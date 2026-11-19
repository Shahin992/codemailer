import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, ChevronRight, Clock, Mail, ShieldAlert, ShieldCheck } from "lucide-react";
import { Time } from "@/components/client";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { Badge, Card, EmptyState, cn } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { extractReplyText } from "@/lib/mail/inbound-parse";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";
import { snippet } from "@/lib/push";
import {
  HISTORY_FILTERS,
  messagePreview,
  warmupHistoryStats,
  warmupThreads,
  type HistoryFilter,
  type ThreadSummary,
} from "@/lib/warmup/history";
import { Avatar, Pill } from "./parts";

export const metadata: Metadata = { title: "Warm-up history" };

type Search = { show?: string; q?: string; page?: string; size?: string };

function Tile({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "success" | "warning" | "danger" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-fg";
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", color)}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** One line of what happened in the conversation, most important first. */
function ThreadState({ t }: { t: ThreadSummary }) {
  const icon = "size-3.5";
  return (
    <>
      {t.stillInSpam && <Pill tone="danger" icon={<ShieldAlert className={icon} />}>In spam</Pill>}
      {t.spam && !t.stillInSpam && <Pill tone="warning" icon={<ShieldCheck className={icon} />}>Spam · moved to inbox</Pill>}
      {t.failed && <Pill tone="danger">Failed</Pill>}
      {t.planned && <Pill tone="neutral" icon={<Clock className={icon} />}>Waiting to send</Pill>}
    </>
  );
}

export default async function WarmupHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const me = await requireSession();
  const { id } = await params;
  const search = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [mailbox] = await db.select().from(senders).where(and(eq(senders.id, id), eq(senders.userId, me.id)));
  if (!mailbox) notFound();
  const isPartner = mailbox.warmupRole === "partner";

  const filter = HISTORY_FILTERS.includes(search.show as HistoryFilter) ? (search.show as HistoryFilter) : undefined;
  const q = (search.q ?? "").trim();
  const requested = readPage(search);
  let { total, rows } = await warmupThreads(me.id, id, { filter, q, paging: requested });
  // A page past the end (an old link): show the last page instead.
  const paging = clampPage(requested, total);
  if (paging.page !== requested.page) ({ total, rows } = await warmupThreads(me.id, id, { filter, q, paging }));
  const info = pageInfo(paging, total, rows.length);
  const stats = await warmupHistoryStats(me.id, id);
  const path = `/mailboxes/${id}/warmup`;
  const spamPct = stats.found ? Math.round((stats.spam / stats.found) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/mailboxes/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back to the mailbox
      </Link>

      <div className="flex items-center gap-3">
        <Avatar name={mailbox.displayName} email={mailbox.email} />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Warm-up conversations</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="truncate">{mailbox.email}</span>
            <Badge tone={mailbox.warmupEnabled ? "primary" : "neutral"}>
              {isPartner ? "Partner" : "Business mailbox"}
              {mailbox.warmupEnabled ? "" : " · warm-up off"}
            </Badge>
          </p>
        </div>
      </div>

      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4">
        <Tile label="Conversations" value={stats.conversations} />
        <Tile label="Emails sent" value={stats.sent} />
        <Tile label="Emails received" value={stats.received} />
        {isPartner ? (
          <Tile label="Moved out of its spam" value={stats.rescuedHere} hint="others' emails" tone={stats.rescuedHere ? "warning" : undefined} />
        ) : (
          <Tile
            label="Its emails in spam"
            value={stats.found ? `${spamPct}%` : "—"}
            hint={
              !stats.found
                ? "nothing found yet"
                : stats.spam === 0
                  ? `0 of ${stats.found}`
                  : `${stats.spam} of ${stats.found}, ${stats.movedBack === stats.spam ? "all" : stats.movedBack} moved back`
            }
            tone={!stats.found ? undefined : spamPct === 0 ? "success" : spamPct <= 10 ? "warning" : "danger"}
          />
        )}
      </Card>

      <div className="space-y-3">
        <ListSearch value={q} placeholder="Search by mailbox or subject" hidden={{ show: filter }} />
        <FilterChips
          path={path}
          search={search}
          param="show"
          options={[
            { label: "All" },
            // A partner never starts a conversation, so both of these would list the same ones.
            ...(isPartner
              ? []
              : [
                  { value: "started", label: "Started here" },
                  { value: "received", label: "Started by others" },
                ]),
            { value: "spam", label: "Landed in spam" },
            { value: "planned", label: "Waiting to send" },
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={filter === "planned" && !q ? "Nothing waiting" : q || filter ? "No conversations match" : "No warm-up emails yet"}
            description={
              filter === "planned" && !q
                ? "Emails planned for later today show up here until they're sent."
                : q || filter
                  ? "Try another search or filter."
                  : mailbox.warmupEnabled
                    ? "The first ones go out during your send window. They show up here as soon as they're sent."
                    : "Turn on warm-up on the mailbox page to start."
            }
          />
        ) : (
          <ul className="divide-y">
            {rows.map((t) => (
              <li key={t.threadId}>
                <Link href={`${path}/${t.threadId}`} className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-soft md:px-5">
                  <Avatar name={t.partnerName} email={t.partnerEmail} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-sm">
                        <span className="font-semibold">{t.partnerName || t.partnerEmail}</span>
                        {t.partnerName && <span className="text-muted"> · {t.partnerEmail}</span>}
                      </p>
                      <span className="shrink-0 text-xs text-muted">
                        <Time value={t.lastAt} mode="relative" />
                      </span>
                    </div>
                    <p className={cn("truncate text-sm", t.subject ? "font-medium" : "text-muted italic")}>
                      {t.subject ?? "Text is written when it's sent"}
                    </p>
                    {t.latestText && <p className="truncate text-sm text-muted">{snippet(messagePreview(t.latestText, extractReplyText), 160)}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        {t.startedHere ? <ArrowUpRight className="size-3.5" /> : <ArrowDownLeft className="size-3.5" />}
                        {t.startedHere ? "Started here" : "Started by them"}
                      </span>
                      <span className="text-xs text-muted">·</span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Mail className="size-3.5" />
                        {t.messages} {t.messages === 1 ? "email" : "emails"}
                      </span>
                      <ThreadState t={t} />
                    </div>
                  </div>
                  <ChevronRight className="mt-2 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination info={info} path={path} search={search} noun="conversations" />
      </Card>
    </div>
  );
}
