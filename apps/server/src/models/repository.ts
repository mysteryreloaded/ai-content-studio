// Model persistence (issue #40): create from an uploaded Workflow, edit
// Details, reorder, soft-delete. Workflows are content-addressed and kept
// forever (workflow-hash.ts); Model revisions are immutable and numbered
// per Model.

import {
  type OutsideServiceNote,
  type Workflow,
  findMissingLinkTargets,
  findOutsideServiceNotes,
  parseApiFormatWorkflow,
} from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import { recordAuditEntry } from "../audit/audit.js";
import type { Database, Transaction } from "../db/client.js";
import { modelRevisions, models, workflows } from "../db/schema.js";
import {
  MAX_WORKFLOW_BYTES,
  type ModelDetailsInput,
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
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelDetail {
  model: ModelRecord;
  workflowHash: string;
  nodes: Array<{ id: string; classType: string; title: string | null }>;
  outsideServiceNotes: OutsideServiceNote[];
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
      workflowHash: revision.workflowHash,
      nodes: nodesFrom(workflow),
      outsideServiceNotes: findOutsideServiceNotes(workflow),
    };
  }
}
