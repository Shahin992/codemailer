ALTER TABLE "push_subscriptions" ADD COLUMN "last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_error_at" timestamp with time zone;