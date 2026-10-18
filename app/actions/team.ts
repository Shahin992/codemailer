"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";

export type TeamState = { error?: string; message?: string };

const passwordSchema = z
  .object({ current: z.string().min(1, "Enter your current password"), password: z.string().min(8, "Use at least 8 characters").max(200), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "The new passwords don't match" })
  .refine((v) => v.password !== v.current, { message: "Choose a password different from the current one" });

/** Change your own password (members and the super admin). */
export async function changePassword(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const me = await requireUser();
  const parsed = passwordSchema.safeParse({
    current: String(formData.get("current") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const [user] = await db.select().from(users).where(eq(users.id, me.id));
  if (!user || !(await verifyPassword(parsed.data.current, user.passwordHash))) return { error: "Your current password is wrong." };
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.id, me.id));
  return { message: "Password changed." };
}
