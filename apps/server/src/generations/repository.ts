// Generation persistence (issue #43, ADR 0002: this table is the queue).
// This ticket only ever inserts `queued` rows; a later issue's
// dispatcher moves them on.

import { DAY_MS } from "@ai-content-studio/shared";
import type {
  Clock,
  GenerationInputSetting,
  InputDefinition,
  Workflow,
} from "@ai-content-studio/shared";
import {
  type ModeInputSetting,
  resolveGenerationSettings,
} from "@ai-content-studio/shared";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { type AuditActor, recordAuditEntry } from "../audit/audit.js";
import type { Database } from "../db/client.js";
import {
  assets,
  generations,
  modelRevisions,
  models,
  modes,
  uploads,
  users,
  workflows,
} from "../db/schema.js";
import {
  ConcurrentCapExceeded,
  DailyCapExceeded,
  countConcurrentForUser,
  countDailyForUser,
  effectiveCapsFor,
} from "./caps.js";

export type GenerationState =
  | "queued"
  | "starting"
  | "running"
  | "saving"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled";

/** Issue #57: a Generation past any of these states can be deleted (into a Tombstone) or have its detail's "run time" shown. */
export const ENDED_STATES: readonly GenerationState[] = [
  "succeeded",
  "failed",
  "cancelled",
];

export interface AssetSummary {
  id: string;
  nodeId: string;
  sortOrder: number;
  kind: string;
  contentType: string;
}

export interface GenerationRecord {
  id: string;
  modelId: string;
  revisionId: string;
  modeId: string;
  modeName: string;
  userId: string;
  submissionId: string;
  state: GenerationState;
  /** Issue #55: tries made so far (at most 2). A queued card with `tries > 0` is retrying, not waiting for its first try. */
  tries: number;
  error: string | null;
  submittedAt: Date;
  startedAt: Date | null;
  /** Issue #57: when this Generation reached a terminal state; null while under way. */
  endedAt: Date | null;
  /** Issue #57: set once this Generation (or its Submission) was deleted — a Tombstone. */
  deletedAt: Date | null;
  /** Issue #68: set once an Admin removed this Generation — the owner sees a dismissable card, no reason. */
  removedAt: Date | null;
  assets: AssetSummary[];
  /** Issue #74: a test run of the Model editor's own unsaved state, never counted toward Caps and never current. */
  isTest: boolean;
}

export interface GenerationSummary extends GenerationRecord {
  modelSlug: string;
  modelName: string;
}

export interface SubmissionSummary {
  submissionId: string;
  modeId: string;
  modeName: string;
  submittedAt: Date;
  /** The Submission's prompt text, or null when the Model has no text Input to show (issue #47). */
  prompt: string | null;
  generations: GenerationRecord[];
}

/** The Gallery's state filter (issue #56): buckets of `GenerationState`. */
export type GalleryStateFilter = "underway" | "finished" | "failed";

const GALLERY_STATE_BUCKETS: Record<
  GalleryStateFilter,
  readonly GenerationState[]
> = {
  underway: ["queued", "starting", "running", "saving", "cancelling"],
  finished: ["succeeded"],
  // "Failed or cancelled" (issue #54): a cancelled Generation never
  // produced anything to show either, so it buckets with "failed".
  failed: ["failed", "cancelled"],
};

/** A Submission in the Gallery (issue #56): across every Model, with the whole of its Generations. */
export interface GallerySubmission {
  submissionId: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modeId: string;
  modeName: string;
  submittedAt: Date;
  generations: GenerationRecord[];
}

export interface GalleryPage {
  submissions: GallerySubmission[];
  hasMore: boolean;
}

export interface GalleryModelOption {
  id: string;
  slug: string;
  name: string;
  /** Sorts last in the filter (issue #56's AC), even though it's still shown for a user's past Submissions. */
  deleted: boolean;
}

/** One Asset's facts for the detail dialog (issue #57's AC): resolution, duration, fps, size. */
export interface GenerationAssetDetail extends AssetSummary {
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
}

/** A Generation's own detail (issue #57): owner-only, 404 otherwise. */
export interface GenerationDetail {
  id: string;
  state: GenerationState;
  error: string | null;
  tries: number;
  submittedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  deletedAt: Date | null;
  /** Issue #68: set once an Admin removed this Generation — the owner sees a dismissable card, no reason, no Reuse. */
  removedAt: Date | null;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modelAttribution: string;
  modelDeleted: boolean;
  modeId: string;
  modeName: string;
  assets: GenerationAssetDetail[];
  /** Empty for a Tombstone, which has nothing left to resolve. */
  settings: GenerationInputSetting[];
}

/** An Admin's own read-only view of a Generation (issue #68): everything `GenerationDetail` has, plus the owner, tries/error and (when removed) the reason. */
export interface AdminGenerationDetail extends GenerationDetail {
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  /** Shown to Admins only; the owner's own view never includes this. */
  removedReason: string | null;
  tries: number;
  error: string | null;
}

/** The Admin Generations page's state filter (issue #68): every real `GenerationState`, plus "deleted" and "removed" (mutually exclusive with a real state and with each other — a deleted row never also matches "removed"). */
export type AdminGenerationStatusFilter =
  | GenerationState
  | "deleted"
  | "removed";

export interface AdminGenerationRow {
  id: string;
  modelId: string;
  modelName: string;
  modelSlug: string;
  modeId: string;
  modeName: string;
  userId: string;
  userEmail: string;
  userName: string;
  state: GenerationState;
  isTest: boolean;
  deletedAt: Date | null;
  removedAt: Date | null;
  submittedAt: Date;
  endedAt: Date | null;
}

export interface AdminGenerationListParams {
  modelId?: string;
  modeId?: string;
  userId?: string;
  status?: AdminGenerationStatusFilter;
  isTest?: boolean;
  from?: Date;
  to?: Date;
  cursor?: { submittedAt: Date; id: string };
  limit: number;
}

export interface AdminGenerationListPage {
  generations: AdminGenerationRow[];
  hasMore: boolean;
}

/** Just enough to decide how to remove a Generation (issue #68): who owns it, its Model/Mode, and whether it's already gone. */
export interface GenerationForRemoval {
  userId: string;
  modelId: string;
  modeId: string;
  state: GenerationState;
  tries: number;
  deletedAt: Date | null;
  removedAt: Date | null;
}

/** Storage keys {@link GenerationsRepository.finishDelete} collected, for the route to delete from `Storage` once the Tombstone is committed. */
export interface DeletedStorageKeys {
  assets: {
    storageKey: string;
    posterKey: string | null;
    thumbnailKey: string | null;
  }[];
  uploads: { storageKey: string; thumbnailKey: string | null }[];
}

/** Where a Model's "prompt" field lives, and the value it has when a user leaves it blank (issue #47). */
export interface PromptBinding {
  nodeId: string;
  field: string;
  unsetValue: string;
}

/** Where a Model's "prompt" field lives (issue #47): its first text Input's first binding, and the value it has when a user leaves it blank. */
export function promptBindingFor(
  inputs: readonly InputDefinition[],
  workflow: Workflow,
): PromptBinding | null {
  const promptInput = inputs.find((input) => input.kind === "text");
  const binding = promptInput?.bindings[0];
  if (!promptInput || promptInput.kind !== "text" || !binding) return null;
  const workflowValue = workflow[binding.nodeId]?.inputs[binding.field];
  const placeholder = typeof workflowValue === "string" ? workflowValue : "";
  return {
    nodeId: binding.nodeId,
    field: binding.field,
    unsetValue: promptInput.default || placeholder,
  };
}

/** A Submission's prompt (issue #47): the frozen value at `binding`, prefixed "Default prompt: " when it matches the Workflow's own unset value. */
export function promptFor(
  builtPrompt: Workflow,
  binding: PromptBinding | null | undefined,
): string | null {
  if (!binding) return null;
  const node = builtPrompt[binding.nodeId];
  const value = node?.inputs[binding.field];
  if (typeof value !== "string") return null;
  return value === binding.unsetValue ? `Default prompt: ${value}` : value;
}

export interface CreateGenerationInput {
  id: string;
  modelId: string;
  revisionId: string;
  modeId: string;
  modeName: string;
  userId: string;
  submissionId: string;
  builtPrompt: Workflow;
  nodeTypes: string[];
  /** Issue #50: the Uploads `builtPrompt` names. */
  uploadIds?: string[];
  submittedAt: Date;
  /** Issue #74: true for a Test run; defaults false for a real Submission. */
  isTest?: boolean;
  /** Issue #74: the Backend a Test pinned itself to, or null/undefined for Any. */
  pinnedBackendId?: string | null;
}

type GenerationRow = typeof generations.$inferSelect;
type AssetRow = typeof assets.$inferSelect;

function toAssetSummary(row: AssetRow): AssetSummary {
  return {
    id: row.id,
    nodeId: row.nodeId,
    sortOrder: row.sortOrder,
    kind: row.kind,
    contentType: row.contentType,
  };
}

function toRecord(
  row: GenerationRow,
  modeName: string,
  assetRows: readonly AssetRow[] = [],
): GenerationRecord {
  return {
    id: row.id,
    modelId: row.modelId,
    revisionId: row.revisionId,
    modeId: row.modeId,
    modeName,
    userId: row.userId,
    submissionId: row.submissionId,
    state: row.state,
    tries: row.tries,
    error: row.error,
    submittedAt: row.submittedAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    deletedAt: row.deletedAt,
    removedAt: row.removedAt,
    isTest: row.isTest,
    assets: [...assetRows]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toAssetSummary),
  };
}

async function assetsByGenerationId(
  db: Database,
  generationIds: readonly string[],
): Promise<Map<string, AssetRow[]>> {
  if (generationIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(assets)
    .where(inArray(assets.generationId, generationIds));
  const byId = new Map<string, AssetRow[]>();
  for (const row of rows) {
    const list = byId.get(row.generationId) ?? [];
    list.push(row);
    byId.set(row.generationId, list);
  }
  return byId;
}

export class GenerationsRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateGenerationInput): Promise<GenerationRecord> {
    const [row] = await this.db
      .insert(generations)
      .values({
        id: input.id,
        modelId: input.modelId,
        revisionId: input.revisionId,
        modeId: input.modeId,
        userId: input.userId,
        submissionId: input.submissionId,
        builtPrompt: input.builtPrompt,
        nodeTypes: input.nodeTypes,
        uploadIds: input.uploadIds ?? [],
        submittedAt: input.submittedAt,
        queuedAt: input.submittedAt,
        isTest: input.isTest ?? false,
        pinnedBackendId: input.pinnedBackendId ?? null,
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return toRecord(row, input.modeName);
  }

  /**
   * One Submission's 1-4 Generations (issue #47, ADR "Submission
   * creation is one locked transaction"; issue #53, ADR "Caps are
   * checked in the locking transaction"): locks the submitting user's
   * row before inserting every Generation, so two presses of Generate
   * from the same user never interleave their draws or their Cap
   * checks. Caps are checked all-or-nothing against this one
   * Submission's own count: a Submission that would exceed either Cap
   * is refused whole, inserting nothing.
   */
  async createSubmission(
    userId: string,
    inputs: readonly CreateGenerationInput[],
    siteCaps: { dailyCap: number; concurrentCap: number },
    clock: Clock,
  ): Promise<GenerationRecord[]> {
    return await this.db.transaction(async (tx) => {
      const [userRow] = await tx
        .select({
          id: users.id,
          dailyCapOverride: users.dailyCapOverride,
          concurrentCapOverride: users.concurrentCapOverride,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!userRow) throw new Error("user not found");

      const caps = effectiveCapsFor(siteCaps, userRow);
      const now = clock.now();
      const since = new Date(now.getTime() - DAY_MS);
      const [dailyUsed, concurrentUsed] = await Promise.all([
        countDailyForUser(tx, userId, since),
        countConcurrentForUser(tx, userId),
      ]);

      if (dailyUsed + inputs.length > caps.dailyCap) {
        throw new DailyCapExceeded(
          caps.dailyCap,
          Math.max(0, caps.dailyCap - dailyUsed),
        );
      }
      if (concurrentUsed + inputs.length > caps.concurrentCap) {
        throw new ConcurrentCapExceeded(
          caps.concurrentCap,
          Math.max(0, caps.concurrentCap - concurrentUsed),
        );
      }

      const rows = await tx
        .insert(generations)
        .values(
          inputs.map((input) => ({
            id: input.id,
            modelId: input.modelId,
            revisionId: input.revisionId,
            modeId: input.modeId,
            userId: input.userId,
            submissionId: input.submissionId,
            builtPrompt: input.builtPrompt,
            nodeTypes: input.nodeTypes,
            uploadIds: input.uploadIds ?? [],
            submittedAt: input.submittedAt,
            queuedAt: input.submittedAt,
          })),
        )
        .returning();

      const modeNameById = new Map(
        inputs.map((input) => [input.id, input.modeName]),
      );
      return rows.map((row) => toRecord(row, modeNameById.get(row.id) ?? ""));
    });
  }

  /** Every unfinished Generation of this user, across every Model (issue #43: one SSE stream per tab). */
  async listActiveForUser(userId: string): Promise<GenerationSummary[]> {
    const rows = await this.db
      .select({ generation: generations, mode: modes })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .where(
        and(
          eq(generations.userId, userId),
          notInArray(generations.state, ["succeeded", "failed", "cancelled"]),
        ),
      )
      .orderBy(desc(generations.submittedAt));

    if (rows.length === 0) return [];

    const modelIds = [...new Set(rows.map((row) => row.generation.modelId))];
    const modelRows = await this.db
      .select({ id: models.id, slug: models.slug, name: models.name })
      .from(models)
      .where(inArray(models.id, modelIds));
    const modelById = new Map(modelRows.map((row) => [row.id, row]));
    const assetsById = await assetsByGenerationId(
      this.db,
      rows.map((row) => row.generation.id),
    );

    return rows.map((row) => {
      const model = modelById.get(row.generation.modelId);
      return {
        ...toRecord(
          row.generation,
          row.mode.name,
          assetsById.get(row.generation.id) ?? [],
        ),
        modelSlug: model?.slug ?? "",
        modelName: model?.name ?? "",
      };
    });
  }

  /** This Model's latest `limit` Submissions, this user's own (issue #43's right panel). */
  async listRecentSubmissionsForModel(
    modelId: string,
    userId: string,
    limit: number,
    promptBinding?: PromptBinding | null,
  ): Promise<SubmissionSummary[]> {
    const rows = await this.db
      .select({ generation: generations, mode: modes })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .where(
        and(
          eq(generations.modelId, modelId),
          eq(generations.userId, userId),
          isNull(generations.deletedAt),
        ),
      )
      .orderBy(desc(generations.submittedAt))
      .limit(200);

    const bySubmission = new Map<string, GenerationRow[]>();
    const orderedSubmissionIds: string[] = [];
    for (const row of rows) {
      const id = row.generation.submissionId;
      if (!bySubmission.has(id)) {
        bySubmission.set(id, []);
        orderedSubmissionIds.push(id);
      }
      bySubmission.get(id)?.push(row.generation);
    }
    const modeNameById = new Map(
      rows.map((row) => [row.generation.id, row.mode.name]),
    );
    const assetsById = await assetsByGenerationId(
      this.db,
      rows.map((row) => row.generation.id),
    );

    return orderedSubmissionIds.slice(0, limit).map((submissionId) => {
      const submissionRows = bySubmission.get(submissionId) ?? [];
      const first = submissionRows[0] as GenerationRow;
      return {
        submissionId,
        modeId: first.modeId,
        modeName: modeNameById.get(first.id) ?? "",
        submittedAt: first.submittedAt,
        prompt: promptFor(first.builtPrompt as Workflow, promptBinding),
        generations: submissionRows.map((row) =>
          toRecord(
            row,
            modeNameById.get(row.id) ?? "",
            assetsById.get(row.id) ?? [],
          ),
        ),
      };
    });
  }

  /** This Model's last `limit` Tests, this Admin's own (issue #74's AC: "the last 5 tests are listed"). */
  async listRecentTestsForModel(
    modelId: string,
    userId: string,
    limit: number,
  ): Promise<GenerationSummary[]> {
    const rows = await this.db
      .select({ generation: generations, mode: modes, model: models })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .innerJoin(models, eq(models.id, generations.modelId))
      .where(
        and(
          eq(generations.modelId, modelId),
          eq(generations.userId, userId),
          eq(generations.isTest, true),
        ),
      )
      .orderBy(desc(generations.submittedAt))
      .limit(limit);

    const assetsById = await assetsByGenerationId(
      this.db,
      rows.map((row) => row.generation.id),
    );
    return rows.map((row) => ({
      ...toRecord(
        row.generation,
        row.mode.name,
        assetsById.get(row.generation.id) ?? [],
      ),
      modelSlug: row.model.slug,
      modelName: row.model.name,
    }));
  }

  /** Whether this Model has any Generation that isn't done yet (issue #43, #44: refuses deleting it). */
  async hasUnfinishedForModel(modelId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: generations.id })
      .from(generations)
      .where(
        and(
          eq(generations.modelId, modelId),
          notInArray(generations.state, ["succeeded", "failed", "cancelled"]),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** Whether this Backend has any Generation that isn't done yet (issue #43, #44: refuses deleting it). */
  async hasUnfinishedForBackend(backendId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: generations.id })
      .from(generations)
      .where(
        and(
          eq(generations.backendId, backendId),
          notInArray(generations.state, ["succeeded", "failed", "cancelled"]),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** Just enough to decide how to cancel a Generation (issue #54): who owns it and where it currently is. */
  async getForCancel(
    generationId: string,
  ): Promise<{ userId: string; state: GenerationState } | null> {
    const [row] = await this.db
      .select({ userId: generations.userId, state: generations.state })
      .from(generations)
      .where(eq(generations.id, generationId));
    return row ?? null;
  }

  /** This user's own unfinished Generation ids within one Submission (issue #54's AC: "Cancel all on a Submission block"). */
  async listUnfinishedIdsForSubmission(
    submissionId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ id: generations.id })
      .from(generations)
      .where(
        and(
          eq(generations.submissionId, submissionId),
          eq(generations.userId, userId),
          notInArray(generations.state, ["succeeded", "failed", "cancelled"]),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** One Generation, enriched like the SSE/submit events (issue #54: so a cancel's own "change" can be published straight away). */
  async getSummary(generationId: string): Promise<GenerationSummary | null> {
    const [row] = await this.db
      .select({ generation: generations, mode: modes })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .where(eq(generations.id, generationId));
    if (!row) return null;

    const [model] = await this.db
      .select({ slug: models.slug, name: models.name })
      .from(models)
      .where(eq(models.id, row.generation.modelId));
    const assetRows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.generationId, generationId));

    return {
      ...toRecord(row.generation, row.mode.name, assetRows),
      modelSlug: model?.slug ?? "",
      modelName: model?.name ?? "",
    };
  }

  /**
   * The Gallery's page of Submissions (issue #56): every Model, newest
   * first, paged by a (submitted-at, submission id) keyset cursor. A
   * Submission shows whole once any of its Generations matches `modelId`
   * and `stateFilter` (the AC: it stays shown even if that Generation's
   * state moves on from the match during this page's lifetime).
   */
  async listGallerySubmissions(params: {
    userId: string;
    modelId?: string;
    stateFilter?: GalleryStateFilter;
    cursor?: { submittedAt: Date; submissionId: string };
    limit: number;
  }): Promise<GalleryPage> {
    const clauses = [
      eq(generations.userId, params.userId),
      isNull(generations.deletedAt),
      // Issue #68's AC: a removed Generation keeps showing under All
      // until the owner dismisses its card, then it drops out of the
      // Gallery for good (though the row itself, and the Audit entry,
      // stay for Admins).
      or(isNull(generations.removedAt), isNull(generations.removedDismissedAt)),
    ];
    if (params.modelId) clauses.push(eq(generations.modelId, params.modelId));
    if (params.stateFilter) {
      clauses.push(
        inArray(generations.state, GALLERY_STATE_BUCKETS[params.stateFilter]),
      );
    }
    if (params.cursor) {
      const cursorClause = or(
        lt(generations.submittedAt, params.cursor.submittedAt),
        and(
          eq(generations.submittedAt, params.cursor.submittedAt),
          lt(generations.submissionId, params.cursor.submissionId),
        ),
      );
      if (cursorClause) clauses.push(cursorClause);
    }

    const idRows = await this.db
      .selectDistinct({
        submissionId: generations.submissionId,
        submittedAt: generations.submittedAt,
      })
      .from(generations)
      .where(and(...clauses))
      .orderBy(desc(generations.submittedAt), desc(generations.submissionId))
      .limit(params.limit + 1);

    const hasMore = idRows.length > params.limit;
    const page = hasMore ? idRows.slice(0, params.limit) : idRows;
    const orderedIds = page.map((row) => row.submissionId);
    if (orderedIds.length === 0) return { submissions: [], hasMore: false };

    const rows = await this.db
      .select({ generation: generations, mode: modes, model: models })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .innerJoin(models, eq(models.id, generations.modelId))
      .where(
        and(
          inArray(generations.submissionId, orderedIds),
          isNull(generations.deletedAt),
        ),
      );

    const assetsById = await assetsByGenerationId(
      this.db,
      rows.map((row) => row.generation.id),
    );

    const bySubmission = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = bySubmission.get(row.generation.submissionId) ?? [];
      list.push(row);
      bySubmission.set(row.generation.submissionId, list);
    }

    const submissions: GallerySubmission[] = orderedIds.map((submissionId) => {
      const submissionRows = (bySubmission.get(submissionId) ?? []).sort(
        (a, b) => a.generation.id.localeCompare(b.generation.id),
      );
      const first = submissionRows[0] as (typeof rows)[number];
      return {
        submissionId,
        modelId: first.generation.modelId,
        modelSlug: first.model.slug,
        modelName: first.model.name,
        modeId: first.generation.modeId,
        modeName: first.mode.name,
        submittedAt: first.generation.submittedAt,
        generations: submissionRows.map((row) =>
          toRecord(
            row.generation,
            row.mode.name,
            assetsById.get(row.generation.id) ?? [],
          ),
        ),
      };
    });

    return { submissions, hasMore };
  }

  /** Models this user has ever submitted a Generation for, in Admin order, a deleted Model sorted last (issue #56). */
  async listUsedModelsForUser(userId: string): Promise<GalleryModelOption[]> {
    const rows = await this.db
      .selectDistinct({
        id: models.id,
        slug: models.slug,
        name: models.name,
        sortOrder: models.sortOrder,
        deletedAt: models.deletedAt,
      })
      .from(generations)
      .innerJoin(models, eq(models.id, generations.modelId))
      .where(eq(generations.userId, userId));

    return rows
      .sort((a, b) => {
        const aDeleted = a.deletedAt !== null;
        const bDeleted = b.deletedAt !== null;
        if (aDeleted !== bDeleted) return aDeleted ? 1 : -1;
        return a.sortOrder - b.sortOrder;
      })
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        deleted: row.deletedAt !== null,
      }));
  }

  /**
   * One Generation's own detail (issue #57): the owner only — the route
   * turns `null` into a 404, same for a non-owner as for a missing id. A
   * Tombstone (`deletedAt` set) has no settings left to resolve: its
   * `builtPrompt`/Uploads are already cleared, so `settings` comes back
   * empty rather than resolved against emptied data.
   */
  async getDetailForUser(
    generationId: string,
    userId: string,
  ): Promise<GenerationDetail | null> {
    const [row] = await this.db
      .select({ generation: generations, mode: modes, model: models })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .innerJoin(models, eq(models.id, generations.modelId))
      .where(eq(generations.id, generationId));
    if (!row || row.generation.userId !== userId) return null;

    const assetRows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.generationId, generationId));

    const settings = row.generation.deletedAt
      ? []
      : await this.resolveSettings(row.generation, row.mode.inputSettings);

    return {
      id: row.generation.id,
      state: row.generation.state,
      error: row.generation.error,
      tries: row.generation.tries,
      submittedAt: row.generation.submittedAt,
      startedAt: row.generation.startedAt,
      endedAt: row.generation.endedAt,
      deletedAt: row.generation.deletedAt,
      removedAt: row.generation.removedAt,
      modelId: row.generation.modelId,
      modelSlug: row.model.slug,
      modelName: row.model.name,
      modelAttribution: row.model.attribution,
      modelDeleted: row.model.deletedAt !== null,
      modeId: row.generation.modeId,
      modeName: row.mode.name,
      assets: [...assetRows]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(toAssetDetail),
      settings,
    };
  }

  /**
   * One Generation's own detail, for an Admin (issue #68): unlike
   * {@link getDetailForUser}, there's no owner check (any Generation
   * resolves) and settings are resolved even once it's been removed
   * (only a Tombstone's `deletedAt` empties them) — a Removal
   * deliberately keeps `builtPrompt`/`uploadIds` so an Admin can still
   * see the values, prompt and Upload links it ran with.
   */
  async getAdminDetail(
    generationId: string,
  ): Promise<AdminGenerationDetail | null> {
    const [row] = await this.db
      .select({
        generation: generations,
        mode: modes,
        model: models,
        user: users,
      })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .innerJoin(models, eq(models.id, generations.modelId))
      .innerJoin(users, eq(users.id, generations.userId))
      .where(eq(generations.id, generationId));
    if (!row) return null;

    const assetRows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.generationId, generationId));

    const settings = row.generation.deletedAt
      ? []
      : await this.resolveSettings(row.generation, row.mode.inputSettings);

    return {
      id: row.generation.id,
      state: row.generation.state,
      error: row.generation.error,
      tries: row.generation.tries,
      submittedAt: row.generation.submittedAt,
      startedAt: row.generation.startedAt,
      endedAt: row.generation.endedAt,
      deletedAt: row.generation.deletedAt,
      removedAt: row.generation.removedAt,
      removedReason: row.generation.removedReason,
      ownerId: row.user.id,
      ownerEmail: row.user.email,
      ownerName: row.user.name,
      modelId: row.generation.modelId,
      modelSlug: row.model.slug,
      modelName: row.model.name,
      modelAttribution: row.model.attribution,
      modelDeleted: row.model.deletedAt !== null,
      modeId: row.generation.modeId,
      modeName: row.mode.name,
      assets: [...assetRows]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(toAssetDetail),
      settings,
    };
  }

  /**
   * The Admin Generations page's list (issue #68): across every user,
   * newest first, filterable by Model, Mode, user, status (a real state,
   * or "deleted"/"removed") and date, paged by a (submitted-at, id)
   * keyset cursor.
   */
  async listForAdmin(
    params: AdminGenerationListParams,
  ): Promise<AdminGenerationListPage> {
    const clauses = [];
    if (params.modelId) clauses.push(eq(generations.modelId, params.modelId));
    if (params.modeId) clauses.push(eq(generations.modeId, params.modeId));
    if (params.userId) clauses.push(eq(generations.userId, params.userId));
    if (params.isTest !== undefined) {
      clauses.push(eq(generations.isTest, params.isTest));
    }
    if (params.from) clauses.push(gte(generations.submittedAt, params.from));
    if (params.to) clauses.push(lte(generations.submittedAt, params.to));

    if (params.status === "deleted") {
      clauses.push(isNotNull(generations.deletedAt));
    } else if (params.status === "removed") {
      clauses.push(
        and(isNotNull(generations.removedAt), isNull(generations.deletedAt)),
      );
    } else if (params.status) {
      clauses.push(
        and(
          eq(generations.state, params.status),
          isNull(generations.deletedAt),
          isNull(generations.removedAt),
        ),
      );
    }

    if (params.cursor) {
      const cursorClause = or(
        lt(generations.submittedAt, params.cursor.submittedAt),
        and(
          eq(generations.submittedAt, params.cursor.submittedAt),
          lt(generations.id, params.cursor.id),
        ),
      );
      if (cursorClause) clauses.push(cursorClause);
    }

    const rows = await this.db
      .select({
        generation: generations,
        mode: modes,
        model: models,
        user: users,
      })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .innerJoin(models, eq(models.id, generations.modelId))
      .innerJoin(users, eq(users.id, generations.userId))
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(desc(generations.submittedAt), desc(generations.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;

    return {
      generations: page.map((row) => ({
        id: row.generation.id,
        modelId: row.generation.modelId,
        modelName: row.model.name,
        modelSlug: row.model.slug,
        modeId: row.generation.modeId,
        modeName: row.mode.name,
        userId: row.generation.userId,
        userEmail: row.user.email,
        userName: row.user.name,
        state: row.generation.state,
        isTest: row.generation.isTest,
        deletedAt: row.generation.deletedAt,
        removedAt: row.generation.removedAt,
        submittedAt: row.generation.submittedAt,
        endedAt: row.generation.endedAt,
      })),
      hasMore,
    };
  }

  /** Resolves the Admin Generations page's jump-to box (issue #68's AC): a Generation id matches directly, else an Asset id resolves to its own Generation. */
  async resolveJumpTarget(id: string): Promise<string | null> {
    const [generation] = await this.db
      .select({ id: generations.id })
      .from(generations)
      .where(eq(generations.id, id));
    if (generation) return generation.id;

    const [asset] = await this.db
      .select({ generationId: assets.generationId })
      .from(assets)
      .where(eq(assets.id, id));
    return asset?.generationId ?? null;
  }

  /** Just enough to decide how to remove a Generation (issue #68). */
  async getForRemoval(
    generationId: string,
  ): Promise<GenerationForRemoval | null> {
    const [row] = await this.db
      .select({
        userId: generations.userId,
        modelId: generations.modelId,
        modeId: generations.modeId,
        state: generations.state,
        tries: generations.tries,
        deletedAt: generations.deletedAt,
        removedAt: generations.removedAt,
      })
      .from(generations)
      .where(eq(generations.id, generationId));
    return row ?? null;
  }

  /**
   * Removes one Generation (issue #68's AC): deletes its Assets (rows and
   * files, like a user delete) but, unlike a Tombstone, keeps
   * `builtPrompt`/`uploadIds` so an Admin can still see the values,
   * prompt and Upload links it ran with. Call only once the Generation
   * is no longer active (the caller, generations/removal.ts, cancels it
   * first); this just records the Removal and cleans up its Assets. The
   * Audit entry (ADR 0005) holds only the Generation id, owner, Model,
   * Mode and reason (the AC) — nothing else about the Generation.
   */
  async markRemoved(
    generationId: string,
    owner: { id: string; modelId: string; modeId: string },
    reason: string,
    actor: AuditActor,
    clock: Clock,
    now: Date,
  ): Promise<DeletedStorageKeys> {
    const assetRows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.generationId, generationId));

    await this.db.transaction(async (tx) => {
      await tx.delete(assets).where(eq(assets.generationId, generationId));
      await tx
        .update(generations)
        .set({ removedAt: now, removedReason: reason })
        .where(eq(generations.id, generationId));
      await recordAuditEntry(tx, clock, {
        actor,
        targetType: "generation",
        targetId: generationId,
        action: "remove",
        before: null,
        after: {
          ownerId: owner.id,
          modelId: owner.modelId,
          modeId: owner.modeId,
          reason,
        },
      });
    });

    return {
      assets: assetRows.map((row) => ({
        storageKey: row.storageKey,
        posterKey: row.posterKey,
        thumbnailKey: row.thumbnailKey,
      })),
      uploads: [],
    };
  }

  /** The owner dismissing their "Removed by an administrator" card (issue #68's AC): false when it's not this user's own, or isn't removed. */
  async dismissRemoved(
    generationId: string,
    userId: string,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({ removedDismissedAt: now })
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.userId, userId),
          isNotNull(generations.removedAt),
        ),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /** Every still-active Generation using this Upload (issue #68's AC: it fails them when the Upload is removed). */
  async listActiveUsingUpload(
    uploadId: string,
  ): Promise<{ id: string; userId: string; tries: number }[]> {
    const rows = await this.db
      .select({
        id: generations.id,
        userId: generations.userId,
        tries: generations.tries,
      })
      .from(generations)
      .where(
        and(
          notInArray(generations.state, ["succeeded", "failed", "cancelled"]),
          isNull(generations.deletedAt),
          sql`${generations.uploadIds} @> ARRAY[${uploadId}]::uuid[]`,
        ),
      );
    return rows;
  }

  private async resolveSettings(
    generation: GenerationRow,
    modeInputSettings: unknown,
  ): Promise<GenerationInputSetting[]> {
    const [revision] = await this.db
      .select()
      .from(modelRevisions)
      .where(eq(modelRevisions.id, generation.revisionId));
    if (!revision) return [];

    const [workflowRow] = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.hash, revision.workflowHash));
    if (!workflowRow) return [];

    const uploadIds = generation.uploadIds;
    const uploadRows =
      uploadIds.length === 0
        ? []
        : await this.db
            .select()
            .from(uploads)
            .where(inArray(uploads.id, uploadIds));

    const trimmedFromIds = uploadRows
      .map((upload) => upload.trimmedFromId)
      .filter((id): id is string => id !== null);
    const trimmedFromRows =
      trimmedFromIds.length === 0
        ? []
        : await this.db
            .select({ id: uploads.id, originalName: uploads.originalName })
            .from(uploads)
            .where(inArray(uploads.id, trimmedFromIds));
    const trimmedFromNameById = new Map(
      trimmedFromRows.map((row) => [row.id, row.originalName]),
    );

    const uploadLookups = uploadRows.map((upload) => ({
      id: upload.id,
      extension: upload.extension ?? "",
      facts: {
        id: upload.id,
        name: upload.originalName,
        size: upload.size,
        durationMs: upload.durationMs,
        width: upload.width,
        height: upload.height,
        thumbnailKey: upload.thumbnailKey,
        trimmedFromName: upload.trimmedFromId
          ? (trimmedFromNameById.get(upload.trimmedFromId) ?? null)
          : null,
        removed: upload.removedAt !== null,
      },
    }));

    return resolveGenerationSettings({
      inputs: revision.inputs as InputDefinition[],
      modeInputSettings: modeInputSettings as ModeInputSetting[],
      workflow: workflowRow.json as Workflow,
      builtPrompt: generation.builtPrompt as Workflow,
      uploads: uploadLookups,
    });
  }

  /**
   * Deletes one ended Generation (issue #57's AC), into a Tombstone:
   * `null` when it's missing, not this user's, already deleted, or
   * still under way (nothing to delete yet — cancel it first).
   */
  async deleteGeneration(
    generationId: string,
    userId: string,
    now: Date,
  ): Promise<DeletedStorageKeys | null> {
    const [row] = await this.db
      .select({
        state: generations.state,
        userId: generations.userId,
        deletedAt: generations.deletedAt,
      })
      .from(generations)
      .where(eq(generations.id, generationId));
    if (
      !row ||
      row.userId !== userId ||
      row.deletedAt !== null ||
      !ENDED_STATES.includes(row.state)
    ) {
      return null;
    }
    return this.finishDelete([generationId], now);
  }

  /**
   * Deletes a whole Submission (issue #57's AC): `null` when any of its
   * Generations is missing from this user's own, already deleted, or
   * still under way — cancel it first, same as deleting one.
   */
  async deleteSubmission(
    submissionId: string,
    userId: string,
    now: Date,
  ): Promise<DeletedStorageKeys | null> {
    const rows = await this.db
      .select({
        id: generations.id,
        state: generations.state,
        userId: generations.userId,
        deletedAt: generations.deletedAt,
      })
      .from(generations)
      .where(eq(generations.submissionId, submissionId));
    if (
      rows.length === 0 ||
      rows.some(
        (row) =>
          row.userId !== userId ||
          row.deletedAt !== null ||
          !ENDED_STATES.includes(row.state),
      )
    ) {
      return null;
    }
    return this.finishDelete(
      rows.map((row) => row.id),
      now,
    );
  }

  /**
   * Turns `ids` into Tombstones (issue #57, ADR 0011): deletes their
   * Assets outright, clears `builtPrompt`/`nodeTypes`/`uploadIds` and
   * sets `deletedAt`, then sweeps any Upload those Generations used that
   * no other, non-deleted Generation of this user still references.
   * Returns the storage keys the caller (the route) must delete from
   * `Storage` — this repository never touches it directly.
   */
  private async finishDelete(
    ids: readonly string[],
    now: Date,
  ): Promise<DeletedStorageKeys> {
    const assetRows = await this.db
      .select()
      .from(assets)
      .where(inArray(assets.generationId, ids));
    const genRows = await this.db
      .select({ id: generations.id, uploadIds: generations.uploadIds })
      .from(generations)
      .where(inArray(generations.id, ids));
    const uploadIdSet = new Set<string>();
    for (const row of genRows) {
      for (const uploadId of row.uploadIds) uploadIdSet.add(uploadId);
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(assets).where(inArray(assets.generationId, ids));
      await tx
        .update(generations)
        .set({
          deletedAt: now,
          builtPrompt: {},
          nodeTypes: [],
          uploadIds: [],
        })
        .where(inArray(generations.id, ids));
    });

    const uploadKeys: DeletedStorageKeys["uploads"] = [];
    for (const uploadId of uploadIdSet) {
      const [stillUsed] = await this.db
        .select({ id: generations.id })
        .from(generations)
        .where(
          and(
            isNull(generations.deletedAt),
            sql`${generations.uploadIds} @> ARRAY[${uploadId}]::uuid[]`,
          ),
        )
        .limit(1);
      if (stillUsed) continue;

      const [uploadRow] = await this.db
        .select()
        .from(uploads)
        .where(eq(uploads.id, uploadId));
      if (!uploadRow) continue;
      await this.db.delete(uploads).where(eq(uploads.id, uploadId));
      uploadKeys.push({
        storageKey: uploadRow.storageKey,
        thumbnailKey: uploadRow.thumbnailKey,
      });
    }

    return {
      assets: assetRows.map((row) => ({
        storageKey: row.storageKey,
        posterKey: row.posterKey,
        thumbnailKey: row.thumbnailKey,
      })),
      uploads: uploadKeys,
    };
  }
}

function toAssetDetail(row: AssetRow): GenerationAssetDetail {
  return {
    id: row.id,
    nodeId: row.nodeId,
    sortOrder: row.sortOrder,
    kind: row.kind,
    contentType: row.contentType,
    size: row.size,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    fps: row.fps,
  };
}
