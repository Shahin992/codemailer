// Numbers for the warm-up views (the Warm-up menu, its mailbox pages and the Mailboxes list).
import { aliasedTable, and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { senders, warmupMessages, type Sender } from "@/lib/db/schema";
import { localDate, zonedInputToDate } from "@/lib/time-window";
import { canWarmUp, dailyTarget, isGmailMailbox, warmupDay } from "@/lib/warmup/schedule";

const WEEK = sql`now() - interval '7 days'`;

/** Midnight to midnight today on the account's clock. */
function todayRange(timeZone: string, now = new Date()) {
  const day = localDate(now, timeZone);
  const start = zonedInputToDate(`${day}T00:00`, timeZone) ?? now;
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

const n = (expr: ReturnType<typeof sql>) => sql<number>`(${expr})::int`.mapWith(Number);

export type WarmupSummary = { sentToday: number; found7d: number; spam7d: number };

/** Per mailbox of an account: warm-up emails sent today and where its emails landed in the last 7 days. */
export async function warmupSummaries(userId: string, timeZone: string): Promise<Map<string, WarmupSummary>> {
  const { start } = todayRange(timeZone);
  const rows = await db
    .select({
      senderId: warmupMessages.senderId,
      sentToday: n(sql`count(*) filter (where ${warmupMessages.sentAt} >= ${start.toISOString()}::timestamptz)`),
      found7d: n(sql`count(*) filter (where ${warmupMessages.receivedAt} is not null and ${warmupMessages.sentAt} > ${WEEK})`),
      spam7d: n(sql`count(*) filter (where ${warmupMessages.landedIn} = 'spam' and ${warmupMessages.sentAt} > ${WEEK})`),
    })
    .from(warmupMessages)
    .where(eq(warmupMessages.userId, userId))
    .groupBy(warmupMessages.senderId);
  return new Map(rows.map(({ senderId, ...rest }) => [senderId, rest]));
}

export type WarmupActivity = {
  id: string;
  threadId: string;
  direction: "out" | "in";
  partner: string;
  partnerName: string | null;
  isReply: boolean;
  subject: string | null;
  status: string;
  at: Date;
  landedIn: "inbox" | "spam" | null;
  rescuedAt: Date | null;
  receivedAt: Date | null;
  error: string | null;
};

export type WarmupDetail = {
  day: number | null;
  target: number | null;
  maxReachedOnDay: number | null;
  /** The other warm-up mailboxes it trades with, and whether each is a partner / on Gmail. */
  partners: { email: string; partner: boolean; gmail: boolean }[];
  today: { newSent: number; repliesSent: number; stillToSend: number; received: number; receivedNew: number };
  week: {
    sent: number;
    found: number;
    spam: number;
    movedBack: number;
    /** Its emails found by Gmail mailboxes (partners): the inbox placement that matters most. */
    gmailFound: number;
    gmailSpam: number;
    gmailMovedBack: number;
    notFound: number;
    failed: number;
    received: number;
    repliesReceived: number;
    repliesSent: number;
    rescuedHere: number;
  };
  allTime: { sent: number; spam: number; movedBack: number; rescuedHere: number };
  recent: WarmupActivity[];
};

/** Everything the mailbox page shows about one mailbox's warm-up. */
export async function warmupDetail(sender: Sender, timeZone: string, weekdaysOnly = false): Promise<WarmupDetail> {
  const now = new Date();
  const { start, end } = todayRange(timeZone, now);
  const startIso = sql`${start.toISOString()}::timestamptz`;
  const endIso = sql`${end.toISOString()}::timestamptz`;
  const w = warmupMessages;

  const toGmail = sql`${w.toSenderId} in (select id from ${senders} where provider = 'gmail' or imap_host ~* '(^|[.])(gmail|googlemail)[.]com$')`;
  const [out] = await db
    .select({
      gmailFound7d: n(sql`count(*) filter (where ${w.receivedAt} is not null and ${w.sentAt} > ${WEEK} and ${toGmail})`),
      gmailSpam7d: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.sentAt} > ${WEEK} and ${toGmail})`),
      gmailMoved7d: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.rescuedAt} is not null and ${w.sentAt} > ${WEEK} and ${toGmail})`),
      newToday: n(sql`count(*) filter (where ${w.parentId} is null and ${w.sentAt} >= ${startIso})`),
      repliesToday: n(sql`count(*) filter (where ${w.parentId} is not null and ${w.sentAt} >= ${startIso})`),
      stillToSend: n(sql`count(*) filter (where ${w.status} = 'scheduled' and ${w.scheduledAt} < ${endIso})`),
      sent7d: n(sql`count(*) filter (where ${w.sentAt} > ${WEEK})`),
      repliesSent7d: n(sql`count(*) filter (where ${w.parentId} is not null and ${w.sentAt} > ${WEEK})`),
      found7d: n(sql`count(*) filter (where ${w.receivedAt} is not null and ${w.sentAt} > ${WEEK})`),
      spam7d: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.sentAt} > ${WEEK})`),
      moved7d: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.rescuedAt} is not null and ${w.sentAt} > ${WEEK})`),
      notFound7d: n(sql`count(*) filter (where ${w.status} = 'sent' and ${w.receivedAt} is null and ${w.sentAt} < now() - interval '1 hour' and ${w.sentAt} > ${WEEK})`),
      failed7d: n(sql`count(*) filter (where ${w.status} = 'failed' and ${w.updatedAt} > ${WEEK})`),
      sentAll: n(sql`count(*) filter (where ${w.sentAt} is not null)`),
      spamAll: n(sql`count(*) filter (where ${w.landedIn} = 'spam')`),
      movedAll: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.rescuedAt} is not null)`),
    })
    .from(w)
    .where(eq(w.senderId, sender.id));

  const [inc] = await db
    .select({
      receivedToday: n(sql`count(*) filter (where ${w.receivedAt} >= ${startIso})`),
      receivedNewToday: n(sql`count(*) filter (where ${w.parentId} is null and ${w.receivedAt} >= ${startIso})`),
      received7d: n(sql`count(*) filter (where ${w.receivedAt} > ${WEEK})`),
      repliesReceived7d: n(sql`count(*) filter (where ${w.parentId} is not null and ${w.receivedAt} > ${WEEK})`),
      rescued7d: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.rescuedAt} is not null and ${w.receivedAt} > ${WEEK})`),
      rescuedAll: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.rescuedAt} is not null)`),
    })
    .from(w)
    .where(eq(w.toSenderId, sender.id));

  const pool = await db
    .select()
    .from(senders)
    .where(and(eq(senders.userId, sender.userId), eq(senders.warmupEnabled, true), ne(senders.id, sender.id)));
  const partners = pool
    .filter((p) => canWarmUp(p) && p.email !== sender.email)
    .map((p) => ({ email: p.email, partner: p.warmupRole === "partner", gmail: isGmailMailbox(p) }));

  const partner = aliasedTable(senders, "partner");
  const recentRows = await db
    .select({ row: w, fromEmail: senders.email, fromName: senders.displayName, toEmail: partner.email, toName: partner.displayName })
    .from(w)
    .innerJoin(senders, eq(senders.id, w.senderId))
    .innerJoin(partner, eq(partner.id, w.toSenderId))
    .where(
      or(
        and(eq(w.senderId, sender.id), ne(w.status, "cancelled")),
        and(eq(w.toSenderId, sender.id), inArray(w.status, ["sent"])),
      ),
    )
    .orderBy(desc(sql`coalesce(${w.sentAt}, ${w.scheduledAt})`))
    .limit(12);

  const isSender = sender.warmupRole !== "partner";
  const day = isSender && sender.warmupEnabled && sender.warmupStartedAt ? warmupDay(sender.warmupStartedAt, now, timeZone, weekdaysOnly) : null;
  const maxReachedOnDay =
    sender.warmupIncrease > 0 ? Math.max(Math.ceil((sender.warmupMax - sender.warmupStart) / sender.warmupIncrease) + 1, 1) : null;

  return {
    day,
    target: day ? dailyTarget(sender, day) : null,
    maxReachedOnDay,
    partners,
    today: { newSent: out.newToday, repliesSent: out.repliesToday, stillToSend: out.stillToSend, received: inc.receivedToday, receivedNew: inc.receivedNewToday },
    week: {
      sent: out.sent7d,
      found: out.found7d,
      spam: out.spam7d,
      movedBack: out.moved7d,
      gmailFound: out.gmailFound7d,
      gmailSpam: out.gmailSpam7d,
      gmailMovedBack: out.gmailMoved7d,
      notFound: out.notFound7d,
      failed: out.failed7d,
      received: inc.received7d,
      repliesReceived: inc.repliesReceived7d,
      repliesSent: out.repliesSent7d,
      rescuedHere: inc.rescued7d,
    },
    allTime: { sent: out.sentAll, spam: out.spamAll, movedBack: out.movedAll, rescuedHere: inc.rescuedAll },
    recent: recentRows.map(({ row, fromEmail, fromName, toEmail, toName }) => {
      const outgoing = row.senderId === sender.id;
      return {
        id: row.id,
        threadId: row.threadId,
        direction: outgoing ? "out" : "in",
        partner: outgoing ? toEmail : fromEmail,
        partnerName: outgoing ? toName : fromName,
        isReply: Boolean(row.parentId),
        subject: row.subject,
        status: row.status,
        at: row.sentAt ?? row.scheduledAt,
        landedIn: row.landedIn,
        rescuedAt: row.rescuedAt,
        receivedAt: row.receivedAt,
        error: row.error,
      };
    }),
  };
}

/** Inbox placement as a 0–100 score: of its warm-up emails the other side found, the share that wasn't in spam. */
export function inboxScore(found: number, spam: number): number | null {
  return found > 0 ? Math.round(((found - spam) / found) * 100) : null;
}

export type WarmupOverview = {
  /** Its own emails (new ones and replies). */
  sentToday: number;
  stillToSend: number;
  sent7d: number;
  found7d: number;
  spam7d: number;
  notFound7d: number;
  failed7d: number;
  /** Other mailboxes' emails that reached it. */
  receivedToday: number;
  received7d: number;
  receivedSpam7d: number;
  conversations7d: number;
  lastAt: Date | null;
};

const EMPTY_OVERVIEW: WarmupOverview = {
  sentToday: 0,
  stillToSend: 0,
  sent7d: 0,
  found7d: 0,
  spam7d: 0,
  notFound7d: 0,
  failed7d: 0,
  receivedToday: 0,
  received7d: 0,
  receivedSpam7d: 0,
  conversations7d: 0,
  lastAt: null,
};

/** Per mailbox of an account, for the Warm-up list: today, the last 7 days and the last activity. */
export async function warmupOverview(userId: string, timeZone: string): Promise<Map<string, WarmupOverview>> {
  const { start, end } = todayRange(timeZone);
  const startIso = sql`${start.toISOString()}::timestamptz`;
  const endIso = sql`${end.toISOString()}::timestamptz`;
  const w = warmupMessages;
  const [out, inc] = await Promise.all([
    db
      .select({
        id: w.senderId,
        sentToday: n(sql`count(*) filter (where ${w.sentAt} >= ${startIso})`),
        stillToSend: n(sql`count(*) filter (where ${w.status} = 'scheduled' and ${w.scheduledAt} < ${endIso})`),
        sent7d: n(sql`count(*) filter (where ${w.sentAt} > ${WEEK})`),
        found7d: n(sql`count(*) filter (where ${w.receivedAt} is not null and ${w.sentAt} > ${WEEK})`),
        spam7d: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.sentAt} > ${WEEK})`),
        notFound7d: n(sql`count(*) filter (where ${w.status} = 'sent' and ${w.receivedAt} is null and ${w.sentAt} < now() - interval '1 hour' and ${w.sentAt} > ${WEEK})`),
        failed7d: n(sql`count(*) filter (where ${w.status} = 'failed' and ${w.updatedAt} > ${WEEK})`),
        threads: n(sql`count(distinct ${w.threadId}) filter (where ${w.sentAt} > ${WEEK})`),
        lastAt: sql<string | null>`max(${w.sentAt})`,
      })
      .from(w)
      .where(eq(w.userId, userId))
      .groupBy(w.senderId),
    db
      .select({
        id: w.toSenderId,
        receivedToday: n(sql`count(*) filter (where ${w.receivedAt} >= ${startIso})`),
        received7d: n(sql`count(*) filter (where ${w.receivedAt} > ${WEEK})`),
        receivedSpam7d: n(sql`count(*) filter (where ${w.landedIn} = 'spam' and ${w.receivedAt} > ${WEEK})`),
        threads: n(sql`count(distinct ${w.threadId}) filter (where ${w.receivedAt} > ${WEEK})`),
        lastAt: sql<string | null>`max(${w.receivedAt})`,
      })
      .from(w)
      .where(eq(w.userId, userId))
      .groupBy(w.toSenderId),
  ]);
  const map = new Map<string, WarmupOverview>();
  const get = (id: string) => map.get(id) ?? map.set(id, { ...EMPTY_OVERVIEW }).get(id)!;
  const later = (a: Date | null, b: string | null) => (b && (!a || new Date(b) > a) ? new Date(b) : a);
  for (const { id, threads, lastAt, ...rest } of out) {
    const o = get(id);
    Object.assign(o, rest);
    o.conversations7d = Math.max(o.conversations7d, threads);
    o.lastAt = later(o.lastAt, lastAt);
  }
  for (const { id, threads, lastAt, ...rest } of inc) {
    const o = get(id);
    Object.assign(o, rest);
    // A conversation is counted on both sides; it's the same one, so take the larger count, not the sum.
    o.conversations7d = Math.max(o.conversations7d, threads);
    o.lastAt = later(o.lastAt, lastAt);
  }
  return map;
}

export function overviewFor(map: Map<string, WarmupOverview>, id: string): WarmupOverview {
  return map.get(id) ?? EMPTY_OVERVIEW;
}

export type WarmupDay = {
  /** "YYYY-MM-DD" on the account's clock. */
  date: string;
  /** Its own emails sent that day, by where the other mailbox found them. */
  sent: number;
  inbox: number;
  spam: number;
  notFound: number;
  /** Other mailboxes' emails that reached it that day, and how many of those were in its spam. */
  received: number;
  receivedSpam: number;
};

/** One mailbox's warm-up, day by day, for the last `days` days (oldest first, today last). */
export async function warmupDaily(senderId: string, timeZone: string, days = 14): Promise<WarmupDay[]> {
  const today = localDate(new Date(), timeZone);
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
  const since = sql`now() - make_interval(days => ${days + 1}::int)`;
  const [out, inc] = await Promise.all([
    db.execute<{ day: string; sent: number; inbox: number; spam: number; not_found: number }>(sql`
      select to_char(timezone(${timeZone}, sent_at), 'YYYY-MM-DD') as day,
        count(*)::int as sent,
        count(*) filter (where landed_in = 'inbox')::int as inbox,
        count(*) filter (where landed_in = 'spam')::int as spam,
        count(*) filter (where received_at is null)::int as not_found
      from ${warmupMessages}
      where sender_id = ${senderId} and sent_at is not null and sent_at > ${since}
      group by 1`),
    db.execute<{ day: string; received: number; received_spam: number }>(sql`
      select to_char(timezone(${timeZone}, received_at), 'YYYY-MM-DD') as day,
        count(*)::int as received,
        count(*) filter (where landed_in = 'spam')::int as received_spam
      from ${warmupMessages}
      where to_sender_id = ${senderId} and received_at is not null and received_at > ${since}
      group by 1`),
  ]);
  const outBy = new Map(out.rows.map((r) => [r.day, r]));
  const incBy = new Map(inc.rows.map((r) => [r.day, r]));
  return dates.map((date) => {
    const o = outBy.get(date);
    const i = incBy.get(date);
    return {
      date,
      sent: Number(o?.sent ?? 0),
      inbox: Number(o?.inbox ?? 0),
      spam: Number(o?.spam ?? 0),
      notFound: Number(o?.not_found ?? 0),
      received: Number(i?.received ?? 0),
      receivedSpam: Number(i?.received_spam ?? 0),
    };
  });
}
