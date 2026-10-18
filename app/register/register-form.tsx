"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { register, type AuthState } from "@/app/actions/auth";
import { PasswordInput, SubmitButton, useActionForm } from "@/components/client";
import { Alert, buttonClass, Card, Field, Input } from "@/components/ui";

/** Shown once the account is created: it can't be used until the super admin approves it. */
function PendingApprovalDialog({ email }: { email: string }) {
  const button = useRef<HTMLAnchorElement>(null);
  useEffect(() => button.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="pending-title" aria-describedby="pending-text" className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-lg">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning">
          <Clock className="size-6" aria-hidden />
        </span>
        <h2 id="pending-title" className="mt-4 text-lg font-semibold">
          Waiting for approval
        </h2>
        <div id="pending-text" className="mt-2 space-y-2 text-sm text-muted">
          <p>
            Your account <span className="font-medium break-all text-fg">{email}</span> has been created.
          </p>
          <p>The super admin has to approve it before you can sign in. Try signing in again once it's approved.</p>
        </div>
        <Link ref={button} href="/login" className={buttonClass("primary", "md", "mt-5 w-full")}>
          OK, go to sign in
        </Link>
      </div>
    </div>
  );
}

export function RegisterForm() {
  const { state, onSubmit, pending } = useActionForm<AuthState>(register, {});
  const err = state.fieldErrors ?? {};
  const email = useRef("");

  return (
    <>
      <Card className="p-5">
        <form method="post" onSubmit={(e) => {
          email.current = String(new FormData(e.currentTarget).get("email") ?? "").trim();
          onSubmit(e);
        }} className="space-y-4">
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          <Field label="Your name" htmlFor="name" error={err.name}>
            <Input id="name" name="name" autoComplete="name" required autoFocus />
          </Field>
          <Field label="Email" htmlFor="email" error={err.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" htmlFor="password" error={err.password} hint="At least 8 characters.">
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="Repeat password" htmlFor="confirm" error={err.confirm}>
            <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required />
          </Field>
          <SubmitButton pending={pending} className="w-full" pendingText="Creating account…">
            Create account
          </SubmitButton>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
      {state.registered && <PendingApprovalDialog email={email.current} />}
    </>
  );
}
