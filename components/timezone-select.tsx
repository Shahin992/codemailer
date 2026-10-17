"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { Select } from "@/components/ui";
import { timezoneName, type TimezoneGroup } from "@/lib/timezones";

/** The time right now on the clock in `timeZone`: "Sat 17 Oct, 9:41 AM MST". */
export function zoneClock(timeZone: string, date = new Date()): string {
  return date.toLocaleString(undefined, { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/**
 * A dropdown of every timezone (popular ones first), with the current time there underneath.
 * Controlled with value/onChange, or a plain form field with name/defaultValue.
 */
export function TimezoneSelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  groups,
}: {
  id: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (zone: string) => void;
  groups: TimezoneGroup[];
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const zone = value ?? own;
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      try {
        setNow(zoneClock(zone));
      } catch {
        setNow(null);
      }
    };
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, [zone]);

  return (
    <div className="space-y-1.5">
      <Select
        id={id}
        name={name}
        value={zone}
        onChange={(e) => {
          setOwn(e.target.value);
          onChange?.(e.target.value);
        }}
        required
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => (
              <option key={`${group.label}-${o.value}`} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Clock className="size-3.5 shrink-0" aria-hidden />
        <span>
          Now in {timezoneName(zone)}: <span className="font-medium text-fg">{now ?? "…"}</span>
        </span>
      </p>
    </div>
  );
}
