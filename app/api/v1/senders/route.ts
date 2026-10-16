import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateApi } from "@/lib/api";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { sentLast24h } from "@/lib/queries";

/** Mailboxes you can send from (no passwords or server details). */
export async function GET(request: Request) {
  const caller = await authenticateApi(request);
  if (caller instanceof NextResponse) return caller;
  const rows = await db
    .select({
      id: senders.id,
      email: senders.email,
      display_name: senders.displayName,
      provider: senders.provider,
      status: senders.status,
      daily_limit: senders.dailyLimit,
      sent_last_24h: sentLast24h,
      last_error: senders.lastError,
    })
    .from(senders)
    .orderBy(asc(senders.createdAt));
  return NextResponse.json({ senders: rows });
}
