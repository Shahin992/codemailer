// Warm-up conversations of one mailbox, for the history pages (/mailboxes/[id]/warmup).
// A conversation is a thread: the first email plus its reply and closing, always between the same two mailboxes.
// Cancelled emails (dropped plans) are left out; they never went anywhere.
import { aliasedTable, and, asc, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { senders, warmupMessages, type WarmupMessage } from "@/lib/db/schema";
import type { PageParams } from "@/lib/pagination";

export const HISTORY_FILTERS = ["started", "received", "spam", "planned"] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export type ThreadSummary = {
  threadId: string;
  subject: string | null;
  startedHere: boolean;
  partnerEmail: string;
  partnerName: string | null;
  messages: number;
  lastAt: Date;
  latestText: string | null;
  spam: boolean; // some email in it landed in spam
  stillInSpam: boolean; // …and wasn't moved out yet
  planned: boolean; // an email in it is still waiting to go out
  failed: boolean;
};

const n = (expr: SQL) => sql<number>`(${expr})::int`.mapWith(Number);

/** One page of a mailbox's warm-up conversations, newest activity first, with the total count. */
export async function warmupThreads(
  userId: string,
  mailboxId: string,
  options: { filter?: HistoryFilter; q?: string; paging: PageParams },
): Promise<{ total: number; rows: ThreadSummary[] }> {
  const w = warmupMessages;
  const root = aliasedTable(warmupMessages, "root");
  const partner = aliasedTable(senders, "partner");
  const { filter, q, paging } = options;

  // Every email of a thread is between the same two mailboxes, so the first email says who the other one is.
  const partnerId = sql`case when ${root.senderId} = ${mailboxId} then ${root.toSenderId} else ${root.senderId} end`;
  const where = and(
    eq(w.userId, userId),
    ne(w.status, "cancelled"),
    or(eq(root.senderId, mailboxId), eq(root.toSenderId, mailboxId)),
    filter === "started" ? eq(root.senderId, mailboxId) : undefined,
    filter === "received" ? eq(root.toSenderId, mailboxId) : undefined,
    q ? or(ilike(root.subject, `%${q}%`), ilike(partner.email, `%${q}%`), ilike(partner.displayName, `%${q}%`)) : undefined,
  );
  // The history is what was sent; conversations that haven't started yet are under "Waiting to send".
  const having =
    filter === "planned"
      ? sql`bool_or(${w.status} in ('scheduled', 'sending'))`
      : and(sql`bool_or(${w.status} in ('sent', 'failed'))`, filter === "spam" ? sql`bool_or(${w.landedIn} = 'spam')` : undefined);

  const grouped = db
    .select({
      threadId: w.threadId,
      subject: root.subject,
      startedHere: sql<boolean>`${root.senderId} = ${mailboxId}`,
      partnerEmail: partner.email,
      partnerName: partner.displayName,
      messages: n(sql`count(*)`),
      lastAt: sql<Date>`max(coalesce(${w.sentAt}, ${w.scheduledAt}))`.mapWith((v) => new Date(v)),
      latestText: sql<string | null>`(
        select l.body_text from ${warmupMessages} l
        where l.thread_id = ${w.threadId} and l.status = 'sent'
        order by l.sent_at desc limit 1
      )`,
      spam: sql<boolean>`bool_or(${w.landedIn} = 'spam')`,
      stillInSpam: sql<boolean>`bool_or(${w.landedIn} = 'spam' and ${w.rescuedAt} is null)`,
      planned: sql<boolean>`bool_or(${w.status} in ('scheduled', 'sending'))`,
      failed: sql<boolean>`bool_or(${w.status} = 'failed')`,
    })
    .from(w)
    .innerJoin(root, eq(root.id, w.threadId))
    .innerJoin(partner, eq(partner.id, partnerId))
    .where(where)
    .groupBy(w.threadId, root.subject, root.senderId, partner.email, partner.displayName)
    .having(having);

  const [{ total }] = await db.select({ total: n(sql`count(*)`) }).from(grouped.as("threads"));
  const rows = await grouped
    .orderBy(desc(sql`max(coalesce(${w.sentAt}, ${w.scheduledAt}))`), desc(w.threadId))
    .limit(paging.pageSize)
    .offset(paging.offset);
  return { total, rows };
}

export type ThreadMessage = WarmupMessage & { fromEmail: string; fromName: string | null; toEmail: string; toName: string | null };

/** Every email of one conversation, oldest first, if it belongs to this mailbox (and so to this account). */
export async function warmupThread(userId: string, mailboxId: string, threadId: string): Promise<ThreadMessage[] | null> {
  const w = warmupMessages;
  const fromBox = aliasedTable(senders, "from_box");
  const toBox = aliasedTable(senders, "to_box");
  const rows = await db
    .select({ row: w, fromEmail: fromBox.email, fromName: fromBox.displayName, toEmail: toBox.email, toName: toBox.displayName })
    .from(w)
    .innerJoin(fromBox, eq(fromBox.id, w.senderId))
    .innerJoin(toBox, eq(toBox.id, w.toSenderId))
    .where(and(eq(w.userId, userId), eq(w.threadId, threadId), ne(w.status, "cancelled")))
    .orderBy(asc(sql`coalesce(${w.sentAt}, ${w.scheduledAt})`), asc(w.createdAt));
  if (!rows.length) return null;
  if (!rows.every(({ row }) => row.senderId === mailboxId || row.toSenderId === mailboxId)) return null;
  return rows.map(({ row, ...names }) => ({ ...row, ...names }));
}

/**
 * The message itself, for a one-line preview: without the quoted earlier emails, the greeting ("Hi Anna,")
 * and the sign-off ("Kind regards,\nBen").
 */
export function messagePreview(text: string, extract: (t: string) => string): string {
  const parts = extract(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && parts[0].length <= 40 && /[,!]$/.test(parts[0]) && !/[.?]/.test(parts[0])) parts.shift();
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last && last.split("\n").length <= 2 && last.length <= 40) parts.pop();
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export type HistoryStats = {
  conversations: number;
  sent: number;
  received: number;
  /** Its emails the other mailbox found, and how many of those landed in spam / were moved back. */
  found: number;
  spam: number;
  movedBack: number;
  /** Others' emails that landed in this mailbox's spam and were moved out. */
  rescuedHere: number;
};

/** All-time numbers for the top of the history page. */
export async function warmupHistoryStats(userId: string, mailboxId: string): Promise<HistoryStats> {
  const w = warmupMessages;
  const mine = sql`${w.senderId} = ${mailboxId}`;
  const theirs = sql`${w.toSenderId} = ${mailboxId}`;
  const [row] = await db
    .select({
      conversations: n(sql`count(distinct ${w.threadId}) filter (where ${w.status} in ('sent', 'failed'))`),
      sent: n(sql`count(*) filter (where ${mine} and ${w.status} = 'sent')`),
      received: n(sql`count(*) filter (where ${theirs} and ${w.receivedAt} is not null)`),
      found: n(sql`count(*) filter (where ${mine} and ${w.receivedAt} is not null)`),
      spam: n(sql`count(*) filter (where ${mine} and ${w.landedIn} = 'spam')`),
      movedBack: n(sql`count(*) filter (where ${mine} and ${w.landedIn} = 'spam' and ${w.rescuedAt} is not null)`),
      rescuedHere: n(sql`count(*) filter (where ${theirs} and ${w.landedIn} = 'spam' and ${w.rescuedAt} is not null)`),
    })
    .from(w)
    .where(and(eq(w.userId, userId), or(eq(w.senderId, mailboxId), eq(w.toSenderId, mailboxId))));
  return row;
}
