import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { ArrowLeft, Download, History, MailOpen, Paperclip, Reply } from "lucide-react";
import sanitizeHtml from "sanitize-html";
import { markReplyUnread } from "@/app/actions/replies";
import { SubmitButton, Time } from "@/components/client";
import { Avatar, Badge, Card, StatusBadge, buttonClass } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailPreviewDoc } from "@/lib/email-preview";
import { campaigns, messages, recipients, replies, senders } from "@/lib/db/schema";
import { buildVars, fillFields } from "@/lib/merge";

export const metadata: Metadata = { title: "Reply" };

function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "span", "font", "center"]),
    allowedAttributes: { "*": ["style", "align", "width", "height", "color"], a: ["href", "title"], img: ["src", "alt", "width", "height"] },
    allowedSchemes: ["http", "https", "mailto", "cid", "data"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  });
}

function formatSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function ReplyPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({
      reply: replies,
      mailbox: senders.email,
      recipientEmail: recipients.email,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      originalSubject: messages.subject,
      originalSentAt: messages.sentAt,
      messageStatus: messages.status,
      // To show the email they answered, as it was written for them (display only).
      messageVars: messages.vars,
      recipientName: recipients.name,
      campaignBody: campaigns.bodyText,
      senderName: senders.displayName,
    })
    .from(replies)
    .innerJoin(senders, eq(senders.id, replies.senderId))
    .leftJoin(messages, eq(messages.id, replies.messageId))
    .leftJoin(campaigns, eq(campaigns.id, messages.campaignId))
    .leftJoin(recipients, eq(recipients.id, replies.recipientId))
    .where(and(eq(replies.id, id), eq(replies.userId, me.id)));
  if (!row) notFound();
  const { reply } = row;

  // Everything this person wrote back about the same email, oldest first, so a second or third reply is never hidden.
  const conversation = await db
    .select({ id: replies.id, receivedAt: replies.receivedAt, replyText: replies.replyText, bodyText: replies.bodyText, readAt: replies.readAt, attachments: replies.attachments })
    .from(replies)
    .where(
      and(
        eq(replies.userId, me.id),
        reply.messageId ? eq(replies.messageId, reply.messageId) : and(isNull(replies.messageId), eq(replies.fromEmail, reply.fromEmail), eq(replies.senderId, reply.senderId)),
        or(eq(replies.isAutoReply, false), eq(replies.id, reply.id)),
      ),
    )
    .orderBy(asc(replies.receivedAt), asc(replies.id));
  // All of them are shown in full on this page, so they all count as read.
  const unreadIds = conversation.filter((r) => !r.readAt).map((r) => r.id);
  if (unreadIds.length) await db.update(replies).set({ readAt: new Date() }).where(inArray(replies.id, unreadIds));
  // The email they answered, filled in for this person the way it was sent (personal-style text, no footer).
  const original =
    row.campaignBody && row.recipientEmail
      ? fillFields(row.campaignBody, buildVars({ email: row.recipientEmail, name: row.recipientName }, row.messageVars)).trim()
      : null;
  const position = conversation.findIndex((r) => r.id === reply.id);
  const mailto = `mailto:${reply.fromEmail}?subject=${encodeURIComponent(`Re: ${reply.subject ?? ""}`)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-20 md:pb-0">
      <Link href="/replies" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Replies
      </Link>

      <div>
        <h1 className="text-[22px] leading-tight font-bold tracking-tight break-words md:text-[26px]">{reply.subject || "(no subject)"}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {row.campaignId && (
            <Link href={`/campaigns/${row.campaignId}`}>
              <Badge tone="primary">{row.campaignName}</Badge>
            </Link>
          )}
          {reply.isAutoReply && <Badge tone="warning">auto-reply</Badge>}
          {conversation.length > 1 && (
            <Badge>
              reply {position + 1} of {conversation.length}
            </Badge>
          )}
          {row.messageStatus && <StatusBadge status={row.messageStatus} />}
        </div>
      </div>

      <Card className="divide-y overflow-hidden">
        {/* The email they answered: folded, like the earlier messages of a thread in a mail app. */}
        {(original || row.originalSubject) && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 hover:bg-neutral-soft/60 md:px-5 [&::-webkit-details-marker]:hidden">
              <Avatar name={row.senderName} email={row.mailbox} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-[15px] font-semibold">
                    You <span className="text-xs font-medium text-muted">· {row.senderName || row.mailbox}</span>
                  </p>
                  <span className="shrink-0 text-xs text-muted">{row.originalSentAt ? <Time value={row.originalSentAt} /> : null}</span>
                </div>
                <p className="truncate text-[13px] text-muted group-open:hidden">{original ? original.replace(/\s+/g, " ") : row.originalSubject}</p>
                <p className="hidden truncate text-[13px] text-muted group-open:block">to {reply.fromName || reply.fromEmail}</p>
              </div>
            </summary>
            <div className="px-4 pb-5 md:pr-5 md:pl-[68px]">
              {row.originalSubject && <p className="mb-2 text-sm font-semibold break-words">{row.originalSubject}</p>}
              {original ? (
                <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-fg/90">{original}</p>
              ) : (
                <p className="text-sm text-muted">The text of this email isn&apos;t available.</p>
              )}
              {row.campaignId && (
                <Link href={`/campaigns/${row.campaignId}`} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
                  Open the campaign →
                </Link>
              )}
            </div>
          </details>
        )}

        {/* Everything this person wrote back about the same email, oldest first; the one opened here unfolded. */}
        {conversation.map((r, i) => {
          const current = r.id === reply.id;
          const text = r.replyText || r.bodyText || "(empty)";
          return (
            <details key={r.id} open={current} className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 hover:bg-neutral-soft/60 md:px-5 [&::-webkit-details-marker]:hidden">
                <Avatar name={reply.fromName} email={reply.fromEmail} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-[15px] font-semibold">
                      {reply.fromName || reply.fromEmail}
                      {conversation.length > 1 && <span className="ml-1.5 text-xs font-medium text-muted">· reply {i + 1}</span>}
                    </p>
                    <span className="shrink-0 text-xs text-muted">
                      <Time value={r.receivedAt} />
                    </span>
                  </div>
                  <p className="truncate text-[13px] text-muted group-open:hidden">{text.replace(/\s+/g, " ")}</p>
                  <p className="hidden truncate text-[13px] text-muted group-open:block">
                    {reply.fromName ? `${reply.fromEmail} · ` : ""}to {row.mailbox}
                  </p>
                </div>
                {r.attachments.length > 0 && <Paperclip className="mt-1 size-4 shrink-0 text-muted" aria-label="Has attachments" />}
              </summary>
              <div className="px-4 pb-5 md:pr-5 md:pl-[68px]">
                <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap">{text}</p>
                {r.attachments.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {r.attachments.map((a, j) => (
                      <a
                        key={j}
                        href={`/api/attachments/${r.id}/${j}`}
                        className="inline-flex max-w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-card hover:bg-neutral-soft"
                      >
                        <Download className="size-4 shrink-0 text-muted" />
                        <span className="truncate">{a.name}</span>
                        <span className="shrink-0 text-xs text-muted">{formatSize(a.size)}</span>
                      </a>
                    ))}
                  </div>
                )}
                {!current && (
                  <Link href={`/replies/${r.id}`} className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
                    Open this reply on its own
                  </Link>
                )}
              </div>
            </details>
          );
        })}
      </Card>

      {reply.bodyHtml && (
        <details className="rounded-2xl border bg-card shadow-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium md:px-5">Show the full email with formatting</summary>
          <iframe
            title="Full email"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="h-[60vh] w-full rounded-b-2xl border-t bg-white"
            srcDoc={emailPreviewDoc(cleanHtml(reply.bodyHtml), { openLinksInNewTab: true })}
          />
        </details>
      )}

      {/* Actions: a bar above the tabs on phones (like a mail app's reply bar), a row on wider screens. */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-30 border-t bg-card/95 px-4 py-2.5 backdrop-blur-md md:static md:rounded-2xl md:border md:bg-card md:px-5 md:py-3 md:shadow-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <a href={mailto} className={buttonClass("primary", "sm", "flex-1 md:flex-none")}>
            <Reply className="size-4" /> Reply
          </a>
          <Link href={`/recipients?email=${encodeURIComponent(reply.fromEmail)}`} className={buttonClass("secondary", "sm", "flex-1 md:flex-none")}>
            <History className="size-4" /> History
          </Link>
          <form action={markReplyUnread.bind(null, reply.id)} className="flex-1 md:ml-auto md:flex-none">
            <SubmitButton variant="ghost" size="sm" className="w-full" pendingText="Saving…">
              <MailOpen className="size-4" /> Mark unread
            </SubmitButton>
          </form>
        </div>
        <p className="mx-auto mt-1.5 hidden max-w-3xl text-xs text-muted md:block">Reply opens your mail app, so the answer goes out from your own mailbox.</p>
      </div>
    </div>
  );
}
