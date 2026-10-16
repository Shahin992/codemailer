"use server";

import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { pushConfigured, sendPushToAll } from "@/lib/push";
import { APP_NAME } from "@/lib/brand";

export async function savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string) {
  const me = await requireSession();
  if (!/^https:\/\//.test(sub.endpoint) || !sub.p256dh || !sub.auth) throw new Error("Invalid push subscription");
  await db
    .insert(pushSubscriptions)
    .values({ userId: me.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent: userAgent.slice(0, 300) })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: me.id, p256dh: sub.p256dh, auth: sub.auth } });
}

export async function removePushSubscription(endpoint: string) {
  await requireSession();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function sendTestPush(): Promise<{ sent: number; error?: string }> {
  await requireSession();
  if (!pushConfigured()) return { sent: 0, error: "VAPID keys are missing from .env." };
  const sent = await sendPushToAll({ title: APP_NAME, body: "Notifications work. You'll get one for each new reply.", url: "/replies", tag: "test" });
  return { sent };
}
