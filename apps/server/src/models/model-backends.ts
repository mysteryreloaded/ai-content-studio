// Attaches/detaches Backends to a Model, many-to-many (issue #41). No
// node knowledge lives here — see backends/node-knowledge.ts.

import type { Clock } from "@ai-content-studio/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import { recordAuditEntry } from "../audit/audit.js";
import { toRecord as toBackendRecord } from "../backends/repository.js";
import type { BackendRecord } from "../backends/repository.js";
import type { Database } from "../db/client.js";
import { backends, modelBackends, models } from "../db/schema.js";

export class NotFound extends Error {
  constructor(what: "Model" | "Backend") {
    super(`${what} not found`);
  }
}

export class ModelBackendsRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async listForModel(modelId: string): Promise<BackendRecord[]> {
    const rows = await this.db
      .select({ backend: backends })
      .from(modelBackends)
      .innerJoin(backends, eq(modelBackends.backendId, backends.id))
      .where(
        and(eq(modelBackends.modelId, modelId), isNull(backends.deletedAt)),
      )
      .orderBy(backends.name);
    return rows.map((row) => toBackendRecord(row.backend));
  }

  async attach(
    modelId: string,
    backendId: string,
    actor: AuditActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [model] = await tx
        .select()
        .from(models)
        .where(and(eq(models.id, modelId), isNull(models.deletedAt)));
      if (!model) throw new NotFound("Model");

      const [backend] = await tx
        .select()
        .from(backends)
        .where(and(eq(backends.id, backendId), isNull(backends.deletedAt)));
      if (!backend) throw new NotFound("Backend");

      const inserted = await tx
        .insert(modelBackends)
        .values({ modelId, backendId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return;

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: modelId,
        action: "attach_backend",
        before: null,
        after: { backendId, backendName: backend.name },
      });
    });
  }

  async detach(
    modelId: string,
    backendId: string,
    actor: AuditActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [backend] = await tx
        .select()
        .from(backends)
        .where(eq(backends.id, backendId));

      const deleted = await tx
        .delete(modelBackends)
        .where(
          and(
            eq(modelBackends.modelId, modelId),
            eq(modelBackends.backendId, backendId),
          ),
        )
        .returning();
      if (deleted.length === 0) return;

      await recordAuditEntry(tx, this.clock, {
        actor,
        targetType: "model",
        targetId: modelId,
        action: "detach_backend",
        before: { backendId, backendName: backend?.name ?? backendId },
        after: null,
      });
    });
  }
}
