// Numbers for the warm-up status views (mailbox page and the Mailboxes list).
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
  direction: "out" | "in";
  partner: string;
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
export async function warmupDetail(sender: Sender, timeZone: string): Promise<WarmupDetail> {
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
    .select({ row: w, fromEmail: senders.email, toEmail: partner.email })
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
  const day = isSender && sender.warmupEnabled && sender.warmupStartedAt ? warmupDay(sender.warmupStartedAt, now, timeZone) : null;
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
    recent: recentRows.map(({ row, fromEmail, toEmail }) => {
      const outgoing = row.senderId === sender.id;
      return {
        id: row.id,
        direction: outgoing ? "out" : "in",
        partner: outgoing ? toEmail : fromEmail,
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
