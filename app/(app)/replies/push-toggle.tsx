"use client";

import { Bell, BellOff, Smartphone, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { removePushDevice, removePushSubscription, savePushSubscription, sendTestPush } from "@/app/actions/push";
import { Time } from "@/components/client";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { currentSubscription, isIos, isStandalone, pushSupported, setPushOff, subscriptionKeys } from "@/lib/push-client";

type Status = "loading" | "unsupported" | "ios-needs-install" | "denied" | "off" | "on";

/** One of your devices that gets notifications. tail: the end of its endpoint, to spot this device. */
export type PushDevice = {
  id: string;
  label: string;
  createdAt: string;
  tail: string;
  lastSentAt: string | null;
  lastReceivedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** Did the last notification reach this device? Sent = the push service took it; arrived = the device said so. */
function DeviceHealth({ d }: { d: PushDevice }) {
  if (d.lastError && ms(d.lastErrorAt) >= ms(d.lastSentAt)) {
    return (
      <span className="block text-xs text-danger">
        Last notification failed <Time value={d.lastErrorAt} mode="relative" />: {d.lastError}
      </span>
    );
  }
  if (!d.lastSentAt) return <span className="block text-xs text-muted">No notification sent yet. Use “Send test”.</span>;
  const arrived = ms(d.lastReceivedAt) >= ms(d.lastSentAt) - 60_000;
  return arrived ? (
    <span className="block text-xs text-success">
      Last notification arrived <Time value={d.lastReceivedAt} mode="relative" />
    </span>
  ) : (
    <span className="block text-xs text-warning">
      Sent <Time value={d.lastSentAt} mode="relative" />, but the device hasn't confirmed it arrived. It may be blocking notifications in the
      background: see the tips below.
    </span>
  );
}

/** Turn reply notifications on or off for this browser or phone, and see which devices get them. */
export function PushToggle({ vapidPublicKey, compact = false, devices }: { vapidPublicKey: string; compact?: boolean; devices?: PushDevice[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, startRemoving] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      if (!pushSupported()) {
        setStatus(isIos() && !isStandalone() ? "ios-needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setStatus("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
      setStatus(sub && Notification.permission === "granted" ? "on" : "off");
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
      const { sub, replaced } = await currentSubscription(vapidPublicKey);
      await savePushSubscription(subscriptionKeys(sub), navigator.userAgent, isStandalone(), replaced);
      setPushOff(false);
      setEndpoint(sub.endpoint);
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
      setPushOff(true);
      setEndpoint(null);
      setStatus("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const { results, error } = await sendTestPush();
    const failed = results.filter((r) => !r.ok);
    setMessage(
      error
        ? { tone: "danger", text: error }
        : failed.length
          ? { tone: "danger", text: `Sent to ${results.length - failed.length} of ${results.length} devices. ${failed.map((r) => `${r.label}: ${r.error}`).join(" ")}` }
          : { tone: "success", text: `Sent to ${results.length} device${results.length === 1 ? "" : "s"}. Each one should show it within a few seconds.` },
    );
    setBusy(false);
    // Devices confirm arrival in the background; show their status once they've had time to.
    setTimeout(() => router.refresh(), 8_000);
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
    denied: "Notifications are blocked for this app. Allow them in the phone's or browser's settings for this site, then reopen the app.",
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

      {!compact && devices && devices.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-1 text-xs font-medium text-muted">Your devices that get notifications</p>
          <ul className="divide-y">
            {devices.map((d) => (
              <li key={d.id} className="flex items-start gap-2 py-2">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="mr-1.5">{d.label}</span>
                  {endpoint?.endsWith(d.tail) && <Badge tone="primary">this device</Badge>}
                  <DeviceHealth d={d} />
                  <span className="block text-xs text-muted">
                    Added <Time value={d.createdAt} mode="date" />
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={removing}
                  aria-label={`Stop notifications to ${d.label}`}
                  title="Stop notifications to this device"
                  onClick={() => startRemoving(() => removePushDevice(d.id))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-primary">Notifications late on your phone?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
            <li>Replies are checked the moment they reach your inbox, and the notification is sent at once.</li>
            <li>
              Android: Settings → Apps → Chrome (and ColdMailer, if listed) → Battery → <strong>Unrestricted</strong>. Battery savers hold notifications
              back until the phone wakes up.
            </li>
            <li>
              iPhone: Settings → Notifications → ColdMailer: allow notifications and keep it out of <strong>Scheduled Summary</strong>. Low Power Mode
              and Focus can also hold them.
            </li>
            <li>Use “Send test” with the screen off to check: it should arrive within a few seconds.</li>
          </ul>
        </details>
      )}
    </Card>
  );
}
