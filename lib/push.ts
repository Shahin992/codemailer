import { eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";

export type PushPayload = { title: string; body: string; url: string; tag?: string };

let configured = false;

export function pushConfigured(): boolean {
  const publicKey = optionalEnv("VAPID_PUBLIC_KEY");
  const privateKey = optionalEnv("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    webpush.setVapidDetails(optionalEnv("VAPID_SUBJECT") ?? "mailto:admin@localhost", publicKey, privateKey);
    configured = true;
  }
  return true;
}

/** Send to every subscribed browser and phone; drop subscriptions the push service says are gone. */
export async function sendPushToAll(payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  const subs = await db.select().from(pushSubscriptions);
  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          // "high" asks the push service to deliver at once, even to a sleeping phone; "normal" can wait until the device wakes.
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        delivered++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
        } else {
          console.error("[push] send failed", status ?? err);
        }
      }
    }),
  );
  return delivered;
}

export function snippet(text: string | null | undefined, max = 140): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
