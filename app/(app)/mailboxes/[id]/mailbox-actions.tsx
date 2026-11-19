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
import { Input } from "@/components/ui";
import { ActionResult, toast } from "@/components/toast";

function Result({ state }: { state: MailboxActionState }) {
  return <ActionResult state={state} />;
}

export function MailboxActions({ id, status, testEmail }: { id: string; status: "active" | "paused"; testEmail: string }) {
  const [testState, testAction] = useActionState<MailboxActionState>(retestMailbox.bind(null, id), {});
  const send = useActionForm<MailboxActionState>(sendMailboxTest.bind(null, id), {});
  const [deleteState, deleteAction] = useActionState<MailboxActionState>(deleteMailbox.bind(null, id), {});
  // Pause/Resume: same server action as before, plus a message saying it happened.
  const [, toggle] = useActionState(async () => {
    const next = status === "active" ? "paused" : "active";
    await setMailboxStatus(id, next);
    toast("success", next === "paused" ? "Sending paused for this mailbox." : "Sending resumed for this mailbox.");
    return null;
  }, null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <form action={toggle} className="contents">
          <SubmitButton variant={status === "active" ? "secondary" : "primary"} size="sm" className="w-full px-2">
            {status === "active" ? <Pause className="size-4" /> : <Play className="size-4" />}
            {status === "active" ? "Pause" : "Resume"}
          </SubmitButton>
        </form>
        <form action={testAction} className="contents">
          <SubmitButton variant="secondary" size="sm" pendingText="Testing…" className="w-full px-2">
            <RefreshCw className="size-4" /> Test
          </SubmitButton>
        </form>
        <form action={deleteAction} className="contents">
          <SubmitButton variant="danger" size="sm" confirm="Delete this mailbox? This can't be undone." className="w-full px-2">
            <Trash2 className="size-4" /> Delete
          </SubmitButton>
        </form>
      </div>
      <p className="-mt-2 text-xs text-muted">
        {status === "active" ? "Pause stops this mailbox sending; Test logs in again to check the connection." : "This mailbox is paused. Resume it to send again."}
      </p>
      <Result state={testState} />
      <Result state={deleteState} />

      <form method="post" onSubmit={send.onSubmit} className="space-y-2 border-t pt-4">
        <label htmlFor="test-to" className="block text-sm font-medium">
          Send a test email
        </label>
        <div className="flex gap-2">
          <Input id="test-to" name="to" type="email" defaultValue={testEmail} placeholder="you@yourdomain.com" required className="min-w-0 flex-1" />
          <SubmitButton pending={send.pending} variant="secondary" pendingText="Sending…" className="shrink-0" aria-label="Send test email">
            <Send className="size-4" /> <span className="hidden sm:inline">Send</span>
          </SubmitButton>
        </div>
      </form>
      <Result state={send.state} />
    </div>
  );
}
