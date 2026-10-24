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
import { ValidationFailed } from "./validation.js";

const SYSTEM: AuditActor = { type: "system" };

const WORKFLOW_V1: Workflow = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": {
    class_type: "SaveImage",
    inputs: { images: ["1", 0], filename_prefix: "x" },
  },
};

/** Node "1" keeps its class and field; node "2" is now a different class (issue #71's "broken binding by node id"). */
const WORKFLOW_V2_BROKEN_NODE_2: Workflow = {
  "1": { class_type: "LoadImage", inputs: { image: "b.png" } },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
};

/** Node "2" is gone; node "3" is a fresh SaveImage a rebind can repoint onto (CEO review). */
const WORKFLOW_V3_RENAMED_NODE_2: Workflow = {
  "1": { class_type: "LoadImage", inputs: { image: "c.png" } },
  "3": {
    class_type: "SaveImage",
    inputs: { images: ["1", 0], filename_prefix: "y" },
  },
};

/** Node "1" is gone; node "4" is a fresh LoadImage a rebind can repoint an Input binding onto. */
const WORKFLOW_V4_RENAMED_NODE_1: Workflow = {
  "4": { class_type: "LoadImage", inputs: { image: "d.png" } },
  "2": {
    class_type: "SaveImage",
    inputs: { images: ["4", 0], filename_prefix: "z" },
  },
};

describe("ModelRepository.uploadWorkflow", () => {
  const testDb = createTestDatabase("workflow_upload_repository_test");
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

  test("replaces the Workflow, bumping the Model to a new revision, carrying Modes/Inputs forward unchanged", async () => {
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    const { record: withMode } = await repository.updateModes(
      created.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      created.version,
      SYSTEM,
    );

    const result = await repository.uploadWorkflow(
      created.id,
      WORKFLOW_V2_BROKEN_NODE_2,
      withMode.version,
      SYSTEM,
    );

    expect(result.record.currentRevision).toBe(3);
    // The Mode's output node id carries forward by id, even though node
    // "2" is now a different class — checkModel is what flags that.
    expect(result.modes[0]?.outputNodes.map((n) => n.nodeId)).toEqual(["2"]);

    const detail = await repository.get(created.id);
    expect(detail?.workflow).toEqual(WORKFLOW_V2_BROKEN_NODE_2);
  });

  test("rejects a UI-format save, same as createFromWorkflow", async () => {
    const repository = await repo();
    const { record } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );

    await expect(
      repository.uploadWorkflow(
        record.id,
        { nodes: [] },
        record.version,
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(ValidationFailed);
  });

  test("rejects a stale version", async () => {
    const repository = await repo();
    const { record } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );

    await expect(
      repository.uploadWorkflow(
        record.id,
        WORKFLOW_V2_BROKEN_NODE_2,
        record.version + 1,
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(StaleVersion);
  });

  test("throws NotFound for a missing Model", async () => {
    const repository = await repo();
    await expect(
      repository.uploadWorkflow(
        "11111111-1111-1111-1111-111111111111",
        WORKFLOW_V1,
        1,
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });

  test("rebind repoints a Mode's output node onto a node of the new Workflow, re-resolving it fresh", async () => {
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    const { record: withMode } = await repository.updateModes(
      created.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      created.version,
      SYSTEM,
    );

    const result = await repository.uploadWorkflow(
      created.id,
      WORKFLOW_V3_RENAMED_NODE_2,
      withMode.version,
      SYSTEM,
      [{ nodeId: "2", newNodeId: "3" }],
    );

    expect(result.modes[0]?.outputNodes).toEqual([
      { nodeId: "3", classType: "SaveImage", title: null, kind: "image" },
    ]);
  });

  test("rebind repoints an Input's binding onto a node of the new Workflow", async () => {
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    const { record: withMode } = await repository.updateModes(
      created.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      created.version,
      SYSTEM,
    );
    const { record: withInput } = await repository.updateInputs(
      created.id,
      [
        {
          id: "00000000-0000-0000-0000-000000000001",
          kind: "text",
          group: "describe",
          label: "Prefix",
          help: "",
          multiline: false,
          maxLength: 2000,
          default: "",
          bindings: [
            {
              nodeId: "1",
              field: "image",
              classType: "LoadImage",
              title: null,
            },
          ],
        },
      ],
      withMode.version,
      SYSTEM,
    );

    const result = await repository.uploadWorkflow(
      created.id,
      WORKFLOW_V4_RENAMED_NODE_1,
      withInput.version,
      SYSTEM,
      [{ nodeId: "1", newNodeId: "4" }],
    );

    expect(result.inputs[0]?.bindings).toEqual([
      { nodeId: "4", field: "image", classType: "LoadImage", title: null },
    ]);
  });

  test("rebind that still leaves a binding broken fails validation (ValidationFailed)", async () => {
    const repository = await repo();
    const { record: created } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );
    const { record: withMode } = await repository.updateModes(
      created.id,
      [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      created.version,
      SYSTEM,
    );

    await expect(
      repository.uploadWorkflow(
        created.id,
        WORKFLOW_V3_RENAMED_NODE_2,
        withMode.version,
        SYSTEM,
        // "1" exists but isn't a valid output node class-wise for this
        // test's purposes isn't the point; "ghost" simply doesn't exist.
        [{ nodeId: "2", newNodeId: "ghost" }],
      ),
    ).rejects.toBeInstanceOf(ValidationFailed);
  });

  test("writes an Audit entry", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const { record } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW_V1,
      SYSTEM,
    );

    await repository.uploadWorkflow(
      record.id,
      WORKFLOW_V2_BROKEN_NODE_2,
      record.version,
      SYSTEM,
    );

    const entries = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, record.id));
    expect(entries.some((e) => e.action === "upload_workflow")).toBe(true);
  });
});
