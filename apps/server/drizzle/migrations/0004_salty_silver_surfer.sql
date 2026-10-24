CREATE TYPE "public"."log_source" AS ENUM('backend', 'app');--> statement-breakpoint
ALTER TABLE "log_entries" ADD COLUMN "source" "log_source" DEFAULT 'backend' NOT NULL;--> statement-breakpoint
ALTER TABLE "log_entries" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "log_entries" ADD COLUMN "model_id" uuid;--> statement-breakpoint
ALTER TABLE "log_entries" ADD COLUMN "generation_id" uuid;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;