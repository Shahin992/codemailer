"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

export type AccountState = { error?: string; message?: string };

/** The member account an action is about, for the super admin. Never another super admin. */
async function target(userId: string): Promise<{ user: User } | { error: string }> {
  await requireSuperAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Account not found." };
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.role === "superadmin") return { error: "Account not found." };
  return { user };
}

function refresh() {
  revalidatePath("/superadmin");
}

/** Approve a sign-up, or enable a disabled account again. The person can sign in right away. */
export async function approveUser(userId: string, _prev: AccountState): Promise<AccountState> {
  const found = await target(userId);
  if ("error" in found) return found;
  await db.update(users).set({ status: "active" }).where(eq(users.id, userId));
  refresh();
  return { message: `${found.user.email} can sign in now.` };
}

/** Disable an account: it can't sign in or use the API, and its campaigns stop sending. Its data is kept. */
export async function disableUser(userId: string, _prev: AccountState): Promise<AccountState> {
  const found = await target(userId);
  if ("error" in found) return found;
  await db.update(users).set({ status: "disabled" }).where(eq(users.id, userId));
  refresh();
  return { message: `${found.user.email} is disabled.` };
}

/** Reject a sign-up, or remove a disabled account together with its whole workspace. */
export async function deleteUser(userId: string, _prev: AccountState): Promise<AccountState> {
  const found = await target(userId);
  if ("error" in found) return found;
  if (found.user.status === "active") return { error: "Disable the account before deleting it." };
  await db.delete(users).where(eq(users.id, userId));
  refresh();
  return { message: found.user.status === "pending" ? `The sign-up from ${found.user.email} was rejected.` : `${found.user.email} and everything in that account were deleted.` };
}
