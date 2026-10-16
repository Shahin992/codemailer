import { sql } from "drizzle-orm";
import { messages, testSends } from "@/lib/db/schema";

/**
 * Emails sent by a mailbox in the last 24 hours, campaign emails plus test emails
 * (Hostinger and Gmail count the same rolling window).
 *
 * The outer mailbox is written as "senders"."id" on purpose: Drizzle leaves column names
 * unqualified in single-table selects, and inside this subquery a bare "id" would mean
 * the message's own id, so the count would always be 0.
 */
export const sentLast24h = sql<number>`(
  (select count(*) from ${messages} m where m.sender_id = "senders"."id" and m.sent_at > now() - interval '24 hours')
  + (select count(*) from ${testSends} t where t.sender_id = "senders"."id" and t.sent_at > now() - interval '24 hours')
)`.mapWith(Number);
