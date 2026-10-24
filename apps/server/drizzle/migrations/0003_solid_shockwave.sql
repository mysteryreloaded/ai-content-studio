CREATE TYPE "public"."backend_auth_kind" AS ENUM('none', 'basic', 'header');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('error', 'warning', 'info');--> statement-breakpoint
CREATE TABLE "backends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"auth_kind" "backend_auth_kind" DEFAULT 'none' NOT NULL,
	"encrypted_credentials" text,
	"header_name" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" "log_level" NOT NULL,
	"message" text NOT NULL,
	"details" text,
	"backend_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_backend_id_backends_id_fk" FOREIGN KEY ("backend_id") REFERENCES "public"."backends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backends_name_unique" ON "backends" USING btree ("name") WHERE "backends"."deleted_at" is null;