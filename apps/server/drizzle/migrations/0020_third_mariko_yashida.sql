DROP INDEX "generations_backend_unfinished_unique";--> statement-breakpoint
ALTER TYPE "public"."generation_state" RENAME TO "generation_state__old";--> statement-breakpoint
CREATE TYPE "public"."generation_state" AS ENUM('queued', 'starting', 'running', 'saving', 'succeeded', 'failed', 'cancelling', 'cancelled');--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "state" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "state" TYPE "public"."generation_state" USING "state"::text::"public"."generation_state";--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "state" SET DEFAULT 'queued';--> statement-breakpoint
DROP TYPE "public"."generation_state__old";--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "pending_backend_cancel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "generations_backend_unfinished_unique" ON "generations" USING btree ("backend_id") WHERE "generations"."state" in ('starting', 'running', 'cancelling') and "generations"."backend_id" is not null;
