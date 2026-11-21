// Warm-up timing maths. Pure functions, safe to import anywhere.
import { daysBetween, isInsideWindow, localDate, nextWindowOpen, type SendWindow } from "@/lib/time-window";

export const WARMUP_DEFAULTS = { start: 2, increase: 2, max: 30, replyRate: 35, receiveMax: 3 } as const;
export const WARMUP_LIMITS = {
  start: { min: 1, max: 50 },
  increase: { min: 0, max: 20 },
  max: { min: 1, max: 200 },
  replyRate: { min: 0, max: 100 },
  receiveMax: { min: 1, max: 50 }, // raised from 10 on Nov 21 at the user's request
} as const;

/** Gmail and Google Workspace mailboxes: their spam folder is the inbox-placement signal that matters most. */
export function isGmailMailbox(s: { provider: string; imapHost: string | null }): boolean {
  return s.provider === "gmail" || /(^|\.)gmail\.com$/i.test(s.imapHost ?? "") || /(^|\.)googlemail\.com$/i.test(s.imapHost ?? "");
}

/** How long a mailbox takes to answer a warm-up email, in minutes. Partner mailboxes (people's own accounts) are slower and more varied. */
export const REPLY_DELAY_MINUTES = { sender: [15, 180], partner: [20, 300] } as const;

/** A mailbox that can take part: warm-up on, sending, and with an inbox ColdMailer reads (to find mail and reply). */
export function canWarmUp(s: { warmupEnabled: boolean; status: string; readInbox: boolean; imapHost: string | null }): boolean {
  return s.warmupEnabled && s.status === "active" && s.readInbox && Boolean(s.imapHost);
}

/** A reply not sent within this long after it was planned is dropped: answering a days-old email reads oddly. */
export const REPLY_MAX_AGE_MS = 4 * 86_400_000;
/** A new email this long past its time (the server was down, or the account was disabled) is dropped as missed. */
export const NEW_EMAIL_GRACE_MS = 3 * 3_600_000;

/** At most this many messages in one thread (email, reply, reply back). */
export const MAX_THREAD_LENGTH = 3;
/** Never two sends from one mailbox closer together than this. */
export const MIN_SPACING_MS = 2 * 60_000;

export type WarmupRamp = { warmupStart: number; warmupIncrease: number; warmupMax: number };

/**
 * The ramp's day: day 1 is the day warm-up was turned on, counted on the account's clock. Only days warm-up can
 * send on count, so with "weekdays only" a weekend doesn't move it ahead (Friday day 2, Monday day 3).
 */
export function warmupDay(startedAt: Date, now: Date, timeZone: string, weekdaysOnly = false): number {
  const first = localDate(startedAt, timeZone);
  const span = daysBetween(first, localDate(now, timeZone));
  if (!weekdaysOnly) return Math.max(span + 1, 1);
  let count = 0;
  const start = Date.parse(`${first}T12:00:00Z`);
  for (let i = 0; i <= span && i < 1000; i++) {
    const weekday = new Date(start + i * 86_400_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return Math.max(count, 1);
}

/** New warm-up emails a mailbox sends on a given day: start, then `increase` more each day, up to the maximum. */
export function dailyTarget(ramp: WarmupRamp, day: number): number {
  return Math.max(Math.min(ramp.warmupStart + ramp.warmupIncrease * (day - 1), ramp.warmupMax), 0);
}

export function randomBetween(min: number, max: number, rand: () => number = Math.random): number {
  return min + rand() * (max - min);
}

/** `n` random moments between `from` and `to`, sorted, at least `minGap` apart where there is room. */
export function randomTimes(n: number, from: Date, to: Date, minGapMs: number, rand: () => number = Math.random): Date[] {
  const span = to.getTime() - from.getTime();
  if (n <= 0 || span <= 0) return [];
  const times = Array.from({ length: n }, () => from.getTime() + rand() * span).sort((a, b) => a - b);
  const gap = Math.min(minGapMs, span / n);
  for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + gap);
  return times.map((t) => new Date(Math.min(t, to.getTime())));
}

/**
 * When a reply goes out: some minutes to hours after the email was found, like a person getting to it.
 * Outside the send window it waits for the window to open, plus a little.
 */
export function replyTime(
  foundAt: Date,
  w: SendWindow,
  delay: readonly [number, number] = REPLY_DELAY_MINUTES.sender,
  rand: () => number = Math.random,
): Date {
  const at = new Date(foundAt.getTime() + randomBetween(delay[0], delay[1], rand) * 60_000);
  if (isInsideWindow(at, w)) return at;
  return new Date(nextWindowOpen(at, w).getTime() + randomBetween(5, 90, rand) * 60_000);
}

/** Moving the ramp's day 1 forward by the time warm-up was off, so a break doesn't jump it ahead. */
export function resumedStart(startedAt: Date | null, pausedAt: Date | null, now: Date): Date {
  if (!startedAt) return now;
  if (!pausedAt) return startedAt;
  return new Date(Math.min(startedAt.getTime() + (now.getTime() - pausedAt.getTime()), now.getTime()));
}
