CREATE TYPE "public"."sign_up_mode" AS ENUM('open', 'approval');--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "sign_up_mode" "sign_up_mode" DEFAULT 'approval' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "contact" text DEFAULT '' NOT NULL;