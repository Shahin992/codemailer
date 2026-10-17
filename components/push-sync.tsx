"use client";

import { useEffect } from "react";
import { savePushSubscription } from "@/app/actions/push";
import { currentSubscription, isPushOff, isStandalone, pushSupported, subscriptionKeys } from "@/lib/push-client";

const RECHECK_MS = 60 * 60_000;

/**
 * Keeps reply notifications reaching this device. Each time the app opens (and when it comes back after an
 * hour or more), if notifications are allowed here it makes sure the device has a push subscription and that
 * the server has it. Phones renew or drop subscriptions on their own; without this a phone could silently stop
 * getting notifications. Also shows the unread count on the installed app's icon.
 */
export function PushSync({ vapidPublicKey, unread }: { vapidPublicKey: string; unread: number }) {
  useEffect(() => {
    if (!vapidPublicKey || !pushSupported()) return;
    let last = 0;
    const sync = async () => {
      if (Notification.permission !== "granted" || isPushOff() || Date.now() - last < RECHECK_MS) return;
      last = Date.now();
      const { sub, replaced } = await currentSubscription(vapidPublicKey);
      await savePushSubscription(subscriptionKeys(sub), navigator.userAgent, isStandalone(), replaced);
    };
    const run = () => void sync().catch((err) => console.warn("Push check failed", err));
    const onVisible = () => document.visibilityState === "visible" && run();
    run();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [vapidPublicKey]);

  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge || !nav.clearAppBadge) return;
    (unread > 0 ? nav.setAppBadge(unread) : nav.clearAppBadge()).catch(() => {});
  }, [unread]);

  return null;
}
