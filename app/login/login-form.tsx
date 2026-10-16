"use client";

import Link from "next/link";
import { login, type AuthState } from "@/app/actions/auth";
import { SubmitButton, useActionForm } from "@/components/client";
import { Alert, Card, Field, Input } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const { state, onSubmit, pending } = useActionForm<AuthState>(login, {});
  return (
    <>
      <Card className="p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton pending={pending} className="w-full" pendingText="Signing in…">
            Sign in
          </SubmitButton>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-muted">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </>
  );
}
