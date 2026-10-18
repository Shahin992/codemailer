import { NextResponse } from "next/server";
import { z } from "zod";
import { getMemberSession } from "@/lib/auth";
import { saveSubscription } from "@/lib/push";

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  oldEndpoint: z.string().nullable().optional(),
});

/**
 * The service worker calls this when the browser renews a push subscription by itself
 * (the "pushsubscriptionchange" event), so replies keep reaching that phone.
 */
export async function POST(request: Request) {
  const me = await getMemberSession();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  const { endpoint, keys, oldEndpoint } = parsed.data;
  await saveSubscription(me.id, { endpoint, p256dh: keys.p256dh, auth: keys.auth }, request.headers.get("user-agent") ?? "", oldEndpoint);
  return NextResponse.json({ ok: true });
}
