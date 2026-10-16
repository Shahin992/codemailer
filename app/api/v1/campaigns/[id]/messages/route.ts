import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateApi, isUuid } from "@/lib/api";
import { db } from "@/lib/db";
import { campaigns, messages, MESSAGE_STATUSES, recipients, senders, type MessageStatus } from "@/lib/db/schema";
import { apiPagination, clampPage, pageInfo, readApiPage } from "@/lib/pagination";

/** One campaign's emails: who, from which mailbox, and what happened. ?status=sent&q=text&page=1&page_size=50 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authenticateApi(request);
  if (caller instanceof NextResponse) return caller;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = MESSAGE_STATUSES.includes(statusParam as MessageStatus) ? (statusParam as MessageStatus) : undefined;
  const q = (url.searchParams.get("q") ?? "").trim();
  const where = and(
    eq(messages.campaignId, id),
    status ? eq(messages.status, status) : undefined,
    q ? or(ilike(recipients.email, `%${q}%`), ilike(recipients.name, `%${q}%`)) : undefined,
  );

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(recipients, eq(recipients.id, messages.recipientId))
    .where(where);
  const paging = clampPage(readApiPage(url), total);
  const rows = await db
    .select({
      id: messages.id,
      email: recipients.email,
      name: recipients.name,
      status: messages.status,
      mailbox: senders.email,
      subject: messages.subject,
      error: messages.error,
      scheduled_at: messages.scheduledAt,
      sent_at: messages.sentAt,
      replied_at: messages.repliedAt,
      bounced_at: messages.bouncedAt,
      open_count: messages.openCount,
      click_count: messages.clickCount,
    })
    .from(messages)
    .innerJoin(recipients, eq(recipients.id, messages.recipientId))
    .leftJoin(senders, eq(senders.id, messages.senderId))
    .where(where)
    .orderBy(desc(sql`${messages.sentAt} is not null`), desc(messages.sentAt), asc(messages.scheduledAt), asc(messages.createdAt), asc(messages.id))
    .limit(paging.pageSize)
    .offset(paging.offset);

  return NextResponse.json({ messages: rows, pagination: apiPagination(pageInfo(paging, total, rows.length)) });
}
