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

/** A date as the value of an <input type="datetime-local">, in the viewer's own timezone. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
