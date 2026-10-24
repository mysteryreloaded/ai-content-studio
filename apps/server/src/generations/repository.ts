// Generation persistence (issue #43, ADR 0002: this table is the queue).
// This ticket only ever inserts `queued` rows; a later issue's
// dispatcher moves them on.

import type { Workflow } from "@ai-content-studio/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { generations, models, modes } from "../db/schema.js";

export interface GenerationRecord {
  id: string;
  modelId: string;
  revisionId: string;
  modeId: string;
  modeName: string;
  userId: string;
  submissionId: string;
  state: "queued";
  submittedAt: Date;
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
  submittedAt: Date;
}

type GenerationRow = typeof generations.$inferSelect;

function toRecord(row: GenerationRow, modeName: string): GenerationRecord {
  return {
    id: row.id,
    modelId: row.modelId,
    revisionId: row.revisionId,
    modeId: row.modeId,
    modeName,
    userId: row.userId,
    submissionId: row.submissionId,
    state: row.state,
    submittedAt: row.submittedAt,
  };
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
      .where(eq(generations.userId, userId))
      .orderBy(desc(generations.submittedAt));

    if (rows.length === 0) return [];

    const modelIds = [...new Set(rows.map((row) => row.generation.modelId))];
    const modelRows = await this.db
      .select({ id: models.id, slug: models.slug, name: models.name })
      .from(models)
      .where(inArray(models.id, modelIds));
    const modelById = new Map(modelRows.map((row) => [row.id, row]));

    return rows.map((row) => {
      const model = modelById.get(row.generation.modelId);
      return {
        ...toRecord(row.generation, row.mode.name),
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

    return orderedSubmissionIds.slice(0, limit).map((submissionId) => {
      const submissionRows = bySubmission.get(submissionId) ?? [];
      const first = submissionRows[0] as GenerationRow;
      return {
        submissionId,
        modeId: first.modeId,
        modeName: modeNameById.get(first.id) ?? "",
        submittedAt: first.submittedAt,
        generations: submissionRows.map((row) =>
          toRecord(row, modeNameById.get(row.id) ?? ""),
        ),
      };
    });
  }

  /** Whether this Model has any Generation that isn't done yet (issue #43: refuses deleting it). */
  async hasUnfinishedForModel(modelId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: generations.id })
      .from(generations)
      .where(eq(generations.modelId, modelId))
      .limit(1);
    return !!row;
  }

  /** Whether this Backend has any Generation that isn't done yet (issue #43: refuses deleting it). */
  async hasUnfinishedForBackend(backendId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: generations.id })
      .from(generations)
      .where(eq(generations.backendId, backendId))
      .limit(1);
    return !!row;
  }
}
