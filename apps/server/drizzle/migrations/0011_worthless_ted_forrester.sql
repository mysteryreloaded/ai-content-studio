CREATE TABLE "model_terms_acceptances" (
	"model_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_terms_acceptances_model_id_user_id_pk" PRIMARY KEY("model_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "terms_body" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "license_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "attribution" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "terms_version" integer;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "terms_version_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "terms_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_terms_acceptances" ADD CONSTRAINT "model_terms_acceptances_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_terms_acceptances" ADD CONSTRAINT "model_terms_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;