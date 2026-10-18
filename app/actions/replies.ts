"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { replies } from "@/lib/db/schema";

export async function markReplyUnread(id: string) {
  const me = await requireSession();
  await db.update(replies).set({ readAt: null }).where(and(eq(replies.id, id), eq(replies.userId, me.id)));
  revalidatePath("/replies");
  revalidatePath(`/replies/${id}`);
}

export async function markAllRepliesRead() {
  const me = await requireSession();
  await db.update(replies).set({ readAt: new Date() }).where(and(eq(replies.userId, me.id), isNull(replies.readAt)));
  revalidatePath("/replies");
  revalidatePath("/", "layout");
}
