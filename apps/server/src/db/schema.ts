import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The single Site settings row. `singleton` is always `true` and is the
 * primary key, so the table can never hold more than one row. `version`
 * guards a save against a concurrent one (a stale save gets 409).
 */
export const signUpMode = pgEnum("sign_up_mode", ["open", "approval"]);

export const siteSettings = pgTable("site_settings", {
  singleton: boolean("singleton").primaryKey().default(true),
  version: integer("version").notNull().default(1),
  title: text("title").notNull().default("AI Content Studio"),
  landingText: text("landing_text").notNull().default(""),
  accent: text("accent").notNull().default("teal"),
  /** Issue #62: whether a new sign-in needs an Admin's approval. Switching this approves nobody already pending. */
  signUpMode: signUpMode("sign_up_mode").notNull().default("approval"),
  /** Issue #62: shown on the waiting page, for reports and account questions. An email or an http(s) URL; blank means unset. */
  contact: text("contact").notNull().default(""),
  logoKey: text("logo_key"),
  logoContentType: text("logo_content_type"),
  logoHash: text("logo_hash"),
  logoSize: integer("logo_size"),
  backgroundKey: text("background_key"),
  backgroundContentType: text("background_content_type"),
  backgroundHash: text("background_hash"),
  backgroundSize: integer("background_size"),
  /**
   * Issue #60: `termsBody` is the Markdown always shown on `/terms`, but
   * `termsVersion` only moves when it's first set or a save ticks "Ask
   * everyone to accept again" — a quiet text edit keeps everyone's
   * acceptance. `termsVersion` never moves backwards and is never
   * reused, even across a blank (cleared) body, so a stale acceptance
   * can never match a later, different version by numeric coincidence.
   * A blank `termsBody` means "no terms are set" (the gate is off) —
   * `termsVersion` itself is not the signal for that, since it's kept
   * (not nulled) across a clear so the next save can keep counting up;
   * see `activeTermsVersion` in `branding/site-settings-store.ts`.
   * `termsRevision` is terms' own optimistic-concurrency token,
   * independent of `version` (branding's), so saving one form never
   * races the other into a spurious 409.
   */
  termsBody: text("terms_body").notNull().default(""),
  termsVersion: integer("terms_version"),
  termsVersionCreatedAt: timestamp("terms_version_created_at", {
    withTimezone: true,
  }),
  termsRevision: integer("terms_revision").notNull().default(1),
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
 * `pinned` is not authoritative and no guard or route reads it (ADR 0008):
 * whether a user is pinned is always `isPinned(email, adminEmails)`,
 * computed live against the current `ADMIN_EMAILS`, so removing an email
 * unpins immediately without a write here.
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
  /** Issue #60: null until this user accepts the Site terms' current `termsVersion`. */
  termsAcceptedVersion: integer("terms_accepted_version"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** ADR 0004: ComfyUI is the only Backend kind, so there's no `kind` column. */
export const backendAuthKind = pgEnum("backend_auth_kind", [
  "none",
  "basic",
  "header",
]);

/**
 * A ComfyUI server (issue #39). Credentials are encrypted at rest
 * (AES-256-GCM, see backends/credentials.ts) and write-only: a save with
 * blank credential fields keeps the stored ones. `version` guards a save
 * against a concurrent one (409 when stale). Soft-deleted rows are kept
 * (`deletedAt` set) so Log/Audit entries about them still resolve.
 */
export const backends = pgTable(
  "backends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    authKind: backendAuthKind("auth_kind").notNull().default("none"),
    /** Base64 of nonce + ciphertext + auth tag; null when authKind = "none". */
    encryptedCredentials: text("encrypted_credentials"),
    headerName: text("header_name"),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("backends_name_unique")
      .on(table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * An operational record about the app or a Backend (issue #39), distinct
 * from Audit entries. `source` says what wired it (issue #67): `backend`
 * for Backend health, `app` for everything else (unhandled 500s, a
 * non-Admin calling an admin route). `userId` is nulled, not kept, once
 * its user is gone, mirroring ADR 0005's live join for Audit entries.
 * `modelId`/`generationId` have no foreign key yet: Models and
 * Generations don't exist until later issues wire entries that set them.
 */
export const logLevel = pgEnum("log_level", ["error", "warning", "info"]);
export const logSource = pgEnum("log_source", ["backend", "app"]);

export const logEntries = pgTable("log_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  level: logLevel("level").notNull(),
  source: logSource("source").notNull().default("backend"),
  message: text("message").notNull(),
  /** Truncated by the writer before insert; see backends/log-entries.ts. */
  details: text("details"),
  backendId: uuid("backend_id").references(() => backends.id, {
    onDelete: "set null",
  }),
  userId: uuid("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  modelId: uuid("model_id"),
  generationId: uuid("generation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/**
 * A Workflow's JSON, content-addressed by `hash` (SHA-256 of its canonical
 * JSON, see workflow/validate.ts) and kept forever (issue #40): several
 * Model revisions may point at the same row, and a revision's history must
 * always be able to resolve the Workflow it ran.
 */
export const workflows = pgTable("workflows", {
  hash: text("hash").primaryKey(),
  json: jsonb("json").notNull(),
  nodeCount: integer("node_count").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A Model starts disabled (issue #40); enabling it is a later issue. */
export const modelState = pgEnum("model_state", ["enabled", "disabled"]);

/**
 * An admin-defined generation offering (issue #40). `sortOrder` is the
 * Admin's own ordering of the Models list, reassigned by the up/down
 * buttons. `currentRevision` is the number of the Model revision this row
 * currently points at; the revisions themselves live in `modelRevisions`,
 * immutable and numbered per Model. `version` guards a save against a
 * concurrent one (409 when stale). Soft-deleted rows are kept (`deletedAt`
 * set), freeing their name and slug for reuse.
 */
export const models = pgTable(
  "models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    maxRunTimeMinutes: integer("max_run_time_minutes").notNull().default(30),
    state: modelState("state").notNull().default("disabled"),
    sortOrder: integer("sort_order").notNull(),
    currentRevision: integer("current_revision").notNull().default(1),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("models_name_unique")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("models_slug_unique")
      .on(table.slug)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * One saved, immutable, numbered state of a Model's Workflow and Modes
 * (issue #40, #42; Inputs join this later). Never updated or deleted: a
 * save of either makes a new row with the next `revisionNumber`.
 */
export const modelRevisions = pgTable(
  "model_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    workflowHash: text("workflow_hash")
      .notNull()
      .references(() => workflows.hash),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_revisions_model_number_unique").on(
      table.modelId,
      table.revisionNumber,
    ),
  ],
);

/**
 * Which Backends are attached to a Model (issue #41), many-to-many. No
 * node knowledge lives here: `/object_info` is fetched live and cached
 * only in memory (backends/node-knowledge.ts), never stored.
 */
export const modelBackends = pgTable(
  "model_backends",
  {
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    backendId: uuid("backend_id")
      .notNull()
      .references(() => backends.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.backendId] })],
);

/**
 * A named preset of a Model revision (issue #42): its ordered output
 * nodes (ADR 0001) resolved against that revision's Workflow at save
 * time, so an old revision's Modes still read back even if the Admin
 * later renames or removes those nodes in a newer Workflow. `sortOrder`
 * is the Admin's own ordering within the revision. `outputNodes` is an
 * ordered JSON array of `{ nodeId, classType, title, kind }`; the first
 * entry is the main Asset.
 */
export const modes = pgTable(
  "modes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => modelRevisions.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    outputNodes: jsonb("output_nodes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("modes_revision_name_unique").on(
      table.revisionId,
      sql`lower(${table.name})`,
    ),
  ],
);

/**
 * A Generation's state (issue #43). Only `queued` exists so far: this
 * ticket submits and streams it but never dispatches it, so nothing can
 * yet move it on. Later issues add `running`, `succeeded`, `failed` and
 * `cancelled`. Every state here counts as "unfinished" for the delete
 * guards on Models and Backends.
 */
export const generationState = pgEnum("generation_state", ["queued"]);

/**
 * One request to produce output from a Model in a chosen Mode (issue
 * #43, ADR 0002: this table is the queue). `revisionId` and `modeId`
 * freeze the Model revision and Mode this Generation ran with, so later
 * edits never rewrite its history. `submissionId` groups the 1-4
 * Generations a single press of Generate makes (ADR 0007); all of them
 * share `submittedAt`. `builtPrompt` is the frozen prompt actually sent
 * to a Backend: the Mode's Path (ADR 0001) with each output node's
 * `filename_prefix` set to `studio/<generation-id>/`. `nodeTypes` is the
 * Path's distinct node class types, read back without recomputing the
 * Path against a Workflow that may since have changed. `backendId` is
 * set only once a later issue's dispatcher claims this Generation.
 */
export const generations = pgTable(
  "generations",
  {
    id: uuid("id").primaryKey(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => modelRevisions.id),
    modeId: uuid("mode_id")
      .notNull()
      .references(() => modes.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    backendId: uuid("backend_id").references(() => backends.id, {
      onDelete: "set null",
    }),
    submissionId: uuid("submission_id").notNull(),
    state: generationState("state").notNull().default("queued"),
    builtPrompt: jsonb("built_prompt").notNull(),
    nodeTypes: text("node_types").array().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("generations_model_id_idx").on(table.modelId),
    index("generations_user_id_idx").on(table.userId),
    index("generations_submission_id_idx").on(table.submissionId),
  ],
);

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
