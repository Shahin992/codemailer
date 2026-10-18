import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateApi } from "@/lib/api";
import { db } from "@/lib/db";
import { campaigns, messages, recipients, replies, senders } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/recipients-parse";

/** Everything about one person: their mailbox, every email, and their replies. */
export async function GET(request: Request) {
  const caller = await authenticateApi(request);
  if (caller instanceof NextResponse) return caller;
  const email = normalizeEmail(new URL(request.url).searchParams.get("email") ?? "");
  if (!email) return NextResponse.json({ error: "Pass ?email=" }, { status: 400 });

  const [person] = await db
    .select({ id: recipients.id, email: recipients.email, name: recipients.name, status: recipients.status, mailbox: senders.email, first_contact_at: recipients.firstContactAt, last_contact_at: recipients.lastContactAt })
    .from(recipients)
    .leftJoin(senders, eq(senders.id, recipients.senderId))
    .where(and(eq(recipients.userId, caller.userId), eq(recipients.email, email)));
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [history, theirReplies] = await Promise.all([
    db
      .select({
        message_id: messages.id,
        campaign_id: campaigns.id,
        campaign: campaigns.name,
        mailbox: senders.email,
        subject: messages.subject,
        status: messages.status,
        sent_at: messages.sentAt,
        replied_at: messages.repliedAt,
        bounced_at: messages.bouncedAt,
        open_count: messages.openCount,
        click_count: messages.clickCount,
      })
      .from(messages)
      .innerJoin(campaigns, eq(campaigns.id, messages.campaignId))
      .leftJoin(senders, eq(senders.id, messages.senderId))
      .where(eq(messages.recipientId, person.id))
      .orderBy(asc(messages.createdAt)),
    db
      .select({ id: replies.id, message_id: replies.messageId, reply_text: replies.replyText, is_auto_reply: replies.isAutoReply, received_at: replies.receivedAt })
      .from(replies)
      .where(eq(replies.recipientId, person.id))
      .orderBy(asc(replies.receivedAt)),
  ]);

  const { id: _id, ...publicPerson } = person;
  return NextResponse.json({ recipient: publicPerson, messages: history, replies: theirReplies });
}
