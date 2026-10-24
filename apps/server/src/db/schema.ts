import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
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
  /**
   * Issue #65: the Privacy policy's Operator part. Unlike Site terms,
   * there is no gate and nobody accepts it, so there is no version to
   * track — only when it was last saved, shown as "Last updated" on
   * `/privacy`. `privacyRevision` is its own optimistic-concurrency
   * token, independent of `version` and `termsRevision`, so saving one
   * form never races another into a spurious 409.
   */
  privacyBody: text("privacy_body").notNull().default(""),
  privacyUpdatedAt: timestamp("privacy_updated_at", { withTimezone: true }),
  privacyRevision: integer("privacy_revision").notNull().default(1),
  /** Issue #65: up to 3 extra footer links, each `{ label, url }`. */
  footerLinks: jsonb("footer_links").notNull().default([]),
  /**
   * Issue #66: words and phrases the studio refuses in prompts, already
   * NFKC-normalised, case-folded and deduped (see
   * `branding/blocked-words.ts`). `blockedWordsRevision` is its own
   * optimistic-concurrency token, independent of the other Site settings
   * forms', so saving one never races another into a spurious 409.
   */
  blockedWords: jsonb("blocked_words").notNull().default([]),
  blockedWordsRevision: integer("blocked_words_revision").notNull().default(1),
  /**
   * Issue #59: a short plain-text banner shown on every page, signed in
   * or out. `noticeRevision` is its own optimistic-concurrency token,
   * independent of the other Site settings forms', so saving one never
   * races another into a spurious 409. The standard message shown when
   * this is blank during a Pause lives in shared (`STANDARD_PAUSE_NOTICE`),
   * not here, since it's never actually saved.
   */
  notice: text("notice").notNull().default(""),
  noticeRevision: integer("notice_revision").notNull().default(1),
  /**
   * Issue #59: an Admin stopping generating site-wide for maintenance,
   * until an Admin resumes it. `pausedAt`/`pausedByName` are null while
   * not paused; `pausedByName` is the Admin's display name at the time
   * they paused (not a live join), so "Paused since … by …" keeps
   * reading correctly even if that Admin is later renamed or removed.
   */
  paused: boolean("paused").notNull().default(false),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedByName: text("paused_by_name"),
  /**
   * Issue #53: the daily Cap (rolling 24h) and the concurrent Cap (queued
   * through saving), both Admin-editable defaults; a user's own override
   * lives on `users` instead. `capsRevision` is its own
   * optimistic-concurrency token, independent of the other Site settings
   * forms', so saving one never races another into a spurious 409.
   */
  dailyCap: integer("daily_cap").notNull().default(20),
  concurrentCap: integer("concurrent_cap").notNull().default(4),
  capsRevision: integer("caps_revision").notNull().default(1),
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
  /**
   * Issue #53: this user's own Cap, 0-1,000, overriding the Site default
   * (null means "use the Site default"); 0 blocks them from generating
   * at all. Editing these is a later (user-management) ticket; this
   * ticket only stores and enforces them.
   */
  dailyCapOverride: integer("daily_cap_override"),
  concurrentCapOverride: integer("concurrent_cap_override"),
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
    /** Issue #44: an Admin's own on/off switch, separate from reachability — a disabled Backend is never dispatched to, even while reachable. */
    enabled: boolean("enabled").notNull().default(true),
    /** Issue #55: an Admin's own "finish what you have, take nothing new" switch — unlike `enabled`, a draining Backend keeps its in-flight try. */
    draining: boolean("draining").notNull().default(false),
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
    /**
     * Issue #61: `termsBody` is the Markdown shown in the blocking dialog,
     * but `termsVersion` only moves when it's first set or a save ticks
     * "Ask everyone to accept again" — a quiet text edit keeps everyone's
     * acceptance (mirrors `siteSettings.termsVersion`). A blank
     * `termsBody` means "no terms are set" for this Model; `termsVersion`
     * itself is kept (not nulled) across a clear, so a later save keeps
     * counting up instead of reusing a number an old acceptance already
     * points at. `termsRevision` is terms' own optimistic-concurrency
     * token, independent of `version`, so saving Details/Modes never
     * races a Terms save into a spurious 409. `licenseUrl` is an http(s)
     * URL or blank; `attribution` is shown atop the Workbench, the Models
     * home and a Generation's detail.
     */
    termsBody: text("terms_body").notNull().default(""),
    licenseUrl: text("license_url").notNull().default(""),
    attribution: text("attribution").notNull().default(""),
    termsVersion: integer("terms_version"),
    termsVersionCreatedAt: timestamp("terms_version_created_at", {
      withTimezone: true,
    }),
    termsRevision: integer("terms_revision").notNull().default(1),
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
 * One saved, immutable, numbered state of a Model's Workflow, Modes and
 * Inputs (issue #40, #42, #46). Never updated or deleted: a save of any
 * of the three makes a new row with the next `revisionNumber`. `inputs`
 * is an ordered JSON array of `InputDefinition` (packages/shared); it
 * carries forward unchanged when only Modes (or the reverse) are saved.
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
    inputs: jsonb("inputs").notNull().default([]),
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
 * One user's acceptance of a Model's terms (issue #61): at most one row
 * per Model and user, holding the latest `version` they accepted
 * (mirrors `users.termsAcceptedVersion` for Site terms, but per Model).
 * Re-accepting after "Ask everyone to accept again" overwrites the row
 * rather than keeping history, since only the latest acceptance matters.
 */
export const modelTermsAcceptances = pgTable(
  "model_terms_acceptances",
  {
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.userId] })],
);

/**
 * A Generation's state (issue #43, #44). `queued` -> `starting` ->
 * `running` -> `saving` -> `succeeded`, or `failed` from any of the
 * dispatched states. Cancellation isn't wired yet (a later issue). Every
 * state here counts as "unfinished" for the delete guards on Models and
 * Backends.
 */
export const generationState = pgEnum("generation_state", [
  "queued",
  "starting",
  "running",
  "saving",
  "succeeded",
  "failed",
]);

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
 * set once the dispatcher (issue #44) claims this Generation, and kept
 * afterwards for history even once the Backend frees. `error` is set
 * only on `failed`. Progress (step counter, elapsed/estimate) is kept in
 * memory only (issue #44's AC), not persisted here.
 *
 * Issue #55 (reliable dispatch): `tries` counts tries made so far (at
 * most 2) and also doubles as this row's own concurrency token — every
 * write a try makes is conditioned on `tries` still matching the value
 * it read at claim time, so a stale in-process runner's writes no-op
 * once a watchdog or a later try has already moved the row on.
 * `queuedAt` is when this row most recently became `queued` (first
 * submitted, or requeued after a lost try); it resets on each requeue,
 * unlike `submittedAt`. The "no usable Backend for 15 minutes" timeout
 * is tracked separately, in the Dispatcher's own memory, from when a
 * Model last had no usable Backend at all — not from `queuedAt` — so a
 * Generation queued a while behind a busy (but usable) Backend doesn't
 * fail the instant that Backend is drained or briefly unreachable.
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
    /** Issue #50: the Uploads its prompt names, sent to the claimed Backend before the prompt is queued. */
    uploadIds: uuid("upload_ids").array().notNull().default(sql`'{}'::uuid[]`),
    tries: integer("tries").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("generations_model_id_idx").on(table.modelId),
    index("generations_user_id_idx").on(table.userId),
    index("generations_submission_id_idx").on(table.submissionId),
    index("generations_state_idx").on(table.state),
    /**
     * One unfinished (starting/running) try per Backend at a time: the
     * dispatcher's claim UPDATE relies on this to fail with a unique
     * violation instead of double-booking a Backend on a race. `saving`
     * is deliberately excluded so the Backend frees as soon as the run
     * ends, letting the next start overlap this Generation's save.
     */
    uniqueIndex("generations_backend_unfinished_unique")
      .on(table.backendId)
      .where(
        sql`${table.state} in ('starting', 'running') and ${table.backendId} is not null`,
      ),
  ],
);

/**
 * One kept output file of a Generation (issue #44): one of its Mode's
 * output nodes' `/view` files whose ComfyUI `type` is `"output"`.
 * `sortOrder` mirrors the Mode's own output node order, so the first
 * (sortOrder 0) is the main Asset. Idempotent on (generation, node id,
 * ComfyUI file name): a retried save can't double-write the same file.
 *
 * Issue #45: `size` and `storageKey` hold the *finished* file (video is
 * re-muxed in place, metadata-stripped and comment-tagged); the finishing
 * facts below are null when finishing couldn't read the file (never
 * attempted for audio's poster/thumbnail, which it doesn't have).
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    kind: text("kind").notNull(),
    comfyuiFilename: text("comfyui_filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    posterKey: text("poster_key"),
    thumbnailKey: text("thumbnail_key"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    fps: doublePrecision("fps"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("assets_generation_node_filename_unique").on(
      table.generationId,
      table.nodeId,
      table.comfyuiFilename,
    ),
  ],
);

/**
 * An Upload's state (issue #50): `uploading` while chunks arrive,
 * `complete` once ffprobe accepted it, `failed` when it was refused at
 * complete (its bytes are deleted then).
 */
export const uploadStatus = pgEnum("upload_status", [
  "uploading",
  "complete",
  "failed",
]);

/**
 * A file a user supplies as an Input value (issue #50), received in
 * chunks. `receivedBytes` is the server's offset a resumed upload
 * continues from. `modelId`/`inputId` are only the hint given at create
 * (which Input's limits to check at complete); submit checks the Input
 * actually used. `kind`, `extension`, `width`/`height` and `probe` (the
 * ffprobe facts kept) are set at complete. `createdAt` is written from
 * the clock (ADR 0006): the cleanup of unused Uploads compares it.
 */
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: uploadStatus("status").notNull().default("uploading"),
    originalName: text("original_name").notNull(),
    declaredType: text("declared_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    receivedBytes: bigint("received_bytes", { mode: "number" })
      .notNull()
      .default(0),
    modelId: uuid("model_id"),
    inputId: text("input_id"),
    storageKey: text("storage_key").notNull(),
    thumbnailKey: text("thumbnail_key"),
    kind: text("kind"),
    extension: text("extension"),
    contentType: text("content_type"),
    width: integer("width"),
    height: integer("height"),
    probe: jsonb("probe"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("uploads_user_id_idx").on(table.userId)],
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
