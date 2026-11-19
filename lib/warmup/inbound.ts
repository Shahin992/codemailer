// The receiving side of warm-up, called by the inbox check for every new email in INBOX and the spam folder.
// A warm-up email is recognised by its Message-ID (saved before it was sent), so the email carries no visible
// or unusual marker. It's recorded with where it landed and handed back to the inbox check, which marks it read
// and moves it out of spam. Then, at the receiving mailbox's reply rate, a reply is planned for later.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { senders, warmupMessages, type Sender } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { canWarmUp, MAX_THREAD_LENGTH, REPLY_DELAY_MINUTES, replyTime } from "@/lib/warmup/schedule";

export type WarmupMatch =
  | { kind: "warmup"; id: string } // for this mailbox: mark read (and move out of spam)
  | { kind: "not_ours" }; // a warm-up email, but for another mailbox or account reading the same inbox: leave it alone

/** Is this email (by its Message-ID) a warm-up email? Records its arrival the first time it's seen. */
export async function matchWarmup(sender: Sender, messageId: string | undefined, folder: string): Promise<WarmupMatch | null> {
  const id = messageId?.trim();
  if (!id) return null;
  const [row] = await db.select().from(warmupMessages).where(eq(warmupMessages.messageIdHeader, id));
  if (!row) return null;
  if (row.toSenderId !== sender.id) return { kind: "not_ours" };

  if (!row.receivedAt) {
    const [first] = await db
      .update(warmupMessages)
      .set({ receivedAt: new Date(), landedIn: folder.toUpperCase() === "INBOX" ? "inbox" : "spam", updatedAt: new Date() })
      .where(and(eq(warmupMessages.id, row.id), isNull(warmupMessages.receivedAt)))
      .returning();
    if (first) await maybePlanReply(sender, first).catch((err) => console.error("[warmup] could not plan a reply", err));
  }
  return { kind: "warmup", id: row.id };
}

/** Moved out of spam into the inbox by the inbox check. */
export async function markRescued(ids: string[]) {
  if (!ids.length) return;
  await db
    .update(warmupMessages)
    .set({ rescuedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(warmupMessages.id, ids), eq(warmupMessages.landedIn, "spam"), isNull(warmupMessages.rescuedAt)));
}

/** A bounce notice about a warm-up email this mailbox sent. Returns true when it was one. */
export async function matchWarmupBounce(sender: Sender, quotedIds: string[], reason: string): Promise<boolean> {
  if (!quotedIds.length) return false;
  const rows = await db
    .update(warmupMessages)
    .set({ status: "failed", error: `Bounced: ${reason}`, updatedAt: new Date() })
    .where(and(inArray(warmupMessages.messageIdHeader, quotedIds), eq(warmupMessages.senderId, sender.id)))
    .returning({ id: warmupMessages.id });
  return rows.length > 0;
}

/**
 * Mail that answers a warm-up email without being one (an out-of-office reply from someone's Gmail, or a
 * provider that rewrote the Message-ID): never a campaign reply. True when it quotes a warm-up Message-ID.
 */
export async function quotesWarmup(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const [row] = await db.select({ id: warmupMessages.id }).from(warmupMessages).where(inArray(warmupMessages.messageIdHeader, ids)).limit(1);
  return Boolean(row);
}

/** One of the account's own warm-up mailboxes. Mail from (or bounces about) them is never matched by address alone. */
export async function isOwnWarmupAddress(userId: string, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: senders.id })
    .from(senders)
    .where(and(eq(senders.userId, userId), eq(senders.email, email.toLowerCase()), eq(senders.warmupEnabled, true)))
    .limit(1);
  return Boolean(row);
}

async function maybePlanReply(receiver: Sender, row: typeof warmupMessages.$inferSelect) {
  // A paused mailbox (or one that left warm-up) doesn't save up replies for later.
  if (!canWarmUp(receiver) || row.senderId === receiver.id) return;
  const [thread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(warmupMessages)
    .where(and(eq(warmupMessages.threadId, row.threadId), ne(warmupMessages.status, "cancelled")));
  if (thread.n >= MAX_THREAD_LENGTH) return;
  // The first email is answered at the reply rate; a reply gets an answer back half as often, so threads taper off.
  const rate = row.parentId ? receiver.warmupReplyRate / 2 : receiver.warmupReplyRate;
  if (Math.random() * 100 >= rate) return;

  const settings = await getSettings(receiver.userId);
  await db.insert(warmupMessages).values({
    id: randomUUID(),
    userId: receiver.userId,
    senderId: receiver.id,
    toSenderId: row.senderId,
    parentId: row.id,
    threadId: row.threadId,
    topic: row.topic,
    scheduledAt: replyTime(new Date(), settings, REPLY_DELAY_MINUTES[receiver.warmupRole]),
  });
}
