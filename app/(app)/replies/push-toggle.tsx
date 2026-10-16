"use client";

import { Bell, BellOff, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/app/actions/push";
import { Alert, Button, Card } from "@/components/ui";

type Status = "loading" | "unsupported" | "ios-needs-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Turn reply notifications on or off for this browser or phone. */
export function PushToggle({ vapidPublicKey, compact = false }: { vapidPublicKey: string; compact?: boolean }) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus(isIos() && !isStandalone() ? "ios-needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setStatus("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    })().catch(() => setStatus("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
      const json = sub.toJSON();
      await savePushSubscription({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" }, navigator.userAgent);
      setStatus("on");
      setMessage({ tone: "success", text: "Notifications are on for this device." });
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const result = await sendTestPush();
    setMessage(result.sent > 0 ? { tone: "success", text: `Test sent to ${result.sent} device(s).` } : { tone: "danger", text: result.error ?? "No device received it." });
    setBusy(false);
  }

  if (!vapidPublicKey) {
    return compact ? null : (
      <Alert tone="warning" title="Push notifications are not set up">
        Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to .env (run <code>npm run keys</code> to create them), then restart the app.
      </Alert>
    );
  }
  if (status === "loading" || (compact && (status === "on" || status === "unsupported"))) return null;

  const text: Record<Exclude<Status, "loading">, string> = {
    unsupported: "This browser can't show push notifications.",
    "ios-needs-install": "On iPhone and iPad: tap Share → Add to Home Screen, open the app from there, then turn notifications on.",
    denied: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
    off: "Get a notification on this device when someone replies.",
    on: "This device gets a notification for every new reply.",
  };

  return (
    <Card className={compact ? "mb-4 p-3" : "p-4 md:p-5"}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          {status === "ios-needs-install" ? <Smartphone className="size-4.5" /> : status === "on" ? <Bell className="size-4.5" /> : <BellOff className="size-4.5" />}
        </span>
        <p className="min-w-0 flex-1 text-sm">{text[status]}</p>
        <div className="flex gap-2">
          {status === "off" && (
            <Button size="sm" onClick={enable} disabled={busy}>
              {busy ? "Turning on…" : "Turn on"}
            </Button>
          )}
          {status === "on" && (
            <>
              <Button size="sm" variant="secondary" onClick={test} disabled={busy}>
                Send test
              </Button>
              <Button size="sm" variant="ghost" onClick={disable} disabled={busy}>
                Turn off
              </Button>
            </>
          )}
        </div>
      </div>
      {message && (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      )}
    </Card>
  );
}
