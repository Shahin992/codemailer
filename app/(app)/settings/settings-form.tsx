"use client";

import { saveSettings, type FormState } from "@/app/actions/settings";
import { SubmitButton, useActionForm } from "@/components/client";
import { TimezoneSelect } from "@/components/timezone-select";
import { Alert, Card, CardHeader, Checkbox, Field, Input, Textarea } from "@/components/ui";
import type { TimezoneGroup } from "@/lib/timezones";
import { LogoField, type LogoInfo } from "./logo-field";

type Values = {
  footerText: string;
  optOutLine: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  weekdaysOnly: boolean;
  testEmail: string;
  logoDisplayWidth: number;
  logoInPersonal: boolean;
};

export function SettingsForm({ initial, zones, logo }: { initial: Values; zones: TimezoneGroup[]; logo: LogoInfo | null }) {
  const { state, onSubmit, pending } = useActionForm<FormState>(saveSettings, {});

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Card>
        <CardHeader title="Sending defaults" description="New campaigns start with these; each campaign can change them." />
        <div className="space-y-4 p-4 md:p-5">
          <Field label="Timezone" htmlFor="timezone" hint="Usually your recipients' timezone. Send windows and set times follow this clock.">
            <TimezoneSelect id="timezone" name="timezone" defaultValue={initial.timezone} groups={zones} />
          </Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Window start" htmlFor="windowStart">
              <Input id="windowStart" name="windowStart" type="time" defaultValue={initial.windowStart} required />
            </Field>
            <Field label="Window end" htmlFor="windowEnd">
              <Input id="windowEnd" name="windowEnd" type="time" defaultValue={initial.windowEnd} required />
            </Field>
            <div className="col-span-2 flex items-end pb-1 sm:col-span-1">
              <Checkbox name="weekdaysOnly" label="Weekdays only" defaultChecked={initial.weekdaysOnly} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Email footer and logo" description="Added under every campaign email, like a signature." />
        <div className="space-y-4 p-4 md:p-5">
          <Field label="Opt-out line (personal-style emails)" htmlFor="optOutLine" hint="Used instead of an unsubscribe link. Leave empty to leave it out.">
            <Input id="optOutLine" name="optOutLine" defaultValue={initial.optOutLine} maxLength={300} />
          </Field>
          <Field label="Footer text" htmlFor="footerText" hint="US law (CAN-SPAM) asks for a real postal address in commercial email.">
            <Textarea id="footerText" name="footerText" rows={3} defaultValue={initial.footerText} placeholder={"YourBrand Ltd\n123 Main Street, Dhaka 1212, Bangladesh"} />
          </Field>
          <LogoField logo={logo} displayWidth={initial.logoDisplayWidth} inPersonal={initial.logoInPersonal} footerText={initial.footerText} />
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
