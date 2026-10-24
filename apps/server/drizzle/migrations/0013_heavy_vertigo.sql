ALTER TABLE "backends" ADD COLUMN "draining" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "tries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
UPDATE "generations" SET "queued_at" = "submitted_at" WHERE "queued_at" IS NULL;--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "queued_at" SET NOT NULL;
