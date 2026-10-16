import { and, desc, eq, gt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateApi } from "@/lib/api";
import { db } from "@/lib/db";
import { messages, replies, senders } from "@/lib/db/schema";
import { apiPagination, clampPage, pageInfo, readApiPage } from "@/lib/pagination";

/**
 * Replies, newest first. ?since=ISO-date limits to replies received after that time;
 * ?include_auto=true adds out-of-office replies; ?page=1&page_size=50 pages through the rest.
 */
export async function GET(request: Request) {
  const caller = await authenticateApi(request);
  if (caller instanceof NextResponse) return caller;
  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const sinceDate = since ? new Date(since) : null;
  if (sinceDate && Number.isNaN(sinceDate.getTime())) return NextResponse.json({ error: "since must be an ISO date" }, { status: 400 });
  const includeAuto = url.searchParams.get("include_auto") === "true";
  if (!url.searchParams.has("page_size") && url.searchParams.has("limit")) url.searchParams.set("page_size", url.searchParams.get("limit")!); // older clients

  const where = and(sinceDate ? gt(replies.receivedAt, sinceDate) : undefined, includeAuto ? undefined : eq(replies.isAutoReply, false));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(replies).where(where);
  const paging = clampPage(readApiPage(url), total);

  const rows = await db
    .select({
      id: replies.id,
      from_email: replies.fromEmail,
      from_name: replies.fromName,
      subject: replies.subject,
      reply_text: replies.replyText,
      is_auto_reply: replies.isAutoReply,
      received_at: replies.receivedAt,
      mailbox: senders.email,
      message_id: replies.messageId,
      campaign_id: messages.campaignId,
    })
    .from(replies)
    .innerJoin(senders, eq(senders.id, replies.senderId))
    .leftJoin(messages, eq(messages.id, replies.messageId))
    .where(where)
    .orderBy(desc(replies.receivedAt), desc(replies.id))
    .limit(paging.pageSize)
    .offset(paging.offset);
  return NextResponse.json({ replies: rows, pagination: apiPagination(pageInfo(paging, total, rows.length)) });
}
