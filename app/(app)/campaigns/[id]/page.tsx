import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ArrowLeft, Ban, MailPlus, Pause, Play, RotateCcw } from "lucide-react";
import { cancelCampaign, retryFailed, setCampaignStatus } from "@/app/actions/campaigns";
import { SubmitButton, Time } from "@/components/client";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { Alert, ButtonLink, Card, CardHeader, Progress, Stat, StatusBadge } from "@/components/ui";
import { campaignCounts, EMPTY_COUNTS } from "@/lib/campaigns";
import { db } from "@/lib/db";
import { campaignSenders, campaigns, messages, recipients, replies, senders, MESSAGE_STATUSES, type MessageStatus } from "@/lib/db/schema";
import { estimateSendingDays, isInsideWindow } from "@/lib/time-window";
import { QueueEta } from "@/components/queue-eta";
import { SendTimeEditor } from "@/components/send-time-editor";
import { estimateCampaignQueue, estimateTime, type QueueEstimate } from "@/lib/queue-eta";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; q?: string; page?: string; size?: string; created?: string; skipped?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) notFound();

  const filter = MESSAGE_STATUSES.includes(query.status as MessageStatus) ? (query.status as MessageStatus) : undefined;
  const q = (query.q ?? "").trim();
  // Only these belong in paging links ("created" and "skipped" are one-time notices).
  const listSearch = { status: filter, q: q || undefined, size: query.size };
  const rowFilter = and(
    eq(messages.campaignId, id),
    filter ? eq(messages.status, filter) : undefined,
    q ? or(ilike(recipients.email, `%${q}%`), ilike(recipients.name, `%${q}%`)) : undefined,
  );
  const [filtered] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(recipients, eq(recipients.id, messages.recipientId))
    .where(rowFilter);
  const paging = clampPage(readPage(query, 50), filtered.n);

  const [counts, mailboxes, rows] = await Promise.all([
    campaignCounts([id]).then((m) => m.get(id) ?? EMPTY_COUNTS),
    db
      .select({ email: senders.email, status: senders.status, dailyLimit: senders.dailyLimit })
      .from(campaignSenders)
      .innerJoin(senders, eq(senders.id, campaignSenders.senderId))
      .where(eq(campaignSenders.campaignId, id)),
    db
      .select({
        id: messages.id,
        status: messages.status,
        error: messages.error,
        scheduledAt: messages.scheduledAt,
        sentAt: messages.sentAt,
        openCount: messages.openCount,
        clickCount: messages.clickCount,
        email: recipients.email,
        name: recipients.name,
        sender: senders.email,
        replyId: sql<string | null>`(select r.id from ${replies} r where r.message_id = ${messages.id} order by r.received_at desc limit 1)`,
        replyCount: sql<number>`(select count(*)::int from ${replies} r where r.message_id = ${messages.id})`,
      })
      .from(messages)
      .innerJoin(recipients, eq(recipients.id, messages.recipientId))
      .leftJoin(senders, eq(senders.id, messages.senderId))
      .where(rowFilter)
      .orderBy(desc(sql`${messages.sentAt} is not null`), desc(messages.sentAt), asc(messages.scheduledAt), asc(messages.createdAt), asc(messages.id))
      .limit(paging.pageSize)
      .offset(paging.offset),
  ]);
  const info = pageInfo(paging, filtered.n, rows.length);

  const processed = counts.total - counts.queued - counts.sending;
  // Mailboxes may be shared with other campaigns, so this is an upper bound on speed.
  const capacity = mailboxes.filter((m) => m.status === "active").reduce((sum, m) => sum + m.dailyLimit, 0);
  const daysLeft = estimateSendingDays(counts.queued, capacity);
  const etas: Map<string, QueueEstimate> = counts.queued > 0 ? await estimateCampaignQueue(id) : new Map();
  const timed = [...etas.values()]
    .filter((e) => e.kind === "eta" || e.kind === "scheduled")
    .sort((a, b) => estimateTime(a)!.getTime() - estimateTime(b)!.getTime());
  const nextEta = timed[0];
  const lastEta = timed[timed.length - 1];
  const hasSetTimes = timed.some((e) => e.kind === "scheduled");
  // Fills the time picker: the time it's set for, else when it's expected.
  const pickerTime = (r: { id: string; scheduledAt: Date | null }) => (r.scheduledAt ?? estimateTime(etas.get(r.id)))?.toISOString() ?? null;
  const inWindow = isInsideWindow(new Date(), campaign);
  const canPause = campaign.status === "active";
  const canResume = campaign.status === "paused";
  const open = campaign.status === "active" || campaign.status === "paused";

  const filters = [
    { label: "All", count: counts.total },
    { value: "queued", label: "Waiting", count: counts.queued },
    { value: "sent", label: "No reply yet", count: counts.sentNoReply },
    { value: "replied", label: "Replied", count: counts.replied },
    { value: "bounced", label: "Bounced", count: counts.bounced },
    { value: "failed", label: "Failed", count: counts.failed },
    { value: "cancelled", label: "Cancelled", count: counts.cancelled },
  ].filter((f) => !f.value || f.count > 0 || f.value === filter);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Campaigns
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold md:text-2xl">{campaign.name}</h1>
              <StatusBadge status={campaign.status} />
            </div>
            <p className="mt-1 truncate text-sm text-muted">{campaign.subject}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canPause && (
              <form action={setCampaignStatus.bind(null, id, "paused")}>
                <SubmitButton variant="secondary" size="sm">
                  <Pause className="size-4" /> Pause
                </SubmitButton>
              </form>
            )}
            {canResume && (
              <form action={setCampaignStatus.bind(null, id, "active")}>
                <SubmitButton size="sm">
                  <Play className="size-4" /> Resume
                </SubmitButton>
              </form>
            )}
            {counts.failed > 0 && (
              <form action={retryFailed.bind(null, id)}>
                <SubmitButton variant="secondary" size="sm" confirm="Put failed emails back in the queue? Check the mailbox's Sent folder first if they were interrupted.">
                  <RotateCcw className="size-4" /> Retry failed
                </SubmitButton>
              </form>
            )}
            {counts.sent > 0 && (
              <ButtonLink href={`/campaigns/new?followUp=${id}`} variant="secondary" size="sm">
                <MailPlus className="size-4" /> Follow-up
              </ButtonLink>
            )}
            {open && (
              <form action={cancelCampaign.bind(null, id)}>
                <SubmitButton variant="danger" size="sm" confirm="Cancel this campaign? Emails not yet sent will not go out.">
                  <Ban className="size-4" /> Cancel
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
      </div>

      {query.created && (
        <Alert tone="success" title="Campaign started">
          {query.created} emails queued{Number(query.skipped) > 0 ? `, ${query.skipped} skipped (invalid, duplicate or on the do-not-send list)` : ""}.{" "}
          {hasSetTimes
            ? "Emails with a set time go out at that time; any others go out a few at a time inside the send window."
            : "They go out a few at a time inside the send window."}{" "}
          You can change any email's time below.
        </Alert>
      )}
      {campaign.status === "active" && !inWindow && (
        <Alert tone="info">
          Outside the send window right now ({campaign.windowStart}–{campaign.windowEnd} {campaign.timezone}
          {campaign.weekdaysOnly ? ", weekdays" : ""}). Sending resumes when it opens{hasSetTimes ? "; emails with a set time still go out at that time" : ""}.
        </Alert>
      )}
      {mailboxes.length > 0 && mailboxes.every((m) => m.status !== "active") && open && (
        <Alert tone="warning">All of this campaign's mailboxes are paused, so nothing is sending. Resume one on the Mailboxes page.</Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sent" value={`${counts.sent}/${counts.total}`} hint={`${counts.queued} waiting`} />
        <Stat label="Replied" value={counts.replied} hint={counts.sent ? `${Math.round((counts.replied / counts.sent) * 100)}% of sent` : undefined} />
        <Stat label="Bounced" value={counts.bounced} hint={counts.failed ? `${counts.failed} failed` : undefined} />
        <Stat
          label={campaign.trackOpens || campaign.trackClicks ? "Opened / clicked" : "Tracking"}
          value={campaign.trackOpens || campaign.trackClicks ? `${counts.opened} / ${counts.clicked}` : "Off"}
        />
      </div>

      <Card className="p-4">
        <Progress value={processed} max={counts.total} tone={campaign.status === "done" ? "success" : "primary"} />
        {open && counts.queued > 0 && (
          <p className="mt-3 text-sm">
            {capacity > 0 ? (
              <>
                {counts.queued} still waiting. At up to {capacity} a day from these mailboxes, about{" "}
                <strong>
                  {daysLeft} more sending day{daysLeft === 1 ? "" : "s"}
                </strong>
                . Whatever is left after today's limits continues automatically tomorrow.
                {nextEta && (
                  <span className="mt-1 block text-muted">
                    Next email <QueueEta estimate={nextEta} />
                    {lastEta && lastEta !== nextEta && (
                      <>
                        {" "}· last one around <Time value={estimateTime(lastEta)} />
                      </>
                    )}
                    .
                  </span>
                )}
              </>
            ) : (
              <>{counts.queued} still waiting. No active mailbox is sending for this campaign.</>
            )}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span>
            Window: {campaign.windowStart}–{campaign.windowEnd} {campaign.timezone}
            {campaign.weekdaysOnly ? " · weekdays" : ""}
          </span>
          <span className="break-all">From: {mailboxes.map((m) => m.email).join(", ")}</span>
          <span>
            Created <Time value={campaign.createdAt} />
          </span>
        </div>
      </Card>

      <Card>
        <CardHeader title="Recipients" />
        <div className="space-y-3 border-b px-4 py-3 md:px-5">
          <ListSearch value={q} placeholder="Search recipients by email or name" hidden={{ status: filter, size: query.size }} />
          <FilterChips path={`/campaigns/${id}`} search={listSearch} param="status" options={filters} />
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">{q ? `Nobody matches “${q}”.` : "Nobody here."}</p>
        ) : (
          <>
            {/* Phones: stacked rows */}
            <ul className="divide-y md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/recipients?email=${encodeURIComponent(r.email)}`} className="min-w-0 truncate text-sm font-medium">
                      {r.name ? `${r.name} · ` : ""}
                      {r.email}
                    </Link>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-xs text-muted">
                    {r.sender ?? "mailbox chosen when it sends"} ·{" "}
                    {r.sentAt ? <Time value={r.sentAt} /> : r.status === "queued" ? <QueueEta estimate={etas.get(r.id)} /> : "not sent"}
                    {(r.openCount > 0 || r.clickCount > 0) && ` · ${r.openCount} opens, ${r.clickCount} clicks`}
                  </p>
                  {r.status === "queued" && open && <SendTimeEditor messageId={r.id} current={pickerTime(r)} isSet={Boolean(r.scheduledAt)} />}
                  {r.replyId && (
                    <Link href={`/replies/${r.replyId}`} className="text-xs font-medium text-primary">
                      {r.replyCount > 1 ? `Read ${r.replyCount} replies →` : "Read reply →"}
                    </Link>
                  )}
                  {r.error && r.status !== "sent" && <p className="text-xs break-words text-danger">{r.error}</p>}
                </li>
              ))}
            </ul>

            {/* Tablets and up: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b">
                    <th className="px-5 py-2.5 font-medium">Recipient</th>
                    <th className="px-3 py-2.5 font-medium">Mailbox</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Sent / send time</th>
                    <th className="px-3 py-2.5 text-right font-medium">Opens</th>
                    <th className="px-5 py-2.5 text-right font-medium">Clicks</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="max-w-72 px-5 py-3">
                        <Link href={`/recipients?email=${encodeURIComponent(r.email)}`} className="block truncate font-medium hover:underline">
                          {r.email}
                        </Link>
                        {r.name && <span className="block truncate text-xs text-muted">{r.name}</span>}
                        {r.error && r.status !== "sent" && <span className="block text-xs break-words text-danger">{r.error}</span>}
                      </td>
                      <td className="max-w-56 truncate px-3 py-3 text-muted">{r.sender ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={r.status} />
                          {r.replyId && (
                            <Link href={`/replies/${r.replyId}`} className="text-xs font-medium whitespace-nowrap text-primary hover:underline">
                              {r.replyCount > 1 ? `Read ${r.replyCount}` : "Read"}
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted">
                        {r.sentAt ? (
                          <span className="whitespace-nowrap">
                            <Time value={r.sentAt} />
                          </span>
                        ) : r.status === "queued" ? (
                          <div className="max-w-72 space-y-1">
                            <QueueEta estimate={etas.get(r.id)} className="block text-xs" />
                            {open && <SendTimeEditor messageId={r.id} current={pickerTime(r)} isSet={Boolean(r.scheduledAt)} />}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.openCount}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{r.clickCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Pagination info={info} path={`/campaigns/${id}`} search={listSearch} noun="recipients" />
      </Card>
    </div>
  );
}
