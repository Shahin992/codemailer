import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignSenders, campaigns, messages, senders, testSends, type Campaign } from "@/lib/db/schema";
import { MIN_GAP_MINUTES, nextWindowOpen, windowMinutes } from "@/lib/time-window";

/**
 * When will each queued email go out? Replays the send job's rules forward in time:
 * mailboxes take turns, each waits its gap, stays under its rolling 24-hour limit,
 * and only sends inside the campaign's window. Emails with a set time go at that time,
 * window or not, unless a rest or the daily limit holds them back. It's an estimate: the real gaps vary
 * by ±15%, cron runs once a minute, and mailboxes shared with other campaigns are
 * also busy with those.
 */
export type QueueEstimate =
  | { kind: "eta"; at: Date }
  // A time someone set. due is when it can actually go: later than at only when a limit or rest holds it back (note says which).
  | { kind: "scheduled"; at: Date; due: Date; note?: string }
  | { kind: "retry"; at: Date; error: string | null }
  | { kind: "blocked"; reason: string };

/** When the email is expected to go out, or null when nothing is moving. */
export function estimateTime(estimate: QueueEstimate | undefined): Date | null {
  if (!estimate || estimate.kind === "blocked") return null;
  return estimate.kind === "scheduled" ? estimate.due : estimate.at;
}

const DAY = 24 * 60 * 60_000;
const MAX_STEPS = 5000;

type SimMailbox = {
  id: string;
  email: string;
  limit: number;
  gap: number;
  free: number; // ms timestamp of its next turn
  restUntil: number; // ms timestamp; 0 = not resting
  recent: number[]; // send times (past, plus set times already placed), ascending
};

/** First moment at or after t when the mailbox is under its rolling 24-hour limit, or null if it already is at t. */
function limitWait(box: SimMailbox, t: number): number | null {
  const inDay = box.recent.filter((s) => s > t - DAY && s <= t);
  // Wait until enough of the last 24 hours' sends age out.
  return inDay.length >= box.limit ? inDay[inDay.length - box.limit] + DAY + 60_000 : null;
}

function nextSlot(box: SimMailbox, from: number, campaign: Campaign): number {
  let t = Math.max(from, box.free);
  for (let guard = 0; guard < 50; guard++) {
    const opened = nextWindowOpen(new Date(t), campaign).getTime();
    if (opened !== t) {
      t = opened;
      continue;
    }
    const later = limitWait(box, t);
    if (later === null) return t;
    t = later;
  }
  return t;
}

/** Emails with a set time ignore the window and the mailbox's turn, but not rests or the daily limit. */
function setTimeSlot(box: SimMailbox, from: number): number {
  let t = Math.max(from, box.restUntil);
  for (let guard = 0; guard < 50; guard++) {
    const later = limitWait(box, t);
    if (later === null) return t;
    t = later;
  }
  return t;
}

function place(box: SimMailbox, at: number) {
  box.recent.push(at);
  box.recent.sort((a, b) => a - b);
}

export async function estimateCampaignQueue(campaignId: string): Promise<Map<string, QueueEstimate>> {
  const result = new Map<string, QueueEstimate>();
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return result;

  const queued = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      scheduledAt: messages.scheduledAt,
      nextAttemptAt: messages.nextAttemptAt,
      error: messages.error,
    })
    .from(messages)
    .where(and(eq(messages.campaignId, campaignId), eq(messages.status, "queued")))
    .orderBy(asc(messages.createdAt));
  if (!queued.length) return result;

  if (campaign.status !== "active") {
    const reason = campaign.status === "paused" ? "Campaign is paused" : `Campaign is ${campaign.status}`;
    for (const m of queued) result.set(m.id, { kind: "blocked", reason });
    return result;
  }

  const chosen = await db
    .select({
      id: senders.id,
      email: senders.email,
      status: senders.status,
      dailyLimit: senders.dailyLimit,
      nextSendAt: senders.nextSendAt,
      restUntil: senders.restUntil,
    })
    .from(campaignSenders)
    .innerJoin(senders, eq(senders.id, campaignSenders.senderId))
    .where(eq(campaignSenders.campaignId, campaignId));
  const active = chosen.filter((s) => s.status === "active");
  const paused = new Map(chosen.filter((s) => s.status !== "active").map((s) => [s.id, s.email]));

  const ids = active.map((s) => s.id);
  const since = sql`now() - interval '24 hours'`;
  const [sentRows, testRows] = ids.length
    ? await Promise.all([
        db.select({ senderId: messages.senderId, at: messages.sentAt }).from(messages).where(and(inArray(messages.senderId, ids), gt(messages.sentAt, since))),
        db.select({ senderId: testSends.senderId, at: testSends.sentAt }).from(testSends).where(and(inArray(testSends.senderId, ids), gt(testSends.sentAt, since))),
      ])
    : [[], []];

  const span = windowMinutes(campaign.windowStart, campaign.windowEnd);
  const now = Date.now();
  const boxes: SimMailbox[] = active.map((s) => ({
    id: s.id,
    email: s.email,
    limit: Math.max(s.dailyLimit, 1),
    gap: Math.max(span / Math.max(s.dailyLimit, 1), MIN_GAP_MINUTES) * 60_000,
    free: Math.max(s.nextSendAt.getTime(), now),
    restUntil: s.restUntil?.getTime() ?? 0,
    recent: [...sentRows, ...testRows]
      .filter((r) => r.senderId === s.id && r.at)
      .map((r) => r.at!.getTime())
      .sort((a, b) => a - b),
  }));

  // Emails that are waiting out a retry delay keep their own time.
  const pending = queued.filter((m) => {
    if (m.nextAttemptAt && m.nextAttemptAt.getTime() > now) {
      result.set(m.id, { kind: "retry", at: m.nextAttemptAt, error: m.error });
      return false;
    }
    if (m.senderId && paused.has(m.senderId)) {
      result.set(m.id, { kind: "blocked", reason: `Waiting for ${paused.get(m.senderId)}, which is paused` });
      return false;
    }
    return true;
  });

  if (!boxes.length) {
    for (const m of pending) result.set(m.id, { kind: "blocked", reason: "All of this campaign's mailboxes are paused" });
    return result;
  }

  // Set times first, in time order: they use up the daily limit before the automatic emails around them.
  const setTimes = pending.filter((m) => m.scheduledAt).sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime());
  for (const m of setTimes) {
    const at = m.scheduledAt!.getTime();
    const own = m.senderId ? boxes.find((b) => b.id === m.senderId) : undefined;
    let best: { box: SimMailbox; at: number } | null = null;
    for (const box of own ? [own] : boxes) {
      const slot = setTimeSlot(box, Math.max(at, now));
      if (!best || slot < best.at) best = { box, at: slot };
    }
    place(best!.box, best!.at);
    const held = best!.at - Math.max(at, now) > 60_000;
    const resting = best!.box.restUntil > Math.max(at, now);
    result.set(m.id, {
      kind: "scheduled",
      at: m.scheduledAt!,
      due: new Date(best!.at),
      note: held ? (resting ? `${best!.box.email} is resting after a “limit exceeded” error` : `${best!.box.email} has reached its daily limit`) : undefined,
    });
  }

  // Same order as the send job: people tied to a mailbox go first on its turn, then everyone else in list order.
  const tied = new Map<string, string[]>();
  const open: string[] = [];
  for (const m of pending.filter((p) => !p.scheduledAt)) {
    if (m.senderId && boxes.some((b) => b.id === m.senderId)) tied.set(m.senderId, [...(tied.get(m.senderId) ?? []), m.id]);
    else open.push(m.id);
  }

  let remaining = pending.length - setTimes.length;
  for (let step = 0; step < MAX_STEPS && remaining > 0; step++) {
    let best: { box: SimMailbox; at: number } | null = null;
    for (const box of boxes) {
      if (!(tied.get(box.id)?.length || open.length)) continue;
      const at = nextSlot(box, now, campaign);
      if (!best || at < best.at) best = { box, at };
    }
    if (!best) break;
    const own = tied.get(best.box.id);
    const messageId = own?.length ? own.shift()! : open.shift()!;
    result.set(messageId, { kind: "eta", at: new Date(best.at) });
    place(best.box, best.at);
    best.box.free = best.at + best.box.gap;
    remaining--;
  }

  // Beyond the simulated horizon: give the day-level estimate instead.
  for (const m of pending) {
    if (!result.has(m.id)) result.set(m.id, { kind: "blocked", reason: "Later: more than 5,000 emails ahead of it in this campaign" });
  }
  return result;
}
