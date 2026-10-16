import { cronHandler } from "@/lib/cron-route";
import { runSendJob } from "@/lib/jobs/send";

export const maxDuration = 60;

export function POST(request: Request) {
  return cronHandler(request, "send", 5, runSendJob);
}

export const GET = POST;
