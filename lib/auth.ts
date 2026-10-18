import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { safeEqual } from "@/lib/crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { appUrl } from "@/lib/env";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "@/lib/session-token";

export type CurrentUser = { id: string; email: string; name: string; role: "superadmin" | "member" };

/** The signed-in account (member or super admin), or null. Disabled or not-yet-approved accounts count as signed out. */
export const getSession = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!token) return null;
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, token.userId));
  if (!user || user.status !== "active") return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

/** The signed-in member, who has a workspace; null for the super admin, who has none. For route handlers. */
export async function getMemberSession(): Promise<CurrentUser | null> {
  const session = await getSession();
  return session && session.role !== "superadmin" ? session : null;
}

/** A signed-in member, for workspace pages and actions. The super admin is sent to its own panel. */
export async function requireSession(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "superadmin") redirect("/superadmin");
  return session;
}

/** Any signed-in account (member or super admin), e.g. to change its own password. */
export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** The signed-in super admin; anyone else goes to the super admin sign-in page. */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session || session.role !== "superadmin") redirect("/superadmin/login");
  return session;
}

export async function startSession(userId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(userId), {
    httpOnly: true,
    secure: appUrl().startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function endSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export function checkBearer(request: Request, expected: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 && safeEqual(token, expected);
}
