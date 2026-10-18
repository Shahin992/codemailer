"use client";

import { superAdminLogin, type AuthState } from "@/app/actions/auth";
import { PasswordInput, SubmitButton, useActionForm } from "@/components/client";
import { Alert, Card, Field, Input } from "@/components/ui";

export function SuperAdminLoginForm() {
  const { state, onSubmit, pending } = useActionForm<AuthState>(superAdminLogin, {});
  return (
    <Card className="p-5">
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton pending={pending} className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </Card>
  );
}
