import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { clearFailures, isLimited, recordFailure } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/recipients-parse";

export type CredentialResult =
  | { ok: true; user: User }
  | { ok: false; reason: "limited" | "invalid" | "pending" | "disabled"; message: string };

/** Check an email and password; used by the login page and the API token endpoint. */
export async function checkCredentials(rawEmail: string, password: string, ip: string): Promise<CredentialResult> {
  const email = normalizeEmail(rawEmail);
  const key = `${ip}|${email}`;
  if (isLimited(key)) {
    return { ok: false, reason: "limited", message: "Too many failed attempts. Wait 15 minutes and try again." };
  }
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, 400));
    return { ok: false, reason: "invalid", message: "Wrong email or password." };
  }
  clearFailures(key);
  if (user.status === "pending") return { ok: false, reason: "pending", message: "Your account is waiting for an admin to approve it." };
  if (user.status === "disabled") return { ok: false, reason: "disabled", message: "This account has been disabled. Ask an admin." };
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return { ok: true, user };
}
