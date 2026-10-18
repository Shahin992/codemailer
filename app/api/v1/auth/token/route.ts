import { NextResponse } from "next/server";
import { z } from "zod";
import { checkCredentials } from "@/lib/credentials";
import { clientIp } from "@/lib/rate-limit";
import { API_TOKEN_MAX_DAYS, signApiToken } from "@/lib/session-token";

const schema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  days: z.number().int().min(1).max(API_TOKEN_MAX_DAYS).optional(),
});

/**
 * Exchange an account's email and password for a JWT access token.
 * Use it as `Authorization: Bearer <access_token>` on /api/v1/*.
 */
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Send JSON: {"email": "...", "password": "...", "days": 1-${API_TOKEN_MAX_DAYS} (optional, default 30)}` }, { status: 400 });
  }
  const result = await checkCredentials(parsed.data.email, parsed.data.password, clientIp(request.headers), "member");
  if (!result.ok) {
    const status = result.reason === "limited" ? 429 : result.reason === "invalid" ? 401 : 403;
    return NextResponse.json({ error: result.message }, { status });
  }
  const { token, expiresIn, expiresAt } = await signApiToken(result.user.id, parsed.data.days ?? 30);
  return NextResponse.json(
    { access_token: token, token_type: "Bearer", expires_in: expiresIn, expires_at: expiresAt.toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
