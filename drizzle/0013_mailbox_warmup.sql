CREATE TABLE "warmup_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"to_sender_id" uuid NOT NULL,
	"parent_id" uuid,
	"thread_id" uuid NOT NULL,
	"topic" text,
	"subject" text,
	"body_text" text,
	"message_id_header" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"received_at" timestamp with time zone,
	"landed_in" text,
	"rescued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warmup_messages_message_id_header_unique" UNIQUE("message_id_header")
);
--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_role" text DEFAULT 'sender' NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_receive_max" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_planned_on" text;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_start" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_increase" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_max" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "warmup_reply_rate" integer DEFAULT 35 NOT NULL;--> statement-breakpoint
ALTER TABLE "warmup_messages" ADD CONSTRAINT "warmup_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warmup_messages" ADD CONSTRAINT "warmup_messages_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warmup_messages" ADD CONSTRAINT "warmup_messages_to_sender_id_senders_id_fk" FOREIGN KEY ("to_sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warmup_messages" ADD CONSTRAINT "warmup_messages_parent_id_warmup_messages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."warmup_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warmup_status_scheduled_idx" ON "warmup_messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "warmup_sender_sent_idx" ON "warmup_messages" USING btree ("sender_id","sent_at");--> statement-breakpoint
CREATE INDEX "warmup_to_sender_received_idx" ON "warmup_messages" USING btree ("to_sender_id","received_at");--> statement-breakpoint
CREATE INDEX "warmup_user_created_idx" ON "warmup_messages" USING btree ("user_id","created_at");