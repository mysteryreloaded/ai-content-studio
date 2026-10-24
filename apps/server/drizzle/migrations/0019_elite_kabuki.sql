ALTER TABLE "site_settings" ADD COLUMN "notice" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "notice_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "paused_by_name" text;