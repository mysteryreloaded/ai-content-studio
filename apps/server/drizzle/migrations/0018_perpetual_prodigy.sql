ALTER TYPE "public"."generation_state" ADD VALUE 'cancelling';--> statement-breakpoint
ALTER TYPE "public"."generation_state" ADD VALUE 'cancelled';--> statement-breakpoint
DROP INDEX "generations_backend_unfinished_unique";--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "pending_backend_cancel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "generations_backend_unfinished_unique" ON "generations" USING btree ("backend_id") WHERE "generations"."state" in ('starting', 'running', 'cancelling') and "generations"."backend_id" is not null;