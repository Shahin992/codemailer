"use server";

import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, startSession } from "@/lib/auth";
import { checkCredentials } from "@/lib/credentials";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";
import { hashPassword } from "@/lib/password";
import { clientIp } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/recipients-parse";

export type AuthState = { error?: string; message?: string; fieldErrors?: Record<string, string> };

function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "/");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const result = await checkCredentials(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""), clientIp(await headers()));
  if (!result.ok) return { error: result.message };
  await startSession(result.user.id);
  redirect(safeNext(formData.get("next")));
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
  const passwordHash = await hashPassword(password);
  const adminEmail = optionalEnv("ADMIN_EMAIL")?.trim().toLowerCase();

  const result = await db.transaction(async (tx) => {
    // Serialise sign-ups so two people can't both become the first admin.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('register'))`);
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) return { error: "An account with this email already exists." } as const;
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    const first = n === 0;
    if (first && adminEmail && email !== adminEmail) {
      return { error: "The first account must use the admin email set in ADMIN_EMAIL." } as const;
    }
    const [user] = await tx
      .insert(users)
      .values({ name, email, passwordHash, role: first ? "admin" : "member", status: first ? "active" : "pending" })
      .returning({ id: users.id });
    return { userId: user.id, first } as const;
  });

  if ("error" in result) return { error: result.error };
  if (result.first) {
    await startSession(result.userId);
    redirect("/");
  }
  return { message: "Account created. An admin needs to approve it before you can sign in." };
}

export async function logout() {
  await endSession();
  redirect("/login");
}
