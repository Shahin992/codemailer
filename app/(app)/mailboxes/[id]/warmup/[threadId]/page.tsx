import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, ChevronDown, Clock } from "lucide-react";
import { Time } from "@/components/client";
import { Badge, Card, cn } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { extractReplyText } from "@/lib/mail/inbound-parse";
import { messagePreview, warmupThread, type ThreadMessage } from "@/lib/warmup/history";
import { Avatar, Pill, PlacementPill } from "../parts";

export const metadata: Metadata = { title: "Warm-up conversation" };

const UUID = /^[0-9a-f-]{36}$/i;

/** The new text of an email and the earlier emails it quotes underneath ("On … wrote:"). */
function splitQuote(body: string): { text: string; quoted: string | null } {
  const full = body.trim();
  const text = extractReplyText(full);
  if (text.length >= full.length || !full.startsWith(text)) return { text: full, quoted: null };
  return { text, quoted: full.slice(text.length).trim() || null };
}

function Address({ name, email }: { name: string | null; email: string }) {
  return name ? (
    <>
      {name} <span className="text-muted">&lt;{email}&gt;</span>
    </>
  ) : (
    <>{email}</>
  );
}

/** One email of the thread, like a mail app shows it: folded to a line (sender and preview) or opened in full. */
function Email({ m, mailboxId, open }: { m: ThreadMessage; mailboxId: string; open: boolean }) {
  const fromHere = m.senderId === mailboxId;
  const planned = m.status === "scheduled" || m.status === "sending";
  const body = m.bodyText ? splitQuote(m.bodyText) : null;
  const preview = m.bodyText ? messagePreview(m.bodyText, extractReplyText) : "The text is written when it's sent.";

  return (
    <details open={open} className="group">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 transition-colors hover:bg-neutral-soft/60 md:px-5 [&::-webkit-details-marker]:hidden">
        <Avatar name={m.fromName} email={m.fromEmail} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[15px] font-semibold">
              {m.fromName || m.fromEmail}
              {fromHere && <span className="ml-1.5 text-xs font-medium text-muted">· this mailbox</span>}
            </p>
            <span className="shrink-0 text-xs text-muted">
              {m.sentAt ? <Time value={m.sentAt} /> : <Time value={m.scheduledAt} />}
            </span>
          </div>
          {/* Folded: a one-line preview. Open: who it went to. */}
          <p className="truncate text-[13px] text-muted group-open:hidden">{preview}</p>
          <p className="hidden items-center gap-1 text-[13px] text-muted group-open:flex">
            <span className="truncate">to {m.toName || m.toEmail}</span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </p>
        </div>
      </summary>

      <div className="px-4 pb-5 md:pr-5 md:pl-[68px]">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <PlacementPill m={m} />
          {m.receivedAt && (
            <span>
              found <Time value={m.receivedAt} mode="relative" />
              {m.rescuedAt && (
                <>
                  , moved to the inbox <Time value={m.rescuedAt} mode="relative" />
                </>
              )}
            </span>
          )}
          {planned && (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" /> goes out <Time value={m.scheduledAt} mode="relative" />
            </span>
          )}
        </div>

        {body ? (
          <div className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{body.text}</div>
        ) : (
          <p className="text-sm text-muted italic">The text is written when it&apos;s sent.</p>
        )}

        {body?.quoted && (
          <details className="group/quote mt-3">
            <summary
              className="inline-flex h-6 cursor-pointer list-none items-center rounded-full border bg-neutral-soft px-2.5 text-xs font-bold tracking-widest text-muted hover:text-fg [&::-webkit-details-marker]:hidden"
              aria-label="Show the quoted text"
              title="Show the quoted text"
            >
              •••
            </summary>
            <div className="mt-3 border-l-2 pl-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-muted">{body.quoted}</div>
          </details>
        )}

        {m.error && <p className={cn("mt-3 text-xs break-words", m.status === "failed" ? "text-danger" : "text-muted")}>{m.error}</p>}

        <details className="mt-4 text-xs">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            Email details
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-neutral-soft p-3">
            <dt className="text-muted">From</dt>
            <dd className="break-words">
              <Address name={m.fromName} email={m.fromEmail} />
            </dd>
            <dt className="text-muted">To</dt>
            <dd className="break-words">
              <Address name={m.toName} email={m.toEmail} />
            </dd>
            <dt className="text-muted">{m.sentAt ? "Sent" : "Planned"}</dt>
            <dd>
              <Time value={m.sentAt ?? m.scheduledAt} />
            </dd>
            {m.subject && (
              <>
                <dt className="text-muted">Subject</dt>
                <dd className="break-words">{m.subject}</dd>
              </>
            )}
            {m.messageIdHeader && (
              <>
                <dt className="text-muted">Message-ID</dt>
                <dd className="break-all">{m.messageIdHeader}</dd>
              </>
            )}
          </dl>
        </details>
      </div>
    </details>
  );
}

export default async function WarmupConversationPage({ params }: { params: Promise<{ id: string; threadId: string }> }) {
  const me = await requireSession();
  const { id, threadId } = await params;
  if (!UUID.test(id) || !UUID.test(threadId)) notFound();
  const [mailbox] = await db.select({ email: senders.email }).from(senders).where(and(eq(senders.id, id), eq(senders.userId, me.id)));
  if (!mailbox) notFound();
  const thread = await warmupThread(me.id, id, threadId);
  if (!thread) notFound();

  const first = thread[0];
  const spam = thread.filter((m) => m.landedIn === "spam").length;
  const movedBack = thread.filter((m) => m.landedIn === "spam" && m.rescuedAt).length;
  const sent = thread.filter((m) => m.sentAt).length;
  // Like a mail app: earlier emails folded to a line, the latest one sent open. Planned ones stay folded.
  const lastSent = thread.reduce((last, m, i) => (m.sentAt ? i : last), -1);
  const openIndex = lastSent >= 0 ? lastSent : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/mailboxes/${id}/warmup`} className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Warm-up conversations
      </Link>

      <div>
        <h1 className="text-[22px] leading-tight font-bold tracking-tight break-words md:text-[26px]">{first.subject ?? "Not written yet"}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="primary">Warm-up</Badge>
          <Pill tone="neutral">
            {sent} {sent === 1 ? "email" : "emails"}
            {thread.length > sent ? ` · ${thread.length - sent} planned` : ""}
          </Pill>
          {spam > 0 && (
            <Pill tone={movedBack === spam ? "warning" : "danger"}>
              {spam} landed in spam{movedBack ? (movedBack === spam ? " · moved back" : ` · ${movedBack} moved back`) : ""}
            </Pill>
          )}
          {spam === 0 && sent > 0 && thread.every((m) => !m.sentAt || m.landedIn) && <Pill tone="success">All reached the inbox</Pill>}
        </div>
      </div>

      <Card className="divide-y overflow-hidden">
        {thread.map((m, i) => (
          <Email key={m.id} m={m} mailboxId={id} open={i === openIndex} />
        ))}
      </Card>

      <p className="px-1 text-xs leading-snug text-muted">
        A warm-up conversation: it stays out of Replies and campaign numbers, and the receiving mailbox marked each email as read.
        {thread.length >= 3 ? " Warm-up conversations end after 3 emails." : ""}
      </p>
    </div>
  );
}
