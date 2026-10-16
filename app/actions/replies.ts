"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { replies } from "@/lib/db/schema";

export async function markReplyUnread(id: string) {
  await requireSession();
  await db.update(replies).set({ readAt: null }).where(eq(replies.id, id));
  revalidatePath("/replies");
  revalidatePath(`/replies/${id}`);
}

export async function markAllRepliesRead() {
  await requireSession();
  await db.update(replies).set({ readAt: new Date() }).where(and(isNull(replies.readAt)));
  revalidatePath("/replies");
  revalidatePath("/", "layout");
}
