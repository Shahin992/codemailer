"use client";

import { useMemo } from "react";
import { saveSettings, type FormState } from "@/app/actions/settings";
import { SubmitButton, useActionForm } from "@/components/client";
import { Alert, Card, CardHeader, Checkbox, Field, Input, Textarea } from "@/components/ui";

type Values = {
  footerText: string;
  optOutLine: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  weekdaysOnly: boolean;
  testEmail: string;
};

export function SettingsForm({ initial }: { initial: Values }) {
  const { state, onSubmit, pending } = useActionForm<FormState>(saveSettings, {});
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Card>
        <CardHeader title="Email footer" description="Added under every campaign email." />
        <div className="space-y-4 p-4 md:p-5">
          <Field
            label="Opt-out line (personal-style emails)"
            htmlFor="optOutLine"
            hint="Personal-style emails end with this instead of an unsubscribe link. Keep it short and friendly. Leave empty to leave it out."
          >
            <Input id="optOutLine" name="optOutLine" defaultValue={initial.optOutLine} maxLength={300} />
          </Field>
          <Field label="Footer text" htmlFor="footerText" hint="US law (CAN-SPAM) asks for a real postal address in commercial email.">
            <Textarea id="footerText" name="footerText" rows={3} defaultValue={initial.footerText} placeholder={"YourBrand Ltd\n123 Main Street, Dhaka 1212, Bangladesh"} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Default send window" description="New campaigns start with these; each campaign can change them." />
        <div className="grid gap-4 p-4 sm:grid-cols-2 md:p-5 lg:grid-cols-4">
          <Field label="Start" htmlFor="windowStart">
            <Input id="windowStart" name="windowStart" type="time" defaultValue={initial.windowStart} required />
          </Field>
          <Field label="End" htmlFor="windowEnd">
            <Input id="windowEnd" name="windowEnd" type="time" defaultValue={initial.windowEnd} required />
          </Field>
          <Field label="Timezone" htmlFor="timezone">
            <Input id="timezone" name="timezone" list="settings-zones" defaultValue={initial.timezone} required />
            <datalist id="settings-zones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <div className="flex items-end pb-1">
            <Checkbox name="weekdaysOnly" label="Weekdays only" defaultChecked={initial.weekdaysOnly} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Test emails" />
        <div className="p-4 md:p-5">
          <Field label="Send test emails to" htmlFor="testEmail">
            <Input id="testEmail" name="testEmail" type="email" defaultValue={initial.testEmail} placeholder="you@yourdomain.com" />
          </Field>
        </div>
      </Card>

      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}
      <div className="flex justify-end">
        <SubmitButton pending={pending} className="w-full sm:w-auto">
          Save settings
        </SubmitButton>
      </div>
    </form>
  );
}
