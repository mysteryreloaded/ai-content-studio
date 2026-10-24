ALTER TABLE "site_settings" ADD COLUMN "daily_cap" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "concurrent_cap" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "caps_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "daily_cap_override" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "concurrent_cap_override" integer;