// Model persistence (issue #40): create from an uploaded Workflow, edit
// Details, reorder, soft-delete. Workflows are content-addressed and kept
// forever (workflow-hash.ts); Model revisions are immutable and numbered
// per Model.

import {
  type BindingValidationContext,
  type ComfyFieldSpec,
  type InputDefinition,
  type ModeInputSetting,
  type OutsideServiceNote,
  type ResolvedOutputNode,
  type Workflow,
  fieldKey,
  findMissingLinkTargets,
  findOutsideServiceNotes,
  parseApiFormatWorkflow,
  resolveModeOutputNodes,
  reviseModeInputSettings,
  validateBinding,
  validateInputDefinition,
  validateModeInputSettings,
  validateModeName,
} from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import { recordAuditEntry } from "../audit/audit.js";
import type { Database, Transaction } from "../db/client.js";
import {
  modelRevisions,
  modelTermsAcceptances,
  models,
  modes,
  workflows,
} from "../db/schema.js";
import {
  MAX_WORKFLOW_BYTES,
  type ModelDetailsInput,
  type ValidationError,
  ValidationFailed,
  slugify,
  validateModelDetails,
} from "./validation.js";
import { hashWorkflow } from "./workflow-hash.js";

export class StaleVersion extends Error {
  constructor() {
    super("changed by someone else, reload");
  }
}

export class NameTaken extends Error {
  constructor() {
    super("a Model with this name already exists");
  }
}

export class SlugTaken extends Error {
  constructor() {
    super("a Model with this slug already exists");
  }
}

export class NotFound extends Error {
  constructor() {
    super("Model not found");
  }
}

type ModelRow = typeof models.$inferSelect;

export interface ModelRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  maxRunTimeMinutes: number;
  state: "enabled" | "disabled";
  sortOrder: number;
  currentRevision: number;
  version: number;
  /** Issue #61: Markdown shown in the terms dialog; blank means no terms are set. */
  termsBody: string;
  licenseUrl: string;
  attribution: string;
  termsVersion: number | null;
  termsVersionCreatedAt: Date | null;
  termsRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The terms version a user must accept for this Model, or `null` when none are required (issue #61). */
export function activeModelTermsVersion(
  model: Pick<ModelRecord, "termsBody" | "termsVersion">,
): number | null {
  return model.termsBody === "" ? null : model.termsVersion;
}

export interface ModeRecord {
  id: string;
  sortOrder: number;
  name: string;
  description: string;
  outputNodes: ResolvedOutputNode[];
  /** Per-Input hidden/optional/required/fixed settings for this Mode (issue #48). */
  inputSettings: ModeInputSetting[];
}

export interface ModeInput {
  name: string;
  description: string;
  outputNodeIds: string[];
  /** Per-Input hidden/optional/required/fixed settings for this Mode (issue #48); defaults to none (every Input optional). */
  inputSettings?: ModeInputSetting[];
}

export interface ModelDetail {
  model: ModelRecord;
  /** The current revision's own id (issue #43: a Generation freezes this). */
  revisionId: string;
  workflowHash: string;
  workflow: Workflow;
  nodes: Array<{ id: string; classType: string; title: string | null }>;
  outsideServiceNotes: OutsideServiceNote[];
  modes: ModeRecord[];
  /** The current revision's Inputs, in the Admin's order (issue #46). */
  inputs: InputDefinition[];
}

type ModeRow = typeof modes.$inferSelect;

function toModeRecord(row: ModeRow): ModeRecord {
  return {
    id: row.id,
    sortOrder: row.sortOrder,
    name: row.name,
    description: row.description,
    outputNodes: row.outputNodes as ResolvedOutputNode[],
    inputSettings: row.inputSettings as ModeInputSetting[],
  };
}

async function listModesForRevision(
  db: Database | Transaction,
  revisionId: string,
): Promise<ModeRecord[]> {
  const rows = await db
    .select()
    .from(modes)
    .where(eq(modes.revisionId, revisionId))
    .orderBy(asc(modes.sortOrder));
  return rows.map(toModeRecord);
}

function toRecord(row: ModelRow): ModelRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    maxRunTimeMinutes: row.maxRunTimeMinutes,
    state: row.state,
    sortOrder: row.sortOrder,
    currentRevision: row.currentRevision,
    version: row.version,
    termsBody: row.termsBody,
    licenseUrl: row.licenseUrl,
    attribution: row.attribution,
    termsVersion: row.termsVersion,
    termsVersionCreatedAt: row.termsVersionCreatedAt,
    termsRevision: row.termsRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function snapshot(row: ModelRow, workflowHash?: string) {
  return {
    name: row.name,
    slug: row.slug,
    description: row.description,
    maxRunTimeMinutes: row.maxRunTimeMinutes,
    state: row.state,
    sortOrder: row.sortOrder,
    currentRevision: row.currentRevision,
    ...(workflowHash ? { workflowHash } : {}),
  };
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const cause =
    err && typeof err === "object" && "cause" in err ? err.cause : err;
  if (
    !cause ||
    typeof cause !== "object" ||
    !("code" in cause) ||
    cause.code !== "23505"
  ) {
    return false;
  }
  if (!constraint) return true;
  return "constraint_name" in cause && cause.constraint_name === constraint;
}

function nodesFrom(
  workflow: Workflow,
): Array<{ id: string; classType: string; title: string | null }> {
  return Object.entries(workflow).map(([id, node]) => ({
    id,
    classType: node.class_type,
    title: node._meta?.title ?? null,
  }));
}

export interface WorkflowUploadResult {
  record: ModelRecord;
  outsideServiceNotes: OutsideServiceNote[];
}

/**
 * Repoints every Mode output node and Input binding at `nodeId` onto
 * `newNodeId` instead (issue #71's rebind picker, CEO review): a single
 * node-id remap, applied uniformly wherever that old node id is
 * referenced, matching how `uploadWorkflow` already carries bindings
 * forward "by node id" in the first place.
 */
export interface RebindEntry {
  nodeId: string;
  newNodeId: string;
}

/** One numbered Model revision, listed in the editor's Revisions section (issue #71). */
export interface RevisionSummary {
  revisionNumber: number;
  createdAt: Date;
  workflowHash: string;
  modeCount: number;
  inputCount: number;
}

export interface RevisionDetail {
  workflow: Workflow;
  inputs: InputDefinition[];
  modes: ModeRecord[];
}

export class ModelRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Creates a disabled Model at revision 1 from a name and an API-format
   * Workflow upload. Refuses a UI-format save, links to missing nodes, and
   * any outside-service node whose key is still set (that key is never
   * stored since the upload is refused outright); an empty key is allowed
   * and returned as a note.
   */
  async createFromWorkflow(
    name: string,
    rawWorkflow: unknown,
    actor: AuditActor,
  ): Promise<WorkflowUploadResult> {
    const errors: { field: string; message: string }[] = [];
    if (name.length < 1 || name.length > 80) {
      errors.push({ field: "name", message: "must be 1-80 characters" });
    }

    const size = Buffer.byteLength(JSON.stringify(rawWorkflow));
    if (size > MAX_WORKFLOW_BYTES) {
      errors.push({ field: "workflow", message: "must be 10 MB or smaller" });
    }

    const parsed = parseApiFormatWorkflow(rawWorkflow);
    if (!parsed.ok) {
      errors.push({ field: "workflow", message: parsed.error });
      throw new ValidationFailed(errors);
    }

    const missing = findMissingLinkTargets(parsed.workflow);
    if (missing.length > 0) {
      errors.push({
        field: "workflow",
        message: `links to missing nodes: ${missing.join(", ")}`,
      });
    }

    const notes = findOutsideServiceNotes(parsed.workflow);
    for (const note of notes) {
      if (note.keySet) {
        errors.push({
          field: "workflow",
          message: `${note.classType} (node ${note.nodeId}) still has a key set; clear it before uploading`,
        });
      }
    }

    if (errors.length > 0) throw new ValidationFailed(errors);

    try {
      const record = await this.db.transaction(async (tx) => {
        const hash = hashWorkflow(parsed.workflow);
        await tx
          .insert(workflows)
          .values({
            hash,
            json: parsed.workflow,
            nodeCount: Object.keys(parsed.workflow).length,
            size,
          })
          .onConflictDoNothing();

        const slug = await this.uniqueSlug(tx, slugify(name));

        const [sortRow] = await tx
          .select({ max: max(models.sortOrder) })
          .from(models);
        const sortOrder = (sortRow?.max ?? -1) + 1;

        const [row] = await tx
          .insert(models)
          .values({ name, slug, sortOrder })
          .returning();
        if (!row) throw new Error("insert returned no row");

        await tx.insert(modelRevisions).values({
          modelId: row.id,
          revisionNumber: 1,
          workflowHash: hash,
        });

        await recordAuditEntry(tx, this.clock, {
          actor,
          targetType: "model",
          targetId: row.id,
          action: "create",
          before: null,
          after: snapshot(row, hash),
        });

        return toRecord(row);
      });
      return { record, outsideServiceNotes: notes };
    } catch (err) {
      if (isUniqueViolation(err, "models_name_unique")) throw new NameTaken();
      if (isUniqueViolation(err, "models_slug_unique")) throw new SlugTaken();
      throw err;
    }
  }

  private async uniqueSlug(tx: Transaction, base: string): Promise<string> {
    for (let attempt = 1; attempt < 100; attempt++) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`;
      const [existing] = await tx
        .select({ id: models.id })
        .from(models)
        .where(and(eq(models.slug, candidate), isNull(models.deletedAt)));
      if (!existing) return candidate;
    }
    throw new Error("could not find a unique slug");
  }

  async updateDetails(
    id: string,
    input: ModelDetailsInput,
    expectedVersion: number,
    actor: AuditActor,
  ): Promise<ModelRecord> {
    const errors = validateModelDetails(input);
    if (errors.length > 0) throw new ValidationFailed(errors);

    try {
      return await this.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(models)
          .where(and(eq(models.id, id), isNull(models.deletedAt)));
        if (!before) throw new NotFound();

        const [row] = await tx
          .update(models)
          .set({
            name: input.name,
            slug: input.slug,
            description: input.description,
            maxRunTimeMinutes: input.maxRunTimeMinutes,
            version: before.version + 1,
            updatedAt: this.clock.now(),
          })
          .where(and(eq(models.id, id), eq(models.version, expectedVersion)))
          .returning();
        if (!row) throw new StaleVersion();

        await recordAuditEntry(tx, this.clock, {
          actor,
          targetType: "model",
          targetId: id,
          action: "update",
          before: snapshot(before),
          after: snapshot(row),
        });

        return toRecord(row);
      });
    } catch (err) {
      if (isUniqueViolation(err, "models_name_unique")) throw new NameTaken();
      if (isUniqueViolation(err, "models_slug_unique")) throw new SlugTaken();
      throw err;
    }
  }

  /**
   * Saves this Model's terms, license link and Attribution, deciding
   * `termsVersion` the same way `updateSiteTerms` does for Site terms: a
   * first-ever non-blank body, or one that follows a blank body, always
   * starts a new version; on top of an already non-blank body, `askAgain`
   * bumps it (clearing every acceptance) and any other save keeps it.
   * Guarded by `termsRevision`, not `version`, so saving Details/Modes
   * never races a Terms save into a spurious 409.
   */
  async updateTerms(
    id: string,
    input: {
      termsBody: string;
      licenseUrl: string;
      attribution: string;
      askAgain: boolean;
    },
    expectedRevision: number,
    actor: AuditActor,
  ): Promise<ModelRecord> {
    return await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(models)
        .where(and(eq(models.id, id), isNull(models.deletedAt)));
      if (!before) throw new NotFound();

      const now = this.clock.now();
      const termsBody = input.termsBody.trim();
      let termsVersion = before.termsVersion;
      let termsVersionCreatedAt = before.termsVersionCreatedAt;
      const wasBlank = before.termsBody === "";
      if (termsBody !== "" && (wasBlank || input.askAgain)) {
        termsVersion = (before.termsVersion ?? 0) + 1;
        termsVersionCreatedAt = now;
      }

      const [row] = await tx
        .update(models)
        .set({
          termsBody,
          licenseUrl: input.licenseUrl,
          attribution: input.attribution,
          termsVersion,
          termsVersionCreatedAt,
          termsRevision: before.termsRevision + 1,
          updatedAt: now,
        })
        .where(
          and(eq(models.id, id), eq(models.termsRevision, expectedRevision)),
        )
        .returning();
      if (!row) throw new StaleVersion();

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: id,
        action: "update_terms",
        before: {
          termsBody: before.termsBody,
          licenseUrl: before.licenseUrl,
          attribution: before.attribution,
          termsVersion: before.termsVersion,
        },
        after: {
          termsBody: row.termsBody,
          licenseUrl: row.licenseUrl,
          attribution: row.attribution,
          termsVersion: row.termsVersion,
          askAgain: input.askAgain,
        },
      });

      return toRecord(row);
    });
  }

  /** The version this user last accepted of this Model's terms, or `null` (issue #61). */
  async getAcceptedTermsVersion(
    modelId: string,
    userId: string,
  ): Promise<number | null> {
    const [row] = await this.db
      .select({ version: modelTermsAcceptances.version })
      .from(modelTermsAcceptances)
      .where(
        and(
          eq(modelTermsAcceptances.modelId, modelId),
          eq(modelTermsAcceptances.userId, userId),
        ),
      );
    return row?.version ?? null;
  }

  /** Records (or overwrites) this user's acceptance of this Model's current terms version. */
  async acceptTerms(modelId: string, userId: string, version: number) {
    const now = this.clock.now();
    await this.db
      .insert(modelTermsAcceptances)
      .values({ modelId, userId, version, acceptedAt: now })
      .onConflictDoUpdate({
        target: [modelTermsAcceptances.modelId, modelTermsAcceptances.userId],
        set: { version, acceptedAt: now },
      });
  }

  async softDelete(
    id: string,
    expectedVersion: number,
    actor: AuditActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(models)
        .where(and(eq(models.id, id), isNull(models.deletedAt)));
      if (!before) throw new NotFound();

      const [row] = await tx
        .update(models)
        .set({ deletedAt: this.clock.now(), version: before.version + 1 })
        .where(and(eq(models.id, id), eq(models.version, expectedVersion)))
        .returning();
      if (!row) throw new StaleVersion();

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: id,
        action: "soft_delete",
        before: snapshot(before),
        after: null,
      });
    });
  }

  /** Moves a Model up or down in the Admin's ordering by swapping `sortOrder` with its neighbor. */
  async reorder(
    id: string,
    direction: "up" | "down",
    actor: AuditActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(models)
        .where(isNull(models.deletedAt))
        .orderBy(asc(models.sortOrder));

      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) throw new NotFound();

      const neighborIndex = direction === "up" ? index - 1 : index + 1;
      if (neighborIndex < 0 || neighborIndex >= rows.length) return;

      const current = rows[index] as ModelRow;
      const neighbor = rows[neighborIndex] as ModelRow;

      await tx
        .update(models)
        .set({ sortOrder: neighbor.sortOrder })
        .where(eq(models.id, current.id));
      await tx
        .update(models)
        .set({ sortOrder: current.sortOrder })
        .where(eq(models.id, neighbor.id));

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: current.id,
        action: "reorder",
        before: { sortOrder: current.sortOrder },
        after: { sortOrder: neighbor.sortOrder },
      });
    });
  }

  async list(): Promise<ModelRecord[]> {
    const rows = await this.db
      .select()
      .from(models)
      .where(isNull(models.deletedAt))
      .orderBy(asc(models.sortOrder));
    return rows.map(toRecord);
  }

  async get(id: string): Promise<ModelDetail | null> {
    const [row] = await this.db
      .select()
      .from(models)
      .where(and(eq(models.id, id), isNull(models.deletedAt)));
    if (!row) return null;
    return this.detailFor(row);
  }

  /** Looked up by slug (issue #43: the Workbench's URL). */
  async getBySlug(slug: string): Promise<ModelDetail | null> {
    const [row] = await this.db
      .select()
      .from(models)
      .where(and(eq(models.slug, slug), isNull(models.deletedAt)));
    if (!row) return null;
    return this.detailFor(row);
  }

  private async detailFor(row: ModelRow): Promise<ModelDetail> {
    const [revision] = await this.db
      .select()
      .from(modelRevisions)
      .where(
        and(
          eq(modelRevisions.modelId, row.id),
          eq(modelRevisions.revisionNumber, row.currentRevision),
        ),
      );
    if (!revision) throw new Error("current revision missing");

    const [workflowRow] = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.hash, revision.workflowHash));
    if (!workflowRow) throw new Error("Workflow missing for revision");

    const workflow = workflowRow.json as Workflow;
    return {
      model: toRecord(row),
      revisionId: revision.id,
      workflowHash: revision.workflowHash,
      workflow,
      nodes: nodesFrom(workflow),
      outsideServiceNotes: findOutsideServiceNotes(workflow),
      modes: await listModesForRevision(this.db, revision.id),
      inputs: revision.inputs as InputDefinition[],
    };
  }

  /** Every numbered revision of this Model, newest first (issue #71's Revisions section). */
  async listRevisions(id: string): Promise<RevisionSummary[]> {
    const rows = await this.db
      .select()
      .from(modelRevisions)
      .where(eq(modelRevisions.modelId, id))
      .orderBy(desc(modelRevisions.revisionNumber));

    const summaries: RevisionSummary[] = [];
    for (const row of rows) {
      const modeRows = await listModesForRevision(this.db, row.id);
      summaries.push({
        revisionNumber: row.revisionNumber,
        createdAt: row.createdAt,
        workflowHash: row.workflowHash,
        modeCount: modeRows.length,
        inputCount: (row.inputs as InputDefinition[]).length,
      });
    }
    return summaries;
  }

  /** One numbered revision's own Workflow, Inputs and Modes (issue #71), for the restore route's pre-check. */
  async getRevisionDetail(
    id: string,
    revisionNumber: number,
  ): Promise<RevisionDetail | null> {
    const [revision] = await this.db
      .select()
      .from(modelRevisions)
      .where(
        and(
          eq(modelRevisions.modelId, id),
          eq(modelRevisions.revisionNumber, revisionNumber),
        ),
      );
    if (!revision) return null;

    const [workflowRow] = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.hash, revision.workflowHash));
    if (!workflowRow) return null;

    return {
      workflow: workflowRow.json as Workflow,
      inputs: revision.inputs as InputDefinition[],
      modes: await listModesForRevision(this.db, revision.id),
    };
  }

  /**
   * Inserts a copy of revision `revisionNumber` as a new, current
   * revision (issue #71's Restore): same Workflow, Inputs and Modes,
   * through the same optimistic-concurrency check every other save
   * uses. The caller runs the same `checkModel` gate the Modes/Inputs
   * routes do first, offering "Restore and disable" when the restored
   * state has errors on an enabled Model.
   */
  async restoreRevision(
    id: string,
    revisionNumber: number,
    expectedVersion: number,
    actor: AuditActor,
  ): Promise<{
    record: ModelRecord;
    modes: ModeRecord[];
    inputs: InputDefinition[];
  }> {
    return await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(models)
        .where(and(eq(models.id, id), isNull(models.deletedAt)));
      if (!before) throw new NotFound();

      const [target] = await tx
        .select()
        .from(modelRevisions)
        .where(
          and(
            eq(modelRevisions.modelId, id),
            eq(modelRevisions.revisionNumber, revisionNumber),
          ),
        );
      if (!target) throw new NotFound();

      const targetModes = await listModesForRevision(tx, target.id);

      const newRevisionNumber = before.currentRevision + 1;
      const [row] = await tx
        .update(models)
        .set({
          currentRevision: newRevisionNumber,
          version: before.version + 1,
          updatedAt: this.clock.now(),
        })
        .where(and(eq(models.id, id), eq(models.version, expectedVersion)))
        .returning();
      if (!row) throw new StaleVersion();

      const [newRevision] = await tx
        .insert(modelRevisions)
        .values({
          modelId: id,
          revisionNumber: newRevisionNumber,
          workflowHash: target.workflowHash,
          inputs: target.inputs,
        })
        .returning();
      if (!newRevision) throw new Error("insert returned no row");

      if (targetModes.length > 0) {
        await tx.insert(modes).values(
          targetModes.map((mode) => ({
            revisionId: newRevision.id,
            sortOrder: mode.sortOrder,
            name: mode.name,
            description: mode.description,
            outputNodes: mode.outputNodes,
            inputSettings: mode.inputSettings,
          })),
        );
      }

      const newModes = await listModesForRevision(tx, newRevision.id);

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: id,
        action: "restore_revision",
        before: { currentRevision: before.currentRevision },
        after: {
          currentRevision: newRevisionNumber,
          restoredFromRevision: revisionNumber,
        },
      });

      return {
        record: toRecord(row),
        modes: newModes,
        inputs: target.inputs as InputDefinition[],
      };
    });
  }

  /**
   * Replaces this Model's Workflow (issue #71): keeps its Modes' output
   * nodes and Inputs' bindings exactly as they were, matched only by
   * node id — a node whose class and value-holding field still exist
   * there keeps working; one that doesn't is now broken, which
   * `checkModel` reports as an error against the new Workflow the next
   * time it runs, same as any other missing binding (ADR-0010). `rebind`
   * (CEO review) repoints any number of broken node ids onto a node of
   * the new Workflow before anything is carried forward: each Mode's
   * output nodes are re-resolved fresh (new classType/kind/title) and
   * every Input is re-validated the same way `updateInputs` validates
   * one, so a rebind that actually fixes everything needn't disable an
   * enabled Model. Always makes a new revision, same reasoning as
   * {@link updateModes}.
   */
  async uploadWorkflow(
    id: string,
    rawWorkflow: unknown,
    expectedVersion: number,
    actor: AuditActor,
    rebind?: RebindEntry[],
    fieldSpecs?: ReadonlyMap<string, Record<string, ComfyFieldSpec>>,
    maxUploadMb?: number,
  ): Promise<{
    record: ModelRecord;
    modes: ModeRecord[];
    inputs: InputDefinition[];
    outsideServiceNotes: OutsideServiceNote[];
  }> {
    const errors: ValidationError[] = [];

    const size = Buffer.byteLength(JSON.stringify(rawWorkflow));
    if (size > MAX_WORKFLOW_BYTES) {
      errors.push({ field: "workflow", message: "must be 10 MB or smaller" });
    }

    const parsed = parseApiFormatWorkflow(rawWorkflow);
    if (!parsed.ok) {
      errors.push({ field: "workflow", message: parsed.error });
      throw new ValidationFailed(errors);
    }

    const missing = findMissingLinkTargets(parsed.workflow);
    if (missing.length > 0) {
      errors.push({
        field: "workflow",
        message: `links to missing nodes: ${missing.join(", ")}`,
      });
    }

    const notes = findOutsideServiceNotes(parsed.workflow);
    for (const note of notes) {
      if (note.keySet) {
        errors.push({
          field: "workflow",
          message: `${note.classType} (node ${note.nodeId}) still has a key set; clear it before uploading`,
        });
      }
    }

    if (errors.length > 0) throw new ValidationFailed(errors);

    return await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(models)
        .where(and(eq(models.id, id), isNull(models.deletedAt)));
      if (!before) throw new NotFound();

      const [currentRevision] = await tx
        .select()
        .from(modelRevisions)
        .where(
          and(
            eq(modelRevisions.modelId, id),
            eq(modelRevisions.revisionNumber, before.currentRevision),
          ),
        );
      if (!currentRevision) throw new Error("current revision missing");

      const currentModes = await listModesForRevision(tx, currentRevision.id);
      const currentInputs = currentRevision.inputs as InputDefinition[];

      let newModeInputs: ModeRecord[] = currentModes;
      let newInputs: InputDefinition[] = currentInputs;

      if (rebind && rebind.length > 0) {
        const remap = new Map(
          rebind.map((entry) => [entry.nodeId, entry.newNodeId]),
        );
        const rebindErrors: ValidationError[] = [];

        // Only a Mode with a remapped output node is re-resolved; one
        // with none (even a broken one left on "Leave broken") carries
        // forward exactly as the no-rebind path already does, for
        // checkModel to flag — a partial rebind must save (with
        // `disable: true`) without this touching what it wasn't asked
        // to fix (CEO review).
        newModeInputs = currentModes.map((mode, index) => {
          if (!mode.outputNodes.some((node) => remap.has(node.nodeId))) {
            return mode;
          }
          const outputNodeIds = mode.outputNodes.map(
            (node) => remap.get(node.nodeId) ?? node.nodeId,
          );
          const outcome = resolveModeOutputNodes(
            parsed.workflow,
            outputNodeIds,
          );
          if (!outcome.ok) {
            for (const message of outcome.errors) {
              rebindErrors.push({
                field: `modes[${index}].outputNodes`,
                message,
              });
            }
            return mode;
          }
          return { ...mode, outputNodes: outcome.outputNodes };
        });

        newInputs = currentInputs.map((input) => ({
          ...input,
          bindings: input.bindings.map((binding) => {
            const newNodeId = remap.get(binding.nodeId);
            if (!newNodeId) return binding;
            const node = parsed.workflow[newNodeId];
            return {
              ...binding,
              nodeId: newNodeId,
              classType: node?.class_type ?? binding.classType,
              title: node?._meta?.title ?? null,
            };
          }),
        }));

        // `usedFields` starts from every binding this rebind doesn't
        // touch, so a remapped binding can still be refused for landing
        // on a field one of those already holds; only a remapped
        // binding is itself checked — not the rest of its own Input's
        // shape (that's `updateInputs`'s job, and it needs `allInputs`
        // this partial pass has no reason to assemble).
        const usedFields = new Set<string>();
        for (const input of currentInputs) {
          for (const binding of input.bindings) {
            if (!remap.has(binding.nodeId)) {
              usedFields.add(fieldKey(binding.nodeId, binding.field));
            }
          }
        }
        const outputNodeIds = new Set(
          newModeInputs.flatMap((mode) =>
            mode.outputNodes.map((node) => node.nodeId),
          ),
        );

        newInputs.forEach((input, inputIndex) => {
          const before = currentInputs[inputIndex];
          input.bindings.forEach((binding, bindingIndex) => {
            const beforeBinding = before?.bindings[bindingIndex];
            if (!beforeBinding || !remap.has(beforeBinding.nodeId)) return;

            const ctx: BindingValidationContext = {
              workflow: parsed.workflow,
              outputNodeIds,
              usedFields,
              fieldSpecs,
              maxUploadMb,
            };
            const error = validateBinding(
              input.kind,
              binding.nodeId,
              binding.field,
              ctx,
              binding.classType,
            );
            if (error) {
              rebindErrors.push({
                field: `inputs[${inputIndex}].bindings[${bindingIndex}]`,
                message: error,
              });
              return;
            }
            usedFields.add(fieldKey(binding.nodeId, binding.field));
          });
        });

        if (rebindErrors.length > 0) throw new ValidationFailed(rebindErrors);
      }

      const hash = hashWorkflow(parsed.workflow);
      await tx
        .insert(workflows)
        .values({
          hash,
          json: parsed.workflow,
          nodeCount: Object.keys(parsed.workflow).length,
          size,
        })
        .onConflictDoNothing();

      const newRevisionNumber = before.currentRevision + 1;
      const [row] = await tx
        .update(models)
        .set({
          currentRevision: newRevisionNumber,
          version: before.version + 1,
          updatedAt: this.clock.now(),
        })
        .where(and(eq(models.id, id), eq(models.version, expectedVersion)))
        .returning();
      if (!row) throw new StaleVersion();

      const [newRevision] = await tx
        .insert(modelRevisions)
        .values({
          modelId: id,
          revisionNumber: newRevisionNumber,
          workflowHash: hash,
          inputs: newInputs,
        })
        .returning();
      if (!newRevision) throw new Error("insert returned no row");

      if (newModeInputs.length > 0) {
        await tx.insert(modes).values(
          newModeInputs.map((mode) => ({
            revisionId: newRevision.id,
            sortOrder: mode.sortOrder,
            name: mode.name,
            description: mode.description,
            outputNodes: mode.outputNodes,
            inputSettings: mode.inputSettings,
          })),
        );
      }

      const newModes = await listModesForRevision(tx, newRevision.id);

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: id,
        action: "upload_workflow",
        before: { workflowHash: currentRevision.workflowHash },
        after: { workflowHash: hash },
      });

      return {
        record: toRecord(row),
        modes: newModes,
        inputs: newInputs,
        outsideServiceNotes: notes,
      };
    });
  }

  /**
   * Replaces this Model's Modes, resolving each's output nodes against
   * the current revision's Workflow (ADR 0001). Always makes a new
   * revision, even when the Workflow itself doesn't change, since a
   * Model revision is "one saved state of a Model's Workflow, Inputs and
   * Modes".
   */
  async updateModes(
    id: string,
    input: ModeInput[],
    expectedVersion: number,
    actor: AuditActor,
  ): Promise<{ record: ModelRecord; modes: ModeRecord[] }> {
    return await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(models)
        .where(and(eq(models.id, id), isNull(models.deletedAt)));
      if (!before) throw new NotFound();

      const [currentRevision] = await tx
        .select()
        .from(modelRevisions)
        .where(
          and(
            eq(modelRevisions.modelId, id),
            eq(modelRevisions.revisionNumber, before.currentRevision),
          ),
        );
      if (!currentRevision) throw new Error("current revision missing");

      const [workflowRow] = await tx
        .select()
        .from(workflows)
        .where(eq(workflows.hash, currentRevision.workflowHash));
      if (!workflowRow) throw new Error("Workflow missing for revision");
      const workflow = workflowRow.json as Workflow;

      const errors: ValidationError[] = [];
      const namesSoFar: string[] = [];
      const resolved: Array<{
        name: string;
        description: string;
        outputNodes: ResolvedOutputNode[];
        inputSettings: ModeInputSetting[];
      }> = [];
      const currentInputs = currentRevision.inputs as InputDefinition[];

      input.forEach((modeInput, index) => {
        const nameError = validateModeName(modeInput.name, namesSoFar);
        if (nameError) {
          errors.push({ field: `modes[${index}].name`, message: nameError });
        }
        namesSoFar.push(modeInput.name);

        const inputSettings = modeInput.inputSettings ?? [];
        const settingsErrors = validateModeInputSettings(
          inputSettings,
          currentInputs,
        );
        for (const message of settingsErrors) {
          errors.push({ field: `modes[${index}].inputSettings`, message });
        }

        const outcome = resolveModeOutputNodes(
          workflow,
          modeInput.outputNodeIds,
        );
        if (!outcome.ok) {
          for (const message of outcome.errors) {
            errors.push({ field: `modes[${index}].outputNodes`, message });
          }
          return;
        }
        resolved.push({
          name: modeInput.name,
          description: modeInput.description,
          outputNodes: outcome.outputNodes,
          inputSettings,
        });
      });

      if (errors.length > 0) throw new ValidationFailed(errors);

      const beforeModes = await listModesForRevision(tx, currentRevision.id);

      // The version-checked claim runs first, before anything that could
      // collide: two concurrent saves both reading currentRevision=1 and
      // both inserting revisionNumber=2 would otherwise hit
      // model_revisions_model_number_unique and surface as a 500, not the
      // 409 a stale save should get. Only the winner of this UPDATE goes
      // on to insert the new revision/Modes.
      const newRevisionNumber = before.currentRevision + 1;
      const [row] = await tx
        .update(models)
        .set({
          currentRevision: newRevisionNumber,
          version: before.version + 1,
          updatedAt: this.clock.now(),
        })
        .where(and(eq(models.id, id), eq(models.version, expectedVersion)))
        .returning();
      if (!row) throw new StaleVersion();

      const [newRevision] = await tx
        .insert(modelRevisions)
        .values({
          modelId: id,
          revisionNumber: newRevisionNumber,
          workflowHash: currentRevision.workflowHash,
          inputs: currentRevision.inputs,
        })
        .returning();
      if (!newRevision) throw new Error("insert returned no row");

      if (resolved.length > 0) {
        await tx.insert(modes).values(
          resolved.map((mode, index) => ({
            revisionId: newRevision.id,
            sortOrder: index,
            name: mode.name,
            description: mode.description,
            outputNodes: mode.outputNodes,
            inputSettings: mode.inputSettings,
          })),
        );
      }

      const afterModes = await listModesForRevision(tx, newRevision.id);
      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: id,
        action: "update_modes",
        before: beforeModes,
        after: afterModes,
      });

      return { record: toRecord(row), modes: afterModes };
    });
  }

  /**
   * Replaces this Model's Inputs (issue #46), validating every binding
   * against the current revision's Workflow and its Modes' output nodes
   * (a named output's `filename_prefix` can't be bound). Always makes a
   * new revision carrying the current Modes forward unchanged, same
   * reasoning as {@link updateModes}.
   */
  async updateInputs(
    id: string,
    input: InputDefinition[],
    expectedVersion: number,
    actor: AuditActor,
    fieldSpecs?: ReadonlyMap<string, Record<string, ComfyFieldSpec>>,
    maxUploadMb?: number,
  ): Promise<{ record: ModelRecord; inputs: InputDefinition[] }> {
    return await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(models)
        .where(and(eq(models.id, id), isNull(models.deletedAt)));
      if (!before) throw new NotFound();

      const [currentRevision] = await tx
        .select()
        .from(modelRevisions)
        .where(
          and(
            eq(modelRevisions.modelId, id),
            eq(modelRevisions.revisionNumber, before.currentRevision),
          ),
        );
      if (!currentRevision) throw new Error("current revision missing");

      const [workflowRow] = await tx
        .select()
        .from(workflows)
        .where(eq(workflows.hash, currentRevision.workflowHash));
      if (!workflowRow) throw new Error("Workflow missing for revision");
      const workflow = workflowRow.json as Workflow;

      const currentModes = await listModesForRevision(tx, currentRevision.id);
      const outputNodeIds = new Set(
        currentModes.flatMap((mode) =>
          mode.outputNodes.map((node) => node.nodeId),
        ),
      );

      const errors: ValidationError[] = [];
      const usedFields = new Set<string>();
      const labelsSoFar: string[] = [];
      const idsSoFar: string[] = [];

      input.forEach((def, index) => {
        const ctx: BindingValidationContext = {
          workflow,
          outputNodeIds,
          usedFields,
          fieldSpecs,
          maxUploadMb,
        };
        const defErrors = validateInputDefinition(
          def,
          labelsSoFar,
          ctx,
          idsSoFar,
          input,
        );
        for (const message of defErrors) {
          errors.push({ field: `inputs[${index}]`, message });
        }
        labelsSoFar.push(def.label);
        idsSoFar.push(def.id);
        for (const binding of def.bindings) {
          usedFields.add(fieldKey(binding.nodeId, binding.field));
        }
      });

      // At most one Seed Input per Model (issue #47).
      const seedCount = input.filter((def) => def.kind === "seed").length;
      if (seedCount > 1) {
        errors.push({
          field: "inputs",
          message: "a Model can have at most one Seed Input",
        });
      }

      // An enabled Model's Seed Input must keep a max (ADR 0007): enabling
      // already refuses a null one, so a later Input edit can't sneak one
      // in while the Model stays enabled.
      if (before.state === "enabled") {
        for (const def of input) {
          if (def.kind === "seed" && def.max === null) {
            errors.push({
              field: "inputs",
              message: `Seed Input "${def.label}" needs a max while the Model is enabled`,
            });
          }
        }
      }

      if (errors.length > 0) throw new ValidationFailed(errors);

      const beforeInputs = currentRevision.inputs as InputDefinition[];

      const newRevisionNumber = before.currentRevision + 1;
      const [row] = await tx
        .update(models)
        .set({
          currentRevision: newRevisionNumber,
          version: before.version + 1,
          updatedAt: this.clock.now(),
        })
        .where(and(eq(models.id, id), eq(models.version, expectedVersion)))
        .returning();
      if (!row) throw new StaleVersion();

      const [newRevision] = await tx
        .insert(modelRevisions)
        .values({
          modelId: id,
          revisionNumber: newRevisionNumber,
          workflowHash: currentRevision.workflowHash,
          inputs: input,
        })
        .returning();
      if (!newRevision) throw new Error("insert returned no row");

      if (currentModes.length > 0) {
        await tx.insert(modes).values(
          currentModes.map((mode) => ({
            revisionId: newRevision.id,
            sortOrder: mode.sortOrder,
            name: mode.name,
            description: mode.description,
            outputNodes: mode.outputNodes,
            inputSettings: reviseModeInputSettings(mode.inputSettings, input),
          })),
        );
      }

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: id,
        action: "update_inputs",
        before: beforeInputs,
        after: input,
      });

      return { record: toRecord(row), inputs: input };
    });
  }

  async setState(
    id: string,
    state: "enabled" | "disabled",
    expectedVersion: number,
    actor: AuditActor,
  ): Promise<ModelRecord> {
    return await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(models)
        .where(and(eq(models.id, id), isNull(models.deletedAt)));
      if (!before) throw new NotFound();

      const [row] = await tx
        .update(models)
        .set({
          state,
          version: before.version + 1,
          updatedAt: this.clock.now(),
        })
        .where(and(eq(models.id, id), eq(models.version, expectedVersion)))
        .returning();
      if (!row) throw new StaleVersion();

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: id,
        action: state === "enabled" ? "enable" : "disable",
        before: { state: before.state },
        after: { state: row.state },
      });

      return toRecord(row);
    });
  }

  /** Enabled Models for the signed-in Models home, in Admin order. */
  async listEnabledSummaries(): Promise<
    Array<{
      id: string;
      slug: string;
      name: string;
      description: string;
      modeCount: number;
      attribution: string;
    }>
  > {
    const rows = await this.db
      .select({ model: models, revision: modelRevisions })
      .from(models)
      .innerJoin(
        modelRevisions,
        and(
          eq(modelRevisions.modelId, models.id),
          eq(modelRevisions.revisionNumber, models.currentRevision),
        ),
      )
      .where(and(eq(models.state, "enabled"), isNull(models.deletedAt)))
      .orderBy(asc(models.sortOrder));

    const summaries = [];
    for (const row of rows) {
      const modeRows = await listModesForRevision(this.db, row.revision.id);
      summaries.push({
        id: row.model.id,
        slug: row.model.slug,
        name: row.model.name,
        description: row.model.description,
        modeCount: modeRows.length,
        attribution: row.model.attribution,
      });
    }
    return summaries;
  }

  /**
   * Issue #65: whether any Mode of any enabled Model makes something
   * other than video (checked by each Mode's main Asset, its first
   * output node), which switches the landing page's default text from
   * "AI video models" to "AI models". A Mode with no output kind
   * (unresolved, or an unrecognised save node) doesn't count as a
   * reason to switch, since LTX/Wan's all-in-one Workflows are
   * video-first.
   */
  async hasEnabledNonVideoModel(): Promise<boolean> {
    const rows = await this.db
      .select({ revision: modelRevisions })
      .from(models)
      .innerJoin(
        modelRevisions,
        and(
          eq(modelRevisions.modelId, models.id),
          eq(modelRevisions.revisionNumber, models.currentRevision),
        ),
      )
      .where(and(eq(models.state, "enabled"), isNull(models.deletedAt)));

    for (const row of rows) {
      const modeRows = await listModesForRevision(this.db, row.revision.id);
      for (const mode of modeRows) {
        const kind = mode.outputNodes[0]?.kind;
        if (kind && kind !== "video") return true;
      }
    }
    return false;
  }
}
