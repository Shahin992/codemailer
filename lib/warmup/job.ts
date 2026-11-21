// Warm-up sending, run by the send job every minute (before campaigns, so they share the daily limit safely).
//   1. Plan: once a day per warm-up mailbox, pick random times inside the account's send window and a partner
//      (another warm-up mailbox of the same account) for each of the day's new emails.
//   2. Send: emails and replies whose time has come, within pauses, rests and the daily limit.
// Replies are planned by the receiving side (lib/warmup/inbound.ts) when a warm-up email is found.

import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, senders, users, warmupMessages, type Sender, type Settings, type WarmupMessage } from "@/lib/db/schema";
import { newMessageIdHeader } from "@/lib/mail/compose";
import { appendToSent, buildRawEmail, configFromSender, sendRawEmail, type MailOptions } from "@/lib/mail/connection";
import { classifySmtpError, describeMailError } from "@/lib/mail/errors";
import { sentLast24h } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { isInsideWindow, localDate, nextWindowOpen, windowOnDay } from "@/lib/time-window";
import { firstName, newWarmupEmail, replySubject, warmupReply } from "@/lib/warmup/content";
import {
  canWarmUp,
  dailyTarget,
  MIN_SPACING_MS,
  NEW_EMAIL_GRACE_MS,
  randomBetween,
  randomTimes,
  REPLY_MAX_AGE_MS,
  warmupDay,
} from "@/lib/warmup/schedule";

export { canWarmUp };

const MAX_SENDS_PER_RUN = 10;
const MAX_ATTEMPTS = 3;
const STUCK_MINUTES = 10;
const UNIQUE_DAYS = 90;

type Outcome = "sent" | "waiting" | "failed" | "cancelled";
export type WarmupRunCounts = Record<Outcome | "planned", number>;


function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The other mailboxes a warm-up mailbox can send to: both business mailboxes and partners. */
function partnersOf(sender: Sender, pool: Sender[]): Sender[] {
  return pool.filter((p) => p.id !== sender.id && p.email !== sender.email && p.userId === sender.userId && canWarmUp(p));
}

/** New warm-up emails (not replies) planned or sent to each of these mailboxes between `from` and `to`. */
async function newEmailsTo(ids: string[], from: Date, to: Date): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: warmupMessages.toSenderId, n: sql<number>`count(*)::int` })
    .from(warmupMessages)
    .where(
      and(
        inArray(warmupMessages.toSenderId, ids),
        isNull(warmupMessages.parentId),
        inArray(warmupMessages.status, ["scheduled", "sending", "sent"]),
        gte(warmupMessages.scheduledAt, from),
        lt(warmupMessages.scheduledAt, to),
      ),
    )
    .groupBy(warmupMessages.toSenderId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * Who gets a business mailbox's `count` new emails today. Partners (e.g. Gmail accounts) take at most their
 * daily number (warmup_receive_max) from all business mailboxes together, shared out fairly, so each business
 * mailbox gets some Gmail placement every day; the rest goes to the other business mailboxes.
 */
async function pickRecipients(
  sender: Sender,
  pool: Sender[],
  count: number,
  window: { start: Date; end: Date },
  rank: number,
): Promise<Sender[]> {
  const others = partnersOf(sender, pool);
  const peers = shuffle(others.filter((p) => p.warmupRole !== "partner"));
  const partners = others.filter((p) => p.warmupRole === "partner");
  const used = await newEmailsTo(partners.map((p) => p.id), window.start, window.end);
  const free = partners.map((p) => ({ p, left: p.warmupReceiveMax - (used.get(p.id) ?? 0) })).filter((f) => f.left > 0);
  const businessCount = pool.filter((s) => s.userId === sender.userId && canWarmUp(s) && s.warmupRole !== "partner").length;
  // Every business mailbox gets the even share; the leftover slots go to the first ones in today's (random)
  // planning order, so over the days each of them gets them in turn. 20 slots for 6 mailboxes: 3 each, 2 get 4.
  const room = partners.reduce((sum, p) => sum + p.warmupReceiveMax, 0);
  const n = Math.max(businessCount, 1);
  const fairShare = Math.floor(room / n) + (rank < room % n ? 1 : 0);
  const freeTotal = free.reduce((sum, f) => sum + f.left, 0);
  const toPartners = Math.min(count, freeTotal, peers.length ? fairShare : freeTotal);

  const chosen: Sender[] = [];
  for (let i = 0; i < toPartners; i++) {
    // The partner with the most room left (ties broken at random), so they fill evenly.
    const top = Math.max(...free.map((f) => f.left));
    const candidates = free.filter((f) => f.left === top);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    pick.left--;
    chosen.push(pick.p);
  }
  // Without another business mailbox, partners are all there is, and the day is limited to their room.
  for (let i = 0; peers.length && chosen.length < count; i++) chosen.push(peers[i % peers.length]);
  return shuffle(chosen); // Gmail emails spread over the day, not all first
}

/** Plan today's new warm-up emails for every warm-up mailbox that hasn't been planned for its account's today yet. */
async function planDay(now: Date, settingsFor: (userId: string) => Promise<Settings>): Promise<number> {
  const rows = await db
    .select({ sender: senders })
    .from(senders)
    .innerJoin(users, eq(users.id, senders.userId))
    .where(and(eq(senders.warmupEnabled, true), eq(users.status, "active")))
    .orderBy(asc(senders.createdAt));
  const pool = rows.map((r) => r.sender);
  let planned = 0;
  const rankInAccount = new Map<string, number>(); // order in which an account's mailboxes were planned this run

  // A new random order each run, so nobody is always first when partner slots are shared out.
  for (const sender of shuffle(pool)) {
    // Partners never start a thread; they only answer.
    if (!canWarmUp(sender) || sender.warmupRole === "partner") continue;
    const settings = await settingsFor(sender.userId);
    const today = localDate(now, settings.timezone);
    if (sender.warmupPlannedOn === today) continue;
    // Without a partner nothing is planned (and the day stays open), so a mailbox joining later today still counts.
    const partners = partnersOf(sender, pool);
    if (!partners.length) continue;

    const [claimed] = await db
      .update(senders)
      .set({ warmupPlannedOn: today })
      .where(and(eq(senders.id, sender.id), sql`${senders.warmupPlannedOn} is distinct from ${today}`))
      .returning({ id: senders.id });
    if (!claimed) continue;

    const window = windowOnDay(today, settings);
    if (!window) continue; // a weekend with "weekdays only"
    const from = new Date(Math.max(now.getTime() + 60_000, window.start.getTime()));
    const until = new Date(window.end.getTime() - 5 * 60_000);
    if (from >= until) continue; // today's window is already over

    // Turned on part-way through the day: only the rest of the day's share. Turned off and on again: what's left.
    const target = dailyTarget(sender, warmupDay(sender.warmupStartedAt ?? now, now, settings.timezone, settings.weekdaysOnly));
    const share = Math.ceil((target * (until.getTime() - from.getTime())) / (window.end.getTime() - window.start.getTime()));
    const [already] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(warmupMessages)
      .where(
        and(
          eq(warmupMessages.senderId, sender.id),
          isNull(warmupMessages.parentId),
          inArray(warmupMessages.status, ["scheduled", "sending", "sent"]),
          gte(warmupMessages.scheduledAt, window.start),
          lt(warmupMessages.scheduledAt, window.end),
        ),
      );
    const count = Math.max(Math.min(share, target - already.n), 0);
    const rank = rankInAccount.get(sender.userId) ?? 0;
    rankInAccount.set(sender.userId, rank + 1);
    const recipients = await pickRecipients(sender, pool, count, window, rank);
    // Only moments the send job will also see as inside the window (an overnight window with "weekdays only"
    // closes at midnight going into Saturday, for example).
    const slots = randomTimes(recipients.length, from, until, 3 * MIN_SPACING_MS)
      .map((scheduledAt, i) => ({ scheduledAt, to: recipients[i] }))
      .filter((slot) => isInsideWindow(slot.scheduledAt, settings));
    if (!slots.length) continue;

    await db.insert(warmupMessages).values(
      slots.map(({ scheduledAt, to }) => {
        const id = randomUUID();
        return { id, threadId: id, userId: sender.userId, senderId: sender.id, toSenderId: to.id, scheduledAt };
      }),
    );
    planned += slots.length;
  }
  return planned;
}

/** A crash mid-send leaves rows in 'sending'; don't resend those blindly. */
async function recoverStuck() {
  await db
    .update(warmupMessages)
    .set({ status: "failed", error: "Interrupted while sending.", updatedAt: new Date() })
    .where(and(eq(warmupMessages.status, "sending"), lt(warmupMessages.updatedAt, sql`now() - make_interval(mins => ${STUCK_MINUTES}::int)`)));
}

async function postpone(row: WarmupMessage, until: Date, reason: string): Promise<Outcome> {
  await db
    .update(warmupMessages)
    .set({ scheduledAt: until, error: reason, updatedAt: new Date() })
    .where(and(eq(warmupMessages.id, row.id), eq(warmupMessages.status, "scheduled")));
  return "waiting";
}

async function cancel(row: WarmupMessage, reason: string): Promise<Outcome> {
  await db
    .update(warmupMessages)
    .set({ status: "cancelled", error: reason, updatedAt: new Date() })
    .where(and(eq(warmupMessages.id, row.id), eq(warmupMessages.status, "scheduled")));
  return "cancelled";
}

const minutesFromNow = (min: number, max: number) => new Date(Date.now() + randomBetween(min, max) * 60_000);

/** When this mailbox last sent anything (campaign or warm-up email). */
async function lastSendAt(senderId: string): Promise<number> {
  const result = await db.execute<{ at: Date | string | null }>(sql`select greatest(
    (select max(sent_at) from ${messages} where sender_id = ${senderId}),
    (select max(sent_at) from ${warmupMessages} where sender_id = ${senderId})
  ) as at`);
  const at = result.rows[0]?.at;
  return at ? new Date(at).getTime() : 0;
}

/** A new email's text, different from every warm-up email this account sent recently. */
async function freshEmail(userId: string, from: Sender, to: Sender) {
  let email = newWarmupEmail({ name: firstName(from.displayName, from.email) }, { name: firstName(to.displayName, to.email) });
  for (let tries = 0; tries < 5; tries++) {
    const [seen] = await db
      .select({ id: warmupMessages.id })
      .from(warmupMessages)
      .where(
        and(
          eq(warmupMessages.userId, userId),
          eq(warmupMessages.bodyText, email.text),
          gte(warmupMessages.createdAt, sql`now() - make_interval(days => ${UNIQUE_DAYS}::int)`),
        ),
      )
      .limit(1);
    if (!seen) break;
    email = newWarmupEmail({ name: firstName(from.displayName, from.email) }, { name: firstName(to.displayName, to.email) });
  }
  return email;
}

/** The earlier messages of a reply's thread, oldest first. */
async function threadOf(row: WarmupMessage): Promise<WarmupMessage[]> {
  const chain: WarmupMessage[] = [];
  let cursor = row.parentId;
  for (let depth = 0; cursor && depth < 10; depth++) {
    const [parent] = await db.select().from(warmupMessages).where(eq(warmupMessages.id, cursor));
    if (!parent) break;
    chain.unshift(parent);
    cursor = parent.parentId;
  }
  return chain;
}

async function sendOne(row: WarmupMessage, settings: Settings): Promise<Outcome> {
  const [from] = await db.select().from(senders).where(eq(senders.id, row.senderId));
  let [to] = await db.select().from(senders).where(eq(senders.id, row.toSenderId));
  const isReply = Boolean(row.parentId);
  const now = new Date();

  if (!from.warmupEnabled) return cancel(row, "Warm-up was turned off for this mailbox.");
  if (!isReply && from.warmupRole === "partner") return cancel(row, "Partner mailboxes only reply; they don't start threads.");
  // A paused mailbox drops what it had waiting instead of saving it up for when it's resumed.
  if (from.status !== "active" || !from.readInbox) return cancel(row, "The mailbox was paused.");
  if (isReply && now.getTime() - row.createdAt.getTime() > REPLY_MAX_AGE_MS) return cancel(row, "Too late to reply: the email is days old.");
  // Its day is over (the app was down, or the account was disabled for a while): today has its own plan.
  if (!isReply && now.getTime() - row.scheduledAt.getTime() > NEW_EMAIL_GRACE_MS) return cancel(row, "Missed: its time passed while nothing could be sent.");
  if (from.restUntil && from.restUntil > now) {
    if (!isReply) return cancel(row, "Missed: the mailbox is resting after a provider limit.");
    return postpone(row, new Date(from.restUntil.getTime() + randomBetween(5, 60) * 60_000), "Waiting: the mailbox is resting after a provider limit.");
  }
  if (!isInsideWindow(now, settings)) {
    if (!isReply) return cancel(row, "Missed: the send window closed before it could go out.");
    return postpone(row, new Date(nextWindowOpen(now, settings).getTime() + randomBetween(5, 90) * 60_000), "Waiting for the send window.");
  }

  // The other mailbox left warm-up (or was paused) since this was planned: a new email goes to another one instead,
  // a business mailbox if there is one, else a partner that still has room today.
  if (!canWarmUp(to) || to.userId !== from.userId) {
    if (isReply) return cancel(row, "The other mailbox left warm-up.");
    const pool = await db.select().from(senders).where(and(eq(senders.userId, from.userId), eq(senders.warmupEnabled, true)));
    const others = partnersOf(from, pool);
    const peers = others.filter((p) => p.warmupRole !== "partner");
    const partners = others.filter((p) => p.warmupRole === "partner");
    const used = await newEmailsTo(partners.map((p) => p.id), new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000));
    const roomy = partners.filter((p) => (used.get(p.id) ?? 0) < p.warmupReceiveMax);
    const choices = peers.length ? peers : roomy;
    if (!choices.length) return cancel(row, "No other mailbox in this account can take it.");
    to = choices[Math.floor(Math.random() * choices.length)];
    await db.update(warmupMessages).set({ toSenderId: to.id }).where(eq(warmupMessages.id, row.id));
  }

  // The daily limit covers campaign, warm-up and test emails together.
  const [usage] = await db.select({ sent: sentLast24h }).from(senders).where(eq(senders.id, from.id));
  if (usage.sent >= from.dailyLimit) return postpone(row, minutesFromNow(20, 60), "Waiting: the mailbox reached its daily limit.");
  if (Date.now() - (await lastSendAt(from.id)) < MIN_SPACING_MS) return postpone(row, minutesFromNow(2, 5), "Waiting a few minutes after the last email.");

  let subject: string;
  let text: string;
  let topic = row.topic;
  let references: string[] = [];
  // A retry sends exactly what the first try did, with the same Message-ID: if the first try actually got
  // through (the connection broke after the server took it), the copy that arrived is still recognised.
  const retry = Boolean(row.messageIdHeader && row.subject && row.bodyText);
  if (retry) {
    subject = row.subject!;
    text = row.bodyText!;
    if (isReply) references = (await threadOf(row)).map((m) => m.messageIdHeader).filter((id): id is string => Boolean(id));
  } else if (!isReply) {
    const email = await freshEmail(from.userId, from, to);
    ({ subject, text, topic } = email);
  } else {
    const thread = await threadOf(row);
    const parent = thread[thread.length - 1];
    if (!parent?.messageIdHeader || !parent.sentAt || !parent.bodyText) return cancel(row, "The email it answers is gone.");
    references = thread.map((m) => m.messageIdHeader).filter((id): id is string => Boolean(id));
    subject = replySubject(thread[0].subject ?? parent.subject ?? "");
    topic = topic ?? thread[0].topic;
    ({ text } = warmupReply({
      topic,
      position: thread.length >= 2 ? 3 : 2,
      from: { name: firstName(from.displayName, from.email) },
      to: { name: firstName(to.displayName, to.email), email: to.email },
      parent: { text: parent.bodyText, sentAt: parent.sentAt },
      timeZone: settings.timezone,
    }));
  }
  const messageIdHeader = retry ? row.messageIdHeader! : newMessageIdHeader(from.email);

  // Claim it, with the Message-ID saved first: if the app stops right after sending, the receiver still recognises it.
  const [claimed] = await db
    .update(warmupMessages)
    .set({ status: "sending", subject, bodyText: text, topic, messageIdHeader, attempts: sql`${warmupMessages.attempts} + 1`, error: null, updatedAt: new Date() })
    .where(and(eq(warmupMessages.id, row.id), eq(warmupMessages.status, "scheduled")))
    .returning();
  if (!claimed) return "waiting";
  // Campaign emails from this mailbox keep a short distance too.
  const spaced = new Date(Date.now() + MIN_SPACING_MS).toISOString();
  await db.update(senders).set({ nextSendAt: sql`greatest(${senders.nextSendAt}, ${spaced}::timestamptz)` }).where(eq(senders.id, from.id));

  const mail: MailOptions = {
    from: from.displayName ? { name: from.displayName, address: from.email } : from.email,
    to: to.displayName ? { name: to.displayName, address: to.email } : to.email,
    subject,
    text,
    messageId: messageIdHeader,
    date: new Date(),
    ...(references.length ? { inReplyTo: references[references.length - 1], references: references.join(" ") } : {}),
  };
  const cfg = configFromSender(from);
  try {
    const raw = await buildRawEmail(mail);
    await sendRawEmail(cfg, { from: from.email, to: to.email }, raw);
    await db.update(warmupMessages).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(warmupMessages.id, row.id));
    if (from.lastError && !from.lastError.startsWith("Inbox check failed:")) {
      await db.update(senders).set({ lastError: null, lastErrorAt: null }).where(eq(senders.id, from.id));
    }
    if (from.saveToSent && from.sentFolder) {
      await appendToSent(cfg, from.sentFolder, raw).catch((err) =>
        console.error(`[warmup] could not save copy to Sent for ${from.email}:`, describeMailError(err)),
      );
    }
    return "sent";
  } catch (err) {
    return handleError(err, from, claimed);
  }
}

async function handleError(err: unknown, sender: Sender, row: WarmupMessage): Promise<Outcome> {
  const detail = describeMailError(err);
  const now = new Date();
  const retry = (at: Date) =>
    db
      .update(warmupMessages)
      .set({ status: "scheduled", scheduledAt: at, error: detail, updatedAt: now })
      .where(eq(warmupMessages.id, row.id));
  const fail = () => db.update(warmupMessages).set({ status: "failed", error: detail, updatedAt: now }).where(eq(warmupMessages.id, row.id));

  const kind = classifySmtpError(err);
  switch (kind) {
    case "auth":
      // Same as campaigns: a wrong password pauses the mailbox until someone fixes it.
      await db.update(senders).set({ status: "paused", lastError: detail, lastErrorAt: now }).where(eq(senders.id, sender.id));
      await fail();
      return "failed";
    case "sender_limit":
    case "rate_limit": {
      const hours = kind === "sender_limit" ? 24 : 1;
      const restUntil = new Date(now.getTime() + hours * 3_600_000);
      await db
        .update(senders)
        .set({ nextSendAt: restUntil, restUntil, lastError: `Resting ${hours}h: ${detail}`, lastErrorAt: now })
        .where(eq(senders.id, sender.id));
      if (!row.parentId) {
        // A new email isn't worth saving for later: the next day has its own plan.
        await db.update(warmupMessages).set({ status: "cancelled", error: `Missed: ${detail}`, updatedAt: now }).where(eq(warmupMessages.id, row.id));
        return "cancelled";
      }
      await retry(new Date(restUntil.getTime() + randomBetween(5, 60) * 60_000));
      return "waiting";
    }
    case "recipient":
    case "rejected":
      await fail();
      return "failed";
    default:
      if (row.attempts >= MAX_ATTEMPTS) {
        await fail();
        return "failed";
      }
      await retry(minutesFromNow(10, 20));
      return "waiting";
  }
}

/** Plan today's warm-up emails and send the ones that are due, until `deadline` (ms timestamp). */
export async function runWarmup(deadline: number): Promise<WarmupRunCounts> {
  const counts: WarmupRunCounts = { planned: 0, sent: 0, waiting: 0, failed: 0, cancelled: 0 };
  const settingsByUser = new Map<string, Settings>();
  const settingsFor = async (userId: string) => {
    if (!settingsByUser.has(userId)) settingsByUser.set(userId, await getSettings(userId));
    return settingsByUser.get(userId)!;
  };

  await recoverStuck();
  counts.planned = await planDay(new Date(), settingsFor);

  const due = await db
    .select({ row: warmupMessages })
    .from(warmupMessages)
    .innerJoin(users, eq(users.id, warmupMessages.userId))
    .where(and(eq(warmupMessages.status, "scheduled"), lte(warmupMessages.scheduledAt, sql`now()`), eq(users.status, "active")))
    .orderBy(asc(warmupMessages.scheduledAt))
    .limit(30);
  const busy = new Set<string>(); // one send per mailbox per run keeps them spaced out
  for (const { row } of due) {
    if (Date.now() >= deadline || counts.sent >= MAX_SENDS_PER_RUN) break;
    if (busy.has(row.senderId)) continue;
    try {
      const outcome = await sendOne(row, await settingsFor(row.userId));
      counts[outcome]++;
      if (outcome === "sent") busy.add(row.senderId);
    } catch (err) {
      counts.failed++;
      console.error(`[warmup] ${row.id}:`, err);
    }
  }
  return counts;
}

/** Cancel everything a mailbox still had waiting to send (warm-up turned off). */
export async function cancelPendingWarmup(senderId: string) {
  await db
    .update(warmupMessages)
    .set({ status: "cancelled", error: "Warm-up was turned off for this mailbox.", updatedAt: new Date() })
    .where(and(eq(warmupMessages.senderId, senderId), eq(warmupMessages.status, "scheduled")));
}

/**
 * The account's send window changed (hours, days or timezone). Plan today again under the new window, so turning
 * on weekends on a Saturday starts warm-up that day rather than the next, and bring forward the emails that were
 * only waiting for the old window to open. Planning again is safe: it only adds what today's number still lacks.
 */
export async function replanWarmupForWindow(userId: string, settings: Settings, now = new Date()) {
  await db.update(senders).set({ warmupPlannedOn: null }).where(eq(senders.userId, userId));
  const opens = nextWindowOpen(now, settings).getTime();
  // Longer than any reply delay (partners wait up to 5 hours), so replies timed normally are left alone.
  const pushedBy = opens + 5 * 3_600_000;
  const waiting = await db
    .select({ id: warmupMessages.id, scheduledAt: warmupMessages.scheduledAt })
    .from(warmupMessages)
    .where(and(eq(warmupMessages.userId, userId), eq(warmupMessages.status, "scheduled")));
  for (const row of waiting) {
    const at = row.scheduledAt.getTime();
    if (at <= now.getTime() || (at <= pushedBy && isInsideWindow(row.scheduledAt, settings))) continue;
    await db
      .update(warmupMessages)
      .set({ scheduledAt: new Date(opens + randomBetween(5, 90) * 60_000), updatedAt: now })
      .where(and(eq(warmupMessages.id, row.id), eq(warmupMessages.status, "scheduled")));
  }
}
