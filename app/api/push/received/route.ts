import { NextResponse } from "next/server";
import { markPushReceived } from "@/lib/push";

/**
 * A device's service worker reports that a notification arrived, so Settings can show whether pushes
 * actually reach each phone. No sign-in needed: the subscription endpoint is a secret only that device has,
 * and all this does is note the time.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string" || !/^https:\/\//.test(body.endpoint)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  await markPushReceived(body.endpoint);
  return NextResponse.json({ ok: true });
}
