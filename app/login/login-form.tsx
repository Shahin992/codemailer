"use client";

import Link from "next/link";
import { login, type AuthState } from "@/app/actions/auth";
import { PasswordInput, SubmitButton, useActionForm } from "@/components/client";
import { Alert, Card, Field, Input } from "@/components/ui";

export function LoginForm({ next, notice }: { next: string; notice?: { tone: "success" | "info"; text: string } }) {
  const { state, onSubmit, pending } = useActionForm<AuthState>(login, {});
  return (
    <>
      <Card className="p-5">
        <form method="post" onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          {state.error ? <Alert tone="danger">{state.error}</Alert> : notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
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
      <p className="mt-4 text-center text-sm text-muted">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create one
        </Link>
      </p>
    </>
  );
}
