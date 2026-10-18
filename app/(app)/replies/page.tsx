import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Paperclip } from "lucide-react";
import { markAllRepliesRead } from "@/app/actions/replies";
import { SubmitButton, Time } from "@/components/client";
import { FilterChips, ListSearch, Pagination } from "@/components/pagination";
import { Badge, Card, EmptyState, PageHeader, cn } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { clampPage, pageInfo, readPage } from "@/lib/pagination";
import { db } from "@/lib/db";
import { campaigns, messages, replies, senders } from "@/lib/db/schema";
import { snippet } from "@/lib/push";
import { PushToggle } from "./push-toggle";
import { optionalEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Replies" };

type Search = { show?: string; q?: string; page?: string; size?: string };

export default async function RepliesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireSession();
  const search = await searchParams;
  const view = search.show === "unread" || search.show === "auto" ? search.show : "all";
  const q = (search.q ?? "").trim();
  const where = and(
    eq(replies.userId, me.id),
    view === "unread"
      ? and(isNull(replies.readAt), eq(replies.isAutoReply, false))
      : view === "auto"
        ? eq(replies.isAutoReply, true)
        : eq(replies.isAutoReply, false),
    q ? or(ilike(replies.fromEmail, `%${q}%`), ilike(replies.fromName, `%${q}%`), ilike(replies.subject, `%${q}%`)) : undefined,
  );

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(replies).where(where);
  const paging = clampPage(readPage(search), total);

  const rows = await db
    .select({
      id: replies.id,
      fromEmail: replies.fromEmail,
      fromName: replies.fromName,
      subject: replies.subject,
      replyText: replies.replyText,
      receivedAt: replies.receivedAt,
      readAt: replies.readAt,
      attachments: replies.attachments,
      mailbox: senders.email,
      campaign: campaigns.name,
      isAutoReply: replies.isAutoReply,
      // When someone answers the same email more than once: which reply this is, and how many there are.
      // The outer row is written as "replies"."…" on purpose (see lib/queries.ts); inside, r2 is the other replies.
      threadPosition: sql<number>`(select count(*)::int from ${replies} r2 where r2.message_id = "replies"."message_id" and not r2.is_auto_reply and (r2.received_at, r2.id) <= ("replies"."received_at", "replies"."id"))`,
      threadSize: sql<number>`(select count(*)::int from ${replies} r2 where r2.message_id = "replies"."message_id" and not r2.is_auto_reply)`,
    })
    .from(replies)
    .innerJoin(senders, eq(senders.id, replies.senderId))
    .leftJoin(messages, eq(messages.id, replies.messageId))
    .leftJoin(campaigns, eq(campaigns.id, messages.campaignId))
    .where(where)
    .orderBy(desc(replies.receivedAt), desc(replies.id))
    .limit(paging.pageSize)
    .offset(paging.offset);
  const info = pageInfo(paging, total, rows.length);

  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(replies)
    .where(and(eq(replies.userId, me.id), isNull(replies.readAt), eq(replies.isAutoReply, false)));

  return (
    <>
      <PageHeader
        title="Replies"
        description="Answers to your emails, matched to the campaign and mailbox. Checked every few minutes."
        action={
          unread.n > 0 ? (
            <form action={markAllRepliesRead}>
              <SubmitButton variant="secondary" size="sm">
                Mark all read
              </SubmitButton>
            </form>
          ) : undefined
        }
      />

      <PushToggle vapidPublicKey={optionalEnv("VAPID_PUBLIC_KEY") ?? ""} compact />

      <div className="mb-3 space-y-3">
        <ListSearch value={q} placeholder="Search by sender or subject" hidden={{ show: view === "all" ? undefined : view }} />
        <FilterChips
          path="/replies"
          search={search}
          param="show"
          options={[
            { label: "All replies" },
            { value: "unread", label: "Unread", count: unread.n },
            { value: "auto", label: "Auto-replies" },
          ]}
        />
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={q ? "No replies match" : view === "unread" ? "All caught up" : "No replies yet"}
            description="When someone answers, it shows up here and on your phone if notifications are on."
          />
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/replies/${r.id}`} className="flex gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-soft md:px-5">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", r.readAt ? "bg-transparent" : "bg-primary")} aria-label={r.readAt ? undefined : "Unread"} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", !r.readAt && "font-semibold")}>{r.fromName || r.fromEmail}</span>
                      <span className="shrink-0 text-xs text-muted">
                        <Time value={r.receivedAt} mode="relative" />
                      </span>
                    </span>
                    <span className="block truncate text-sm">{r.subject || "(no subject)"}</span>
                    <span className="block truncate text-sm text-muted">{snippet(r.replyText, 160)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span className="truncate">to {r.mailbox}</span>
                      {r.campaign && <Badge>{r.campaign}</Badge>}
                      {!r.isAutoReply && r.threadSize > 1 && (
                        <Badge tone="primary">
                          reply {r.threadPosition} of {r.threadSize}
                        </Badge>
                      )}
                      {r.attachments.length > 0 && <Paperclip className="size-3.5" aria-label="Has attachments" />}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination info={info} path="/replies" search={search} noun="replies" />
      </Card>
    </>
  );
}
