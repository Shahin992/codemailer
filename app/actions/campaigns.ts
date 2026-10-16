"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaigns, messages } from "@/lib/db/schema";

function refresh(id: string) {
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/");
}

export async function setCampaignStatus(id: string, status: "active" | "paused") {
  await requireSession();
  await db
    .update(campaigns)
    .set({ status })
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, ["active", "paused"])));
  refresh(id);
}

export async function cancelCampaign(id: string) {
  await requireSession();
  await db.transaction(async (tx) => {
    await tx
      .update(messages)
      .set({ status: "cancelled", error: "Campaign cancelled", updatedAt: new Date() })
      .where(and(eq(messages.campaignId, id), eq(messages.status, "queued")));
    await tx.update(campaigns).set({ status: "cancelled", completedAt: new Date() }).where(eq(campaigns.id, id));
  });
  refresh(id);
}

/**
 * Set one waiting email's send time (ISO date-time), or null to hand it back to automatic timing.
 * A set time goes out at that time, inside or outside the send window (daily limits still apply).
 */
export async function setEmailSendTime(messageId: string, sendAt: string | null): Promise<{ error?: string }> {
  await requireSession();
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return { error: "Email not found" };
  let at: Date | null = null;
  if (sendAt !== null) {
    at = new Date(sendAt);
    if (Number.isNaN(at.getTime())) return { error: "Pick a valid date and time." };
    if (at.getTime() < Date.now() - 5 * 60_000) return { error: "That time has already passed. Pick a later time, or use Send now." };
    if (at.getTime() - Date.now() > 366 * 24 * 60 * 60_000) return { error: "Pick a time within the next year." };
  }
  const [row] = await db
    .update(messages)
    // A chosen time also replaces any retry wait.
    .set({ scheduledAt: at, ...(at ? { nextAttemptAt: null } : {}), updatedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.status, "queued")))
    .returning({ campaignId: messages.campaignId });
  if (!row) return { error: "This email isn't waiting any more: it was sent or cancelled." };
  refresh(row.campaignId);
  revalidatePath("/recipients");
  return {};
}

/** Put failed emails back in the queue (for example after fixing a mailbox). */
export async function retryFailed(id: string) {
  await requireSession();
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(messages)
      .set({ status: "queued", attempts: 0, nextAttemptAt: null, error: null, updatedAt: new Date() })
      .where(and(eq(messages.campaignId, id), eq(messages.status, "failed")))
      .returning({ id: messages.id });
    if (rows.length) {
      await tx
        .update(campaigns)
        .set({ status: "active", completedAt: null })
        .where(and(eq(campaigns.id, id), inArray(campaigns.status, ["done", "active", "paused"])));
    }
  });
  refresh(id);
}
