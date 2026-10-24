CREATE TABLE "model_backends" (
	"model_id" uuid NOT NULL,
	"backend_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_backends_model_id_backend_id_pk" PRIMARY KEY("model_id","backend_id")
);
--> statement-breakpoint
ALTER TABLE "model_backends" ADD CONSTRAINT "model_backends_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_backends" ADD CONSTRAINT "model_backends_backend_id_backends_id_fk" FOREIGN KEY ("backend_id") REFERENCES "public"."backends"("id") ON DELETE cascade ON UPDATE no action;