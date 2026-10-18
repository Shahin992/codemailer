"use client";

import { useEffect, useRef } from "react";
import { changePassword, type TeamState } from "@/app/actions/team";
import { PasswordInput, SubmitButton, useActionForm } from "@/components/client";
import { Alert, Card, CardHeader, Field } from "@/components/ui";

export function PasswordCard({ title = "Change your password", description }: { title?: string; description?: string }) {
  const { state, onSubmit, pending } = useActionForm<TeamState>(changePassword, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.message) form.current?.reset();
  }, [state]);
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <form ref={form} method="post" onSubmit={onSubmit} className="grid gap-4 p-4 sm:grid-cols-3 md:p-5">
        <Field label="Current password" htmlFor="current">
          <PasswordInput id="current" name="current" autoComplete="current-password" required />
        </Field>
        <Field label="New password" htmlFor="new-password">
          <PasswordInput id="new-password" name="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Repeat new password" htmlFor="confirm-password">
          <PasswordInput id="confirm-password" name="confirm" autoComplete="new-password" required />
        </Field>
        <div className="space-y-3 sm:col-span-3">
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          {state.message && <Alert tone="success">{state.message}</Alert>}
          <div className="flex justify-end">
            <SubmitButton pending={pending} variant="secondary" className="w-full sm:w-auto">
              Change password
            </SubmitButton>
          </div>
        </div>
      </form>
    </Card>
  );
}
