CREATE TYPE "public"."model_state" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TABLE "model_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"workflow_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"max_run_time_minutes" integer DEFAULT 30 NOT NULL,
	"state" "model_state" DEFAULT 'disabled' NOT NULL,
	"sort_order" integer NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"hash" text PRIMARY KEY NOT NULL,
	"json" jsonb NOT NULL,
	"node_count" integer NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_revisions" ADD CONSTRAINT "model_revisions_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_revisions" ADD CONSTRAINT "model_revisions_workflow_hash_workflows_hash_fk" FOREIGN KEY ("workflow_hash") REFERENCES "public"."workflows"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_revisions_model_number_unique" ON "model_revisions" USING btree ("model_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "models_name_unique" ON "models" USING btree (lower("name")) WHERE "models"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "models_slug_unique" ON "models" USING btree ("slug") WHERE "models"."deleted_at" is null;