ALTER TABLE "log_entries" ADD COLUMN "request_id" text;--> statement-breakpoint
CREATE INDEX "log_entries_request_id_idx" ON "log_entries" USING btree ("request_id");