import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";
import { verifyApiToken } from "@/lib/session-token";

/** Who is calling the API and whose workspace it works in: a member's JWT, or the shared API_KEY (the first member's workspace). */
export type ApiCaller = { userId: string; via: "jwt" | "api_key" };

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
  if (apiKey && safeEqual(token, apiKey)) {
    // Always the very first member account, never whichever one happens to be next, so the key can't
    // drift into someone else's workspace. The super admin has no workspace.
    const [first] = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.role, "member"))
      .orderBy(asc(users.createdAt))
      .limit(1);
    if (!first) return unauthorized("API_KEY works once the first member account exists.");
    if (first.status !== "active") return unauthorized("API_KEY belongs to the first member account, which isn't active.");
    return { userId: first.id, via: "api_key" };
  }

  const claims = await verifyApiToken(token);
  if (!claims) return unauthorized("The token is invalid or has expired.");
  const [user] = await db.select({ status: users.status, role: users.role }).from(users).where(eq(users.id, claims.userId));
  if (user?.status !== "active") return unauthorized("This account is no longer active.");
  if (user.role === "superadmin") return unauthorized("The token is invalid or has expired.");
  return { userId: claims.userId, via: "jwt" };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
