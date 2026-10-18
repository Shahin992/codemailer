import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { convert as htmlToText } from "html-to-text";
import { simpleParser, type ParsedMail } from "mailparser";
import { db } from "@/lib/db";
import { messages, recipients, replies, senders, suppressions, type AttachmentMeta, type Sender } from "@/lib/db/schema";
import { extractReplyText, isAutoReply, isBounce, isOptOutReply, messageIdList, parseBounce, senderAddress } from "@/lib/mail/inbound-parse";
import { sendPushToUser, snippet } from "@/lib/push";
import { storageDir } from "@/lib/storage";

export type InboundResult = "reply" | "auto_reply" | "bounce" | "unsubscribe" | "ignored" | "duplicate";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ADDRESS_MATCH_DAYS = 30;

/** The email a reply or bounce quotes by Message-ID, whichever account sent it. */
async function findMessageByHeaders(ids: string[]) {
  if (!ids.length) return undefined;
  const [row] = await db
    .select({ id: messages.id, recipientId: messages.recipientId, status: messages.status, userId: messages.userId })
    .from(messages)
    .where(inArray(messages.messageIdHeader, ids))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  return row;
}

/** The latest email to this person from this mailbox, or from a send-only mailbox whose replies come here. */
async function findLatestMessageTo(userId: string, email: string, senderId: string) {
  const [row] = await db
    .select({ id: messages.id, recipientId: messages.recipientId, status: messages.status, userId: messages.userId })
    .from(messages)
    .innerJoin(recipients, eq(recipients.id, messages.recipientId))
    .where(
      and(
        eq(messages.userId, userId),
        eq(recipients.email, email),
        sql`(${messages.senderId} = ${senderId} or ${messages.senderId} in (select ${senders.id} from ${senders} where ${senders.replyToSenderId} = ${senderId}))`,
        gt(messages.sentAt, sql`now() - make_interval(days => ${ADDRESS_MATCH_DAYS}::int)`),
      ),
    )
    .orderBy(desc(messages.sentAt))
    .limit(1);
  return row;
}

async function handleBounce(sender: Sender, parsed: ParsedMail, raw: string): Promise<InboundResult> {
  const info = parseBounce(raw, parsed.messageId);
  const quoted = await findMessageByHeaders(info.originalMessageIds);
  if (quoted && quoted.userId !== sender.userId) return "ignored"; // another account's email (both read the same inbox)
  let target = quoted;
  if (!target && info.recipient) target = await findLatestMessageTo(sender.userId, info.recipient, sender.id);
  if (!target) return "ignored";

  const reason = [info.status, info.diagnostic].filter(Boolean).join(" ") || "Bounced";
  if (!info.hard) {
    await db.update(messages).set({ error: `Soft bounce: ${reason}`, updatedAt: new Date() }).where(eq(messages.id, target.id));
    return "bounce";
  }

  await db
    .update(messages)
    .set({ status: target.status === "replied" ? "replied" : "bounced", bouncedAt: new Date(), error: reason, updatedAt: new Date() })
    .where(eq(messages.id, target.id));
  const [recipient] = await db
    .update(recipients)
    .set({ status: "bounced" })
    .where(eq(recipients.id, target.recipientId))
    .returning({ email: recipients.email });
  if (recipient) await db.insert(suppressions).values({ userId: sender.userId, email: recipient.email, reason: "bounced" }).onConflictDoNothing();
  return "bounce";
}

/** The "mailto:…?subject=unsubscribe" option from the List-Unsubscribe header. Applies to the mailbox's account. */
async function handleUnsubscribeEmail(userId: string, email: string): Promise<InboundResult> {
  const [person] = await db
    .select({ id: recipients.id })
    .from(recipients)
    .where(and(eq(recipients.userId, userId), eq(recipients.email, email)));
  if (!person) return "ignored"; // not someone we emailed
  await db.insert(suppressions).values({ userId, email, reason: "unsubscribed" }).onConflictDoNothing();
  await db.update(recipients).set({ status: "unsubscribed" }).where(eq(recipients.id, person.id));
  await db
    .update(messages)
    .set({ status: "cancelled", error: "Unsubscribed", updatedAt: new Date() })
    .where(and(eq(messages.recipientId, person.id), eq(messages.status, "queued")));
  return "unsubscribe";
}

async function saveAttachments(replyId: string, parsed: ParsedMail): Promise<AttachmentMeta[]> {
  const saved: AttachmentMeta[] = [];
  const dir = path.join(storageDir(), "attachments", replyId);
  for (const [i, att] of parsed.attachments.entries()) {
    if (att.contentDisposition === "inline" && att.related) continue; // inline images in signatures
    if (!att.content || att.size > MAX_ATTACHMENT_BYTES) continue;
    const name = (att.filename || `attachment-${i + 1}`).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    await mkdir(dir, { recursive: true });
    const file = `${i}-${name}`;
    await writeFile(path.join(dir, file), att.content);
    saved.push({ name, size: att.size, mime: att.contentType, path: path.join("attachments", replyId, file) });
  }
  return saved;
}

/** Read one incoming email from a sender's inbox: record bounces and replies, ignore everything else. */
export async function processInbound(sender: Sender, source: Buffer, folder: string, uid: number): Promise<InboundResult> {
  const parsed = await simpleParser(source);
  const from = senderAddress(parsed);
  if (!from || from.email === sender.email.toLowerCase()) return "ignored";

  if (isBounce(parsed)) return handleBounce(sender, parsed, source.toString("utf8"));
  if (/^\s*unsubscribe\s*$/i.test(parsed.subject ?? "")) return handleUnsubscribeEmail(sender.userId, from.email);

  const quoted = await findMessageByHeaders(messageIdList(parsed));
  // It answers another account's email (both accounts read the same inbox), so it isn't this account's reply.
  if (quoted && quoted.userId !== sender.userId) return "ignored";
  let target = quoted;
  if (!target) target = await findLatestMessageTo(sender.userId, from.email, sender.id);
  if (!target) return "ignored"; // not about anything we sent, e.g. normal support mail

  const auto = isAutoReply(parsed);
  const bodyText = parsed.text ?? (parsed.html ? htmlToText(parsed.html, { wordwrap: false }) : "");
  const replyId = randomUUID();
  const messageIdHeader = parsed.messageId?.trim() || `<imap-${sender.id}-${folder}-${uid}@local>`;
  const receivedAt = parsed.date ?? new Date();

  const [inserted] = await db
    .insert(replies)
    .values({
      id: replyId,
      userId: sender.userId,
      messageId: target.id,
      recipientId: target.recipientId,
      senderId: sender.id,
      fromEmail: from.email,
      fromName: from.name || null,
      subject: parsed.subject ?? null,
      bodyText,
      bodyHtml: parsed.html || null,
      replyText: extractReplyText(bodyText),
      messageIdHeader,
      isAutoReply: auto,
      receivedAt,
    })
    .onConflictDoNothing()
    .returning({ id: replies.id });
  if (!inserted) return "duplicate";

  const attachments = await saveAttachments(replyId, parsed);
  if (attachments.length) await db.update(replies).set({ attachments }).where(eq(replies.id, replyId));

  if (auto) return "auto_reply";

  await db
    .update(messages)
    .set({ status: "replied", repliedAt: receivedAt, updatedAt: new Date() })
    .where(and(eq(messages.id, target.id), inArray(messages.status, ["sent", "replied"])));
  await db.update(recipients).set({ status: "replied" }).where(and(eq(recipients.id, target.recipientId), eq(recipients.status, "active")));

  // "No thanks" / "stop" / "remove me": the reply-to-opt-out promise in personal-style emails.
  const optedOut = isOptOutReply(extractReplyText(bodyText));
  if (optedOut) await handleUnsubscribeEmail(sender.userId, from.email);

  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(replies)
    .where(and(eq(replies.userId, sender.userId), isNull(replies.readAt), eq(replies.isAutoReply, false)));
  await sendPushToUser(sender.userId, {
    unread: unread?.n,
    title: optedOut ? `${from.name || from.email} opted out` : `Reply from ${from.name || from.email}`,
    body: optedOut
      ? `“${snippet(extractReplyText(bodyText), 60)}”. Added to the do-not-send list.`
      : snippet(extractReplyText(bodyText)) || parsed.subject || "New reply",
    url: `/replies/${replyId}`,
    tag: `reply-${replyId}`,
  }).catch((err) => console.error("[push] reply notification failed", err));

  return optedOut ? "unsubscribe" : "reply";
}
