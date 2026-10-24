CREATE TABLE "modes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"output_nodes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "modes" ADD CONSTRAINT "modes_revision_id_model_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."model_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "modes_revision_name_unique" ON "modes" USING btree ("revision_id",lower("name"));