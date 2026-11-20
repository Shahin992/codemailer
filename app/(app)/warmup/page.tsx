import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ChevronRight, Plus } from "lucide-react";
import { Time } from "@/components/client";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Progress, Stat } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { senders, type Sender } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { dailyTarget, isGmailMailbox, warmupDay } from "@/lib/warmup/schedule";
import { inboxScore, overviewFor, warmupOverview, type WarmupOverview } from "@/lib/warmup/status";
import { Avatar, ScoreRing } from "./parts";

export const metadata: Metadata = { title: "Warm-up" };

/** What keeps a mailbox from taking part, if anything. */
function problem(s: Sender, poolSize: number): string | null {
  if (s.status !== "active") return "Paused";
  if (!s.readInbox || !s.imapHost) return "Inbox not read";
  if (poolSize < 2) return "Needs a second mailbox";
  return null;
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-soft md:px-5">
        {children}
        <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function Who({ s }: { s: Sender }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[15px] font-semibold">{s.email}</p>
      <p className="truncate text-[13px] text-muted">{s.displayName || "No sender name"}</p>
    </div>
  );
}

function BusinessRow({ s, o, day, issue }: { s: Sender; o: WarmupOverview; day: number; issue: string | null }) {
  const score = inboxScore(o.found7d, o.spam7d);
  const target = dailyTarget(s, day);
  return (
    <Row href={`/warmup/${s.id}`}>
      <Avatar name={s.displayName} email={s.email} />
      <div className="min-w-0 flex-1">
        <Who s={s} />
        {/* The ramp: today's number on the way to the maximum (kept to a readable width on big screens). */}
        <div className="md:max-w-md">
          <div className="mt-2 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold">Day {day}</span>
            <span className="text-muted tabular-nums">
              {target} of {s.warmupMax} a day
            </span>
          </div>
          <div className="mt-1">
            <Progress value={target} max={s.warmupMax} tone={target >= s.warmupMax ? "success" : "primary"} />
          </div>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
          <span>
            <span className="font-semibold text-primary tabular-nums">{o.sentToday}</span> sent today
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-semibold text-fg tabular-nums">{o.receivedToday}</span> received
          </span>
          {o.spam7d > 0 && <Badge tone="warning">{o.spam7d} in spam, 7 days</Badge>}
          {issue && <Badge tone="warning">{issue}</Badge>}
        </p>
      </div>
      <ScoreRing score={score} />
    </Row>
  );
}

function PartnerRow({ s, o, issue }: { s: Sender; o: WarmupOverview; issue: string | null }) {
  const score = inboxScore(o.received7d, o.receivedSpam7d);
  return (
    <Row href={`/warmup/${s.id}`}>
      <Avatar name={s.displayName} email={s.email} />
      <div className="min-w-0 flex-1">
        <Who s={s} />
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
          <span>
            <span className="font-semibold text-fg tabular-nums">{o.receivedToday}</span> got today
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-semibold text-primary tabular-nums">{o.sentToday}</span> replied
          </span>
          <span aria-hidden>·</span>
          <span>at most {s.warmupReceiveMax} a day</span>
          {o.receivedSpam7d > 0 && <Badge tone="warning">{o.receivedSpam7d} in its spam, 7 days</Badge>}
          {issue && <Badge tone="warning">{issue}</Badge>}
        </p>
      </div>
      <ScoreRing score={score} label={score === null ? "No data yet" : `${score}% of your mail reached its inbox`} />
    </Row>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="px-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y">{children}</ul>
      </Card>
    </section>
  );
}

export default async function WarmupPage() {
  const me = await requireSession();
  const settings = await getSettings(me.id);
  const all = await db.select().from(senders).where(eq(senders.userId, me.id)).orderBy(asc(senders.createdAt));
  const on = all.filter((s) => s.warmupEnabled);
  const off = all.filter((s) => !s.warmupEnabled);
  const business = on.filter((s) => s.warmupRole !== "partner");
  const partners = on.filter((s) => s.warmupRole === "partner");
  const overview = on.length ? await warmupOverview(me.id, settings.timezone) : new Map<string, WarmupOverview>();
  const now = new Date();

  // Account-wide: its business mailboxes' emails the other side found, and how many were in spam.
  const sum = (list: Sender[], pick: (o: WarmupOverview) => number) => list.reduce((t, s) => t + pick(overviewFor(overview, s.id)), 0);
  const found = sum(business, (o) => o.found7d);
  const spam = sum(business, (o) => o.spam7d);
  const score = inboxScore(found, spam);
  const sentToday = sum(on, (o) => o.sentToday);
  const stillToSend = sum(on, (o) => o.stillToSend);
  const lastAt = on.map((s) => overviewFor(overview, s.id).lastAt).reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);

  return (
    <>
      <PageHeader
        title="Warm-up"
        description={
          on.length
            ? `${business.length} business ${business.length === 1 ? "mailbox" : "mailboxes"}${partners.length ? ` · ${partners.length} ${partners.length === 1 ? "partner" : "partners"}` : ""} warming up`
            : "Mailboxes trade ordinary emails and replies, so new addresses build a normal history before campaigns."
        }
      />

      {all.length === 0 ? (
        <Card>
          <EmptyState
            title="No mailboxes yet"
            description="Connect at least two mailboxes, then turn on warm-up for them; they warm each other up."
            action={
              <ButtonLink href="/mailboxes/new">
                <Plus className="size-4" /> Add mailbox
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {on.length > 0 && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Inbox score, 7 days"
                value={score === null ? "—" : `${score}%`}
                hint={score === null ? "Shows once emails are found" : `${found - spam} of ${found} reached the inbox`}
              />
              <Stat label="Sent today" value={sentToday} hint={stillToSend ? `${stillToSend} still to go today` : "Nothing else planned today"} />
              <Stat label="In spam, 7 days" value={spam} hint={found ? `of ${found} found by the other mailboxes` : "Nothing found yet"} />
              <Stat label="Last warm-up email" value={lastAt ? <Time value={lastAt} mode="relative" /> : "—"} hint="Sent or received" />
            </div>
          )}

          {business.length > 0 && (
            <Section title={`Business mailboxes · ${business.length}`} hint="Send and reply every day, on a slowly growing ramp. The ring is their inbox score.">
              {business.map((s) => (
                <BusinessRow
                  key={s.id}
                  s={s}
                  o={overviewFor(overview, s.id)}
                  day={s.warmupStartedAt ? warmupDay(s.warmupStartedAt, now, settings.timezone, settings.weekdaysOnly) : 1}
                  issue={problem(s, on.length)}
                />
              ))}
            </Section>
          )}

          {partners.length > 0 && (
            <Section title={`Partners · ${partners.length}`} hint="Only receive and reply. The ring is how much of your mail reached their inbox.">
              {partners.map((s) => (
                <PartnerRow key={s.id} s={s} o={overviewFor(overview, s.id)} issue={problem(s, on.length)} />
              ))}
            </Section>
          )}

          {on.length === 0 && (
            <Card>
              <EmptyState
                title="No mailbox is warming up"
                description="Open a mailbox below and turn warm-up on in its Settings tab. Turn it on for at least two; they warm each other up."
              />
            </Card>
          )}

          {off.length > 0 && (
            <Section title={`Warm-up off · ${off.length}`} hint="Open one to turn warm-up on.">
              {off.map((s) => (
                <Row key={s.id} href={`/warmup/${s.id}?tab=settings`}>
                  <Avatar name={s.displayName} email={s.email} />
                  <div className="min-w-0 flex-1">
                    <Who s={s} />
                    {isGmailMailbox(s) && <p className="mt-1 text-xs text-muted">A Gmail account: a good warm-up partner.</p>}
                  </div>
                  <Badge>{!s.readInbox || !s.imapHost ? "Inbox not read" : "Off"}</Badge>
                </Row>
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}
