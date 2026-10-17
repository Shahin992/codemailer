"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { INSTALLED_MARK, pushConfigured, saveSubscription, sendPushToAll, type PushResult, type SubscriptionInput } from "@/lib/push";
import { APP_NAME } from "@/lib/brand";

/**
 * Save this device's subscription. Called when notifications are turned on and again each time the app
 * opens, so a phone whose subscription changed or was dropped is registered again without anyone noticing.
 */
export async function savePushSubscription(sub: SubscriptionInput, userAgent: string, installed = false, replaces: string | null = null) {
  const me = await requireSession();
  await saveSubscription(me.id, sub, installed ? `${userAgent} ${INSTALLED_MARK}` : userAgent, replaces);
}

export async function removePushSubscription(endpoint: string) {
  await requireSession();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  revalidatePath("/settings");
}

/** Stop notifications to one of your devices (for example an old phone). */
export async function removePushDevice(id: string) {
  const me = await requireSession();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, me.id)));
  revalidatePath("/settings");
}

/** Send a test notification to every device and say, per device, whether the push service took it. */
export async function sendTestPush(): Promise<{ results: PushResult[]; error?: string }> {
  await requireSession();
  if (!pushConfigured()) return { results: [], error: "VAPID keys are missing from .env." };
  const results = await sendPushToAll({ title: APP_NAME, body: "Notifications work. You'll get one for each new reply.", url: "/replies", tag: `test-${Date.now()}` });
  revalidatePath("/settings");
  return { results, error: results.length ? undefined : "No device has notifications turned on yet." };
}
