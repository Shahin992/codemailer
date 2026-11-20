"use client";

// The last 14 days as bars, one per day, split by where the emails landed. Tap (or hover) a bar to read that
// day's numbers under the chart; today is picked to start with. Numbers are also in the figures below it.
import { useState } from "react";
import { cn } from "@/components/ui";
import type { WarmupDay } from "@/lib/warmup/status";

type Part = { key: string; label: string; className: string; value: (d: WarmupDay) => number };

// Business mailbox: its own emails by where the other mailbox found them. Partner: emails it got, inbox or spam.
const SENT_PARTS: Part[] = [
  { key: "inbox", label: "Inbox", className: "bg-success", value: (d) => d.inbox },
  { key: "spam", label: "Spam", className: "bg-danger", value: (d) => d.spam },
  { key: "notFound", label: "Not found yet", className: "bg-muted/35", value: (d) => d.notFound },
];
const RECEIVED_PARTS: Part[] = [
  { key: "inbox", label: "Inbox", className: "bg-success", value: (d) => d.received - d.receivedSpam },
  { key: "spam", label: "Spam", className: "bg-danger", value: (d) => d.receivedSpam },
];

const dayName = (date: string, style: "short" | "long") =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    ...(style === "long" ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric" }),
  });

export function DailyChart({ days, mode }: { days: WarmupDay[]; mode: "sent" | "received" }) {
  const parts = mode === "sent" ? SENT_PARTS : RECEIVED_PARTS;
  const total = (d: WarmupDay) => (mode === "sent" ? d.sent : d.received);
  const [picked, setPicked] = useState(days.length - 1);
  const top = Math.max(...days.map(total), 1);
  const day = days[picked];
  const noun = mode === "sent" ? "sent" : "received";

  return (
    <div>
      {/* Legend: colour is never the only clue, the picked day is spelled out below. */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-[3px]", p.className)} aria-hidden />
            {p.label}
          </span>
        ))}
      </div>

      <div className="relative">
        {/* One faint line at the top with the biggest day's number, so the bars have a scale. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2" aria-hidden>
          <span className="h-px flex-1 border-t border-dashed" />
          <span className="text-[10px] text-muted tabular-nums">{top}</span>
        </div>
        <div className="flex h-32 items-end gap-1 pt-4 pr-6" role="list" aria-label={`Warm-up emails ${noun} per day, last ${days.length} days`}>
          {days.map((d, i) => {
            const t = total(d);
            const on = i === picked;
            return (
              <button
                key={d.date}
                type="button"
                role="listitem"
                onClick={() => setPicked(i)}
                onMouseEnter={() => setPicked(i)}
                onFocus={() => setPicked(i)}
                aria-label={`${dayName(d.date, "long")}: ${t} ${noun}`}
                aria-pressed={on}
                className={cn("flex h-full min-w-0 flex-1 flex-col justify-end border-b-2 px-px pb-0.5", on ? "border-fg" : "border-transparent")}
              >
                {t === 0 ? (
                  <span className="block h-[3px] rounded-full bg-border" />
                ) : (
                  <span className="flex flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]" style={{ height: `${(t / top) * 100}%` }}>
                    {parts.map((p) => {
                      const v = p.value(d);
                      return v > 0 ? <span key={p.key} className={cn("min-h-[3px] w-full", p.className)} style={{ flexGrow: v, flexBasis: 0 }} /> : null;
                    })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1 pr-6 text-[10px] text-muted tabular-nums" aria-hidden>
          {days.map((d, i) => (
            // A centred flex box lets "Today" spill evenly over its neighbours on a narrow phone.
            <span key={d.date} className={cn("flex min-w-0 flex-1 justify-center whitespace-nowrap", i === picked && "font-semibold text-fg")}>
              {i === days.length - 1 ? "Today" : i % 2 === (days.length - 1) % 2 ? dayName(d.date, "short") : ""}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-3 rounded-xl bg-neutral-soft px-3 py-2 text-[13px]" aria-live="polite">
        <span className="font-semibold">{picked === days.length - 1 ? "Today" : dayName(day.date, "long")}</span>
        <span className="text-muted"> · </span>
        {total(day) === 0 ? (
          <span className="text-muted">nothing {noun}</span>
        ) : (
          <>
            {total(day)} {noun}
            <span className="text-muted">
              {": "}
              {parts
                .map((p) => [p.value(day), p.label.toLowerCase()] as const)
                .filter(([v]) => v > 0)
                .map(([v, label]) => `${v} ${label}`)
                .join(", ")}
            </span>
          </>
        )}
        {mode === "sent" && day.received > 0 && <span className="text-muted"> · {day.received} received</span>}
      </p>
    </div>
  );
}
