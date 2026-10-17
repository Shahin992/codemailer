import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { convert as htmlToText } from "html-to-text";
import { z } from "zod";
import { db } from "@/lib/db";
import { campaignSenders, campaigns, messages, recipients, senders, suppressions } from "@/lib/db/schema";
import { textToHtml } from "@/lib/merge";
import { checkRecipients, type ParsedRecipient } from "@/lib/recipients-parse";
import { getSettings } from "@/lib/settings";
import { estimateSendingDays, isValidHm, isValidTimeZone } from "@/lib/time-window";

const hm = z.string().refine(isValidHm, "Use HH:MM, for example 09:00");
const dateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Use a date and time like 2026-10-20T09:30:00+06:00");
const MAX_AHEAD_MS = 366 * 24 * 60 * 60_000;

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name").max(200),
  subject: z.string().trim().max(300).optional(),
  body: z.string().max(200_000).optional(),
  bodyFormat: z.enum(["text", "html"]).optional(),
  bodyHtml: z.string().max(200_000).optional(),
  bodyText: z.string().max(200_000).optional(),
  senderIds: z.array(z.string()).optional(),
  senderEmails: z.array(z.string()).optional(),
  recipients: z
    .array(
      z.union([
        z.string(),
        z.object({
          email: z.string(),
          name: z.string().optional(),
          vars: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
          sendAt: dateTime.optional(),
        }),
      ]),
    )
    .max(200_000, "Up to 200,000 recipients per campaign")
    .optional(),
  // Set times instead of automatic spacing: the first email at startAt, then one every everyMinutes.
  // A recipient's own sendAt wins over this.
  schedule: z.object({ startAt: dateTime, everyMinutes: z.number().min(0).max(10_080) }).optional(),
  followUpOf: z.string().uuid().nullable().optional(),
  style: z.enum(["personal", "newsletter"]).optional(),
  trackOpens: z.boolean().optional(),
  trackClicks: z.boolean().optional(),
  windowStart: hm.optional(),
  windowEnd: hm.optional(),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
  weekdaysOnly: z.boolean().optional(),
});

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export type CreateCampaignResult = {
  campaignId: string;
  accepted: number;
  duplicates: number;
  rejected: { email: string; reason: "invalid" | "do_not_send" }[];
  estimatedDays: number;
};

export class CampaignError extends Error {}

function resolveBody(input: CampaignInput): { bodyFormat: "text" | "html"; bodyHtml: string; bodyText: string } {
  if (input.body !== undefined) {
    const format = input.bodyFormat ?? "text";
    const body = input.body.trim();
    if (!body) throw new CampaignError("Write the email body");
    return format === "html"
      ? { bodyFormat: "html", bodyHtml: body, bodyText: htmlToText(body, { wordwrap: false }) }
      : { bodyFormat: "text", bodyHtml: textToHtml(body), bodyText: body };
  }
  if (input.bodyHtml?.trim()) {
    const html = input.bodyHtml.trim();
    return { bodyFormat: "html", bodyHtml: html, bodyText: input.bodyText?.trim() || htmlToText(html, { wordwrap: false }) };
  }
  if (input.bodyText?.trim()) return { bodyFormat: "text", bodyHtml: textToHtml(input.bodyText.trim()), bodyText: input.bodyText.trim() };
  throw new CampaignError("Write the email body");
}

async function resolveSenders(input: CampaignInput) {
  const conditions = [];
  if (input.senderIds?.length) conditions.push(inArray(senders.id, input.senderIds));
  if (input.senderEmails?.length) conditions.push(inArray(senders.email, input.senderEmails.map((e) => e.trim().toLowerCase())));
  const rows = conditions.length
    ? await db.select().from(senders).where(sql.join(conditions, sql` or `))
    : [];
  if (!rows.length) throw new CampaignError("Choose at least one mailbox to send from");
  return rows;
}

function toParsed(list: NonNullable<CampaignInput["recipients"]>): ParsedRecipient[] {
  return list.map((item) =>
    typeof item === "string"
      ? { email: item }
      : {
          email: item.email,
          name: item.name,
          vars: item.vars ? Object.fromEntries(Object.entries(item.vars).map(([k, v]) => [k, String(v)])) : undefined,
          sendAt: item.sendAt,
        },
  );
}

/**
 * Send time for the email at position `index`: the recipient's own time, else the schedule's
 * start plus `index` gaps, else null (automatic).
 */
function sendTimes(schedule: CampaignInput["schedule"]) {
  const start = schedule ? Date.parse(schedule.startAt) : null;
  const every = (schedule?.everyMinutes ?? 0) * 60_000;
  return (index: number, own?: string): Date | null => {
    const at = own ? new Date(own) : start === null ? null : new Date(start + index * every);
    if (at && at.getTime() - Date.now() > MAX_AHEAD_MS) throw new CampaignError("Send times can be at most a year ahead");
    return at;
  };
}

async function suppressedSet(emails: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < emails.length; i += 1000) {
    const chunk = emails.slice(i, i + 1000);
    const rows = await db.select({ email: suppressions.email }).from(suppressions).where(inArray(suppressions.email, chunk));
    rows.forEach((r) => found.add(r.email));
  }
  return found;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Rejected = CreateCampaignResult["rejected"];

/** The valid, not-blocked people in a list, and who was left out. */
async function screenRecipients(list: NonNullable<CampaignInput["recipients"]>) {
  const { valid, invalid, duplicates } = checkRecipients(toParsed(list));
  const blocked = await suppressedSet(valid.map((r) => r.email));
  const accepted = valid.filter((r) => !blocked.has(r.email));
  const rejected: Rejected = [
    ...invalid.map((email) => ({ email, reason: "invalid" as const })),
    ...valid.filter((r) => blocked.has(r.email)).map((r) => ({ email: r.email, reason: "do_not_send" as const })),
  ];
  return { accepted, rejected, duplicates };
}

/**
 * Save the people and queue one email each. With `skipExisting`, anyone who already has an email in this
 * campaign is left out (a list uploaded in batches). Returns how many emails were queued.
 */
async function queueRecipients(
  tx: Tx,
  campaignId: string,
  people: ParsedRecipient[],
  times: (Date | null)[],
  chosenIds: Set<string>,
  skipExisting: boolean,
): Promise<number> {
  let queued = 0;
  for (let i = 0; i < people.length; i += 1000) {
    const chunk = people.slice(i, i + 1000);
    const saved = await tx
      .insert(recipients)
      .values(chunk.map((r) => ({ email: r.email, name: r.name ?? null })))
      .onConflictDoUpdate({
        target: recipients.email,
        set: { name: sql`coalesce(excluded.name, ${recipients.name})` },
      })
      .returning({ id: recipients.id, email: recipients.email, senderId: recipients.senderId });
    const byEmail = new Map(saved.map((p) => [p.email, p]));
    const already = skipExisting
      ? new Set(
          (
            await tx
              .select({ id: messages.recipientId })
              .from(messages)
              .where(and(eq(messages.campaignId, campaignId), inArray(messages.recipientId, saved.map((p) => p.id))))
          ).map((m) => m.id),
        )
      : new Set<string>();
    const rows = chunk
      .map((r, j) => {
        const person = byEmail.get(r.email)!;
        return {
          campaignId,
          recipientId: person.id,
          // Someone already emailed by one of the chosen mailboxes keeps that mailbox.
          senderId: person.senderId && chosenIds.has(person.senderId) ? person.senderId : null,
          vars: { ...(r.vars ?? {}), ...(r.name ? { name: r.name } : {}) },
          scheduledAt: times[i + j],
        };
      })
      .filter((row) => !already.has(row.recipientId));
    if (rows.length) await tx.insert(messages).values(rows);
    queued += rows.length;
  }
  return queued;
}

/**
 * Create a campaign and queue its emails. With `draft`, the campaign waits (nothing sends) until the rest of
 * a large list has been added with addCampaignRecipients(…, finish = true).
 */
export async function createCampaign(
  input: CampaignInput,
  source: "ui" | "api",
  createdBy?: string,
  { draft = false }: { draft?: boolean } = {},
): Promise<CreateCampaignResult> {
  if (input.followUpOf) return createFollowUp(input, input.followUpOf, source, createdBy);

  const settings = await getSettings();
  const subject = input.subject?.trim();
  if (!subject) throw new CampaignError("Write a subject");
  const body = resolveBody(input);
  const chosen = await resolveSenders(input);

  const { accepted, rejected, duplicates } = await screenRecipients(input.recipients ?? []);
  if (!accepted.length && !draft) throw new CampaignError("No valid recipients to send to");
  const timeFor = sendTimes(input.schedule);
  const times = accepted.map((r, i) => timeFor(i, r.sendAt));

  const chosenIds = new Set(chosen.map((s) => s.id));

  const campaignId = await db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        name: input.name,
        subject,
        ...body,
        status: draft ? "draft" : "active",
        style: input.style ?? "personal",
        // Tracking needs HTML, which personal-style emails don't have.
        trackOpens: (input.style ?? "personal") === "newsletter" && (input.trackOpens ?? false),
        trackClicks: (input.style ?? "personal") === "newsletter" && (input.trackClicks ?? false),
        windowStart: input.windowStart ?? settings.windowStart,
        windowEnd: input.windowEnd ?? settings.windowEnd,
        timezone: input.timezone ?? settings.timezone,
        weekdaysOnly: input.weekdaysOnly ?? settings.weekdaysOnly,
        totalRecipients: accepted.length,
        source,
        createdBy: createdBy ?? null,
      })
      .returning({ id: campaigns.id });
    await tx.insert(campaignSenders).values(chosen.map((s) => ({ campaignId: campaign.id, senderId: s.id })));
    await queueRecipients(tx, campaign.id, accepted, times, chosenIds, false);
    return campaign.id;
  });

  const capacity = chosen.filter((s) => s.status === "active").reduce((sum, s) => sum + s.dailyLimit, 0);
  return { campaignId, accepted: accepted.length, duplicates, rejected, estimatedDays: estimateSendingDays(accepted.length, capacity) };
}

export const MAX_RECIPIENTS = 200_000;

export type AddRecipientsResult = { accepted: number; duplicates: number; skipped: number; total: number; estimatedDays?: number };

/**
 * Add the next part of a large list to a draft campaign. With `finish`, the campaign starts sending.
 * People already in the campaign are skipped, so sending a part twice does no harm.
 */
export async function addCampaignRecipients(campaignId: string, list: NonNullable<CampaignInput["recipients"]>, finish: boolean): Promise<AddRecipientsResult> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign || campaign.status !== "draft") throw new CampaignError("This campaign isn't waiting for more recipients.");
  const { accepted, rejected, duplicates } = await screenRecipients(list);
  if (campaign.totalRecipients + accepted.length > MAX_RECIPIENTS) throw new CampaignError(`Up to ${MAX_RECIPIENTS.toLocaleString("en-US")} recipients per campaign`);
  const timeFor = sendTimes(undefined);
  const times = accepted.map((r, i) => timeFor(i, r.sendAt));
  const chosen = await db
    .select({ id: senders.id, status: senders.status, dailyLimit: senders.dailyLimit })
    .from(campaignSenders)
    .innerJoin(senders, eq(senders.id, campaignSenders.senderId))
    .where(eq(campaignSenders.campaignId, campaignId));

  const added = await db.transaction(async (tx) => {
    const queued = await queueRecipients(tx, campaignId, accepted, times, new Set(chosen.map((s) => s.id)), true);
    const [row] = await tx
      .update(campaigns)
      .set({ totalRecipients: sql`${campaigns.totalRecipients} + ${queued}` })
      .where(eq(campaigns.id, campaignId))
      .returning({ total: campaigns.totalRecipients });
    return { queued, total: row.total };
  });

  if (finish) {
    if (added.total === 0) {
      await db.delete(campaigns).where(eq(campaigns.id, campaignId));
      throw new CampaignError("No valid recipients to send to");
    }
    await db.update(campaigns).set({ status: "active" }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "draft")));
  }
  const capacity = chosen.filter((s) => s.status === "active").reduce((sum, s) => sum + s.dailyLimit, 0);
  return {
    accepted: added.queued,
    duplicates: duplicates + (accepted.length - added.queued),
    skipped: rejected.length,
    total: added.total,
    ...(finish ? { estimatedDays: estimateSendingDays(added.total, capacity) } : {}),
  };
}

/** Follow-up: reply in the same thread, from the same mailbox, to everyone who has not replied, bounced or unsubscribed. */
async function createFollowUp(input: CampaignInput, originalId: string, source: "ui" | "api", createdBy?: string): Promise<CreateCampaignResult> {
  const [original] = await db.select().from(campaigns).where(eq(campaigns.id, originalId));
  if (!original) throw new CampaignError("The campaign to follow up was not found");
  const body = resolveBody(input);

  const targets = await db
    .select({ id: messages.id, recipientId: messages.recipientId, senderId: messages.senderId })
    .from(messages)
    .innerJoin(recipients, eq(recipients.id, messages.recipientId))
    .where(
      and(
        eq(messages.campaignId, originalId),
        eq(messages.status, "sent"),
        eq(recipients.status, "active"),
        sql`not exists (select 1 from ${suppressions} s where s.email = ${recipients.email})`,
      ),
    )
    // Same order as the first emails went out, so set times follow that order too.
    .orderBy(asc(messages.sentAt), asc(messages.id));
  if (!targets.length) throw new CampaignError("Nobody left to follow up: everyone replied, bounced, unsubscribed or has not been sent yet");
  const timeFor = sendTimes(input.schedule);
  const times = targets.map((_, i) => timeFor(i));

  const senderIds = [...new Set(targets.map((t) => t.senderId).filter((id): id is string => Boolean(id)))];
  const campaignId = await db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        name: input.name,
        subject: `Re: ${original.subject}`,
        ...body,
        followUpOf: originalId,
        style: input.style ?? original.style,
        trackOpens: (input.style ?? original.style) === "newsletter" && (input.trackOpens ?? original.trackOpens),
        trackClicks: (input.style ?? original.style) === "newsletter" && (input.trackClicks ?? original.trackClicks),
        windowStart: input.windowStart ?? original.windowStart,
        windowEnd: input.windowEnd ?? original.windowEnd,
        timezone: input.timezone ?? original.timezone,
        weekdaysOnly: input.weekdaysOnly ?? original.weekdaysOnly,
        totalRecipients: targets.length,
        source,
        createdBy: createdBy ?? null,
      })
      .returning({ id: campaigns.id });
    if (senderIds.length) await tx.insert(campaignSenders).values(senderIds.map((senderId) => ({ campaignId: campaign.id, senderId })));
    const varsSource = await tx.select({ id: messages.id, vars: messages.vars }).from(messages).where(eq(messages.campaignId, originalId));
    const varsById = new Map(varsSource.map((m) => [m.id, m.vars]));
    for (let i = 0; i < targets.length; i += 500) {
      await tx.insert(messages).values(
        targets.slice(i, i + 500).map((t, j) => ({
          campaignId: campaign.id,
          recipientId: t.recipientId,
          senderId: t.senderId,
          parentMessageId: t.id,
          vars: varsById.get(t.id) ?? null,
          scheduledAt: times[i + j],
        })),
      );
    }
    return campaign.id;
  });

  const chosen = senderIds.length ? await db.select().from(senders).where(inArray(senders.id, senderIds)) : [];
  const capacity = chosen.filter((s) => s.status === "active").reduce((sum, s) => sum + s.dailyLimit, 0);
  return { campaignId, accepted: targets.length, duplicates: 0, rejected: [], estimatedDays: estimateSendingDays(targets.length, capacity) };
}

export type CampaignCounts = Record<"total" | "queued" | "sending" | "sent" | "sentNoReply" | "bounced" | "replied" | "failed" | "cancelled" | "opened" | "clicked", number>;

export async function campaignCounts(campaignIds: string[]): Promise<Map<string, CampaignCounts>> {
  const result = new Map<string, CampaignCounts>();
  if (!campaignIds.length) return result;
  const rows = await db
    .select({
      campaignId: messages.campaignId,
      total: sql<number>`count(*)::int`,
      queued: sql<number>`count(*) filter (where ${messages.status} = 'queued')::int`,
      sending: sql<number>`count(*) filter (where ${messages.status} = 'sending')::int`,
      sent: sql<number>`count(*) filter (where ${messages.sentAt} is not null)::int`,
      sentNoReply: sql<number>`count(*) filter (where ${messages.status} = 'sent')::int`,
      bounced: sql<number>`count(*) filter (where ${messages.status} = 'bounced')::int`,
      replied: sql<number>`count(*) filter (where ${messages.status} = 'replied')::int`,
      failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
      cancelled: sql<number>`count(*) filter (where ${messages.status} = 'cancelled')::int`,
      opened: sql<number>`count(*) filter (where ${messages.openCount} > 0)::int`,
      clicked: sql<number>`count(*) filter (where ${messages.clickCount} > 0)::int`,
    })
    .from(messages)
    .where(inArray(messages.campaignId, campaignIds))
    .groupBy(messages.campaignId);
  for (const { campaignId, ...counts } of rows) result.set(campaignId, counts);
  return result;
}

export const EMPTY_COUNTS: CampaignCounts = {
  total: 0, queued: 0, sending: 0, sent: 0, sentNoReply: 0, bounced: 0, replied: 0, failed: 0, cancelled: 0, opened: 0, clicked: 0,
};
