"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { createApiToken, type ApiTokenState } from "@/app/actions/api-tokens";
import { SubmitButton, Time, useActionForm } from "@/components/client";
import { Alert, Button, Select } from "@/components/ui";

export function ApiTokenCreator() {
  const { state, onSubmit, pending } = useActionForm<ApiTokenState>(createApiToken, {});
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!state.token) return;
    await navigator.clipboard.writeText(state.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select name="days" defaultValue="30" aria-label="Token lifetime" className="sm:w-44">
          <option value="1">Valid 1 day</option>
          <option value="7">Valid 7 days</option>
          <option value="30">Valid 30 days</option>
          <option value="90">Valid 90 days</option>
        </Select>
        <SubmitButton pending={pending} variant="secondary">
          <KeyRound className="size-4" /> Create API token
        </SubmitButton>
      </form>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.token && (
        <div className="space-y-2 rounded-lg border bg-neutral-soft p-3">
          <p className="text-xs text-muted">
            Copy it now; it isn't shown again. Expires <Time value={state.expiresAt} mode="date" />. It stops working early if your account is disabled.
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-card px-2 py-2 font-mono text-xs whitespace-nowrap">{state.token}</code>
            <Button type="button" variant="secondary" size="sm" onClick={copy} aria-label="Copy token">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
