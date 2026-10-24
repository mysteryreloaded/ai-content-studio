CREATE TYPE "public"."generation_state" AS ENUM('queued');--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"model_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"mode_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"backend_id" uuid,
	"submission_id" uuid NOT NULL,
	"state" "generation_state" DEFAULT 'queued' NOT NULL,
	"built_prompt" jsonb NOT NULL,
	"node_types" text[] NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_revision_id_model_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."model_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_mode_id_modes_id_fk" FOREIGN KEY ("mode_id") REFERENCES "public"."modes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_backend_id_backends_id_fk" FOREIGN KEY ("backend_id") REFERENCES "public"."backends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_model_id_idx" ON "generations" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "generations_user_id_idx" ON "generations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generations_submission_id_idx" ON "generations" USING btree ("submission_id");