"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, deleteUser, setUserRole, setUserStatus, type TeamState } from "@/app/actions/team";
import { SubmitButton, Time, useActionForm } from "@/components/client";
import { Alert, Badge, Card, CardHeader, Field, Input } from "@/components/ui";

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  status: "active" | "pending" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
};

const STATUS_TONE = { active: "success", pending: "warning", disabled: "neutral" } as const;

function MemberRow({ member, isMe }: { member: TeamMember; isMe: boolean }) {
  const [statusState, statusAction] = useActionState<TeamState>(
    setUserStatus.bind(null, member.id, member.status === "active" ? "disabled" : "active"),
    {},
  );
  const [roleState, roleAction] = useActionState<TeamState>(setUserRole.bind(null, member.id, member.role === "admin" ? "member" : "admin"), {});
  const [deleteState, deleteAction] = useActionState<TeamState>(deleteUser.bind(null, member.id), {});
  const feedback = [statusState, roleState, deleteState].find((s) => s.error || s.message);

  return (
    <li className="space-y-2 px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {member.name} {isMe && <span className="text-muted">(you)</span>}
          </p>
          <p className="truncate text-xs text-muted">{member.email}</p>
          <p className="text-xs text-muted">
            {member.lastLoginAt ? (
              <>
                Last sign-in <Time value={member.lastLoginAt} mode="relative" />
              </>
            ) : (
              <>
                Signed up <Time value={member.createdAt} mode="relative" />
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={member.role === "admin" ? "primary" : "neutral"}>{member.role}</Badge>
          <Badge tone={STATUS_TONE[member.status]}>{member.status === "pending" ? "waiting for approval" : member.status}</Badge>
        </div>
      </div>
      {!isMe && (
        <div className="flex flex-wrap gap-2">
          <form action={statusAction}>
            <SubmitButton size="sm" variant={member.status === "active" ? "secondary" : "primary"}>
              {member.status === "pending" ? "Approve" : member.status === "active" ? "Disable" : "Enable"}
            </SubmitButton>
          </form>
          {member.status === "active" && (
            <form action={roleAction}>
              <SubmitButton size="sm" variant="ghost">
                {member.role === "admin" ? "Make member" : "Make admin"}
              </SubmitButton>
            </form>
          )}
          {member.status !== "active" && (
            <form action={deleteAction}>
              <SubmitButton size="sm" variant="danger" confirm={`Delete ${member.email}?`}>
                Delete
              </SubmitButton>
            </form>
          )}
        </div>
      )}
      {feedback && <Alert tone={feedback.error ? "danger" : "success"}>{feedback.error ?? feedback.message}</Alert>}
    </li>
  );
}

export function TeamCard({ members, meId }: { members: TeamMember[]; meId: string }) {
  const pending = members.filter((m) => m.status === "pending").length;
  return (
    <Card>
      <CardHeader
        title="Team"
        description={pending ? `${pending} sign-up${pending === 1 ? "" : "s"} waiting for approval.` : "Everyone here shares the same mailboxes and campaigns."}
      />
      <ul className="divide-y">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} isMe={m.id === meId} />
        ))}
      </ul>
    </Card>
  );
}

export function PasswordCard() {
  const { state, onSubmit, pending } = useActionForm<TeamState>(changePassword, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.message) form.current?.reset();
  }, [state]);
  return (
    <Card>
      <CardHeader title="Change your password" />
      <form ref={form} onSubmit={onSubmit} className="grid gap-4 p-4 sm:grid-cols-3 md:p-5">
        <Field label="Current password" htmlFor="current">
          <Input id="current" name="current" type="password" autoComplete="current-password" required />
        </Field>
        <Field label="New password" htmlFor="new-password">
          <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="Repeat new password" htmlFor="confirm-password">
          <Input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <div className="space-y-3 sm:col-span-3">
          {state.error && <Alert tone="danger">{state.error}</Alert>}
          {state.message && <Alert tone="success">{state.message}</Alert>}
          <div className="flex justify-end">
            <SubmitButton pending={pending} variant="secondary" className="w-full sm:w-auto">
              Change password
            </SubmitButton>
          </div>
        </div>
      </form>
    </Card>
  );
}
