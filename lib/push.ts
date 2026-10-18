import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";

/** unread: the unread reply count, shown as a badge on the installed app's icon. */
export type PushPayload = { title: string; body: string; url: string; tag?: string; unread?: number };

let configured = false;

export function pushConfigured(): boolean {
  const publicKey = optionalEnv("VAPID_PUBLIC_KEY");
  const privateKey = optionalEnv("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    // Apple refuses pushes whose subject isn't a real address, so fall back to the admin's before a placeholder.
    const admin = optionalEnv("ADMIN_EMAIL");
    webpush.setVapidDetails(optionalEnv("VAPID_SUBJECT") ?? (admin ? `mailto:${admin}` : "mailto:admin@localhost"), publicKey, privateKey);
    configured = true;
  }
  return true;
}

export type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/**
 * Save (or refresh) a browser's or phone's subscription for a user. `replaces` is the endpoint it
 * took over from, when the browser renewed it; that one is removed.
 */
export async function saveSubscription(userId: string, sub: SubscriptionInput, userAgent: string, replaces?: string | null) {
  if (!/^https:\/\//.test(sub.endpoint) || !sub.p256dh || !sub.auth) throw new Error("Invalid push subscription");
  let ua = userAgent.slice(0, 300);
  if (replaces && replaces !== sub.endpoint) {
    // Same device and browser: keep what was saved about it (e.g. that it's the installed app). Only this
    // account's own row; another account's goes away by itself once the push service reports it expired.
    const [old] = await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, replaces), eq(pushSubscriptions.userId, userId)))
      .returning({ userAgent: pushSubscriptions.userAgent });
    if (old?.userAgent) ua = old.userAgent;
  }
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent: ua })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: sub.p256dh, auth: sub.auth, userAgent: ua } });
}

/** What happened to one device's notification. */
export type PushResult = { id: string; label: string; ok: boolean; error?: string };

/** A push service's refusal, in words that say what to do about it. */
function describePushError(status: number | undefined, body: string): string {
  if (status === 403 && /BadJwtToken/i.test(body)) return "Apple refused the sender identity. Set VAPID_SUBJECT to mailto:you@yourdomain.com and restart.";
  if (status === 403 || status === 401) return "The push service refused it (made with different keys). Open the app on this device to register it again.";
  if (status === 413) return "The notification was too large.";
  if (status === 429) return "The push service asked to slow down; it will be retried with the next reply.";
  return `The push service refused it${status ? ` (${status})` : ""}${body ? `: ${body.slice(0, 160)}` : "."}`;
}

/** Send to every browser and phone the account turned notifications on for; drop subscriptions the push service says are gone. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushResult[]> {
  if (!pushConfigured()) return [];
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  return Promise.all(
    subs.map(async (sub): Promise<PushResult> => {
      const label = deviceLabel(sub.userAgent);
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          // "high" asks the push service to deliver at once, even to a sleeping phone; "normal" can wait until the device wakes.
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        await db.update(pushSubscriptions).set({ lastSentAt: new Date(), lastError: null, lastErrorAt: null }).where(eq(pushSubscriptions.id, sub.id));
        return { id: sub.id, label, ok: true };
      } catch (err) {
        const { statusCode: status, body } = err as { statusCode?: number; body?: string };
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
          return { id: sub.id, label, ok: false, error: "This device's subscription has expired. Open the app on it to register again." };
        }
        const error = status ? describePushError(status, String(body ?? "").trim()) : `Could not reach the push service: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[push] ${label}: ${error}`);
        await db.update(pushSubscriptions).set({ lastError: error, lastErrorAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
        return { id: sub.id, label, ok: false, error };
      }
    }),
  );
}

/** The device's service worker confirms a notification arrived. The endpoint itself proves which device it is. */
export async function markPushReceived(endpoint: string) {
  await db.update(pushSubscriptions).set({ lastReceivedAt: new Date() }).where(eq(pushSubscriptions.endpoint, endpoint));
}

/** Added to the saved user agent when the subscription came from the installed app. */
export const INSTALLED_MARK = "[installed-app]";

/** "Chrome on Android (installed app)" from the user agent saved with a subscription. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /Mac OS X|Macintosh/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /SamsungBrowser/.test(ua)
    ? "Samsung Internet"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "";
  const name = browser && os ? `${browser} on ${os}` : browser || os || "Unknown device";
  return ua.includes(INSTALLED_MARK) ? `${name} (installed app)` : name;
}

export function snippet(text: string | null | undefined, max = 140): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
