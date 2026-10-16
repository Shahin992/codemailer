"use client";

import { CalendarClock, Send, X } from "lucide-react";
import { useState, useTransition } from "react";
import { setEmailSendTime } from "@/app/actions/campaigns";
import { Button, Input } from "@/components/ui";
import { toLocalInputValue } from "@/lib/time-window";

/**
 * Change one waiting email's send time, send it now, or hand it back to automatic timing.
 * current: the time it's set for or expected at (ISO), used to fill in the picker.
 */
export function SendTimeEditor({ messageId, current, isSet }: { messageId: string; current: string | null; isSet: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openEditor() {
    const soon = Date.now() + 5 * 60_000;
    const base = current ? Math.max(new Date(current).getTime(), soon) : Date.now() + 60 * 60_000;
    setValue(toLocalInputValue(new Date(base)));
    setError(null);
    setOpen(true);
  }

  function save(sendAt: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await setEmailSendTime(messageId, sendAt);
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={openEditor} className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-primary hover:underline">
        <CalendarClock className="size-3.5" /> {isSet ? "Change time" : "Set time"}
      </button>
    );
  }

  return (
    <div className="mt-1 w-full max-w-sm space-y-2 rounded-lg border bg-card p-2 text-left">
      <div className="flex items-center gap-1.5">
        <Input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Send at"
          className="h-9 min-w-0 flex-1 text-sm"
        />
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Close">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" disabled={pending || !value} onClick={() => save(new Date(value).toISOString())}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => save(new Date().toISOString())}>
          <Send className="size-4" /> Send now
        </Button>
        {isSet && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => save(null)}>
            Automatic
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        In your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). It goes out at this time even outside the send window; the
        mailbox's daily limit still applies.
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
