import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings, type Settings } from "@/lib/db/schema";
import { optionalEnv } from "@/lib/env";

export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  await db
    .insert(settings)
    .values({ id: 1, testEmail: optionalEnv("ADMIN_EMAIL") ?? null })
    .onConflictDoNothing();
  const [created] = await db.select().from(settings).where(eq(settings.id, 1));
  return created;
}
