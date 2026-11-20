"use client";

import { Ban, Ellipsis, Flame, Inbox, LayoutDashboard, LogOut, Mail, Send, Settings, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { removePushSubscription } from "@/app/actions/push";
import { LiveUpdates } from "@/components/live-updates";
import { NavIcon, NavigationProgress } from "@/components/nav-progress";
import { Toaster } from "@/components/toast";
import { PushSync } from "@/components/push-sync";
import { cn } from "@/components/ui";
import { APP_NAME_PARTS } from "@/lib/brand";
import { existingEndpoint } from "@/lib/push-client";

type NavItem = { href: string; label: string; icon: typeof Mail; badge?: number };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold">
      <img src="/brand/coldmailer-mark.svg" alt="" width={compact ? 26 : 28} height={compact ? 26 : 28} className="rounded-lg" />
      <span className={cn("tracking-tight", compact ? "text-base" : "text-[17px]")}>
        <span className="font-bold">{APP_NAME_PARTS[0]}</span>
        <span className="font-medium text-primary">{APP_NAME_PARTS[1]}</span>
      </span>
    </Link>
  );
}

function Initials({ name, className }: { name: string; className?: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const text = words.length >= 2 ? words[0][0] + words[words.length - 1][0] : (words[0]?.[0] ?? "?");
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary uppercase", className)} aria-hidden>
      {text}
    </span>
  );
}

function CountBadge({ value, className }: { value?: number; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn("min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 font-semibold text-primary-fg", className)}>
      {value > 99 ? "99+" : value}
    </span>
  );
}

export function AppShell({
  children,
  unreadReplies,
  signOut,
  user,
  vapidPublicKey,
}: {
  children: ReactNode;
  unreadReplies: number;
  signOut: () => Promise<void>;
  user: { name: string; email: string };
  vapidPublicKey: string;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);

  // Someone else may sign in on this device next: stop this account's reply notifications reaching it and
  // clear its unread count from the app icon. The next account to sign in registers the device again.
  async function signOutHere() {
    const endpoint = await existingEndpoint().catch(() => null);
    if (endpoint) await removePushSubscription(endpoint).catch(() => {});
    const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
    await nav.clearAppBadge?.().catch(() => {});
    await signOut();
  }

  const main: NavItem[] = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/campaigns", label: "Campaigns", icon: Send },
    { href: "/replies", label: "Replies", icon: Inbox, badge: unreadReplies },
    { href: "/mailboxes", label: "Mailboxes", icon: Mail },
    { href: "/warmup", label: "Warm-up", icon: Flame },
  ];
  const extra: NavItem[] = [
    { href: "/recipients", label: "Recipients", icon: Users },
    { href: "/suppressions", label: "Do-not-send list", icon: Ban },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const extraActive = extra.some((item) => isActive(pathname, item.href));

  return (
    <div className="min-h-dvh md:flex">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <Toaster />

      {/* Sidebar: tablets and up */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:sticky md:top-0 md:flex md:h-dvh lg:w-64">
        <div className="px-5 pt-6 pb-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
          {[...main, ...extra].map((item, i) => {
            const active = isActive(pathname, item.href);
            return (
              <div key={item.href}>
                {i === main.length && <div className="mx-3 my-3 border-t" />}
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    active ? "bg-primary-soft text-primary" : "text-muted hover:bg-neutral-soft hover:text-fg",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <NavIcon icon={item.icon} className="size-[18px]" />
                  <span className="flex-1">{item.label}</span>
                  <CountBadge value={item.badge} />
                </Link>
              </div>
            );
          })}
        </nav>
        <form action={signOutHere} className="border-t p-3">
          <div className="mb-1 flex min-w-0 items-center gap-3 px-2 py-1.5">
            <Initials name={user.name || user.email} className="size-9 text-xs" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-neutral-soft hover:text-fg">
            <LogOut className="size-[18px]" aria-hidden />
            Sign out
          </button>
        </form>
      </aside>

      {/* Top bar: phones */}
      <header className="safe-top sticky top-0 z-30 border-b bg-card/85 backdrop-blur-md md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo compact />
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="-mr-1 rounded-full p-1 transition-colors hover:bg-neutral-soft"
            aria-label="Account and more"
          >
            <Initials name={user.name || user.email} className="size-8 text-xs" />
          </button>
        </div>
      </header>

      <main className="min-w-0 flex-1 overflow-x-clip px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-12">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      {/* Bottom tab bar: phones */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-card/90 shadow-[0_-4px_16px_-8px_rgb(15_23_42/0.12)] backdrop-blur-md md:hidden" aria-label="Main">
        <div className="grid grid-cols-6 px-0.5 pt-1.5 pb-1">
          {main.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex min-w-0 flex-col items-center gap-0.5 py-1 text-[10.5px] tracking-tight"
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={cn(
                    "grid h-8 w-12 place-items-center rounded-full transition-colors",
                    active ? "bg-primary-soft text-primary" : "text-muted",
                  )}
                >
                  <NavIcon icon={item.icon} className="size-5" />
                </span>
                <span className={cn("max-w-full truncate", active ? "font-semibold text-primary" : "font-medium text-muted")}>{item.label}</span>
                <CountBadge value={item.badge} className="absolute top-0 left-1/2 ml-2 ring-2 ring-card" />
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex min-w-0 flex-col items-center gap-0.5 py-1 text-[10.5px] tracking-tight"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <span className={cn("grid h-8 w-12 place-items-center rounded-full", extraActive ? "bg-primary-soft text-primary" : "text-muted")}>
              <Ellipsis className="size-5" aria-hidden />
            </span>
            <span className={cn(extraActive ? "font-semibold text-primary" : "font-medium text-muted")}>More</span>
          </button>
        </div>
      </nav>

      <LiveUpdates />
      <PushSync vapidPublicKey={vapidPublicKey} unread={unreadReplies} />

      {/* "More" sheet: phones */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" aria-label="Close" onClick={() => setMoreOpen(false)} />
          {/* Bottom space: always some, plus the iPhone home-bar area (a "safe-bottom" class would replace the padding, not add to it). */}
          <div className="absolute inset-x-0 bottom-0 animate-toast-in rounded-t-3xl border-t bg-card px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-raised">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
            <div className="flex items-center gap-3 px-2 pb-3">
              <Initials name={user.name || user.email} className="size-10 text-sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{user.name}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
              </div>
              <button className="rounded-full p-2 text-muted hover:bg-neutral-soft" onClick={() => setMoreOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-0.5 border-t pt-2">
              {extra.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium",
                    isActive(pathname, item.href) ? "bg-primary-soft text-primary" : "hover:bg-neutral-soft",
                  )}
                >
                  <NavIcon icon={item.icon} className="size-5" />
                  {item.label}
                </Link>
              ))}
            </div>
            <form action={signOutHere} className="mt-3 border-t pt-3">
              <button className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium text-danger hover:bg-danger-soft">
                <LogOut className="size-5" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
