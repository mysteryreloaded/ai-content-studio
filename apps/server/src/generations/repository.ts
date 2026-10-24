// Generation persistence (issue #43, ADR 0002: this table is the queue).
// This ticket only ever inserts `queued` rows; a later issue's
// dispatcher moves them on.

import type { InputDefinition, Workflow } from "@ai-content-studio/shared";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { assets, generations, models, modes, users } from "../db/schema.js";

export type GenerationState =
  | "queued"
  | "starting"
  | "running"
  | "saving"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled";

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
  /** The Submission's prompt text, or null when the Model has no text Input to show (issue #47). */
  prompt: string | null;
  generations: GenerationRecord[];
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
    tries: row.tries,
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
        submittedAt: input.submittedAt,
        queuedAt: input.submittedAt,
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return toRecord(row, input.modeName);
  }

  /**
   * One Submission's 1-4 Generations (issue #47, ADR 0007): locks the
   * submitting user's row before inserting every Generation, so two
   * presses of Generate from the same user never interleave their draws.
   */
  async createSubmission(
    userId: string,
    inputs: readonly CreateGenerationInput[],
  ): Promise<GenerationRecord[]> {
    return await this.db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

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
}
