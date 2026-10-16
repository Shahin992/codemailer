ALTER TABLE "senders" ALTER COLUMN "imap_host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ALTER COLUMN "imap_port" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "smtp_security" text DEFAULT 'ssl' NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "read_inbox" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "imap_security" text DEFAULT 'ssl' NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "imap_user" text;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "reply_to_sender_id" uuid;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_reply_to_sender_id_senders_id_fk" FOREIGN KEY ("reply_to_sender_id") REFERENCES "public"."senders"("id") ON DELETE set null ON UPDATE no action;