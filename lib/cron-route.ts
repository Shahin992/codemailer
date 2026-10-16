import { NextResponse } from "next/server";
import { checkBearer } from "@/lib/auth";
import { env } from "@/lib/env";
import { runExclusive } from "@/lib/jobs/lock";

/** Shared handler for /api/cron/*: checks CRON_SECRET, then runs the job unless it's already running. */
export async function cronHandler(request: Request, name: string, maxMinutes: number, job: () => Promise<string>) {
  if (!checkBearer(request, env("CRON_SECRET"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const outcome = await runExclusive(name, maxMinutes, job);
  if (!outcome.ran) return NextResponse.json({ skipped: "already running" });
  if (outcome.error) return NextResponse.json({ error: outcome.error }, { status: 500 });
  return NextResponse.json({ result: outcome.result });
}
