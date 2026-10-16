import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";
import { verifyApiToken } from "@/lib/session-token";

/** Who is calling the API: a user's JWT, or the shared API_KEY (no user). */
export type ApiCaller = { userId: string | null; via: "jwt" | "api_key" };

function unauthorized(message: string) {
  return NextResponse.json({ error: message }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="coldmailer"' } });
}

/**
 * Accepts `Authorization: Bearer <token>` where the token is a JWT from POST /api/v1/auth/token
 * (or Settings → API), or the API_KEY from .env if one is set. Returns the caller or an error response.
 */
export async function authenticateApi(request: Request): Promise<ApiCaller | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized("Send Authorization: Bearer <token>. Get a token from POST /api/v1/auth/token.");

  const apiKey = optionalEnv("API_KEY");
  if (apiKey && safeEqual(token, apiKey)) return { userId: null, via: "api_key" };

  const claims = await verifyApiToken(token);
  if (!claims) return unauthorized("The token is invalid or has expired.");
  const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, claims.userId));
  if (user?.status !== "active") return unauthorized("This account is no longer active.");
  return { userId: claims.userId, via: "jwt" };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
