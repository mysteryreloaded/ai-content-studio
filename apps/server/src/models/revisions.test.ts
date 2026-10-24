import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import {
  auditEntries,
  modelRevisions,
  models,
  workflows,
} from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { ModelRepository, NotFound, StaleVersion } from "./repository.js";

const SYSTEM: AuditActor = { type: "system" };

const WORKFLOW_V1: Workflow = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": {
    class_type: "SaveImage",
    inputs: { images: ["1", 0], filename_prefix: "x" },
  },
};

const WORKFLOW_V2: Workflow = {
  "1": { class_type: "LoadImage", inputs: { image: "b.png" } },
  "2": {
    class_type: "SaveImage",
    inputs: { images: ["1", 0], filename_prefix: "y" },
  },
};

describe("ModelRepository revisions and restore", () => {
  const testDb = createTestDatabase("revisions_repository_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
  });

  async function repo() {
    const { db } = await testDb;
    return new ModelRepository(db, clock);
  }

  test("lists every revision, newest first", async () => {
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    const { record: afterMode } = await repository.updateModes(
      created.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      created.version,
      SYSTEM,
    );
    await repository.uploadWorkflow(
      created.id,
      WORKFLOW_V2,
      afterMode.version,
      SYSTEM,
    );

    const revisions = await repository.listRevisions(created.id);
    expect(revisions.map((r) => r.revisionNumber)).toEqual([3, 2, 1]);
    expect(revisions[0]?.modeCount).toBe(1);
  });

  test("restores an old revision as a new, current revision with its Modes carried along", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    const { record: afterMode } = await repository.updateModes(
      created.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      created.version,
      SYSTEM,
    );
    const { record: afterUpload } = await repository.uploadWorkflow(
      created.id,
      WORKFLOW_V2,
      afterMode.version,
      SYSTEM,
    );
    expect(afterUpload.currentRevision).toBe(3);

    const result = await repository.restoreRevision(
      created.id,
      2,
      afterUpload.version,
      SYSTEM,
    );

    expect(result.record.currentRevision).toBe(4);
    expect(result.modes).toHaveLength(1);
    expect(result.modes[0]?.name).toBe("Default");

    const detail = await repository.get(created.id);
    expect(detail?.workflow).toEqual(WORKFLOW_V1);

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, created.id));
    expect(entries.some((e) => e.action === "restore_revision")).toBe(true);
  });

  test("getRevisionDetail returns an old revision's own Workflow/Inputs/Modes", async () => {
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    const detail = await repository.getRevisionDetail(created.id, 1);
    expect(detail?.workflow).toEqual(WORKFLOW_V1);
    expect(detail?.modes).toEqual([]);
    expect(detail?.inputs).toEqual([]);
  });

  test("restoreRevision throws NotFound for a revision number that doesn't exist", async () => {
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    await expect(
      repository.restoreRevision(created.id, 99, created.version, SYSTEM),
    ).rejects.toBeInstanceOf(NotFound);
  });

  test("restoreRevision rejects a stale version", async () => {
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    await expect(
      repository.restoreRevision(created.id, 1, created.version + 1, SYSTEM),
    ).rejects.toBeInstanceOf(StaleVersion);
  });
});
