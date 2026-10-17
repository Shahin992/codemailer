import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CampaignError, campaignInputSchema, createCampaign } from "@/lib/campaigns";

// Dashboard campaign creation. A route handler (not a server action) so large CSV lists fit.
// A list too big for one request starts as a draft ({ draft: true } with its first part); the rest is
// added through /api/campaigns/:id/recipients, which starts the campaign with the last part.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "The campaign could not be read. If the list is very large, reload the page and try again." }, { status: 400 });
  const parsed = campaignInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid campaign" }, { status: 400 });
  }
  try {
    return NextResponse.json(await createCampaign(parsed.data, "ui", session.id, { draft: body.draft === true }), { status: 201 });
  } catch (err) {
    if (err instanceof CampaignError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
