import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings, type Settings } from "@/lib/db/schema";

/** An account's settings, made with the defaults the first time they're needed. */
export async function getSettings(userId: string): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  if (row) return row;
  await db.insert(settings).values({ userId }).onConflictDoNothing();
  const [created] = await db.select().from(settings).where(eq(settings.userId, userId));
  return created;
}
