import { cronHandler } from "@/lib/cron-route";
import { runInboxJob } from "@/lib/jobs/inbox";

export const maxDuration = 300;

export function POST(request: Request) {
  return cronHandler(request, "inbox", 10, runInboxJob);
}

export const GET = POST;
