"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";

export type TeamState = { error?: string; message?: string };

async function otherActiveAdmins(exceptId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, exceptId)));
  return n;
}

/** Approve, disable or re-enable an account. */
export async function setUserStatus(userId: string, status: "active" | "disabled", _prev: TeamState): Promise<TeamState> {
  const me = await requireAdmin();
  if (userId === me.id) return { error: "You can't change your own account here." };
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) return { error: "User not found." };
  if (status === "disabled" && target.role === "admin" && (await otherActiveAdmins(userId)) === 0) {
    return { error: "Keep at least one active admin." };
  }
  await db.update(users).set({ status }).where(eq(users.id, userId));
  revalidatePath("/settings");
  return { message: status === "active" ? `${target.email} can sign in now.` : `${target.email} is disabled.` };
}

export async function setUserRole(userId: string, role: "admin" | "member", _prev: TeamState): Promise<TeamState> {
  const me = await requireAdmin();
  if (userId === me.id) return { error: "You can't change your own role." };
  await db.update(users).set({ role }).where(eq(users.id, userId));
  revalidatePath("/settings");
  return { message: role === "admin" ? "Now an admin." : "Now a member." };
}

/** Remove an account that was never approved or has been disabled. */
export async function deleteUser(userId: string, _prev: TeamState): Promise<TeamState> {
  const me = await requireAdmin();
  if (userId === me.id) return { error: "You can't delete your own account." };
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) return { error: "User not found." };
  if (target.status === "active") return { error: "Disable the account before deleting it." };
  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/settings");
  return { message: `${target.email} was deleted.` };
}

const passwordSchema = z
  .object({ current: z.string().min(1, "Enter your current password"), password: z.string().min(8, "Use at least 8 characters").max(200), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "The new passwords don't match" });

export async function changePassword(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const me = await requireSession();
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
