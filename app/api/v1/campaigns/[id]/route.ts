import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateApi, isUuid } from "@/lib/api";
import { campaignCounts, EMPTY_COUNTS } from "@/lib/campaigns";
import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await authenticateApi(request);
  if (caller instanceof NextResponse) return caller;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const counts = (await campaignCounts([id])).get(id) ?? EMPTY_COUNTS;
  return NextResponse.json({
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    status: campaign.status,
    follow_up_of: campaign.followUpOf,
    created_at: campaign.createdAt,
    completed_at: campaign.completedAt,
    counts: {
      total: counts.total,
      queued: counts.queued,
      sent: counts.sent,
      replied: counts.replied,
      bounced: counts.bounced,
      failed: counts.failed,
      cancelled: counts.cancelled,
      opened: counts.opened,
      clicked: counts.clicked,
    },
  });
}
