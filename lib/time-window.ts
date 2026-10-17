// Send-window maths. Pure functions, safe to import in client components.

export const MIN_GAP_MINUTES = 2;

export type SendWindow = {
  windowStart: string; // "HH:MM"
  windowEnd: string;
  timezone: string;
  weekdaysOnly: boolean;
};

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidHm(value: string): boolean {
  return HM.test(value);
}

export function parseHm(value: string): number {
  const m = HM.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Length of the window in minutes. Equal start and end means all day. */
export function windowMinutes(start: string, end: string): number {
  const diff = parseHm(end) - parseHm(start);
  return diff > 0 ? diff : diff + 1440;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(date: Date, timeZone: string): { weekday: number; minutes: number } {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function isInsideWindow(date: Date, w: SendWindow): boolean {
  const { weekday, minutes } = localParts(date, w.timezone);
  if (w.weekdaysOnly && (weekday === 0 || weekday === 6)) return false;
  const start = parseHm(w.windowStart);
  const end = parseHm(w.windowEnd);
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** The first moment at or after `from` that is inside the send window. */
export function nextWindowOpen(from: Date, w: SendWindow): Date {
  if (isInsideWindow(from, w)) return from;
  const start = parseHm(w.windowStart);
  let t = new Date(Math.ceil(from.getTime() / 60_000) * 60_000);
  // Jump straight to the next local start time, then step a day at a time past weekends.
  // A final minute-by-minute check absorbs daylight-saving shifts.
  for (let day = 0; day < 9; day++) {
    const { minutes } = localParts(t, w.timezone);
    const ahead = (start - minutes + 1440) % 1440;
    const candidate = new Date(t.getTime() + ahead * 60_000);
    for (let nudge = 0; nudge <= 120; nudge += 15) {
      const probe = new Date(candidate.getTime() + nudge * 60_000);
      if (isInsideWindow(probe, w)) return probe;
    }
    t = new Date(candidate.getTime() + 60 * 60_000); // past this start; try the next day
  }
  return from; // window never opens (shouldn't happen with valid settings)
}

/**
 * Wait time before a mailbox's next email: its daily limit spread evenly across the
 * send window, varied by ±15% so the timing never looks mechanical.
 */
export function sendGapMs(window: Pick<SendWindow, "windowStart" | "windowEnd">, dailyLimit: number): number {
  const evenGap = windowMinutes(window.windowStart, window.windowEnd) / Math.max(dailyLimit, 1);
  const minutes = Math.max(evenGap * (0.85 + Math.random() * 0.3), MIN_GAP_MINUTES);
  return Math.round(minutes * 60_000);
}

/** Sending days needed for a list, given the selected mailboxes' combined daily limit. */
export function estimateSendingDays(total: number, dailyCapacity: number): number {
  if (total <= 0) return 0;
  if (dailyCapacity <= 0) return Infinity;
  return Math.ceil(total / dailyCapacity);
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

/** Year, month, day, hour and minute on the clock in `timeZone` at `date`. */
function wallClock(date: Date, timeZone: string) {
  let fmt = wallFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    wallFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** How far `timeZone` is ahead of UTC at `date`, in minutes (Arizona: -420, Dhaka: 360). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const w = wallClock(date, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** A date as the value of an <input type="datetime-local"> showing the clock in `timeZone`. */
export function toZonedInputValue(date: Date, timeZone: string): string {
  const w = wallClock(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * The moment an <input type="datetime-local"> value means when read as a clock in `timeZone`:
 * "2026-10-20T09:00" in America/Phoenix is 16:00 UTC. Null for an empty or invalid value.
 */
export function zonedInputToDate(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Guess with the offset at the wall time, then correct once for a daylight-saving change in between.
  let t = wall - zoneOffsetMinutes(new Date(wall), timeZone) * 60_000;
  t = wall - zoneOffsetMinutes(new Date(t), timeZone) * 60_000;
  return Number.isNaN(t) ? null : new Date(t);
}
