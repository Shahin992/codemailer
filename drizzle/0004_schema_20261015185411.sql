CREATE TABLE "test_sends" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sender_id" uuid NOT NULL,
	"to_email" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_sends" ADD CONSTRAINT "test_sends_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_sends_sender_sent_idx" ON "test_sends" USING btree ("sender_id","sent_at");