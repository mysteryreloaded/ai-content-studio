-- Maps the retired accent keys to their #191 successors (issue #191).
-- Unknown keys already fall back to teal at render time (apps/server/src/branding/accent-html.ts).
UPDATE "site_settings" SET "accent" = 'fuchsia' WHERE "accent" = 'rose';
--> statement-breakpoint
UPDATE "site_settings" SET "accent" = 'orange' WHERE "accent" = 'amber';
--> statement-breakpoint
UPDATE "site_settings" SET "accent" = 'green' WHERE "accent" = 'emerald';
--> statement-breakpoint
UPDATE "site_settings" SET "accent" = 'blue' WHERE "accent" = 'sky';
--> statement-breakpoint
UPDATE "site_settings" SET "accent" = 'graphite' WHERE "accent" = 'slate';
