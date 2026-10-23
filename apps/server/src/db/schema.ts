import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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

/** ADR 0003: two roles, no third status until approval sign-up lands. */
export const userRole = pgEnum("user_role", ["user", "admin"]);
export const userStatus = pgEnum("user_status", [
  "pending",
  "active",
  "disabled",
]);

/**
 * A person who has signed in with Google, keyed on the Google `sub`.
 * `pinned` is set for every email in `ADMIN_EMAILS`: the admin panel must
 * never demote, disable or delete a pinned user.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  picture: text("picture"),
  role: userRole("role").notNull().default("user"),
  status: userStatus("status").notNull().default("active"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A session cookie's server-side half. The cookie holds `id.secret`; only
 * `secretHash` (SHA-256 of `secret`) is stored, never the secret itself.
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  secretHash: text("secret_hash").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
