CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"actor_ip" text,
	"actor_user_agent" text,
	"actor_request_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"images" jsonb
);
--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "landing_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "accent" text DEFAULT 'teal' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "logo_content_type" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "logo_hash" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "logo_size" integer;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "background_key" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "background_content_type" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "background_hash" text;--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "background_size" integer;--> statement-breakpoint
CREATE FUNCTION audit_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_entries_append_only
  BEFORE UPDATE OR DELETE ON "audit_entries"
  FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();