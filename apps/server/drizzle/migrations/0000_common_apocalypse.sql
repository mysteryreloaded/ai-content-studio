CREATE TABLE "site_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"title" text DEFAULT 'AI Content Studio' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "site_settings" ("singleton") VALUES (true);
