import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { ArrowLeft, Check, X } from "lucide-react";
import { Time } from "@/components/client";
import { Alert, Badge, Card, CardHeader, Progress, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { sentLast24h } from "@/lib/queries";
import { domainOf } from "@/lib/mail/compose";
import { checkDomainDns } from "@/lib/mail/dns";
import { PROVIDER_PRESETS, SECURITY_LABELS } from "@/lib/providers";
import { requireSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { MailboxForm } from "../mailbox-form";
import { MailboxActions } from "./mailbox-actions";

export const metadata: Metadata = { title: "Mailbox" };

function DnsRow({ ok, label, help }: { ok: boolean; label: string; help: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <X className="mt-0.5 size-4 shrink-0 text-danger" />}
      <span>
        <span className="font-medium">{label}</span>
        {!ok && <span className="block text-xs text-muted">{help}</span>}
      </span>
    </li>
  );
}

export default async function MailboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; test?: string; testError?: string }>;
}) {
  const me = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ sender: senders, sent24h: sentLast24h })
    .from(senders)
    .where(and(eq(senders.id, id), eq(senders.userId, me.id)));
  if (!row) notFound();
  const { sender, sent24h } = row;
  const [settings, dns, replyTargets] = await Promise.all([
    getSettings(me.id),
    checkDomainDns(domainOf(sender.email)),
    db
      .select({ id: senders.id, email: senders.email })
      .from(senders)
      .where(and(eq(senders.userId, me.id), eq(senders.readInbox, true), ne(senders.id, sender.id)))
      .orderBy(asc(senders.createdAt)),
  ]);
  const replyMailbox = sender.replyToSenderId ? replyTargets.find((t) => t.id === sender.replyToSenderId)?.email : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/mailboxes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Mailboxes
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-xl font-semibold md:text-2xl">{sender.email}</h1>
          <StatusBadge status={sender.status} />
          <Badge>{PROVIDER_PRESETS[sender.provider].label}</Badge>
        </div>
      </div>

      {query.saved && <Alert tone="success">Mailbox connected and saved.</Alert>}
      {query.test && <Alert tone="success">Test email sent to {query.test}. Check that inbox and its spam folder.</Alert>}
      {query.testError && <Alert tone="warning" title="Saved, but the test email failed">{query.testError}</Alert>}
      {sender.lastError && (
        <Alert tone="danger" title="Last problem">
          {sender.lastError}
          {sender.lastErrorAt && (
            <span className="block text-xs opacity-80">
              <Time value={sender.lastErrorAt} mode="relative" />
            </span>
          )}
        </Alert>
      )}

      <Card>
        <CardHeader title="Sending" />
        <div className="grid gap-4 p-4 sm:grid-cols-3 md:p-5">
          <div className="sm:col-span-3">
            <div className="mb-1.5 flex justify-between text-sm">
              <span className="text-muted">Sent in the last 24 hours</span>
              <span className="font-medium tabular-nums">
                {sent24h} / {sender.dailyLimit}
              </span>
            </div>
            <Progress value={sent24h} max={sender.dailyLimit} />
          </div>
          <div>
            <p className="text-xs text-muted">Next turn</p>
            <p className="text-sm font-medium">{sender.status === "active" ? <Time value={sender.nextSendAt} mode="relative" /> : "Paused"}</p>
          </div>
          {sender.readInbox ? (
            <>
              <div>
                <p className="text-xs text-muted">Inbox last checked</p>
                <p className="text-sm font-medium">{sender.lastCheckedAt ? <Time value={sender.lastCheckedAt} mode="relative" /> : "Not yet"}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Sent copies</p>
                <p className="text-sm font-medium">{sender.saveToSent ? `Saved to ${sender.sentFolder}` : "Saved by the provider"}</p>
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted">Inbox</p>
              <p className="text-sm font-medium break-words">
                Send-only. {replyMailbox ? `Replies go to ${replyMailbox}.` : "Replies and bounces aren't tracked."}
              </p>
            </div>
          )}
          <div className="sm:col-span-3">
            <p className="text-xs text-muted">Server</p>
            <p className="text-sm break-all">
              SMTP {sender.smtpHost}:{sender.smtpPort} ({SECURITY_LABELS[sender.smtpSecurity]}) as {sender.smtpUser || sender.email}
              {sender.readInbox && sender.imapHost && (
                <>
                  {" · "}IMAP {sender.imapHost}:{sender.imapPort} ({SECURITY_LABELS[sender.imapSecurity]})
                </>
              )}
            </p>
          </div>
        </div>
        <div className="border-t p-4 md:p-5">
          <MailboxActions id={sender.id} status={sender.status} testEmail={settings.testEmail ?? me.email} />
        </div>
      </Card>

      {dns && (
        <Card>
          <CardHeader title={`Domain check: ${dns.domain}`} description="These records decide whether your mail reaches the inbox." />
          <ul className="space-y-2 p-4 md:p-5">
            <DnsRow ok={dns.mx} label="MX record" help="The domain has no mail server record. Check the domain's DNS settings." />
            <DnsRow ok={dns.spf} label="SPF record" help="Add the SPF record your mail host gives you (Hostinger: Emails → DNS settings)." />
            <DnsRow ok={dns.dmarc} label="DMARC record" help='Add a TXT record at _dmarc with "v=DMARC1; p=none;" to start.' />
          </ul>
          <p className="border-t px-4 py-3 text-xs text-muted md:px-5">DKIM can't be checked from here. Most hosts (Hostinger included) add it when your DNS is with them.</p>
        </Card>
      )}

      <section>
        <h2 className="mb-3 font-semibold">Edit mailbox</h2>
        <MailboxForm
          testEmail={settings.testEmail ?? me.email}
          replyTargets={replyTargets}
          initial={{
            id: sender.id,
            provider: sender.provider,
            email: sender.email,
            displayName: sender.displayName ?? "",
            smtpHost: sender.smtpHost,
            smtpPort: sender.smtpPort,
            smtpSecurity: sender.smtpSecurity,
            smtpUser: sender.smtpUser ?? "",
            readInbox: sender.readInbox,
            imapHost: sender.imapHost ?? "",
            imapPort: sender.imapPort ?? 993,
            imapSecurity: sender.imapSecurity,
            imapUser: sender.imapUser ?? "",
            replyToSenderId: sender.replyToSenderId ?? "",
            dailyLimit: sender.dailyLimit,
          }}
        />
      </section>
    </div>
  );
}
