"use client";

// Change a running campaign's send hours and days (weekends on or off) from its Schedule card.
import { setCampaignWindow, type WindowFormState } from "@/app/actions/campaigns";
import { SubmitButton, useActionForm } from "@/components/client";
import { ActionResult } from "@/components/toast";
import { Checkbox, Field, Input } from "@/components/ui";

export function CampaignWindowForm({
  id,
  windowStart,
  windowEnd,
  weekdaysOnly,
  timeZoneName,
}: {
  id: string;
  windowStart: string;
  windowEnd: string;
  weekdaysOnly: boolean;
  timeZoneName: string;
}) {
  const { state, onSubmit, pending } = useActionForm<WindowFormState>(setCampaignWindow.bind(null, id), {});
  return (
    <details className="group border-t" open={Boolean(state.error)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-primary md:px-5 [&::-webkit-details-marker]:hidden">
        Change send days and hours
        <span className="text-xs font-medium text-muted group-open:hidden">{weekdaysOnly ? "Weekends are off" : "Sends every day"}</span>
      </summary>
      <form method="post" onSubmit={onSubmit} className="space-y-4 px-4 pb-4 md:px-5 md:pb-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor={`ws-${id}`}>
            <Input id={`ws-${id}`} name="windowStart" type="time" defaultValue={windowStart} required />
          </Field>
          <Field label="Until" htmlFor={`we-${id}`}>
            <Input id={`we-${id}`} name="windowEnd" type="time" defaultValue={windowEnd} required />
          </Field>
        </div>
        <Checkbox
          name="weekdaysOnly"
          label="Weekdays only"
          defaultChecked={weekdaysOnly}
          description="Untick to send on Saturday and Sunday too."
        />
        <p className="text-xs text-muted">{timeZoneName} time. Applies from the next minute; daily limits stay the same.</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <ActionResult state={state} />
          </div>
          <SubmitButton pending={pending} variant="secondary" size="sm" pendingText="Saving…">
            Save send window
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
