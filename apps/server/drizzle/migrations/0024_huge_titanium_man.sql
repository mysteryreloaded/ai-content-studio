ALTER TABLE "generations" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "pinned_backend_id" uuid;--> statement-breakpoint
ALTER TABLE "model_revisions" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_pinned_backend_id_backends_id_fk" FOREIGN KEY ("pinned_backend_id") REFERENCES "public"."backends"("id") ON DELETE set null ON UPDATE no action;