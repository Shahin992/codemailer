import { readToken } from "@/lib/crypto";
import { recordOpen } from "@/lib/tracking";

// 1×1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const messageId = readToken(token.replace(/\.gif$/i, ""), "track");
  if (messageId) {
    await recordOpen(messageId, request.headers.get("user-agent") ?? "").catch((err) => console.error("[track] open", err));
  }
  return new Response(new Uint8Array(PIXEL), {
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
