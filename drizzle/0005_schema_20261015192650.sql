CREATE INDEX "campaigns_created_idx" ON "campaigns" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_campaign_sent_idx" ON "messages" USING btree ("campaign_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_recipient_created_idx" ON "messages" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "recipients_last_contact_idx" ON "recipients" USING btree ("last_contact_at");--> statement-breakpoint
CREATE INDEX "recipients_status_idx" ON "recipients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "replies_message_idx" ON "replies" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "replies_recipient_idx" ON "replies" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "suppressions_created_idx" ON "suppressions" USING btree ("created_at");