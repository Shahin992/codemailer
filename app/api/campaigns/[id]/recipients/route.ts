import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { addCampaignRecipients, CampaignError, campaignInputSchema } from "@/lib/campaigns";

const partSchema = z.object({
  recipients: campaignInputSchema.shape.recipients.unwrap().max(10_000, "Send at most 10,000 recipients per part"),
  // true with the last part: the campaign starts sending.
  done: z.boolean(),
});

/** The next part of a large list for a draft campaign created from the dashboard. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = partSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid recipients" }, { status: 400 });
  try {
    return NextResponse.json(await addCampaignRecipients(id, parsed.data.recipients, parsed.data.done));
  } catch (err) {
    if (err instanceof CampaignError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
