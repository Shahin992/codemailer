ALTER TABLE "messages" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "rest_until" timestamp with time zone;