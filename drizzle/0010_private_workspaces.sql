-- Private workspaces: anyone can sign up, and each account only sees its own mailboxes, recipients,
-- campaigns, emails, replies, do-not-send list and settings.
-- Everything saved so far belonged to the one shared workspace, so it goes to the first admin
-- (or, without an admin, the oldest account).
-- Mailbox addresses are unique per account, like recipients and the do-not-send list.
ALTER TABLE "senders" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "recipients" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "suppressions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "user_id" uuid;--> statement-breakpoint
CREATE TEMP TABLE "workspace_owner" AS
  SELECT "id" FROM "users" ORDER BY ("role" = 'admin') DESC, ("status" = 'active') DESC, "created_at" ASC LIMIT 1;--> statement-breakpoint
UPDATE "senders" SET "user_id" = (SELECT "id" FROM "workspace_owner");--> statement-breakpoint
UPDATE "recipients" SET "user_id" = (SELECT "id" FROM "workspace_owner");--> statement-breakpoint
UPDATE "campaigns" SET "user_id" = (SELECT "id" FROM "workspace_owner");--> statement-breakpoint
UPDATE "messages" SET "user_id" = (SELECT "id" FROM "workspace_owner");--> statement-breakpoint
UPDATE "replies" SET "user_id" = (SELECT "id" FROM "workspace_owner");--> statement-breakpoint
UPDATE "suppressions" SET "user_id" = (SELECT "id" FROM "workspace_owner");--> statement-breakpoint
UPDATE "settings" SET "user_id" = (SELECT "id" FROM "workspace_owner");--> statement-breakpoint
-- The background job makes a settings row even before anyone has signed up; with no account it has no owner.
DELETE FROM "settings" WHERE "user_id" IS NULL;--> statement-breakpoint
DROP TABLE "workspace_owner";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "senders" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "replies" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "suppressions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recipients" DROP CONSTRAINT "recipients_email_unique";--> statement-breakpoint
ALTER TABLE "senders" DROP CONSTRAINT "senders_email_unique";--> statement-breakpoint
ALTER TABLE "suppressions" DROP CONSTRAINT "suppressions_pkey";--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_user_id_email_pk" PRIMARY KEY("user_id","email");--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_pkey";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_pkey" PRIMARY KEY("user_id");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_user_created_idx" ON "campaigns" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_user_sent_idx" ON "messages" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recipients_user_email_idx" ON "recipients" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "replies_user_received_idx" ON "replies" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "senders_user_email_idx" ON "senders" USING btree ("user_id","email");
