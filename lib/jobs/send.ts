import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaignSenders,
  campaigns,
  messages,
  recipients,
  senders,
  suppressions,
  trackingLinks,
  type Campaign,
  type Message,
  type Sender,
  type Settings,
} from "@/lib/db/schema";
import { appUrl } from "@/lib/env";
import { makeToken } from "@/lib/crypto";
import { composeEmail } from "@/lib/mail/compose";
import { appendToSent, buildRawEmail, configFromSender, sendRawEmail } from "@/lib/mail/connection";
import { classifySmtpError, describeMailError } from "@/lib/mail/errors";
import { sentLast24h } from "@/lib/queries";
import { getSettings } from "@/lib/settings";
import { isInsideWindow, sendGapMs } from "@/lib/time-window";

const TIME_BUDGET_MS = 45_000; // the job runs every minute
const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = [5, 15, 45];
const STUCK_MINUTES = 10;

type Outcome = "sent" | "bounced" | "failed" | "retry" | "skipped";

/** A crash mid-send leaves rows in 'sending'. Don't resend them blindly: mark them for a person to check. */
async function recoverStuck() {
  await db
    .update(messages)
    .set({
      status: "failed",
      error: "Interrupted while sending. Check the mailbox's Sent folder before retrying.",
      updatedAt: new Date(),
    })
    .where(and(eq(messages.status, "sending"), lt(messages.updatedAt, sql`now() - make_interval(mins => ${STUCK_MINUTES}::int)`)));
}

async function readySenders(campaignId: string): Promise<Sender[]> {
  const rows = await db
    .select({ sender: senders })
    .from(senders)
    .innerJoin(campaignSenders, and(eq(campaignSenders.senderId, senders.id), eq(campaignSenders.campaignId, campaignId)))
    .where(and(eq(senders.status, "active"), lte(senders.nextSendAt, sql`now()`), sql`${sentLast24h} < ${senders.dailyLimit}`))
    .orderBy(asc(senders.nextSendAt));
  return rows.map((r) => r.sender);
}

/**
 * Mailboxes that may send an email with a set time right now. Unlike readySenders this ignores the
 * mailbox's turn (the person picked the time), but still respects pauses, rests and the daily limit.
 */
async function sendersForSetTimes(campaignId: string): Promise<Sender[]> {
  const rows = await db
    .select({ sender: senders })
    .from(senders)
    .innerJoin(campaignSenders, and(eq(campaignSenders.senderId, senders.id), eq(campaignSenders.campaignId, campaignId)))
    .where(
      and(
        eq(senders.status, "active"),
        or(isNull(senders.restUntil), lte(senders.restUntil, sql`now()`)),
        sql`${sentLast24h} < ${senders.dailyLimit}`,
      ),
    )
    .orderBy(asc(senders.nextSendAt));
  return rows.map((r) => r.sender);
}

/** Emails whose set time has come, oldest first. They go out inside or outside the send window. */
async function dueSetTimes(campaignId: string): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.campaignId, campaignId),
        eq(messages.status, "queued"),
        lte(messages.scheduledAt, sql`now()`),
        or(isNull(messages.nextAttemptAt), lte(messages.nextAttemptAt, sql`now()`)),
      ),
    )
    .orderBy(asc(messages.scheduledAt), asc(messages.createdAt))
    .limit(20);
}

async function nextMessageFor(campaignId: string, senderId: string): Promise<Message | undefined> {
  const [row] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.campaignId, campaignId),
        eq(messages.status, "queued"),
        isNull(messages.scheduledAt), // emails with a set time go out at that time instead
        or(isNull(messages.nextAttemptAt), lte(messages.nextAttemptAt, sql`now()`)),
        or(eq(messages.senderId, senderId), isNull(messages.senderId)),
      ),
    )
    // People already tied to this mailbox go first, then everyone else in list order.
    .orderBy(sql`${messages.senderId} is null`, asc(messages.createdAt))
    .limit(1);
  return row;
}

async function finishIfDone(campaign: Campaign) {
  const [left] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.campaignId, campaign.id), inArray(messages.status, ["queued", "sending"])));
  if (left.n === 0) {
    await db.update(campaigns).set({ status: "done", completedAt: new Date() }).where(eq(campaigns.id, campaign.id));
  }
}

async function threadFor(message: Message): Promise<{ subject: string; messageIds: string[] } | undefined> {
  if (!message.parentMessageId) return undefined;
  const ids: string[] = [];
  let subject = "";
  let cursor: string | null = message.parentMessageId;
  for (let depth = 0; cursor && depth < 10; depth++) {
    const [parent] = await db
      .select({ parentId: messages.parentMessageId, header: messages.messageIdHeader, subject: messages.subject })
      .from(messages)
      .where(eq(messages.id, cursor));
    if (!parent) break;
    if (parent.header) ids.unshift(parent.header);
    if (!subject && parent.subject) subject = parent.subject;
    cursor = parent.parentId;
  }
  return ids.length ? { subject, messageIds: ids } : undefined;
}

async function sendOne(campaign: Campaign, sender: Sender, message: Message, settings: Settings): Promise<Outcome> {
  const [recipient] = await db.select().from(recipients).where(eq(recipients.id, message.recipientId));
  const [suppressed] = await db.select().from(suppressions).where(eq(suppressions.email, recipient.email));
  if (suppressed || recipient.status === "bounced" || recipient.status === "unsubscribed") {
    await db
      .update(messages)
      .set({ status: "cancelled", error: "On the do-not-send list", updatedAt: new Date() })
      .where(eq(messages.id, message.id));
    return "skipped";
  }

  // Claim the message and move the mailbox to the back of the line before touching the network.
  const [claimed] = await db
    .update(messages)
    .set({ status: "sending", senderId: sender.id, attempts: sql`${messages.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(messages.id, message.id), eq(messages.status, "queued")))
    .returning();
  if (!claimed) return "skipped";
  // greatest(): an email with a set time can go out before the mailbox's turn; keep the later turn then.
  const nextTurn = new Date(Date.now() + sendGapMs(campaign, sender.dailyLimit)).toISOString();
  await db
    .update(senders)
    .set({ nextSendAt: sql`greatest(${senders.nextSendAt}, ${nextTurn}::timestamptz)` })
    .where(eq(senders.id, sender.id));

  const cfg = configFromSender(sender);
  try {
    if (campaign.trackClicks) await db.delete(trackingLinks).where(eq(trackingLinks.messageId, message.id));
    const token = makeToken(message.id, "track");
    const replyTo = sender.replyToSenderId
      ? (await db.select({ email: senders.email }).from(senders).where(eq(senders.id, sender.replyToSenderId)))[0]?.email
      : undefined;
    const composed = await composeEmail({
      style: campaign.style,
      bodyFormat: campaign.bodyFormat,
      optOutLine: settings.optOutLine,
      sender,
      recipient,
      replyTo,
      vars: message.vars,
      subjectTemplate: campaign.subject,
      bodyHtml: campaign.bodyHtml,
      bodyText: campaign.bodyText,
      footerText: settings.footerText,
      messageId: message.id,
      thread: await threadFor(message),
      trackOpens: campaign.style === "newsletter" && campaign.trackOpens,
      trackLink: campaign.style === "newsletter" && campaign.trackClicks
        ? async (url) => {
            const [link] = await db.insert(trackingLinks).values({ messageId: message.id, url }).returning({ id: trackingLinks.id });
            return `${appUrl()}/t/c/${token}/${link.id}`;
          }
        : undefined,
    });
    const raw = await buildRawEmail(composed.mail);
    await sendRawEmail(cfg, { from: sender.email, to: recipient.email }, raw);

    const now = new Date();
    await db
      .update(messages)
      .set({
        status: "sent",
        sentAt: now,
        subject: composed.subject,
        messageIdHeader: composed.messageIdHeader,
        error: null,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(messages.id, message.id));
    await db
      .update(recipients)
      .set({
        senderId: sql`coalesce(${recipients.senderId}, ${sender.id}::uuid)`,
        firstContactAt: sql`coalesce(${recipients.firstContactAt}, now())`,
        lastContactAt: now,
      })
      .where(eq(recipients.id, recipient.id));
    if (sender.lastError) await db.update(senders).set({ lastError: null, lastErrorAt: null }).where(eq(senders.id, sender.id));

    if (sender.saveToSent && sender.sentFolder) {
      await appendToSent(cfg, sender.sentFolder, raw).catch((err) =>
        console.error(`[send] could not save copy to Sent for ${sender.email}:`, describeMailError(err)),
      );
    }
    return "sent";
  } catch (err) {
    return handleSendError(err, sender, claimed, message.senderId);
  }
}

async function handleSendError(err: unknown, sender: Sender, message: Message, assignedSenderId: string | null): Promise<Outcome> {
  const kind = classifySmtpError(err);
  const detail = describeMailError(err);
  const now = new Date();
  // Requeue without counting the attempt when the problem is the mailbox, not the recipient.
  const requeue = { status: "queued" as const, senderId: assignedSenderId, attempts: message.attempts - 1, error: detail, updatedAt: now };

  switch (kind) {
    case "auth":
      await db.update(senders).set({ status: "paused", lastError: detail, lastErrorAt: now }).where(eq(senders.id, sender.id));
      await db.update(messages).set(requeue).where(eq(messages.id, message.id));
      return "retry";
    case "sender_limit":
    case "rate_limit": {
      const pauseHours = kind === "sender_limit" ? 24 : 1;
      const restUntil = new Date(now.getTime() + pauseHours * 3_600_000);
      await db
        .update(senders)
        .set({ nextSendAt: restUntil, restUntil, lastError: `Resting ${pauseHours}h: ${detail}`, lastErrorAt: now })
        .where(eq(senders.id, sender.id));
      await db.update(messages).set(requeue).where(eq(messages.id, message.id));
      return "retry";
    }
    case "recipient": {
      await db.update(messages).set({ status: "bounced", bouncedAt: now, error: detail, updatedAt: now }).where(eq(messages.id, message.id));
      const [recipient] = await db
        .update(recipients)
        .set({ status: "bounced" })
        .where(eq(recipients.id, message.recipientId))
        .returning({ email: recipients.email });
      if (recipient) await db.insert(suppressions).values({ email: recipient.email, reason: "bounced" }).onConflictDoNothing();
      return "bounced";
    }
    case "rejected":
      await db.update(messages).set({ status: "failed", error: detail, updatedAt: now }).where(eq(messages.id, message.id));
      return "failed";
    default: {
      if (message.attempts >= MAX_ATTEMPTS) {
        await db.update(messages).set({ status: "failed", error: detail, updatedAt: now }).where(eq(messages.id, message.id));
        return "failed";
      }
      const wait = RETRY_MINUTES[Math.min(message.attempts - 1, RETRY_MINUTES.length - 1)];
      await db
        .update(messages)
        .set({ status: "queued", senderId: assignedSenderId, error: detail, nextAttemptAt: new Date(now.getTime() + wait * 60_000), updatedAt: now })
        .where(eq(messages.id, message.id));
      return "retry";
    }
  }
}

/**
 * Try to send one email for a campaign. Emails whose set time has come go first, at any hour.
 * Otherwise, inside the send window, the mailbox that has waited longest sends the next automatic one.
 */
async function sendNext(campaign: Campaign, settings: Settings): Promise<Outcome | "idle"> {
  const due = await dueSetTimes(campaign.id);
  if (due.length) {
    const available = await sendersForSetTimes(campaign.id);
    for (const message of due) {
      // Someone tied to a mailbox waits for that one; anyone else takes the mailbox that has waited longest.
      const sender = message.senderId ? available.find((s) => s.id === message.senderId) : available[0];
      if (sender) return sendOne(campaign, sender, message, settings);
    }
  }
  if (isInsideWindow(new Date(), campaign)) {
    for (const sender of await readySenders(campaign.id)) {
      const message = await nextMessageFor(campaign.id, sender.id);
      if (message) return sendOne(campaign, sender, message, settings);
    }
  }
  await finishIfDone(campaign);
  return "idle";
}

export async function runSendJob(): Promise<string> {
  const started = Date.now();
  await recoverStuck();
  const settings = await getSettings();
  const counts: Record<Outcome, number> = { sent: 0, bounced: 0, failed: 0, retry: 0, skipped: 0 };

  let progressed = true;
  while (progressed && Date.now() - started < TIME_BUDGET_MS) {
    progressed = false;
    const active = await db.select().from(campaigns).where(eq(campaigns.status, "active")).orderBy(asc(campaigns.createdAt));
    for (const campaign of active) {
      if (Date.now() - started >= TIME_BUDGET_MS) break;
      const outcome = await sendNext(campaign, settings);
      if (outcome !== "idle") {
        counts[outcome]++;
        progressed = true;
      }
    }
  }

  return `sent ${counts.sent}, bounced ${counts.bounced}, failed ${counts.failed}, retrying ${counts.retry}, skipped ${counts.skipped}`;
}
