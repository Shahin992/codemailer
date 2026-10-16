import { and, eq, sql } from "drizzle-orm";
import { readToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { trackingLinks } from "@/lib/db/schema";
import { appUrl } from "@/lib/env";
import { recordClick } from "@/lib/tracking";

async function handle(request: Request, params: Promise<{ token: string; linkId: string }>) {
  const { token, linkId } = await params;
  const messageId = readToken(token, "track");
  const id = Number(linkId);
  if (!messageId || !Number.isSafeInteger(id)) return Response.redirect(appUrl(), 302);

  const [link] = await db
    .select({ url: trackingLinks.url })
    .from(trackingLinks)
    .where(and(eq(trackingLinks.id, id), eq(trackingLinks.messageId, messageId)));
  if (!link) return Response.redirect(appUrl(), 302);

  const userAgent = request.headers.get("user-agent") ?? "";
  await Promise.all([
    recordClick(messageId, userAgent, request.method),
    request.method === "GET"
      ? db.update(trackingLinks).set({ clickCount: sql`${trackingLinks.clickCount} + 1` }).where(eq(trackingLinks.id, id))
      : Promise.resolve(),
  ]).catch((err) => console.error("[track] click", err));

  return new Response(null, { status: 302, headers: { Location: link.url, "Cache-Control": "no-store" } });
}

export function GET(request: Request, { params }: { params: Promise<{ token: string; linkId: string }> }) {
  return handle(request, params);
}

export function HEAD(request: Request, { params }: { params: Promise<{ token: string; linkId: string }> }) {
  return handle(request, params);
}
