ALTER TABLE "model_revisions" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "model_revisions" ADD COLUMN "created_by_name" text;--> statement-breakpoint
ALTER TABLE "model_revisions" ADD COLUMN "changed" text[];