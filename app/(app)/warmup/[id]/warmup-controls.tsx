"use client";

import { Flame, Pause } from "lucide-react";
import { useActionState, useState } from "react";
import { saveWarmupSettings, setWarmup, type WarmupFormState } from "@/app/actions/warmup";
import { SubmitButton, useActionForm } from "@/components/client";
import { Field, Input, Select } from "@/components/ui";
import { WARMUP_LIMITS } from "@/lib/warmup/schedule";
import { ActionResult } from "@/components/toast";

function Result({ state }: { state: WarmupFormState }) {
  return <ActionResult state={state} />;
}

/** The on/off switch. */
export function WarmupSwitch({ id, enabled, disabledReason }: { id: string; enabled: boolean; disabledReason?: string }) {
  const [state, action] = useActionState<WarmupFormState>(setWarmup.bind(null, id, !enabled), {});
  return (
    <div className="space-y-3">
      <form action={action}>
        <SubmitButton
          variant={enabled ? "secondary" : "primary"}
          size="sm"
          disabled={!enabled && Boolean(disabledReason)}
          pendingText={enabled ? "Turning off…" : "Turning on…"}
          confirm={enabled ? "Turn off warm-up for this mailbox? Its waiting warm-up emails are cancelled; the ramp continues where it stopped when you turn it on again." : undefined}
        >
          {enabled ? <Pause className="size-4" /> : <Flame className="size-4" />}
          {enabled ? "Turn off warm-up" : "Turn on warm-up"}
        </SubmitButton>
      </form>
      {!enabled && disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
      <Result state={state} />
    </div>
  );
}

type Values = {
  warmupRole: "sender" | "partner";
  warmupStart: number;
  warmupIncrease: number;
  warmupMax: number;
  warmupReplyRate: number;
  warmupReceiveMax: number;
};
type NumberField = Exclude<keyof Values, "warmupRole">;

/** Role, then the numbers that matter for it: the ramp for a business mailbox, the daily number for a partner. */
export function WarmupSettingsForm({ id, values }: { id: string; values: Values }) {
  const { state, onSubmit, pending } = useActionForm<WarmupFormState>(saveWarmupSettings.bind(null, id), {});
  const [role, setRole] = useState(values.warmupRole);
  const err = state.fieldErrors ?? {};
  const number = (name: NumberField, limits: { min: number; max: number }) => (
    <Input id={name} name={name} type="number" inputMode="numeric" min={limits.min} max={limits.max} step={1} defaultValue={values[name]} required />
  );
  const partner = role === "partner";
  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <Field
        label="Takes part as"
        htmlFor="warmupRole"
        error={err.warmupRole}
        hint={
          partner
            ? "Only receives warm-up emails and replies, like your own Gmail accounts. Never sends campaigns."
            : "Sends warm-up emails every day and replies to the ones it gets. For the mailboxes you send campaigns from."
        }
      >
        <Select id="warmupRole" name="warmupRole" value={role} onChange={(e) => setRole(e.target.value as Values["warmupRole"])}>
          <option value="sender">Business mailbox (sends and replies)</option>
          <option value="partner">Partner (only receives and replies)</option>
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Hidden fields are still sent, so switching the role never loses the other role's numbers. */}
        <div className={partner ? "hidden" : "contents"}>
          <Field label="Emails on day 1" htmlFor="warmupStart" error={err.warmupStart} hint="New warm-up emails it sends on the first day.">
            {number("warmupStart", WARMUP_LIMITS.start)}
          </Field>
          <Field label="Add per day" htmlFor="warmupIncrease" error={err.warmupIncrease} hint="How many more each day after that.">
            {number("warmupIncrease", WARMUP_LIMITS.increase)}
          </Field>
          <Field label="Maximum a day" htmlFor="warmupMax" error={err.warmupMax} hint="It stays at this number once reached.">
            {number("warmupMax", WARMUP_LIMITS.max)}
          </Field>
        </div>
        <div className={partner ? "contents" : "hidden"}>
          <Field
            label="Most warm-up emails it gets a day"
            htmlFor="warmupReceiveMax"
            error={err.warmupReceiveMax}
            hint="Shared out among your business mailboxes, 1 to 50. Start low (3 to 10) and raise it slowly, so the account still looks like a person's."
          >
            {number("warmupReceiveMax", WARMUP_LIMITS.receiveMax)}
          </Field>
        </div>
        <Field label="Reply rate (%)" htmlFor="warmupReplyRate" error={err.warmupReplyRate} hint="Share of received warm-up emails it answers.">
          {number("warmupReplyRate", WARMUP_LIMITS.replyRate)}
        </Field>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <Result state={state} />
        </div>
        <SubmitButton pending={pending} variant="secondary" size="sm" pendingText="Saving…">
          Save warm-up settings
        </SubmitButton>
      </div>
    </form>
  );
}
