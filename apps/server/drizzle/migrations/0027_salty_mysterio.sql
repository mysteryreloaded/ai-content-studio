ALTER TABLE "generations" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "removed_reason" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "removed_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "removed_reason" text;