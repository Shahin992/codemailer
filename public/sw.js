// Service worker: offline fallback page and reply push notifications.
const CACHE = "coldmailer-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Pages always come from the network (data must be fresh); show the offline page if there is none.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ColdMailer", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "New reply";
  event.waitUntil(
    (async () => {
      // Show the notification first and on every push: phones drop subscriptions whose pushes show nothing.
      await self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: data.tag,
        renotify: Boolean(data.tag),
        silent: false,
        // Stay on screen until clicked or closed, instead of disappearing into the notification list after a few seconds.
        requireInteraction: true,
        timestamp: Date.now(),
        vibrate: [120, 60, 120],
        data: { url: data.url || "/replies" },
      });
      // Unread count on the installed app's icon (Android, iPhone, desktop), where supported.
      if (typeof data.unread === "number" && self.navigator.setAppBadge) {
        await (data.unread > 0 ? self.navigator.setAppBadge(data.unread) : self.navigator.clearAppBadge()).catch(() => {});
      }
      // Tell the server this device got it, so Settings can show that notifications really reach this phone.
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/received", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
      }
      // Open ColdMailer pages refresh their reply lists and unread count.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: "push", title, body: data.body || "", url: data.url || "/replies" });
    })(),
  );
});

// The browser renewed or dropped the subscription by itself: subscribe again and tell the server,
// so replies keep reaching this device. (The app also re-checks this every time it opens.)
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      const sub = event.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!sub) return;
      const json = sub.toJSON();
      await fetch("/api/push/subscription", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys, oldEndpoint: old ? old.endpoint : null }),
      });
    })().catch((err) => console.error("Push renewal failed", err)),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/replies", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((c) => c.url.startsWith(self.location.origin));
      if (!client) return self.clients.openWindow(url);
      await client.focus();
      // navigate() only works on pages this worker controls; others are asked to open the link themselves.
      await client.navigate(url).catch(() => client.postMessage({ type: "open", url }));
    })(),
  );
});
