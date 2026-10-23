import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The single Site settings row. `singleton` is always `true` and is the
 * primary key, so the table can never hold more than one row.
 */
export const siteSettings = pgTable("site_settings", {
  singleton: boolean("singleton").primaryKey().default(true),
  title: text("title").notNull().default("AI Content Studio"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
