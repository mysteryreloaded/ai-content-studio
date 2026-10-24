ALTER TYPE "public"."generation_state" RENAME TO "generation_state__old";--> statement-breakpoint
CREATE TYPE "public"."generation_state" AS ENUM('queued', 'starting', 'running', 'saving', 'succeeded', 'failed');--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "state" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "state" TYPE "public"."generation_state" USING "state"::text::"public"."generation_state";--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "state" SET DEFAULT 'queued';--> statement-breakpoint
DROP TYPE "public"."generation_state__old";--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"kind" text NOT NULL,
	"comfyui_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backends" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_generation_node_filename_unique" ON "assets" USING btree ("generation_id","node_id","comfyui_filename");--> statement-breakpoint
CREATE INDEX "generations_state_idx" ON "generations" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "generations_backend_unfinished_unique" ON "generations" USING btree ("backend_id") WHERE "generations"."state" in ('starting', 'running') and "generations"."backend_id" is not null;