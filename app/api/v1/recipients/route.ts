import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateApi } from "@/lib/api";
import { db } from "@/lib/db";
import { messages, recipients, senders } from "@/lib/db/schema";
import { apiPagination, clampPage, pageInfo, readApiPage } from "@/lib/pagination";

const STATUSES = ["active", "replied", "bounced", "unsubscribed"] as const;

/** Everyone you've emailed, most recently contacted first. ?status=replied&q=text&page=1&page_size=50 */
export async function GET(request: Request) {
  const caller = await authenticateApi(request);
  if (caller instanceof NextResponse) return caller;
  const url = new URL(request.url);
  const status = STATUSES.find((s) => s === url.searchParams.get("status"));
  const q = (url.searchParams.get("q") ?? "").trim();
  const where = and(
    status ? eq(recipients.status, status) : undefined,
    q ? or(ilike(recipients.email, `%${q}%`), ilike(recipients.name, `%${q}%`)) : undefined,
  );

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(recipients).where(where);
  const paging = clampPage(readApiPage(url), total);
  const rows = await db
    .select({
      email: recipients.email,
      name: recipients.name,
      status: recipients.status,
      mailbox: senders.email,
      first_contact_at: recipients.firstContactAt,
      last_contact_at: recipients.lastContactAt,
      sent: sql<number>`(select count(*) from ${messages} m where m.recipient_id = "recipients"."id" and m.sent_at is not null)`.mapWith(Number),
    })
    .from(recipients)
    .leftJoin(senders, eq(senders.id, recipients.senderId))
    .where(where)
    .orderBy(sql`${recipients.lastContactAt} desc nulls last`, desc(recipients.createdAt), desc(recipients.id))
    .limit(paging.pageSize)
    .offset(paging.offset);

  return NextResponse.json({ recipients: rows, pagination: apiPagination(pageInfo(paging, total, rows.length)) });
}
