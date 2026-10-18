"use client";

import { useActionState } from "react";
import { approveUser, deleteUser, disableUser, type AccountState } from "@/app/actions/superadmin";
import { SubmitButton, Time } from "@/components/client";
import { Alert, Badge } from "@/components/ui";

export type Account = {
  id: string;
  name: string;
  email: string;
  status: "active" | "pending" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
};

const STATUS = {
  pending: { tone: "warning", label: "waiting for approval" },
  active: { tone: "success", label: "active" },
  disabled: { tone: "neutral", label: "disabled" },
} as const;

export function AccountRow({ account }: { account: Account }) {
  const [approveState, approve] = useActionState<AccountState>(approveUser.bind(null, account.id), {});
  const [disableState, disable] = useActionState<AccountState>(disableUser.bind(null, account.id), {});
  const [deleteState, remove] = useActionState<AccountState>(deleteUser.bind(null, account.id), {});
  const feedback = [approveState, disableState, deleteState].find((s) => s.error || s.message);
  const status = STATUS[account.status];

  return (
    <li className="space-y-2 px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="truncate text-xs text-muted">{account.email}</p>
          <p className="text-xs text-muted">
            Signed up <Time value={account.createdAt} mode="relative" />
            {account.lastLoginAt && (
              <>
                {" · "}last sign-in <Time value={account.lastLoginAt} mode="relative" />
              </>
            )}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {account.status !== "active" && (
          <form action={approve}>
            <SubmitButton size="sm">{account.status === "pending" ? "Approve" : "Enable"}</SubmitButton>
          </form>
        )}
        {account.status === "active" && (
          <form action={disable}>
            <SubmitButton size="sm" variant="secondary" confirm={`Disable ${account.email}? They can't sign in and their campaigns stop sending.`}>
              Disable
            </SubmitButton>
          </form>
        )}
        {account.status === "pending" && (
          <form action={remove}>
            <SubmitButton size="sm" variant="ghost" confirm={`Reject the sign-up from ${account.email}? The account is removed.`}>
              Reject
            </SubmitButton>
          </form>
        )}
        {account.status === "disabled" && (
          <form action={remove}>
            <SubmitButton size="sm" variant="danger" confirm={`Delete ${account.email} and all of that account's mailboxes, campaigns, recipients and replies?`}>
              Delete
            </SubmitButton>
          </form>
        )}
      </div>
      {feedback && <Alert tone={feedback.error ? "danger" : "success"}>{feedback.error ?? feedback.message}</Alert>}
    </li>
  );
}
