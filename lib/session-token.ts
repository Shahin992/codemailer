import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

// JWTs for the dashboard login (cookie) and the API (Bearer header), both HS256 with AUTH_SECRET.
// Each kind has its own audience, so a login cookie can't be used as an API token or the other way round.
// Shared by the proxy and server code, so this file must not import next/headers or the database.

export const SESSION_COOKIE = "es_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const ISSUER = "coldmailer";
const AUDIENCE = { session: "coldmailer:web", api: "coldmailer:api" } as const;
type Kind = keyof typeof AUDIENCE;

export const API_TOKEN_MAX_DAYS = 90;

function secret() {
  return new TextEncoder().encode(env("AUTH_SECRET"));
}

async function sign(kind: Kind, userId: string, maxAgeSeconds: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE[kind])
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSeconds)
    .sign(secret());
}

async function verify(kind: Kind, token: string | undefined): Promise<{ userId: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE[kind] });
    return payload.sub && /^[0-9a-f-]{36}$/i.test(payload.sub) ? { userId: payload.sub } : null;
  } catch {
    return null;
  }
}

export function signSession(userId: string) {
  return sign("session", userId, SESSION_MAX_AGE);
}

export function verifySession(token: string | undefined) {
  return verify("session", token);
}

/** An API access token for a user, valid for 1 to 90 days. */
export async function signApiToken(userId: string, days: number): Promise<{ token: string; expiresIn: number; expiresAt: Date }> {
  const expiresIn = Math.round(Math.min(Math.max(days, 1), API_TOKEN_MAX_DAYS) * 86_400);
  return { token: await sign("api", userId, expiresIn), expiresIn, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

export function verifyApiToken(token: string | undefined) {
  return verify("api", token);
}
