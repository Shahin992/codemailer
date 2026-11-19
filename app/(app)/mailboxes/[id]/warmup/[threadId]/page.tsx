import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, ArrowLeftRight, Clock } from "lucide-react";
import { Time } from "@/components/client";
import { Card, cn } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { senders } from "@/lib/db/schema";
import { extractReplyText } from "@/lib/mail/inbound-parse";
import { warmupThread } from "@/lib/warmup/history";
import { Avatar, Pill, PlacementPill } from "../parts";

export const metadata: Metadata = { title: "Warm-up conversation" };

const UUID = /^[0-9a-f-]{36}$/i;
const STEP = ["First email", "Reply", "Answer back"];

export default async function WarmupConversationPage({ params }: { params: Promise<{ id: string; threadId: string }> }) {
  const me = await requireSession();
  const { id, threadId } = await params;
  if (!UUID.test(id) || !UUID.test(threadId)) notFound();
  const [mailbox] = await db.select({ email: senders.email }).from(senders).where(and(eq(senders.id, id), eq(senders.userId, me.id)));
  if (!mailbox) notFound();
  const thread = await warmupThread(me.id, id, threadId);
  if (!thread) notFound();

  const first = thread[0];
  // The two sides, this mailbox first.
  const here = first.senderId === id ? { name: first.fromName, email: first.fromEmail } : { name: first.toName, email: first.toEmail };
  const other = first.senderId === id ? { name: first.toName, email: first.toEmail } : { name: first.fromName, email: first.fromEmail };
  const spam = thread.filter((m) => m.landedIn === "spam").length;
  const movedBack = thread.filter((m) => m.landedIn === "spam" && m.rescuedAt).length;
  const sent = thread.filter((m) => m.sentAt).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/mailboxes/${id}/warmup`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All warm-up conversations
      </Link>

      <Card className="space-y-3 px-4 py-4 md:px-5">
        <h1 className="text-lg font-semibold break-words md:text-xl">{first.subject ?? "Not written yet"}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Avatar name={here.name} email={here.email} size="sm" />
            <span className="truncate font-medium">{here.name || here.email}</span>
          </span>
          <ArrowLeftRight className="size-4 shrink-0 text-muted" aria-label="with" />
          <span className="inline-flex min-w-0 items-center gap-2">
            <Avatar name={other.name} email={other.email} size="sm" />
            <span className="truncate font-medium">{other.name || other.email}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="neutral">
            {sent} of {thread.length} {thread.length === 1 ? "email" : "emails"} sent
          </Pill>
          {spam > 0 && (
            <Pill tone={movedBack === spam ? "warning" : "danger"}>
              {spam} landed in spam{movedBack ? ` · ${movedBack} moved back` : ""}
            </Pill>
          )}
          {spam === 0 && sent > 0 && thread.every((m) => !m.sentAt || m.landedIn) && <Pill tone="success">All reached the inbox</Pill>}
        </div>
        <p className="text-xs text-muted">
          Warm-up mail: it stays out of Replies and campaign numbers, and the receiving mailbox marks each email as read.
        </p>
      </Card>

      <ol className="space-y-5">
        {thread.map((m, i) => {
          const fromHere = m.senderId === id;
          const newText = m.bodyText ? extractReplyText(m.bodyText) : null;
          const hasQuote = Boolean(m.bodyText && newText && newText.length < m.bodyText.trim().length);
          const waiting = m.status === "scheduled" || m.status === "sending";
          return (
            <li key={m.id} className={cn("flex items-start gap-2.5", fromHere && "flex-row-reverse")}>
              {/* On a phone the name above the bubble is enough; the room goes to the text. */}
              <span className="mt-5 hidden sm:block">
                <Avatar name={m.fromName} email={m.fromEmail} />
              </span>
              <div className={cn("flex min-w-0 max-w-[92%] flex-col sm:max-w-[78%]", fromHere ? "items-end" : "items-start")}>
                <p className={cn("mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted", fromHere && "justify-end")}>
                  <span className="font-semibold text-fg">{m.fromName || m.fromEmail}</span>
                  <span>{STEP[i] ?? "Email"}</span>
                  <span>
                    {m.sentAt ? (
                      <Time value={m.sentAt} />
                    ) : (
                      <>
                        planned <Time value={m.scheduledAt} />
                      </>
                    )}
                  </span>
                </p>

                <div
                  className={cn(
                    "w-full rounded-2xl px-4 py-3 text-sm leading-relaxed break-words",
                    waiting
                      ? "border border-dashed bg-card text-muted"
                      : fromHere
                        ? "rounded-br-md bg-primary-soft"
                        : "rounded-bl-md border bg-card",
                  )}
                >
                  {newText ? (
                    <p className="whitespace-pre-wrap">{newText}</p>
                  ) : (
                    <p className="inline-flex items-center gap-1.5">
                      <Clock className="size-4" /> The text is written when it&apos;s sent.
                    </p>
                  )}
                </div>

                <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted", fromHere && "justify-end")}>
                  <PlacementPill m={m} />
                  {m.receivedAt && (
                    <span>
                      found <Time value={m.receivedAt} mode="relative" />
                      {m.rescuedAt && (
                        <>
                          , moved <Time value={m.rescuedAt} mode="relative" />
                        </>
                      )}
                    </span>
                  )}
                </div>
                {m.error && <p className={cn("mt-1 text-xs break-words", m.status === "failed" ? "text-danger" : "text-muted")}>{m.error}</p>}

                {(hasQuote || m.messageIdHeader) && (
                  <details className={cn("mt-1 w-full text-xs", fromHere && "text-right")}>
                    <summary className="inline-flex min-h-10 cursor-pointer items-center px-1 text-sm text-muted hover:text-fg sm:min-h-0 sm:text-xs">
                      {hasQuote ? "Show the full email" : "Details"}
                    </summary>
                    <div className="mt-2 space-y-2 text-left">
                      {hasQuote && <pre className="overflow-x-auto rounded-lg border bg-card p-3 leading-relaxed whitespace-pre-wrap">{m.bodyText}</pre>}
                      {m.messageIdHeader && <p className="break-all text-muted">Message-ID: {m.messageIdHeader}</p>}
                    </div>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="pt-2 text-center text-xs text-muted">
        {thread.length >= 3 ? "Warm-up conversations end after 3 emails." : thread.some((m) => m.status === "scheduled") ? "The next email is planned." : "No more emails planned in this conversation."}
      </p>
    </div>
  );
}
