"use client";

import { Ban, Ellipsis, Inbox, LayoutDashboard, LogOut, Mail, Send, Settings, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { APP_NAME_PARTS } from "@/lib/brand";

type NavItem = { href: string; label: string; icon: typeof Mail; badge?: number };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold">
      <img src="/brand/coldmailer-mark.svg" alt="" width={28} height={28} className="rounded-md" />
      <span className="text-[17px] tracking-tight">
        <span className="font-bold">{APP_NAME_PARTS[0]}</span>
        <span className="font-medium text-primary">{APP_NAME_PARTS[1]}</span>
      </span>
    </Link>
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
}: {
  children: ReactNode;
  unreadReplies: number;
  signOut: () => Promise<void>;
  user: { name: string; email: string };
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);

  const main: NavItem[] = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/campaigns", label: "Campaigns", icon: Send },
    { href: "/replies", label: "Replies", icon: Inbox, badge: unreadReplies },
    { href: "/mailboxes", label: "Mailboxes", icon: Mail },
  ];
  const extra: NavItem[] = [
    { href: "/recipients", label: "Recipients", icon: Users },
    { href: "/suppressions", label: "Do-not-send list", icon: Ban },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const extraActive = extra.some((item) => isActive(pathname, item.href));

  return (
    <div className="min-h-dvh md:flex">
      {/* Sidebar: tablets and up */}
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex md:sticky md:top-0 md:h-dvh lg:w-64">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {[...main, ...extra].map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary-soft text-primary" : "text-muted hover:bg-neutral-soft hover:text-fg",
                )}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="size-4.5" aria-hidden />
                <span className="flex-1">{item.label}</span>
                <CountBadge value={item.badge} />
              </Link>
            );
          })}
        </nav>
        <form action={signOut} className="border-t p-3">
          <div className="mb-1 min-w-0 px-3 py-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-neutral-soft hover:text-fg">
            <LogOut className="size-4.5" aria-hidden />
            Sign out
          </button>
        </form>
      </aside>

      {/* Top bar: phones */}
      <header className="safe-top sticky top-0 z-30 border-b bg-card/90 backdrop-blur md:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo />
        </div>
      </header>

      <main className="min-w-0 flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      {/* Bottom tab bar: phones */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur md:hidden" aria-label="Main">
        <div className="grid grid-cols-5">
          {main.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn("relative flex flex-col items-center gap-1 py-2 text-[11px] font-medium", active ? "text-primary" : "text-muted")}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
                <CountBadge value={item.badge} className="absolute top-1 left-1/2 ml-1.5" />
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn("flex flex-col items-center gap-1 py-2 text-[11px] font-medium", extraActive ? "text-primary" : "text-muted")}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <Ellipsis className="size-5" aria-hidden />
            More
          </button>
        </div>
      </nav>

      {/* "More" sheet: phones */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setMoreOpen(false)} />
          <div className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-2xl border-t bg-card p-3">
            <div className="flex items-center justify-between px-2 pb-2">
              <p className="font-semibold">More</p>
              <button className="rounded-lg p-2 text-muted hover:bg-neutral-soft" onClick={() => setMoreOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            {extra.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-3 text-base",
                  isActive(pathname, item.href) ? "bg-primary-soft text-primary" : "hover:bg-neutral-soft",
                )}
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            ))}
            <form action={signOut} className="mt-1 border-t pt-1">
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-base text-danger hover:bg-neutral-soft">
                <LogOut className="size-5" aria-hidden />
                <span className="min-w-0 text-left">
                  Sign out
                  <span className="block truncate text-xs text-muted">{user.email}</span>
                </span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
