import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CampaignError, campaignInputSchema, createCampaign } from "@/lib/campaigns";

// Dashboard campaign creation. A route handler (not a server action) so large CSV lists fit.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = campaignInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign" }, { status: 400 });
  }
  try {
    return NextResponse.json(await createCampaign(parsed.data, "ui", session.id), { status: 201 });
  } catch (err) {
    if (err instanceof CampaignError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
