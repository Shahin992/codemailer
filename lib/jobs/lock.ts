import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

export type JobOutcome = { ran: boolean; result?: string; error?: string };

/**
 * Run a job only if no other run of it holds the lock. The lock expires on its own,
 * so a crashed run never blocks the job for long.
 */
export async function runExclusive(name: string, maxMinutes: number, fn: () => Promise<string>): Promise<JobOutcome> {
  await db.insert(jobs).values({ name }).onConflictDoNothing();
  const claimed = await db
    .update(jobs)
    .set({ lockedUntil: sql`now() + make_interval(mins => ${maxMinutes}::int)`, lastRunAt: new Date() })
    .where(and(eq(jobs.name, name), or(isNull(jobs.lockedUntil), lt(jobs.lockedUntil, sql`now()`))))
    .returning({ name: jobs.name });
  if (!claimed.length) return { ran: false };

  try {
    const result = await fn();
    await db
      .update(jobs)
      .set({ lockedUntil: null, lastFinishedAt: new Date(), lastResult: result, lastError: null })
      .where(eq(jobs.name, name));
    return { ran: true, result };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[job:${name}]`, err);
    await db.update(jobs).set({ lockedUntil: null, lastFinishedAt: new Date(), lastError: error }).where(eq(jobs.name, name));
    return { ran: true, error };
  }
}
