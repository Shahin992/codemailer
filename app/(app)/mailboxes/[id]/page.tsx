import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { ArrowLeft, Check, X } from "lucide-react";
import { Time } from "@/components/client";
import { Alert, Badge, Card, CardHeader, DetailList, Progress, SectionTabs, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { sentLast24h, warmupSentLast24h } from "@/lib/queries";
import { domainOf } from "@/lib/mail/compose";
import { checkDomainDns } from "@/lib/mail/dns";
import { PROVIDER_PRESETS, SECURITY_LABELS } from "@/lib/providers";
import { requireSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { MailboxForm } from "../mailbox-form";
import { warmupDetail } from "@/lib/warmup/status";
import { MailboxActions } from "./mailbox-actions";
import { WarmupCard } from "./warmup-card";
import { FlashToast } from "@/components/toast";

export const metadata: Metadata = { title: "Mailbox" };

function DnsRow({ ok, label, help }: { ok: boolean; label: string; help: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 text-sm md:px-5">
      <span className={`grid size-6 shrink-0 place-items-center rounded-full ${ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
        {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      </span>
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className={`block text-xs ${ok ? "text-muted" : "text-danger"}`}>{ok ? "Found" : help}</span>
      </span>
    </li>
  );
}

const TABS = ["overview", "warmup", "settings"] as const;
type Tab = (typeof TABS)[number];

export default async function MailboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; test?: string; testError?: string; tab?: string }>;
}) {
  const me = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ sender: senders, sent24h: sentLast24h, warmup24h: warmupSentLast24h })
    .from(senders)
    .where(and(eq(senders.id, id), eq(senders.userId, me.id)));
  if (!row) notFound();
  const { sender, sent24h, warmup24h } = row;
  // One section at a time on the page; after saving the form the page opens on Overview with the result.
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : "overview";
  const settings = await getSettings(me.id);
  const [warmup, dns, replyTargets] = await Promise.all([
    tab === "warmup" ? warmupDetail(sender, settings.timezone, settings.weekdaysOnly) : null,
    tab === "overview" ? checkDomainDns(domainOf(sender.email)) : null,
    db
      .select({ id: senders.id, email: senders.email })
      .from(senders)
      .where(and(eq(senders.userId, me.id), eq(senders.readInbox, true), ne(senders.id, sender.id)))
      .orderBy(asc(senders.createdAt)),
  ]);
  const replyMailbox = sender.replyToSenderId ? replyTargets.find((t) => t.id === sender.replyToSenderId)?.email : undefined;
  const usage = sender.dailyLimit > 0 ? sent24h / sender.dailyLimit : 0;
  const base = `/mailboxes/${sender.id}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/mailboxes" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Mailboxes
        </Link>
        <h1 className="text-[22px] leading-tight font-bold tracking-tight break-words md:text-[26px]">{sender.email}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={sender.status} />
          <Badge>{PROVIDER_PRESETS[sender.provider].label}</Badge>
          {sender.displayName && <Badge>{sender.displayName}</Badge>}
          {sender.warmupEnabled && <Badge tone="primary">{sender.warmupRole === "partner" ? "Warm-up partner" : "Warm-up on"}</Badge>}
          {!sender.readInbox && <Badge tone="warning">Send-only</Badge>}
        </div>
      </div>

      {query.saved && <FlashToast tone="success" text="Mailbox connected and saved." />}
      {query.testError && <FlashToast tone="danger" text={`Saved, but the test email failed: ${query.testError}`} />}
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

      <SectionTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: base },
          { key: "warmup", label: "Warm-up", href: `${base}?tab=warmup` },
          { key: "settings", label: "Settings", href: `${base}?tab=settings` },
        ]}
      />

      {tab === "overview" && (
        <>
          <Card>
            <div className="p-4 md:p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-muted">Sent in the last 24 hours</p>
                  <p className="mt-1 text-[28px] leading-none font-bold tracking-tight tabular-nums">
                    {sent24h}
                    <span className="text-base font-semibold text-muted"> / {sender.dailyLimit}</span>
                  </p>
                </div>
                <p className="pb-0.5 text-right text-xs text-muted">{warmup24h > 0 ? `${warmup24h} of them warm-up` : "daily limit"}</p>
              </div>
              <div className="mt-3">
                <Progress value={sent24h} max={sender.dailyLimit} tone={usage >= 1 ? "warning" : "primary"} />
              </div>
            </div>
            <div className="border-t">
              <DetailList
                items={[
                  { label: "Next turn", value: sender.status === "active" ? <Time value={sender.nextSendAt} mode="relative" /> : "Paused" },
                  ...(sender.readInbox
                    ? [
                        { label: "Inbox last checked", value: sender.lastCheckedAt ? <Time value={sender.lastCheckedAt} mode="relative" /> : "Not yet" },
                        { label: "Sent copies", value: sender.saveToSent ? `Saved to ${sender.sentFolder}` : "Saved by the provider" },
                      ]
                    : [{ label: "Inbox", value: `Send-only. ${replyMailbox ? `Replies go to ${replyMailbox}.` : "Replies and bounces aren't tracked."}`, wide: true }]),
                  {
                    label: "Sending server",
                    value: `${sender.smtpHost}:${sender.smtpPort} · ${SECURITY_LABELS[sender.smtpSecurity]}`,
                    wide: true,
                  },
                  ...(sender.readInbox && sender.imapHost
                    ? [{ label: "Inbox server", value: `${sender.imapHost}:${sender.imapPort} · ${SECURITY_LABELS[sender.imapSecurity]}`, wide: true }]
                    : []),
                ]}
              />
            </div>
            <div className="border-t p-4 md:p-5">
              <MailboxActions id={sender.id} status={sender.status} testEmail={settings.testEmail ?? me.email} />
            </div>
          </Card>

          {dns && (
            <Card>
              <CardHeader title={`Domain check: ${dns.domain}`} description="These records decide whether your mail reaches the inbox." />
              <ul className="divide-y">
                <DnsRow ok={dns.mx} label="MX record" help="The domain has no mail server record. Check the domain's DNS settings." />
                <DnsRow ok={dns.spf} label="SPF record" help="Add the SPF record your mail host gives you (Hostinger: Emails → DNS settings)." />
                <DnsRow ok={dns.dmarc} label="DMARC record" help='Add a TXT record at _dmarc with "v=DMARC1; p=none;" to start.' />
              </ul>
              <p className="border-t px-4 py-3 text-xs text-muted md:px-5">DKIM can't be checked from here. Most hosts (Hostinger included) add it when your DNS is with them.</p>
            </Card>
          )}
        </>
      )}

      {tab === "warmup" && warmup && <WarmupCard sender={sender} detail={warmup} settings={settings} />}

      {tab === "settings" && (
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
      )}
    </div>
  );
}
