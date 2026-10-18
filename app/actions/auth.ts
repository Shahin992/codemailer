"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth";
import { checkCredentials } from "@/lib/credentials";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/password";
import { clientIp } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/recipients-parse";

export type AuthState = { error?: string; message?: string; fieldErrors?: Record<string, string>; registered?: boolean };

function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "/");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const result = await checkCredentials(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""), clientIp(await headers()), "member");
  if (!result.ok) return { error: result.message };
  await startSession(result.user.id);
  redirect(safeNext(formData.get("next")));
}

/** Sign-in on /superadmin/login. Any other account gets the same answer as a wrong password. */
export async function superAdminLogin(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const result = await checkCredentials(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""), clientIp(await headers()), "superadmin");
  if (!result.ok) return { error: result.message };
  await startSession(result.user.id);
  redirect("/superadmin");
}

const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(120),
    email: z.string().transform(normalizeEmail).refine(isValidEmail, "Enter a valid email address"),
    password: z.string().min(8, "Use at least 8 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match" });

export async function register(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(["name", "email", "password", "confirm"].map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { fieldErrors };
  }
  const { name, email, password } = parsed.data;
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (taken) return { error: "An account with this email already exists." };
  try {
    // Waits for the super admin's approval; until then it can't sign in. No automatic sign-in either way.
    await db.insert(users).values({ name, email, passwordHash: await hashPassword(password), role: "member", status: "pending" });
  } catch (err) {
    if (String((err as { code?: string }).code) === "23505") return { error: "An account with this email already exists." };
    throw err;
  }
  return { registered: true };
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function superAdminLogout() {
  await endSession();
  redirect("/superadmin/login");
}
