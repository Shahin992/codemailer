import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";

export type JobStatus = {
  name: "send" | "inbox";
  lastRunAt: Date | null;
  lastResult: string | null;
  lastError: string | null;
  healthy: boolean;
};

const EXPECTED_EVERY_MINUTES = { send: 1, inbox: 5 } as const;

/** Is cron calling the jobs? A job that hasn't run for 3× its interval counts as stopped. */
export async function getJobStatus(): Promise<JobStatus[]> {
  const rows = await db.select().from(jobs);
  return (["send", "inbox"] as const).map((name) => {
    const row = rows.find((r) => r.name === name);
    const lastRunAt = row?.lastRunAt ?? null;
    const healthy = Boolean(lastRunAt && Date.now() - lastRunAt.getTime() < EXPECTED_EVERY_MINUTES[name] * 3 * 60_000);
    return { name, lastRunAt, lastResult: row?.lastResult ?? null, lastError: row?.lastError ?? null, healthy };
  });
}
