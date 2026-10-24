CREATE TYPE "public"."upload_status" AS ENUM('uploading', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "upload_status" DEFAULT 'uploading' NOT NULL,
	"original_name" text NOT NULL,
	"declared_type" text NOT NULL,
	"size" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"model_id" uuid,
	"input_id" text,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"kind" text,
	"extension" text,
	"content_type" text,
	"width" integer,
	"height" integer,
	"probe" jsonb,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "upload_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_user_id_idx" ON "uploads" USING btree ("user_id");