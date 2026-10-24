ALTER TABLE "site_settings" ADD COLUMN "privacy_body" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "privacy_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "privacy_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "footer_links" jsonb DEFAULT '[]'::jsonb NOT NULL;