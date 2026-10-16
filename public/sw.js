// Service worker: offline fallback page and reply push notifications.
const CACHE = "coldmailer-v1";
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
      await self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: data.tag,
        renotify: Boolean(data.tag),
        // Stay on screen until clicked or closed, instead of disappearing into the notification list after a few seconds.
        requireInteraction: true,
        timestamp: Date.now(),
        vibrate: [120, 60, 120],
        data: { url: data.url || "/replies" },
      });
      // Open ColdMailer pages refresh their reply lists and unread count.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: "push", title, body: data.body || "", url: data.url || "/replies" });
    })(),
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
