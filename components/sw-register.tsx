"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.pathname.startsWith("/u/")) return; // recipients' unsubscribe page
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.error("Service worker failed", err));
  }, []);
  return null;
}
