import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, recipients, senders, suppressions } from "@/lib/db/schema";
import { readToken } from "@/lib/crypto";

/** The person (and the mailbox that emailed them) behind an unsubscribe link, if the token is genuine. */
export async function recipientForToken(token: string) {
  const messageId = readToken(token, "unsub");
  if (!messageId) return null;
  const [row] = await db
    .select({
      userId: messages.userId,
      recipientId: recipients.id,
      email: recipients.email,
      status: recipients.status,
      senderName: senders.displayName,
      senderEmail: senders.email,
    })
    .from(messages)
    .innerJoin(recipients, eq(recipients.id, messages.recipientId))
    .leftJoin(senders, eq(senders.id, messages.senderId))
    .where(eq(messages.id, messageId));
  return row ?? null;
}

/** Put the address on the sending account's do-not-send list and cancel anything still waiting to go to it. */
export async function unsubscribeByToken(token: string): Promise<string | null> {
  const person = await recipientForToken(token);
  if (!person) return null;
  await db.insert(suppressions).values({ userId: person.userId, email: person.email, reason: "unsubscribed" }).onConflictDoNothing();
  await db.update(recipients).set({ status: "unsubscribed" }).where(eq(recipients.id, person.recipientId));
  await db
    .update(messages)
    .set({ status: "cancelled", error: "Unsubscribed", updatedAt: new Date() })
    .where(and(eq(messages.recipientId, person.recipientId), inArray(messages.status, ["queued"])));
  return person.email;
}
