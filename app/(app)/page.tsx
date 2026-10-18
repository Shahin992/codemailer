import Link from "next/link";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Time } from "@/components/client";
import { Alert, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Progress, Stat, StatusBadge } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaigns, messages, replies, senders } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";
import { getJobStatus } from "@/lib/job-status";
import { snippet } from "@/lib/push";
import { sentLast24h } from "@/lib/queries";
import { PushToggle } from "./replies/push-toggle";

const since = (days: number) => sql`now() - make_interval(days => ${days}::int)`;

export default async function DashboardPage() {
  const me = await requireSession();
  const [mailboxes, [day], [week], [unread], active, latest, jobs] = await Promise.all([
    db.select({ sender: senders, sent24h: sentLast24h }).from(senders).where(eq(senders.userId, me.id)).orderBy(asc(senders.createdAt)),
    db.select({ sent: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.userId, me.id), gt(messages.sentAt, since(1)))),
    db
      .select({
        sent: sql<number>`count(*) filter (where ${messages.sentAt} > now() - interval '7 days')::int`,
        bounced: sql<number>`count(*) filter (where ${messages.bouncedAt} > now() - interval '7 days')::int`,
        replied: sql<number>`count(*) filter (where ${messages.repliedAt} > now() - interval '7 days')::int`,
      })
      .from(messages)
      .where(eq(messages.userId, me.id)),
    db.select({ n: sql<number>`count(*)::int` }).from(replies).where(and(eq(replies.userId, me.id), isNull(replies.readAt), eq(replies.isAutoReply, false))),
    db.select().from(campaigns).where(and(eq(campaigns.userId, me.id), eq(campaigns.status, "active"))).orderBy(desc(campaigns.createdAt)).limit(5),
    db
      .select({ id: replies.id, fromEmail: replies.fromEmail, fromName: replies.fromName, replyText: replies.replyText, receivedAt: replies.receivedAt, readAt: replies.readAt })
      .from(replies)
      .where(and(eq(replies.userId, me.id), eq(replies.isAutoReply, false)))
      .orderBy(desc(replies.receivedAt))
      .limit(5),
    getJobStatus(),
  ]);

  const activeBoxes = mailboxes.filter((m) => m.sender.status === "active");
  const capacity = activeBoxes.reduce((sum, m) => sum + m.sender.dailyLimit, 0);
  const problems = mailboxes.filter((m) => m.sender.status === "paused" && m.sender.lastError);
  const cronDown = jobs.some((j) => !j.healthy);

  return (
    <>
      <PageHeader
        title="Dashboard"
        action={
          <ButtonLink href="/campaigns/new">
            <Plus className="size-4" /> New campaign
          </ButtonLink>
        }
      />

      <div className="mb-5 space-y-3">
        {mailboxes.length === 0 && (
          <Alert tone="info" title="Start by adding a mailbox">
            <Link href="/mailboxes/new" className="underline">
              Connect a Hostinger or Gmail mailbox
            </Link>{" "}
            so campaigns have something to send from.
          </Alert>
        )}
        {cronDown && (
          <Alert tone="warning" title="Background jobs are not running">
            Nothing sends and replies aren't checked until the cron runner is running again (on the server:{" "}
            <code>docker compose restart cron</code>).
          </Alert>
        )}
        {problems.map(({ sender }) => (
          <Alert key={sender.id} tone="danger" title={`${sender.email} is paused`}>
            {sender.lastError}{" "}
            <Link href={`/mailboxes/${sender.id}`} className="underline">
              Fix it
            </Link>
          </Alert>
        ))}
      </div>

      <PushToggle vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? ""} compact />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sent today" value={day.sent} hint={`of ${capacity} a day across ${activeBoxes.length} mailboxes`} />
        <Stat label="Unread replies" value={unread.n} hint={`${week.replied} replies in 7 days`} href="/replies?show=unread" />
        <Stat label="Sent this week" value={week.sent} hint={week.sent ? `${Math.round((week.replied / week.sent) * 100)}% reply rate` : undefined} />
        <Stat
          label="Bounced this week"
          value={week.bounced}
          hint={week.sent ? `${((week.bounced / week.sent) * 100).toFixed(1)}% · keep under 2%` : undefined}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Mailboxes today" action={<Link href="/mailboxes" className="text-sm text-primary">Manage</Link>} />
          {mailboxes.length === 0 ? (
            <EmptyState title="No mailboxes" action={<ButtonLink href="/mailboxes/new" size="sm">Add mailbox</ButtonLink>} />
          ) : (
            <ul className="divide-y">
              {mailboxes.map(({ sender, sent24h }) => (
                <li key={sender.id}>
                  <Link href={`/mailboxes/${sender.id}`} className="block px-4 py-3 hover:bg-neutral-soft md:px-5">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{sender.email}</span>
                      {sender.status === "active" ? (
                        <span className="shrink-0 tabular-nums text-muted">
                          {sent24h}/{sender.dailyLimit}
                        </span>
                      ) : (
                        <StatusBadge status={sender.status} />
                      )}
                    </div>
                    <Progress value={sent24h} max={sender.dailyLimit} tone={sender.status === "active" ? "primary" : "warning"} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Latest replies" action={<Link href="/replies" className="text-sm text-primary">All replies</Link>} />
          {latest.length === 0 ? (
            <EmptyState title="No replies yet" description="Replies appear here within a few minutes of arriving." />
          ) : (
            <ul className="divide-y">
              {latest.map((r) => (
                <li key={r.id}>
                  <Link href={`/replies/${r.id}`} className="block px-4 py-3 hover:bg-neutral-soft md:px-5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${r.readAt ? "" : "font-semibold"}`}>{r.fromName || r.fromEmail}</span>
                      <span className="shrink-0 text-xs text-muted">
                        <Time value={r.receivedAt} mode="relative" />
                      </span>
                    </div>
                    <p className="truncate text-sm text-muted">{snippet(r.replyText, 120)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Sending now" action={<Link href="/campaigns" className="text-sm text-primary">All campaigns</Link>} />
        {active.length === 0 ? (
          <EmptyState title="No active campaigns" action={<ButtonLink href="/campaigns/new" size="sm">New campaign</ButtonLink>} />
        ) : (
          <ul className="divide-y">
            {active.map((c) => (
              <li key={c.id}>
                <Link href={`/campaigns/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-soft md:px-5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-muted">{c.subject}</span>
                  </span>
                  <StatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
