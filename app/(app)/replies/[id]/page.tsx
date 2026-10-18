import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { ArrowLeft, Download, Paperclip } from "lucide-react";
import sanitizeHtml from "sanitize-html";
import { markReplyUnread } from "@/app/actions/replies";
import { SubmitButton, Time } from "@/components/client";
import { Badge, Card, CardHeader, StatusBadge } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { emailPreviewDoc } from "@/lib/email-preview";
import { campaigns, messages, recipients, replies, senders } from "@/lib/db/schema";

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
  const thread = conversation.length > 1 ? conversation : []; // only shown when there is more than one

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/replies" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Replies
      </Link>

      <Card>
        <div className="space-y-2 border-b px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-lg font-semibold break-words">{reply.subject || "(no subject)"}</h1>
            {reply.isAutoReply && <Badge tone="warning">auto-reply</Badge>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="min-w-0 break-words">
              <span className="font-medium">{reply.fromName || reply.fromEmail}</span>
              {reply.fromName && <span className="text-muted"> &lt;{reply.fromEmail}&gt;</span>}
            </p>
            <span className="text-xs text-muted">
              <Time value={reply.receivedAt} />
            </span>
          </div>
          <p className="text-xs text-muted">to {row.mailbox}</p>
        </div>

        <div className="px-4 py-4 md:px-5">
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{reply.replyText || reply.bodyText || "(empty)"}</p>
        </div>

        {reply.attachments.length > 0 && (
          <div className="border-t px-4 py-3 md:px-5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
              <Paperclip className="size-3.5" /> Attachments
            </p>
            <div className="flex flex-wrap gap-2">
              {reply.attachments.map((a, i) => (
                <a
                  key={i}
                  href={`/api/attachments/${reply.id}/${i}`}
                  className="inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-neutral-soft"
                >
                  <Download className="size-4 shrink-0" />
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-xs text-muted">{formatSize(a.size)}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t px-4 py-3 md:px-5">
          <a href={`mailto:${reply.fromEmail}?subject=${encodeURIComponent(`Re: ${reply.subject ?? ""}`)}`} className="text-sm font-medium text-primary hover:underline">
            Reply from your mail app
          </a>
          <span className="text-muted">·</span>
          <Link href={`/recipients?email=${encodeURIComponent(reply.fromEmail)}`} className="text-sm font-medium text-primary hover:underline">
            Full history
          </Link>
          <form action={markReplyUnread.bind(null, reply.id)} className="ml-auto">
            <SubmitButton variant="ghost" size="sm">
              Mark unread
            </SubmitButton>
          </form>
        </div>
      </Card>

      {thread.length > 0 && (
        <Card>
          <CardHeader
            title={`${thread.length} replies in this conversation`}
            description={`Everything ${reply.fromName || reply.fromEmail} wrote back about this email, oldest first.`}
          />
          <ol className="divide-y">
            {thread.map((r, i) => {
              const current = r.id === reply.id;
              const text = (
                <>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="font-medium text-fg">Reply {i + 1}</span>
                    <Time value={r.receivedAt} />
                    {current && <Badge tone="primary">Shown above</Badge>}
                    {r.attachments.length > 0 && <Paperclip className="size-3.5" aria-label="Has attachments" />}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed break-words whitespace-pre-wrap">{r.replyText || r.bodyText || "(empty)"}</span>
                </>
              );
              return (
                <li key={r.id}>
                  {current ? (
                    <div className="border-l-2 border-primary bg-primary-soft/40 px-4 py-3 md:px-5">{text}</div>
                  ) : (
                    <Link href={`/replies/${r.id}`} className="block px-4 py-3 transition-colors hover:bg-neutral-soft md:px-5">
                      {text}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {row.campaignId && (
        <Card>
          <CardHeader title="Reply to" />
          <div className="space-y-1 px-4 py-3 text-sm md:px-5">
            <p>
              <span className="text-muted">Campaign: </span>
              <Link href={`/campaigns/${row.campaignId}`} className="font-medium hover:underline">
                {row.campaignName}
              </Link>
            </p>
            <p className="break-words">
              <span className="text-muted">Your email: </span>
              {row.originalSubject} · <Time value={row.originalSentAt} />
            </p>
            {row.messageStatus && (
              <p>
                <span className="text-muted">Status: </span>
                <StatusBadge status={row.messageStatus} />
              </p>
            )}
          </div>
        </Card>
      )}

      {reply.bodyHtml && (
        <details className="rounded-xl border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium md:px-5">Show the full email with formatting</summary>
          <iframe
            title="Full email"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="h-[60vh] w-full rounded-b-xl border-t bg-white"
            srcDoc={emailPreviewDoc(cleanHtml(reply.bodyHtml), { openLinksInNewTab: true })}
          />
        </details>
      )}
    </div>
  );
}
