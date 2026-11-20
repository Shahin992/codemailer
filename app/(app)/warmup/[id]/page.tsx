import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge, Card, CardHeader, SectionTabs, StatusBadge } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { warmupThreads } from "@/lib/warmup/history";
import { overviewFor, warmupDaily, warmupDetail, warmupOverview } from "@/lib/warmup/status";
import { Avatar } from "../parts";
import { ConversationsTab, type ConversationSearch } from "./conversations";
import { OverviewTab } from "./overview";
import { WarmupSettingsForm, WarmupSwitch } from "./warmup-controls";

export const metadata: Metadata = { title: "Warm-up" };

const TABS = ["overview", "conversations", "settings"] as const;
type Tab = (typeof TABS)[number];

export default async function WarmupMailboxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ConversationSearch> }) {
  const me = await requireSession();
  const { id } = await params;
  const search = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [sender] = await db.select().from(senders).where(and(eq(senders.id, id), eq(senders.userId, me.id)));
  if (!sender) notFound();
  const tab: Tab = TABS.includes(search.tab as Tab) ? (search.tab as Tab) : "overview";
  const settings = await getSettings(me.id);
  const isPartner = sender.warmupRole === "partner";
  const noInbox = !sender.readInbox || !sender.imapHost;

  const [detail, days, latest, overview] = await Promise.all([
    warmupDetail(sender, settings.timezone, settings.weekdaysOnly),
    tab === "overview" ? warmupDaily(sender.id, settings.timezone) : null,
    tab === "overview" ? warmupThreads(me.id, sender.id, { paging: { page: 1, pageSize: 5, offset: 0 } }) : null,
    tab === "overview" ? warmupOverview(me.id, settings.timezone) : null,
  ]);
  const base = `/warmup/${sender.id}`;
  const window = `${settings.windowStart}–${settings.windowEnd} ${settings.timezone}${settings.weekdaysOnly ? ", weekdays only" : ", every day"}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/warmup" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Warm-up
        </Link>
        <div className="flex items-center gap-3">
          <Avatar name={sender.displayName} email={sender.email} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-[20px] leading-tight font-bold tracking-tight md:text-[24px]">{sender.email}</h1>
            <p className="truncate text-sm text-muted">{sender.displayName || "No sender name"}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {sender.warmupEnabled ? (
            <Badge tone="primary">{isPartner ? "Partner" : detail.day ? `Warm-up day ${detail.day}` : "Warm-up on"}</Badge>
          ) : (
            <Badge>Warm-up off</Badge>
          )}
          <Badge>{isPartner ? "Only receives and replies" : "Business mailbox"}</Badge>
          {sender.status !== "active" && <StatusBadge status={sender.status} />}
          <Link href={`/mailboxes/${sender.id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Mailbox page <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </div>

      <SectionTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: base },
          {
            key: "conversations",
            // "Conversations" doesn't fit a phone's tab; "Emails" says the same.
            label: (
              <>
                <span className="sm:hidden">Emails</span>
                <span className="hidden sm:inline">Conversations</span>
              </>
            ),
            href: `${base}?tab=conversations`,
          },
          { key: "settings", label: "Settings", href: `${base}?tab=settings` },
        ]}
      />

      {tab === "overview" && days && overview && latest && (
        <OverviewTab
          sender={sender}
          detail={detail}
          days={days}
          recent={latest.rows}
          totalConversations={latest.total}
          receivedSpam={overviewFor(overview, sender.id).receivedSpam7d}
        />
      )}

      {tab === "conversations" && <ConversationsTab userId={me.id} mailbox={sender} search={search} />}

      {tab === "settings" && (
        <>
          <Card>
            <CardHeader
              title={sender.warmupEnabled ? "Warm-up is on" : "Warm-up is off"}
              description={
                isPartner
                  ? "Receives warm-up emails from your business mailboxes and replies. Never starts threads or sends campaigns."
                  : "Trades ordinary emails and replies with your other warm-up mailboxes, so this address builds a normal history."
              }
            />
            <div className="p-4 md:p-5">
              <WarmupSwitch
                id={sender.id}
                enabled={sender.warmupEnabled}
                disabledReason={noInbox ? "Warm-up needs a mailbox whose inbox ColdMailer reads (IMAP), so it can find warm-up emails and reply." : undefined}
              />
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Warm-up settings"
              description={
                <>
                  {isPartner
                    ? `Replies go out 20 minutes to 5 hours after a warm-up email arrives, inside your send window (${window}; change it in Settings).`
                    : `New emails go out at random times inside your send window (${window}; change it in Settings), and replies follow 15 minutes to 3 hours later.`}
                  {!isPartner && detail.maxReachedOnDay && ` With these numbers it reaches ${sender.warmupMax} a day on day ${detail.maxReachedOnDay}.`}
                  {!isPartner && settings.weekdaysOnly && " Only weekdays count as warm-up days, so it never jumps ahead after a weekend."}
                </>
              }
            />
            <div className="p-4 md:p-5">
              <WarmupSettingsForm
                id={sender.id}
                values={{
                  warmupRole: sender.warmupRole,
                  warmupStart: sender.warmupStart,
                  warmupIncrease: sender.warmupIncrease,
                  warmupMax: sender.warmupMax,
                  warmupReplyRate: sender.warmupReplyRate,
                  warmupReceiveMax: sender.warmupReceiveMax,
                }}
              />
            </div>
          </Card>
          <p className="px-1 text-xs text-muted">
            The sender name, daily limit and connection are on the{" "}
            <Link href={`/mailboxes/${sender.id}?tab=settings`} className="font-semibold text-primary hover:underline">
              mailbox page
            </Link>
            . Warm-up and campaigns share the daily limit.
          </p>
        </>
      )}
    </div>
  );
}
