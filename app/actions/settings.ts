"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { recipients, settings, suppressions } from "@/lib/db/schema";
import { checkRecipients, parseTypedList } from "@/lib/recipients-parse";
import { getSettings } from "@/lib/settings";
import { isValidHm, isValidTimeZone } from "@/lib/time-window";
import { replanWarmupForWindow } from "@/lib/warmup/job";
import { LOGO_MAX_WIDTH, LOGO_MIN_WIDTH } from "@/lib/brand-logo";

export type FormState = { error?: string; message?: string };

const settingsSchema = z.object({
  footerText: z.string().max(1000),
  optOutLine: z.string().trim().max(300),
  windowStart: z.string().refine(isValidHm, "Use HH:MM"),
  windowEnd: z.string().refine(isValidHm, "Use HH:MM"),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
  weekdaysOnly: z.boolean(),
  testEmail: z.string().trim().max(254),
  logoDisplayWidth: z.number().int(`Logo width: use ${LOGO_MIN_WIDTH} to ${LOGO_MAX_WIDTH} pixels`).min(LOGO_MIN_WIDTH, `Logo width: use ${LOGO_MIN_WIDTH} to ${LOGO_MAX_WIDTH} pixels`).max(LOGO_MAX_WIDTH, `Logo width: use ${LOGO_MIN_WIDTH} to ${LOGO_MAX_WIDTH} pixels`),
  logoInPersonal: z.boolean(),
});

export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireSession();
  const parsed = settingsSchema.safeParse({
    footerText: String(formData.get("footerText") ?? ""),
    optOutLine: String(formData.get("optOutLine") ?? ""),
    windowStart: String(formData.get("windowStart") ?? ""),
    windowEnd: String(formData.get("windowEnd") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    weekdaysOnly: formData.get("weekdaysOnly") === "on",
    testEmail: String(formData.get("testEmail") ?? ""),
    logoDisplayWidth: Number(formData.get("logoDisplayWidth") ?? 160),
    logoInPersonal: formData.get("logoInPersonal") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields" };
  const before = await getSettings(me.id);
  const [after] = await db
    .update(settings)
    .set({ ...parsed.data, testEmail: parsed.data.testEmail || null, updatedAt: new Date() })
    .where(eq(settings.userId, me.id))
    .returning();
  revalidatePath("/settings");
  // The window also times warm-up: a change applies today, not from tomorrow's plan.
  const d = parsed.data;
  if (after && (before.windowStart !== d.windowStart || before.windowEnd !== d.windowEnd || before.timezone !== d.timezone || before.weekdaysOnly !== d.weekdaysOnly)) {
    await replanWarmupForWindow(me.id, after);
    revalidatePath("/warmup");
    return {
      message: d.weekdaysOnly
        ? "Settings saved. Warm-up follows the new send window from now on."
        : "Settings saved. Warm-up now also runs on weekends, starting with today's window. Running campaigns keep their own days: change them on each campaign's page.",
    };
  }
  return { message: "Settings saved." };
}

export async function addSuppressions(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireSession();
  const { valid, invalid } = checkRecipients(parseTypedList(String(formData.get("emails") ?? "")));
  if (!valid.length) return { error: invalid.length ? `Not valid: ${invalid.slice(0, 5).join(", ")}` : "Enter at least one email address." };
  const emails = valid.map((r) => r.email);
  await db
    .insert(suppressions)
    .values(emails.map((email) => ({ userId: me.id, email, reason: "manual" as const })))
    .onConflictDoNothing();
  await db
    .update(recipients)
    .set({ status: "unsubscribed" })
    .where(and(eq(recipients.userId, me.id), inArray(recipients.email, emails), eq(recipients.status, "active")));
  revalidatePath("/suppressions");
  return { message: `Added ${emails.length} address${emails.length === 1 ? "" : "es"}.${invalid.length ? ` Skipped ${invalid.length} invalid.` : ""}` };
}

/** Only addresses added by hand can be removed; bounces and unsubscribes stay as proof. */
export async function removeSuppression(email: string) {
  const me = await requireSession();
  const removed = await db
    .delete(suppressions)
    .where(and(eq(suppressions.userId, me.id), eq(suppressions.email, email), eq(suppressions.reason, "manual")))
    .returning({ email: suppressions.email });
  if (removed.length) {
    await db
      .update(recipients)
      .set({ status: "active" })
      .where(and(eq(recipients.userId, me.id), eq(recipients.email, email), eq(recipients.status, "unsubscribed")));
  }
  revalidatePath("/suppressions");
}
