import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[background-color,box-shadow,transform,color] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 whitespace-nowrap select-none";
const buttonVariants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg shadow-card hover:bg-primary-hover",
  secondary: "bg-card text-fg border shadow-card hover:bg-neutral-soft",
  ghost: "text-fg hover:bg-neutral-soft",
  danger: "bg-danger-soft text-danger hover:brightness-95",
};
const buttonSizes: Record<Size, string> = {
  sm: "h-10 px-3.5 text-sm md:h-9",
  md: "h-12 px-5 text-[15px] md:h-10 md:px-4 md:text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border bg-card shadow-card", className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b px-4 py-3.5 md:px-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-snug text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0 text-sm font-medium">{action}</div>}
    </div>
  );
}

/** Page title. On a phone the title and its buttons share a row and the description stays short underneath. */
export function PageHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 md:mb-6">
      <div className="min-w-0 flex-1 basis-40">
        <h1 className="text-[22px] leading-tight font-bold tracking-tight md:text-[26px]">{title}</h1>
        {description && <p className="mt-1 text-[13px] leading-snug text-muted md:text-sm">{description}</p>}
      </div>
      {/* On a phone the header's buttons are compact so they fit beside the title. */}
      {action && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 max-md:[&_a]:h-10 max-md:[&_a]:px-3.5 max-md:[&_a]:text-sm max-md:[&_button]:h-10 max-md:[&_button]:px-3.5 max-md:[&_button]:text-sm">
          {action}
        </div>
      )}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border bg-card px-3.5 text-fg shadow-[inset_0_1px_1px_rgb(15_23_42/0.03)] transition-[border-color,box-shadow] placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15 disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputBase, "h-12 md:h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputBase, "py-3 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(inputBase, "h-12 pr-8 md:h-10", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] text-danger">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-snug text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, description, ...props }: ComponentProps<"input"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl py-1.5">
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded accent-[var(--primary)]" {...props} />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-muted">{description}</span>}
      </span>
    </label>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";
const tones: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-muted",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  primary: "bg-primary-soft text-primary",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  draft: "warning",
  queued: "neutral",
  sending: "info",
  sent: "info",
  replied: "success",
  bounced: "danger",
  failed: "danger",
  cancelled: "neutral",
  active: "success",
  paused: "warning",
  done: "primary",
  unsubscribed: "warning",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-muted",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  primary: "bg-primary",
};

/** A status as a small coloured label with a dot ("● active"). */
export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? "neutral";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold capitalize", tones[tone])}>
      <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden />
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Progress({ value, max, tone = "primary" }: { value: number; max: number; tone?: "primary" | "success" | "warning" | "danger" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-1 text-[26px] leading-none font-bold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl border bg-card p-4 shadow-card transition-colors hover:bg-neutral-soft active:scale-[0.99]">
      {body}
    </Link>
  ) : (
    <div className="rounded-2xl border bg-card p-4 shadow-card">{body}</div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-neutral-soft text-muted" aria-hidden>
        <Info className="size-5" />
      </span>
      <p className="font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm leading-snug text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const ALERT_ICONS = { info: Info, warning: TriangleAlert, danger: CircleAlert, success: CircleCheck } as const;

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode }) {
  const styles = {
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  }[tone];
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl px-3.5 py-3 text-sm leading-snug", styles)} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(Boolean(title) && "mt-0.5", "break-words opacity-95")}>{children}</div>}
      </div>
    </div>
  );
}

/** A grey placeholder shape shown while a page loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded-lg bg-neutral-soft", className)} aria-hidden />;
}

/** Tabs that switch a page between sections with links (?tab=…), so each section has its own address. */
export function SectionTabs({ tabs, active }: { tabs: { href: string; label: ReactNode; key: string; count?: number }[]; active: string }) {
  return (
    <nav className="flex gap-1 rounded-xl bg-neutral-soft p-1" aria-label="Sections">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition-colors md:h-9",
              on ? "bg-card text-fg shadow-card" : "text-muted hover:text-fg",
            )}
          >
            <span className="truncate">{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-fg">{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Label-and-value rows ("Next turn … in 5 minutes"), readable on a phone. */
export function DetailList({ items }: { items: { label: ReactNode; value: ReactNode; wide?: boolean }[] }) {
  return (
    <dl className="divide-y">
      {items.map((item, i) => (
        <div key={i} className={cn("px-4 py-3 text-sm md:px-5", item.wide ? "space-y-1" : "flex items-baseline justify-between gap-4")}>
          <dt className="shrink-0 text-muted">{item.label}</dt>
          <dd className={cn("min-w-0 font-medium", item.wide ? "break-words" : "text-right")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
