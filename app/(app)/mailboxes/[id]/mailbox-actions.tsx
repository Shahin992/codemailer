"use client";

import { Pause, Play, RefreshCw, Send, Trash2 } from "lucide-react";
import { useActionState } from "react";
import {
  deleteMailbox,
  retestMailbox,
  sendMailboxTest,
  setMailboxStatus,
  type MailboxActionState,
} from "@/app/actions/mailboxes";
import { SubmitButton, useActionForm } from "@/components/client";
import { Alert, Input } from "@/components/ui";

function Result({ state }: { state: MailboxActionState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function MailboxActions({ id, status, testEmail }: { id: string; status: "active" | "paused"; testEmail: string }) {
  const [testState, testAction] = useActionState<MailboxActionState>(retestMailbox.bind(null, id), {});
  const send = useActionForm<MailboxActionState>(sendMailboxTest.bind(null, id), {});
  const [deleteState, deleteAction] = useActionState<MailboxActionState>(deleteMailbox.bind(null, id), {});
  const toggle = setMailboxStatus.bind(null, id, status === "active" ? "paused" : "active");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <form action={toggle}>
          <SubmitButton variant={status === "active" ? "secondary" : "primary"} size="sm">
            {status === "active" ? <Pause className="size-4" /> : <Play className="size-4" />}
            {status === "active" ? "Pause sending" : "Resume sending"}
          </SubmitButton>
        </form>
        <form action={testAction}>
          <SubmitButton variant="secondary" size="sm" pendingText="Testing…">
            <RefreshCw className="size-4" /> Test connection
          </SubmitButton>
        </form>
        <form action={deleteAction}>
          <SubmitButton variant="danger" size="sm" confirm="Delete this mailbox? This can't be undone.">
            <Trash2 className="size-4" /> Delete
          </SubmitButton>
        </form>
      </div>
      <Result state={testState} />
      <Result state={deleteState} />

      <form onSubmit={send.onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <Input name="to" type="email" defaultValue={testEmail} placeholder="you@yourdomain.com" aria-label="Send test email to" required />
        <SubmitButton pending={send.pending} variant="secondary" pendingText="Sending…" className="sm:w-auto">
          <Send className="size-4" /> Send test email
        </SubmitButton>
      </form>
      <Result state={send.state} />
    </div>
  );
}
