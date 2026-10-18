"use client";

import { useState } from "react";
import { saveMailbox, type MailboxFormState } from "@/app/actions/mailboxes";
import { PasswordInput, SubmitButton, useActionForm } from "@/components/client";
import { Alert, Card, CardHeader, Checkbox, Field, Input, Select, cn } from "@/components/ui";
import type { Provider, Security } from "@/lib/db/schema";
import { PROVIDER_PRESETS, SECURITY_LABELS, SMTP_TEMPLATES, UNSUPPORTED_NOTE, securityForPort } from "@/lib/providers";

export type MailboxFormValues = {
  id?: string;
  provider: Provider;
  email: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  smtpUser: string;
  readInbox: boolean;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  imapUser: string;
  replyToSenderId: string;
  dailyLimit: number;
};

type ServerSettings = Pick<
  MailboxFormValues,
  "smtpHost" | "smtpPort" | "smtpSecurity" | "smtpUser" | "readInbox" | "imapHost" | "imapPort" | "imapSecurity" | "imapUser"
>;

const EMPTY_SERVER: ServerSettings = {
  smtpHost: "",
  smtpPort: 465,
  smtpSecurity: "ssl",
  smtpUser: "",
  readInbox: true,
  imapHost: "",
  imapPort: 993,
  imapSecurity: "ssl",
  imapUser: "",
};

function SecuritySelect({ name, value, onChange, id }: { name: string; value: Security; onChange: (v: Security) => void; id: string }) {
  return (
    <Select id={id} name={name} value={value} onChange={(e) => onChange(e.target.value as Security)}>
      {(Object.keys(SECURITY_LABELS) as Security[]).map((key) => (
        <option key={key} value={key}>
          {SECURITY_LABELS[key]}
        </option>
      ))}
    </Select>
  );
}

export function MailboxForm({
  initial,
  testEmail,
  replyTargets,
}: {
  initial?: MailboxFormValues;
  testEmail: string;
  /** Mailboxes whose inbox is read; a send-only mailbox can route replies to one of them. */
  replyTargets: { id: string; email: string }[];
}) {
  const editing = Boolean(initial?.id);
  const { state, onSubmit, pending } = useActionForm<MailboxFormState>(saveMailbox, {});
  const [provider, setProvider] = useState<Provider>(initial?.provider ?? "hostinger");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [dailyLimit, setDailyLimit] = useState(initial?.dailyLimit ?? PROVIDER_PRESETS.hostinger.dailyLimit);
  const [server, setServer] = useState<ServerSettings>(
    initial?.provider === "custom" ? { ...EMPTY_SERVER, ...pickServer(initial) } : EMPTY_SERVER,
  );
  const [replyTo, setReplyTo] = useState(initial?.replyToSenderId ?? "");
  const [template, setTemplate] = useState("");
  const [sendTest, setSendTest] = useState(!editing);
  const preset = PROVIDER_PRESETS[provider];
  const err = state.fieldErrors ?? {};
  const isCustom = provider === "custom";
  const note = SMTP_TEMPLATES.find((t) => t.label === template)?.note;
  const set = (patch: Partial<ServerSettings>) => setServer((s) => ({ ...s, ...patch }));

  function applyTemplate(label: string) {
    setTemplate(label);
    const t = SMTP_TEMPLATES.find((x) => x.label === label);
    if (!t) return;
    const domain = email.includes("@") ? email.split("@")[1] : "yourdomain.com";
    const fill = (host: string) => host.replace("{domain}", domain);
    setServer({
      smtpHost: fill(t.smtpHost),
      smtpPort: t.smtpPort,
      smtpSecurity: t.smtpSecurity,
      smtpUser: t.smtpUser ?? "",
      readInbox: Boolean(t.imap),
      imapHost: t.imap ? fill(t.imap.host) : "",
      imapPort: t.imap?.port ?? 993,
      imapSecurity: t.imap?.security ?? "ssl",
      imapUser: "",
    });
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="provider" value={provider} />

      {state.error && <Alert tone="danger">{state.error}</Alert>}

      <Card className="space-y-5 p-4 md:p-5">
        <div>
          <p className="mb-2 text-sm font-medium">Mailbox type</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup">
            {(Object.keys(PROVIDER_PRESETS) as Provider[]).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={provider === key}
                onClick={() => {
                  setProvider(key);
                  if (!editing) setDailyLimit(PROVIDER_PRESETS[key].dailyLimit);
                }}
                className={cn(
                  "rounded-lg border px-3 py-3 text-left text-sm transition-colors",
                  provider === key ? "border-primary bg-primary-soft text-primary" : "hover:bg-neutral-soft",
                )}
              >
                <span className="block font-medium">{PROVIDER_PRESETS[key].label}</span>
                <span className="block text-xs opacity-80">
                  {key === "custom" ? "Zoho, Yahoo, cPanel, SES, SendGrid…" : PROVIDER_PRESETS[key].smtpHost}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Email address" htmlFor="email" error={err.email} hint="The address recipients see in From.">
            <Input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="support@yourdomain.com"
              autoComplete="off"
            />
          </Field>
          <Field label="Sender name" htmlFor="displayName" hint="What recipients see, e.g. “Sarah from YourBrand”.">
            <Input id="displayName" name="displayName" defaultValue={initial?.displayName} placeholder="Sarah from YourBrand" />
          </Field>
          <Field label={preset.passwordLabel} htmlFor="password" error={err.password} hint={editing ? "Leave empty to keep the saved password." : preset.help}>
            <PasswordInput id="password" name="password" required={!editing} autoComplete="new-password" />
          </Field>
          <Field label="Daily limit" htmlFor="dailyLimit" error={err.dailyLimit} hint={`Emails per 24 hours. Start around ${preset.dailyLimit} and raise slowly.`}>
            <Input
              id="dailyLimit"
              name="dailyLimit"
              type="number"
              min={1}
              max={2000}
              inputMode="numeric"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(Number(e.target.value))}
              required
            />
          </Field>
        </div>

        {!isCustom && (
          <p className="rounded-lg bg-neutral-soft px-3 py-2 text-xs text-muted">
            Sends through <span className="font-medium text-fg">{preset.smtpHost}:{preset.smtpPort}</span> and reads replies from{" "}
            <span className="font-medium text-fg">
              {preset.imapHost}:{preset.imapPort}
            </span>
            .
          </p>
        )}
      </Card>

      {isCustom && (
        <>
          <Card>
            <CardHeader title="Sending (SMTP)" description="Any server that accepts SMTP login: your host, Zoho, Yahoo, or a sending service." />
            <div className="space-y-4 p-4 md:p-5">
              <Field label="Fill in for" htmlFor="template" hint="Optional. Fills the server settings below; you can still change them.">
                <Select id="template" value={template} onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">Choose a provider…</option>
                  {SMTP_TEMPLATES.map((t) => (
                    <option key={t.label}>{t.label}</option>
                  ))}
                </Select>
              </Field>
              {note && <Alert tone="info">{note}</Alert>}
              <div className="grid gap-4 sm:grid-cols-[1fr_110px_170px]">
                <Field label="SMTP server" htmlFor="smtpHost" error={err.smtpHost}>
                  <Input id="smtpHost" name="smtpHost" value={server.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} placeholder="smtp.example.com" />
                </Field>
                <Field label="Port" htmlFor="smtpPort">
                  <Input
                    id="smtpPort"
                    name="smtpPort"
                    type="number"
                    inputMode="numeric"
                    value={server.smtpPort}
                    onChange={(e) => set({ smtpPort: Number(e.target.value), smtpSecurity: securityForPort(Number(e.target.value), "smtp") })}
                  />
                </Field>
                <Field label="Encryption" htmlFor="smtpSecurity">
                  <SecuritySelect id="smtpSecurity" name="smtpSecurity" value={server.smtpSecurity} onChange={(v) => set({ smtpSecurity: v })} />
                </Field>
              </div>
              <Field label="Username" htmlFor="smtpUser" hint="Leave empty to log in with the email address. Some services use something else (SendGrid: apikey).">
                <Input id="smtpUser" name="smtpUser" value={server.smtpUser} onChange={(e) => set({ smtpUser: e.target.value })} placeholder={email || "Same as the email address"} autoComplete="off" />
              </Field>
              {server.smtpSecurity === "none" && (
                <Alert tone="warning">Without encryption the password crosses the internet in plain text. Use it only for a server on your own network.</Alert>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Replies and bounces (IMAP)" />
            <div className="space-y-4 p-4 md:p-5">
              <Checkbox
                name="readInbox"
                label="Read this mailbox's inbox"
                description="ColdMailer checks it every 5 minutes for replies and bounce notices, without marking anything as read."
                checked={server.readInbox}
                onChange={(e) => set({ readInbox: e.target.checked })}
              />
              {server.readInbox ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-[1fr_110px_170px]">
                    <Field label="IMAP server" htmlFor="imapHost" error={err.imapHost}>
                      <Input id="imapHost" name="imapHost" value={server.imapHost} onChange={(e) => set({ imapHost: e.target.value })} placeholder="imap.example.com" />
                    </Field>
                    <Field label="Port" htmlFor="imapPort">
                      <Input
                        id="imapPort"
                        name="imapPort"
                        type="number"
                        inputMode="numeric"
                        value={server.imapPort}
                        onChange={(e) => set({ imapPort: Number(e.target.value), imapSecurity: securityForPort(Number(e.target.value), "imap") })}
                      />
                    </Field>
                    <Field label="Encryption" htmlFor="imapSecurity">
                      <SecuritySelect id="imapSecurity" name="imapSecurity" value={server.imapSecurity} onChange={(v) => set({ imapSecurity: v })} />
                    </Field>
                  </div>
                  <Field label="IMAP username" htmlFor="imapUser" hint="Leave empty to use the SMTP username. Uses the same password.">
                    <Input id="imapUser" name="imapUser" value={server.imapUser} onChange={(e) => set({ imapUser: e.target.value })} placeholder={server.smtpUser || email || "Same as SMTP"} autoComplete="off" />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="Send replies to"
                    htmlFor="replyToSenderId"
                    error={err.replyToSenderId}
                    hint="Emails from this address get a Reply-To pointing at the mailbox you choose, so replies arrive where ColdMailer can read them."
                  >
                    <Select id="replyToSenderId" name="replyToSenderId" value={replyTo} onChange={(e) => setReplyTo(e.target.value)}>
                      <option value="">Don't redirect replies</option>
                      {replyTargets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.email}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Alert tone="warning">
                    Send-only: bounce notices go back to this address, so bounces after sending can't be tracked.
                    {!replyTo && " Without a reply mailbox, replies can't be tracked either."}
                  </Alert>
                </>
              )}
            </div>
          </Card>
          <p className="px-1 text-xs text-muted">{UNSUPPORTED_NOTE}</p>
        </>
      )}

      <Card className="space-y-3 p-4 md:p-5">
        <Checkbox
          label="Send a test email after connecting"
          description="Confirms the mailbox can send. The test goes to the address below."
          checked={sendTest}
          onChange={(e) => setSendTest(e.target.checked)}
        />
        {sendTest && <Input name="sendTestTo" type="email" defaultValue={testEmail} placeholder="you@yourdomain.com" aria-label="Send test to" />}
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <SubmitButton pending={pending} pendingText="Testing connection…" className="w-full sm:w-auto">
          {editing ? "Test and save" : "Connect mailbox"}
        </SubmitButton>
      </div>
    </form>
  );
}

function pickServer(v: MailboxFormValues): ServerSettings {
  return {
    smtpHost: v.smtpHost,
    smtpPort: v.smtpPort,
    smtpSecurity: v.smtpSecurity,
    smtpUser: v.smtpUser,
    readInbox: v.readInbox,
    imapHost: v.imapHost,
    imapPort: v.imapPort,
    imapSecurity: v.imapSecurity,
    imapUser: v.imapUser,
  };
}
