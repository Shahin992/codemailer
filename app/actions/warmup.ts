"use server";

import { and, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaignSenders, senders, warmupMessages } from "@/lib/db/schema";
import { cancelPendingWarmup } from "@/lib/warmup/job";
import { resumedStart, WARMUP_LIMITS } from "@/lib/warmup/schedule";

export type WarmupFormState = { error?: string; message?: string; fieldErrors?: Record<string, string> };

/** One of the signed-in account's mailboxes. */
async function ownMailbox(id: string) {
  const me = await requireSession();
  const [sender] = await db.select().from(senders).where(and(eq(senders.id, id), eq(senders.userId, me.id)));
  return sender;
}

function refresh(id: string) {
  revalidatePath("/mailboxes");
  revalidatePath(`/mailboxes/${id}`);
}

export async function setWarmup(id: string, on: boolean, _prev: WarmupFormState): Promise<WarmupFormState> {
  const sender = await ownMailbox(id);
  if (!sender) return { error: "Mailbox not found." };
  const now = new Date();

  if (!on) {
    await db.update(senders).set({ warmupEnabled: false, warmupPausedAt: now }).where(eq(senders.id, id));
    await cancelPendingWarmup(id);
    refresh(id);
    return { message: "Warm-up is off. Emails it still had waiting were cancelled." };
  }

  if (!sender.readInbox || !sender.imapHost) {
    return { error: "Warm-up needs a mailbox whose inbox ColdMailer reads (IMAP), so it can find warm-up emails and reply." };
  }
  await db
    .update(senders)
    .set({
      warmupEnabled: true,
      // A break doesn't jump the ramp ahead: day 1 moves forward by the time warm-up was off.
      warmupStartedAt: resumedStart(sender.warmupStartedAt, sender.warmupPausedAt, now),
      warmupPausedAt: null,
      warmupPlannedOn: null, // plan today's emails at the next send job run
    })
    .where(eq(senders.id, id));
  const others = await db
    .select({ id: senders.id })
    .from(senders)
    .where(and(eq(senders.userId, sender.userId), eq(senders.warmupEnabled, true), ne(senders.id, id), ne(senders.email, sender.email)));
  refresh(id);
  if (!others.length) return { message: "Warm-up is on. It starts once another mailbox in this account has warm-up on too." };
  if (sender.warmupRole === "partner") return { message: "Warm-up is on. Your business mailboxes will start sending to it; it replies to what it gets." };
  return { message: "Warm-up is on. Today's first emails go out within the send window." };
}

const settingsSchema = z
  .object({
    warmupRole: z.enum(["sender", "partner"]),
    warmupStart: z.coerce.number().int().min(WARMUP_LIMITS.start.min).max(WARMUP_LIMITS.start.max),
    warmupIncrease: z.coerce.number().int().min(WARMUP_LIMITS.increase.min).max(WARMUP_LIMITS.increase.max),
    warmupMax: z.coerce.number().int().min(WARMUP_LIMITS.max.min).max(WARMUP_LIMITS.max.max),
    warmupReplyRate: z.coerce.number().int().min(WARMUP_LIMITS.replyRate.min).max(WARMUP_LIMITS.replyRate.max),
    warmupReceiveMax: z.coerce.number().int().min(WARMUP_LIMITS.receiveMax.min).max(WARMUP_LIMITS.receiveMax.max),
  })
  .refine((v) => v.warmupMax >= v.warmupStart, { path: ["warmupMax"], message: "At least the starting number" });

const LIMIT_KEYS: Record<string, keyof typeof WARMUP_LIMITS> = {
  warmupStart: "start",
  warmupIncrease: "increase",
  warmupMax: "max",
  warmupReplyRate: "replyRate",
  warmupReceiveMax: "receiveMax",
};

export async function saveWarmupSettings(id: string, _prev: WarmupFormState, formData: FormData): Promise<WarmupFormState> {
  const sender = await ownMailbox(id);
  if (!sender) return { error: "Mailbox not found." };
  const parsed = settingsSchema.safeParse({
    warmupRole: formData.get("warmupRole") ?? sender.warmupRole,
    warmupStart: formData.get("warmupStart"),
    warmupIncrease: formData.get("warmupIncrease"),
    warmupMax: formData.get("warmupMax"),
    warmupReplyRate: formData.get("warmupReplyRate"),
    warmupReceiveMax: formData.get("warmupReceiveMax"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      const limits = LIMIT_KEYS[key] ? WARMUP_LIMITS[LIMIT_KEYS[key]] : undefined;
      fieldErrors[key] ??= issue.code === "custom" ? issue.message : limits ? `A whole number from ${limits.min} to ${limits.max}` : issue.message;
    }
    return { error: "Please fix the highlighted fields.", fieldErrors };
  }
  const becomesPartner = parsed.data.warmupRole === "partner" && sender.warmupRole !== "partner";
  if (becomesPartner) {
    // A partner never sends campaigns, so a mailbox that campaigns already use can't become one.
    const [used] = await db.select({ id: campaignSenders.campaignId }).from(campaignSenders).where(eq(campaignSenders.senderId, id)).limit(1);
    if (used) {
      return {
        error: "This mailbox is used by a campaign, so it can't be a partner. Partners are for accounts that only answer warm-up emails, like your own Gmail accounts.",
        fieldErrors: { warmupRole: "Used by a campaign" },
      };
    }
  }
  await db.update(senders).set(parsed.data).where(eq(senders.id, id));
  if (becomesPartner) {
    // Partners only answer: drop the new emails it still had planned (its replies stay).
    await db
      .update(warmupMessages)
      .set({ status: "cancelled", error: "Became a partner mailbox; partners only reply.", updatedAt: new Date() })
      .where(and(eq(warmupMessages.senderId, id), eq(warmupMessages.status, "scheduled"), isNull(warmupMessages.parentId)));
  }
  refresh(id);
  return {
    message:
      parsed.data.warmupRole === "partner"
        ? "Saved. This mailbox only receives warm-up emails (up to the number you set each day) and replies to them."
        : "Saved. New numbers apply from the next day's plan; the reply rate applies straight away.",
  };
}
