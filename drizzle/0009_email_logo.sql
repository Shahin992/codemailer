ALTER TABLE "settings" ADD COLUMN "logo_file" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "logo_mime" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "logo_bytes" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "logo_width" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "logo_height" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "logo_display_width" integer DEFAULT 160 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "logo_in_personal" boolean DEFAULT true NOT NULL;