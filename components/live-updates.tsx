"use client";

import { Inbox, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Toast = { title: string; body: string; url: string };

/** Path and query of a link from the service worker, so the router can open it. */
function localPath(url: string): string {
  const parsed = new URL(url, window.location.origin);
  return parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}` : "/replies";
}

/**
 * Keeps an open page current: when a reply notification arrives, the page reloads its data (reply list,
 * unread count) and shows the reply in a small banner. Data also refreshes when the tab is shown again.
 */
export function LiveUpdates() {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; title?: string; body?: string; url?: string } | null;
      if (data?.type === "push") {
        router.refresh();
        setToast({ title: data.title ?? "New reply", body: data.body ?? "", url: localPath(data.url ?? "/replies") });
      } else if (data?.type === "open" && data.url) {
        router.push(localPath(data.url));
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 10_000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="fixed inset-x-4 bottom-24 z-50 md:inset-x-auto md:right-6 md:bottom-6 md:w-96" role="status" aria-live="polite">
      <div className="flex items-start gap-3 rounded-xl border bg-card p-3 shadow-lg">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          <Inbox className="size-4.5" aria-hidden />
        </span>
        <Link href={toast.url} onClick={() => setToast(null)} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{toast.title}</span>
          {toast.body && <span className="line-clamp-2 text-sm text-muted">{toast.body}</span>}
        </Link>
        <button type="button" onClick={() => setToast(null)} className="rounded-lg p-1 text-muted hover:bg-neutral-soft" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
