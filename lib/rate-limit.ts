// Small in-memory limiter for failed sign-ins. Enough for one app container; resets on restart.

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

const failures = new Map<string, { count: number; resetAt: number }>();

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** True when this key has failed too often recently. */
export function isLimited(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(key: string) {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || entry.resetAt < now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
  if (failures.size > 10_000) {
    for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
  }
}

export function clearFailures(key: string) {
  failures.delete(key);
}
