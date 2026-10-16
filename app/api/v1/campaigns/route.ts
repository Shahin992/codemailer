import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateApi } from "@/lib/api";
import { CampaignError, campaignCounts, campaignInputSchema, createCampaign, EMPTY_COUNTS } from "@/lib/campaigns";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { apiPagination, clampPage, pageInfo, readApiPage } from "@/lib/pagination";

const STATUSES = ["active", "paused", "done", "cancelled"] as const;

/** List campaigns, newest first. ?status=active&q=text&page=1&page_size=50 */
export async function GET(request: Request) {
  const caller = await authenticateApi(request);
  if (caller instanceof NextResponse) return caller;
  const url = new URL(request.url);
  const status = STATUSES.find((s) => s === url.searchParams.get("status"));
  const q = (url.searchParams.get("q") ?? "").trim();
  const where = and(
    status ? eq(campaigns.status, status) : undefined,
    q ? or(ilike(campaigns.name, `%${q}%`), ilike(campaigns.subject, `%${q}%`)) : undefined,
  );
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(campaigns).where(where);
  const paging = clampPage(readApiPage(url), total);
  const rows = await db.select().from(campaigns).where(where).orderBy(desc(campaigns.createdAt), desc(campaigns.id)).limit(paging.pageSize).offset(paging.offset);
  const counts = await campaignCounts(rows.map((c) => c.id));
  return NextResponse.json({
    campaigns: rows.map((c) => {
      const n = counts.get(c.id) ?? EMPTY_COUNTS;
      return {
        id: c.id,
        name: c.name,
        subject: c.subject,
        status: c.status,
        follow_up_of: c.followUpOf,
        created_at: c.createdAt,
        completed_at: c.completedAt,
        counts: { total: n.total, queued: n.queued, sent: n.sent, replied: n.replied, bounced: n.bounced, failed: n.failed },
      };
    }),
    pagination: apiPagination(pageInfo(paging, total, rows.length)),
  });
}

/**
 * Create a campaign. Accepts snake_case (as in the docs) or camelCase fields:
 * name, recipients, subject, body_text / body_html, senders (emails) or sender_ids,
 * follow_up_of, track_opens, track_clicks, send_window {start, end, timezone, weekdays_only},
 * schedule {start_at, every_minutes}, and send_at on a recipient object for set send times.
 */
export async function POST(request: Request) {
  const caller = await authenticateApi(request);
  if (caller instanceof NextResponse) return caller;
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) return NextResponse.json({ error: "Send a JSON body" }, { status: 400 });

  const window = (raw.send_window ?? {}) as Record<string, unknown>;
  const schedule = raw.schedule && typeof raw.schedule === "object" ? (raw.schedule as Record<string, unknown>) : null;
  const recipientList = Array.isArray(raw.recipients)
    ? raw.recipients.map((r) => (r && typeof r === "object" && "send_at" in r ? { ...r, sendAt: (r as Record<string, unknown>).send_at } : r))
    : raw.recipients;
  const input = {
    name: raw.name,
    subject: raw.subject,
    body: raw.body,
    bodyFormat: raw.body_format ?? raw.bodyFormat,
    bodyHtml: raw.body_html ?? raw.bodyHtml,
    bodyText: raw.body_text ?? raw.bodyText,
    senderIds: raw.sender_ids ?? raw.senderIds,
    senderEmails: raw.senders ?? raw.senderEmails,
    recipients: recipientList,
    schedule: schedule ? { startAt: schedule.start_at ?? schedule.startAt, everyMinutes: schedule.every_minutes ?? schedule.everyMinutes ?? 0 } : undefined,
    followUpOf: raw.follow_up_of ?? raw.followUpOf,
    style: raw.style,
    trackOpens: raw.track_opens ?? raw.trackOpens,
    trackClicks: raw.track_clicks ?? raw.trackClicks,
    windowStart: window.start ?? raw.windowStart,
    windowEnd: window.end ?? raw.windowEnd,
    timezone: window.timezone ?? raw.timezone,
    weekdaysOnly: window.weekdays_only ?? raw.weekdaysOnly,
  };
  const parsed = campaignInputSchema.safeParse(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Name fields the way API callers write them (send_at, start_at, every_minutes).
    const field = issue?.path.map((p) => String(p).replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)).join(".");
    return NextResponse.json({ error: `${field || "body"}: ${issue?.message}` }, { status: 400 });
  }
  if (!parsed.data.followUpOf && !parsed.data.senderIds?.length && !parsed.data.senderEmails?.length) {
    return NextResponse.json({ error: "senders: list the mailbox emails to send from (GET /api/v1/senders)" }, { status: 400 });
  }
  try {
    const result = await createCampaign(parsed.data, "api", caller.userId ?? undefined);
    return NextResponse.json(
      {
        campaign_id: result.campaignId,
        accepted: result.accepted,
        duplicates: result.duplicates,
        rejected: result.rejected,
        estimated_days: Number.isFinite(result.estimatedDays) ? result.estimatedDays : null,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof CampaignError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
