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
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { Database, Transaction } from "../db/client.js";
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
const ENDED_STATES: readonly GenerationState[] = [
  "succeeded",
  "failed",
  "cancelled",
];

/** Issue #69: how many Generations {@link GenerationsRepository.pruneOldAssets} tombstones per `inArray`, well under Postgres' bound-parameter limit. */
const PRUNE_BATCH_SIZE = 500;

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

/**
 * Marks every named Upload used right now (issue #69): a Generation (a
 * real Submission, a Test, or "Reuse these settings" resubmitting one
 * already used) counts as a use the same way a chunk or complete does,
 * so retention's 24 h clock resets instead of running from the
 * Upload's own `createdAt`.
 */
async function touchUploads(
  db: Database | Transaction,
  uploadIds: readonly string[] | undefined,
  now: Date,
): Promise<void> {
  if (!uploadIds || uploadIds.length === 0) return;
  await db
    .update(uploads)
    .set({ lastUsedAt: now })
    .where(inArray(uploads.id, [...uploadIds]));
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
    await touchUploads(this.db, input.uploadIds, input.submittedAt);
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

      const uploadIds = [
        ...new Set(inputs.flatMap((input) => input.uploadIds ?? [])),
      ];
      await touchUploads(tx, uploadIds, now);

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
   * The retention sweep's AC (issue #69): turns every non-deleted
   * Generation with an Asset older than `cutoff` into a Tombstone, the
   * same mechanism (and the same storage keys handed back to the
   * caller) as a user's own delete.
   *
   * Runs in batches, oldest Asset first, rather than one `finishDelete`
   * across every matching id: a large backlog (e.g. retention turned on
   * long after launch) can exceed Postgres' bound-parameter limit in a
   * single `inArray`, which would otherwise fail this sweep every hour
   * forever.
   */
  async pruneOldAssets(cutoff: Date, now: Date): Promise<DeletedStorageKeys> {
    const result: DeletedStorageKeys = { assets: [], uploads: [] };
    while (true) {
      const rows = await this.db
        .select({
          id: generations.id,
          oldestAssetAt: sql<Date>`min(${assets.createdAt})`,
        })
        .from(assets)
        .innerJoin(generations, eq(generations.id, assets.generationId))
        .where(and(isNull(generations.deletedAt), lt(assets.createdAt, cutoff)))
        .groupBy(generations.id)
        .orderBy(sql`min(${assets.createdAt})`)
        .limit(PRUNE_BATCH_SIZE);
      if (rows.length === 0) break;
      const batch = await this.finishDelete(
        rows.map((row) => row.id),
        now,
      );
      result.assets.push(...batch.assets);
      result.uploads.push(...batch.uploads);
      if (rows.length < PRUNE_BATCH_SIZE) break;
    }
    return result;
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
