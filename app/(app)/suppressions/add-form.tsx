"use client";

import { useEffect, useRef } from "react";
import { addSuppressions, type FormState } from "@/app/actions/settings";
import { SubmitButton, useActionForm } from "@/components/client";
import { Alert, Card, CardHeader, Textarea } from "@/components/ui";

export function AddSuppressionsForm() {
  const { state, onSubmit, pending } = useActionForm<FormState>(addSuppressions, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.message) form.current?.reset();
  }, [state]);
  return (
    <Card>
      <CardHeader title="Add addresses" description="One per line. They'll never be emailed." />
      <form ref={form} method="post" onSubmit={onSubmit} className="space-y-3 p-4 md:p-5">
        <Textarea name="emails" rows={5} placeholder={"someone@example.com\nanother@example.com"} aria-label="Addresses to block" spellCheck={false} />
        {state.error && <Alert tone="danger">{state.error}</Alert>}
        {state.message && <Alert tone="success">{state.message}</Alert>}
        <SubmitButton pending={pending} className="w-full">
          Add to list
        </SubmitButton>
      </form>
    </Card>
  );
}
