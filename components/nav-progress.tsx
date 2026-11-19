"use client";

// Signs that the app is working while a page loads:
//  - NavigationProgress: a thin bar across the top of the screen from the moment a link is tapped until the
//    new page is shown;
//  - NavIcon: the tapped tab's icon turns into a spinner until its page opens.

import type { LucideIcon } from "lucide-react";
import { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui";

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-hidden />;
}

/** The tab icon, or a spinner while its page is opening. Must sit inside the tab's <Link>. */
export function NavIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={cn("size-[18px]", className)} /> : <Icon className={className} aria-hidden />;
}

function isInternalNavigation(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return false;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  // Same page and query: nothing loads.
  return url.pathname + url.search !== window.location.pathname + window.location.search;
}

export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);

  // The new page is on screen: stop.
  useEffect(() => setLoading(false), [pathname, search]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (isInternalNavigation(event)) setLoading(true);
    };
    const onSubmit = (event: SubmitEvent) => {
      // Search and filter forms (GET) load a new page too.
      const form = event.target as HTMLFormElement | null;
      if (form && (form.getAttribute("method") ?? "get").toLowerCase() === "get" && !form.getAttribute("action")?.startsWith("javascript")) {
        setLoading(true);
      }
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  // Never stuck: give up after 15 seconds (an error page, a download…).
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setLoading(false), 15_000);
    return () => clearTimeout(timer);
  }, [loading]);

  return (
    <div
      className={cn("pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] overflow-hidden transition-opacity duration-300", loading ? "opacity-100" : "opacity-0")}
      role="progressbar"
      aria-hidden={!loading}
      aria-label="Loading"
    >
      <div className="h-full w-2/5 animate-progress rounded-full bg-primary" />
    </div>
  );
}
