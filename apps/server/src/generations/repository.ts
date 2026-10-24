// Generation persistence (issue #43, ADR 0002: this table is the queue).
// This ticket only ever inserts `queued` rows; a later issue's
// dispatcher moves them on.

import type { Workflow } from "@ai-content-studio/shared";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { assets, generations, models, modes } from "../db/schema.js";

export type GenerationState =
  | "queued"
  | "starting"
  | "running"
  | "saving"
  | "succeeded"
  | "failed";

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
  error: string | null;
  submittedAt: Date;
  assets: AssetSummary[];
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
  generations: GenerationRecord[];
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
    error: row.error,
    submittedAt: row.submittedAt,
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
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return toRecord(row, input.modeName);
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
          notInArray(generations.state, ["succeeded", "failed"]),
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
  ): Promise<SubmissionSummary[]> {
    const rows = await this.db
      .select({ generation: generations, mode: modes })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .where(
        and(eq(generations.modelId, modelId), eq(generations.userId, userId)),
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

  /** Whether this Model has any Generation that isn't done yet (issue #43, #44: refuses deleting it). */
  async hasUnfinishedForModel(modelId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: generations.id })
      .from(generations)
      .where(
        and(
          eq(generations.modelId, modelId),
          notInArray(generations.state, ["succeeded", "failed"]),
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
          notInArray(generations.state, ["succeeded", "failed"]),
        ),
      )
      .limit(1);
    return !!row;
  }
}
