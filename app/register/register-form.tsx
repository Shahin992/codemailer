"use client";

import Link from "next/link";
import { register, type AuthState } from "@/app/actions/auth";
import { SubmitButton, useActionForm } from "@/components/client";
import { Alert, Card, Field, Input } from "@/components/ui";

export function RegisterForm({ first }: { first: boolean }) {
  const { state, onSubmit, pending } = useActionForm<AuthState>(register, {});
  const err = state.fieldErrors ?? {};

  if (state.message) {
    return (
      <Card className="space-y-4 p-5">
        <Alert tone="success">{state.message}</Alert>
        <Link href="/login" className="block text-center text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          <Field label="Your name" htmlFor="name" error={err.name}>
            <Input id="name" name="name" autoComplete="name" required autoFocus />
          </Field>
          <Field label="Email" htmlFor="email" error={err.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" htmlFor="password" error={err.password} hint="At least 8 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="Repeat password" htmlFor="confirm" error={err.confirm}>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton pending={pending} className="w-full" pendingText="Creating account…">
            {first ? "Create admin account" : "Create account"}
          </SubmitButton>
        </form>
      </Card>
      {!first && (
        <p className="mt-4 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      )}
    </>
  );
}
