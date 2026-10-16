"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cn } from "@/components/ui";

/**
 * Runs a server action from a form without React's automatic form reset, so what the
 * person typed stays in place when the action returns an error.
 */
export function useActionForm<S>(action: (state: Awaited<S>, payload: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(data));
  };
  return { state, onSubmit, pending };
}

/** Submit button that disables itself and shows progress while its form is submitting. */
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  confirm,
  pending: pendingProp,
  ...props
}: ComponentProps<"button"> & {
  pendingText?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  confirm?: string;
  /** Pass when the form is submitted with useActionForm (useFormStatus can't see it). */
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button
      type="submit"
      disabled={pending || props.disabled}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      {...props}
    >
      {pending ? (
        <>
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function formatDate(date: Date, mode: "datetime" | "relative" | "date") {
  if (mode === "date") return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (mode === "datetime") {
    return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }
  const diff = (Date.now() - date.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const sign = diff >= 0 ? -1 : 1;
  if (abs < 45) return diff >= 0 ? "just now" : "in a moment";
  if (abs < 3600) return rtf.format(sign * Math.round(abs / 60), "minute");
  if (abs < 86400) return rtf.format(sign * Math.round(abs / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(sign * Math.round(abs / 86400), "day");
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Shows a time in the viewer's own timezone (the server doesn't know it). */
export function Time({ value, mode = "datetime" }: { value: Date | string | null | undefined; mode?: "datetime" | "relative" | "date" }) {
  const [text, setText] = useState<string | null>(null);
  const iso = value ? new Date(value).toISOString() : null;
  useEffect(() => {
    if (!iso) return;
    const update = () => setText(formatDate(new Date(iso), mode));
    update();
    if (mode !== "relative") return;
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, [iso, mode]);
  if (!iso) return <span className="text-muted">—</span>;
  return (
    <time dateTime={iso} title={iso}>
      {text ?? "…"}
    </time>
  );
}

function countdownText(ms: number): string {
  if (ms <= 0) return "any moment now";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${pad(minutes)}m ${pad(total % 60)}s`;
  return `in ${minutes}m ${pad(total % 60)}s`;
}

let lastAutoRefresh = 0;

/** Live "in 12m 05s" countdown. Shortly after the time passes it reloads the page's data once, so the sent status shows. */
export function Countdown({ to, className }: { to: Date | string; className?: string }) {
  const router = useRouter();
  const target = new Date(to).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // The send job runs once a minute, so look again about 75 seconds after the time (once for all rows).
    const late = now === null ? 0 : now - target;
    if (late > 75_000 && late < 80_000 && Date.now() - lastAutoRefresh > 30_000) {
      lastAutoRefresh = Date.now();
      router.refresh();
    }
  }, [now, target, router]);
  return (
    <span className={cn("font-medium text-fg tabular-nums", className)} title={new Date(target).toISOString()}>
      {now === null ? "…" : countdownText(target - now)}
    </span>
  );
}
