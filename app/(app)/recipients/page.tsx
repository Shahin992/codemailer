import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { Time } from "@/components/client";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { QueueEta } from "@/components/queue-eta";
import { Alert, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { campaigns, messages, recipients, replies, senders, suppressions } from "@/lib/db/schema";
import { getJobStatus } from "@/lib/job-status";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";
import { snippet } from "@/lib/push";
import { estimateCampaignQueue, estimateTime, type QueueEstimate } from "@/lib/queue-eta";
import { SendTimeEditor } from "@/components/send-time-editor";

export const metadata: Metadata = { title: "Recipients" };

const STATUSES = ["active", "replied", "bounced", "unsubscribed"] as const;
type Search = { email?: string; q?: string; status?: string; contacted?: string; page?: string; size?: string };

export default async function RecipientsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const email = (search.email ?? "").trim().toLowerCase();
  return email ? <RecipientDetail email={email} search={search} /> : <RecipientList search={search} />;
}

/** Everyone ever added to a campaign, newest contact first. */
async function RecipientList({ search }: { search: Search }) {
  const q = (search.q ?? "").trim();
  const status = STATUSES.find((s) => s === search.status);
  const contacted = search.contacted === "no" ? false : search.contacted === "yes" ? true : undefined;

  const where = and(
    q ? or(ilike(recipients.email, `%${q}%`), ilike(recipients.name, `%${q}%`)) : undefined,
    status ? eq(recipients.status, status) : undefined,
    contacted === undefined ? undefined : contacted ? sql`${recipients.lastContactAt} is not null` : sql`${recipients.lastContactAt} is null`,
  );

  const [[{ total }], byStatus] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(recipients).where(where),
    db.select({ status: recipients.status, n: sql<number>`count(*)::int` }).from(recipients).groupBy(recipients.status),
  ]);
  const paging = clampPage(readPage(search), total);
  const rows = await db
    .select({
      id: recipients.id,
      email: recipients.email,
      name: recipients.name,
      status: recipients.status,
      lastContactAt: recipients.lastContactAt,
      mailbox: senders.email,
      sent: sql<number>`(select count(*) from ${messages} m where m.recipient_id = "recipients"."id" and m.sent_at is not null)`.mapWith(Number),
      queued: sql<number>`(select count(*) from ${messages} m where m.recipient_id = "recipients"."id" and m.status = 'queued')`.mapWith(Number),
    })
    .from(recipients)
    .leftJoin(senders, eq(senders.id, recipients.senderId))
    .where(where)
    .orderBy(sql`${recipients.lastContactAt} desc nulls last`, desc(recipients.createdAt), desc(recipients.id))
    .limit(paging.pageSize)
    .offset(paging.offset);
  const info = pageInfo(paging, total, rows.length);
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s.n]));
  const everything = byStatus.reduce((sum, s) => sum + s.n, 0);

  return (
    <>
      <PageHeader title="Recipients" description="Everyone you've added to a campaign: which mailbox owns them, what they were sent, and what happened." />
      <div className="mb-3 space-y-3">
        <ListSearch value={q} placeholder="Search by email or name" hidden={{ status, contacted: search.contacted }} />
        <FilterChips
          path="/recipients"
          search={search}
          param="status"
          options={[
            { label: "All", count: everything },
            { value: "active", label: "Active", count: counts.active ?? 0 },
            { value: "replied", label: "Replied", count: counts.replied ?? 0 },
            { value: "bounced", label: "Bounced", count: counts.bounced ?? 0 },
            { value: "unsubscribed", label: "Unsubscribed", count: counts.unsubscribed ?? 0 },
          ]}
        />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={everything === 0 ? "No recipients yet" : "Nobody matches"}
            description={everything === 0 ? "People show up here once you add them to a campaign." : q ? `Nothing found for “${q}”.` : "Try another filter."}
          />
        ) : (
          <>
            {/* Phones: stacked rows */}
            <ul className="divide-y md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/recipients?email=${encodeURIComponent(r.email)}`} className="block space-y-1 px-4 py-3 hover:bg-neutral-soft">
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">{r.email}</span>
                      <StatusBadge status={r.status} />
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {r.name ? `${r.name} · ` : ""}
                      {r.sent} sent{r.queued ? ` · ${r.queued} waiting` : ""}
                      {r.mailbox ? ` · via ${r.mailbox}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {/* Tablets and up: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b">
                    <th className="px-5 py-2.5 font-medium">Recipient</th>
                    <th className="px-3 py-2.5 font-medium">Their mailbox</th>
                    <th className="px-3 py-2.5 text-right font-medium">Sent</th>
                    <th className="px-3 py-2.5 font-medium">Last contact</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-neutral-soft">
                      <td className="max-w-72 px-5 py-3">
                        <Link href={`/recipients?email=${encodeURIComponent(r.email)}`} className="block truncate font-medium hover:underline">
                          {r.email}
                        </Link>
                        {r.name && <span className="block truncate text-xs text-muted">{r.name}</span>}
                      </td>
                      <td className="max-w-56 truncate px-3 py-3 text-muted">{r.mailbox ?? "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {r.sent}
                        {r.queued > 0 && <span className="block text-xs text-muted">{r.queued} waiting</span>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted">
                        {r.lastContactAt ? <Time value={r.lastContactAt} mode="relative" /> : "Not yet"}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Pagination info={info} path="/recipients" search={search} noun="recipients" />
      </Card>
    </>
  );
}

/** One person: their mailbox, and every email sent to them (paged, newest first) with replies and expected send times. */
async function RecipientDetail({ email, search }: { email: string; search: Search }) {
  const [person] = await db.select().from(recipients).where(eq(recipients.email, email));
  if (!person) {
    return (
      <>
        <BackLink />
        <Card>
          <EmptyState title="Nobody found" description={`${email} hasn't been added to any campaign.`} />
        </Card>
      </>
    );
  }

  const [[{ total }], [{ replyCount }], [owner], [blocked]] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(messages).where(eq(messages.recipientId, person.id)),
    db
      .select({ replyCount: sql<number>`count(*)::int` })
      .from(replies)
      .where(and(eq(replies.recipientId, person.id), eq(replies.isAutoReply, false))),
    person.senderId ? db.select({ email: senders.email }).from(senders).where(eq(senders.id, person.senderId)) : Promise.resolve([]),
    db.select().from(suppressions).where(eq(suppressions.email, person.email)),
  ]);
  const paging = clampPage(readPage(search), total);
  const history = await db
    .select({
      id: messages.id,
      status: messages.status,
      subject: messages.subject,
      scheduledAt: messages.scheduledAt,
      sentAt: messages.sentAt,
      error: messages.error,
      openCount: messages.openCount,
      clickCount: messages.clickCount,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignStatus: campaigns.status,
      mailbox: senders.email,
    })
    .from(messages)
    .innerJoin(campaigns, eq(campaigns.id, messages.campaignId))
    .leftJoin(senders, eq(senders.id, messages.senderId))
    .where(eq(messages.recipientId, person.id))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(paging.pageSize)
    .offset(paging.offset);
  const info = pageInfo(paging, total, history.length);

  const theirReplies = history.length
    ? await db
        .select({ id: replies.id, messageId: replies.messageId, receivedAt: replies.receivedAt, replyText: replies.replyText })
        .from(replies)
        .where(and(inArray(replies.messageId, history.map((m) => m.id)), eq(replies.isAutoReply, false)))
        .orderBy(desc(replies.receivedAt))
    : [];

  // Expected send time for anything on this page that's still queued (one estimate per campaign).
  const etas = new Map<string, QueueEstimate>();
  const queuedCampaigns = [...new Set(history.filter((m) => m.status === "queued").map((m) => m.campaignId))];
  for (const campaignId of queuedCampaigns) {
    for (const [id, estimate] of await estimateCampaignQueue(campaignId)) etas.set(id, estimate);
  }
  const sendJob = queuedCampaigns.length ? (await getJobStatus()).find((j) => j.name === "send") : undefined;

  return (
    <div className="space-y-4">
      <BackLink />
      <Card className="p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-lg font-semibold break-all">{person.email}</h1>
          <StatusBadge status={person.status} />
        </div>
        {person.name && <p className="text-sm text-muted">{person.name}</p>}
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Their mailbox</dt>
            <dd className="font-medium break-all">{owner?.email ?? "Not contacted yet"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">First contact</dt>
            <dd className="font-medium">
              <Time value={person.firstContactAt} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Last contact</dt>
            <dd className="font-medium">
              <Time value={person.lastContactAt} />
            </dd>
          </div>
        </dl>
        {sendJob && !sendJob.healthy && (
          <div className="mt-3">
            <Alert tone="warning" title="Background jobs aren't running">
              Queued emails won't go out until the cron runner is running again. See Settings → Background jobs.
            </Alert>
          </div>
        )}
        {blocked && (
          <div className="mt-3">
            <Alert tone="warning">On the do-not-send list ({blocked.reason}). They won't be emailed again.</Alert>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Timeline"
          description={`${total.toLocaleString()} email${total === 1 ? "" : "s"}, ${replyCount.toLocaleString()} repl${replyCount === 1 ? "y" : "ies"} · newest first`}
        />
        <ol className="divide-y">
          {history.map((m) => {
            const reply = theirReplies.find((r) => r.messageId === m.id);
            return (
              <li key={m.id} className="space-y-1 px-4 py-3 md:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/campaigns/${m.campaignId}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                    {m.campaignName}
                  </Link>
                  <StatusBadge status={m.status} />
                </div>
                <p className="truncate text-sm">{m.subject ?? "Not sent yet"}</p>
                <p className="text-xs break-all text-muted">
                  {m.mailbox ? `from ${m.mailbox}` : "mailbox chosen when it sends"} ·{" "}
                  {m.sentAt ? <Time value={m.sentAt} /> : m.status === "queued" ? <QueueEta estimate={etas.get(m.id)} /> : "not sent"}
                  {(m.openCount > 0 || m.clickCount > 0) && ` · ${m.openCount} opens · ${m.clickCount} clicks`}
                </p>
                {m.status === "queued" && (m.campaignStatus === "active" || m.campaignStatus === "paused") && (
                  <SendTimeEditor
                    messageId={m.id}
                    current={(m.scheduledAt ?? estimateTime(etas.get(m.id)))?.toISOString() ?? null}
                    isSet={Boolean(m.scheduledAt)}
                  />
                )}
                {m.error && m.status !== "sent" && <p className="text-xs break-words text-danger">{m.error}</p>}
                {reply && (
                  <Link href={`/replies/${reply.id}`} className="mt-1 block rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
                    Replied <Time value={reply.receivedAt} mode="relative" />: “{snippet(reply.replyText, 120)}”
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
        <Pagination info={info} path="/recipients" search={{ email: person.email, size: search.size }} noun="emails" />
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/recipients" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
      <ArrowLeft className="size-4" /> Recipients
    </Link>
  );
}
