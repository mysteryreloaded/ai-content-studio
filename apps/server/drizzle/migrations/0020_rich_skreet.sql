ALTER TABLE "uploads" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "fps" double precision;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "trimmed_from_id" uuid;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "trim_start_ms" integer;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "trim_end_ms" integer;