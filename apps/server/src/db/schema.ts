import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The single Site settings row. `singleton` is always `true` and is the
 * primary key, so the table can never hold more than one row. `version`
 * guards a save against a concurrent one (a stale save gets 409).
 */
export const siteSettings = pgTable("site_settings", {
  singleton: boolean("singleton").primaryKey().default(true),
  version: integer("version").notNull().default(1),
  title: text("title").notNull().default("AI Content Studio"),
  landingText: text("landing_text").notNull().default(""),
  accent: text("accent").notNull().default("teal"),
  logoKey: text("logo_key"),
  logoContentType: text("logo_content_type"),
  logoHash: text("logo_hash"),
  logoSize: integer("logo_size"),
  backgroundKey: text("background_key"),
  backgroundContentType: text("background_content_type"),
  backgroundHash: text("background_hash"),
  backgroundSize: integer("background_size"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * ADR 0005: append-only, kept forever (enforced by a database trigger,
 * see the migration). Actor is an Admin (email, IP, user agent, request
 * id) or "system"; a target that isn't an Admin is named by id only.
 */
export const auditEntries = pgTable("audit_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  actorType: text("actor_type").notNull(),
  actorUserId: uuid("actor_user_id"),
  actorEmail: text("actor_email"),
  actorIp: text("actor_ip"),
  actorUserAgent: text("actor_user_agent"),
  actorRequestId: text("actor_request_id"),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  images: jsonb("images"),
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
