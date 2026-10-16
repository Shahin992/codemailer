import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";

// Opens and clicks from machines (privacy proxies, security scanners) are left out of the counts.
const SCANNER_UA = /(bot|crawler|spider|preview|scanner|safelinks|barracuda|mimecast|proofpoint|curl|wget|python-requests|go-http-client)/i;
const SCANNER_CLICK_SECONDS = 10;

export function isMachineOpen(userAgent: string): boolean {
  // Apple Mail Privacy Protection fetches every image through a generic Mozilla UA with no details.
  return SCANNER_UA.test(userAgent) || userAgent === "Mozilla/5.0";
}

export async function recordOpen(messageId: string, userAgent: string) {
  if (isMachineOpen(userAgent)) return;
  await db
    .update(messages)
    .set({ openCount: sql`${messages.openCount} + 1`, firstOpenedAt: sql`coalesce(${messages.firstOpenedAt}, now())` })
    .where(eq(messages.id, messageId));
}

export async function recordClick(messageId: string, userAgent: string, method: string) {
  if (method === "HEAD" || SCANNER_UA.test(userAgent)) return;
  const [msg] = await db.select({ sentAt: messages.sentAt }).from(messages).where(eq(messages.id, messageId));
  if (msg?.sentAt && Date.now() - msg.sentAt.getTime() < SCANNER_CLICK_SECONDS * 1000) return; // link scanners click instantly
  await db
    .update(messages)
    .set({
      clickCount: sql`${messages.clickCount} + 1`,
      firstClickedAt: sql`coalesce(${messages.firstClickedAt}, now())`,
      // A click proves the email was opened even if images were blocked.
      openCount: sql`greatest(${messages.openCount}, 1)`,
      firstOpenedAt: sql`coalesce(${messages.firstOpenedAt}, now())`,
    })
    .where(eq(messages.id, messageId));
}
