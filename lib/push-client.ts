// Browser-side push helpers shared by the notification toggle and the background re-check.

const OFF_KEY = "coldmailer:push-off";

export function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Running as the installed app (home-screen icon), not in a browser tab. */
export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Remembers that notifications were turned off on this device, so the re-check doesn't turn them back on. */
export function setPushOff(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // storage blocked: nothing to remember
  }
}

export function isPushOff() {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * This device's push subscription for the server's key: the existing one, or a new one if there is none
 * or it was made with an old key. `replaced` is the endpoint of a subscription it took over from.
 */
export async function currentSubscription(vapidPublicKey: string): Promise<{ sub: PushSubscription; replaced: string | null }> {
  const reg = await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  let replaced: string | null = null;
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    replaced = sub.endpoint;
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return { sub, replaced };
}

export function subscriptionKeys(sub: PushSubscription) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" };
}
