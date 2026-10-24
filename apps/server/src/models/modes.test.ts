import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
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
import { ValidationFailed } from "./validation.js";

const SYSTEM: AuditActor = { type: "system" };

const WORKFLOW_WITH_SAVE = {
  "1": { class_type: "LoadImage", inputs: {} },
  "2": {
    class_type: "SaveImage",
    inputs: { image: ["1", 0] },
    _meta: { title: "Final" },
  },
  "3": { class_type: "PreviewImage", inputs: { image: ["1", 0] } },
};

describe("ModelRepository Modes", () => {
  const testDb = createTestDatabase("modes_repository_test");
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

  test("saves Modes and bumps the Model to a new revision", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );
    expect(model.currentRevision).toBe(1);

    const { record, modes } = await repository.updateModes(
      model.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      model.version,
      SYSTEM,
    );

    expect(record.currentRevision).toBe(2);
    expect(record.version).toBe(2);
    expect(modes).toHaveLength(1);
    expect(modes[0]?.name).toBe("Default");
    expect(modes[0]?.outputNodes).toEqual([
      { nodeId: "2", classType: "SaveImage", title: "Final", kind: "image" },
    ]);

    const detail = await repository.get(model.id);
    expect(detail?.modes).toHaveLength(1);
  });

  test("writes an Audit entry for the Modes change", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );

    await repository.updateModes(
      model.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      model.version,
      SYSTEM,
    );

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, model.id));
    expect(entries.some((e) => e.action === "update_modes")).toBe(true);
  });

  test("refuses a Mode with no output nodes", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );

    await expect(
      repository.updateModes(
        model.id,
        [{ name: "Default", description: "", outputNodeIds: [] }],
        model.version,
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("refuses a preview node as an output node", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );

    await expect(
      repository.updateModes(
        model.id,
        [{ name: "Default", description: "", outputNodeIds: ["3"] }],
        model.version,
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("refuses two Modes with the same name", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );

    await expect(
      repository.updateModes(
        model.id,
        [
          { name: "Default", description: "", outputNodeIds: ["2"] },
          { name: "default", description: "", outputNodeIds: ["2"] },
        ],
        model.version,
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("refuses a stale version", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );

    await expect(
      repository.updateModes(
        model.id,
        [{ name: "Default", description: "", outputNodeIds: ["2"] }],
        model.version + 1,
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(StaleVersion);
  });

  test("two concurrent saves from the same version: one wins, the other gets StaleVersion, not a 500 from the revision-number unique constraint", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );

    const results = await Promise.allSettled([
      repository.updateModes(
        model.id,
        [{ name: "A", description: "", outputNodeIds: ["2"] }],
        model.version,
        SYSTEM,
      ),
      repository.updateModes(
        model.id,
        [{ name: "B", description: "", outputNodeIds: ["2"] }],
        model.version,
        SYSTEM,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      StaleVersion,
    );
  });

  test("refuses a missing Model", async () => {
    const repository = await repo();
    await expect(
      repository.updateModes(
        "00000000-0000-0000-0000-000000000000",
        [{ name: "Default", description: "", outputNodeIds: ["2"] }],
        1,
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });
});

describe("ModelRepository.setState", () => {
  const testDb = createTestDatabase("model_state_repository_test");
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

  test("enables and disables a Model, writing Audit entries", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );

    const enabled = await repository.setState(
      model.id,
      "enabled",
      model.version,
      SYSTEM,
    );
    expect(enabled.state).toBe("enabled");

    const disabled = await repository.setState(
      model.id,
      "disabled",
      enabled.version,
      SYSTEM,
    );
    expect(disabled.state).toBe("disabled");

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, model.id));
    expect(entries.some((e) => e.action === "enable")).toBe(true);
    expect(entries.some((e) => e.action === "disable")).toBe(true);
  });

  test("lists only enabled Models, in Admin order, with their Mode count", async () => {
    const repository = await repo();
    const { record: a } = await repository.createFromWorkflow(
      "A",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );
    const { record: b } = await repository.createFromWorkflow(
      "B",
      WORKFLOW_WITH_SAVE,
      SYSTEM,
    );

    const { record: aWithMode } = await repository.updateModes(
      a.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      a.version,
      SYSTEM,
    );
    await repository.setState(a.id, "enabled", aWithMode.version, SYSTEM);
    // b has no Modes and stays disabled.
    void b;

    const summaries = await repository.listEnabledSummaries();
    expect(summaries).toEqual([
      { id: a.id, slug: a.slug, name: "A", description: "", modeCount: 1 },
    ]);
  });
});
