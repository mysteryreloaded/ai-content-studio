import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import {
  auditEntries,
  modelRevisions,
  modelTermsAcceptances,
  models,
  users,
  workflows,
} from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import {
  ModelRepository,
  NameTaken,
  NotFound,
  SlugTaken,
  StaleVersion,
} from "./repository.js";
import { ValidationFailed } from "./validation.js";

const SYSTEM: AuditActor = { type: "system" };

const VALID_WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
};

async function auditEntriesFor(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  modelId: string,
) {
  return db
    .select()
    .from(auditEntries)
    .where(eq(auditEntries.targetId, modelId));
}

describe("ModelRepository", () => {
  const testDb = createTestDatabase("models_repository_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(modelTermsAcceptances);
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
    await db.delete(users);
  });

  async function repo() {
    const { db } = await testDb;
    return new ModelRepository(db, clock);
  }

  test("creates a disabled Model at revision 1 with no Inputs or Modes, and writes an Audit entry", async () => {
    const { db } = await testDb;
    const repository = await repo();
    const { record, outsideServiceNotes } = await repository.createFromWorkflow(
      "LTX 2.5",
      VALID_WORKFLOW,
      SYSTEM,
    );

    expect(record.name).toBe("LTX 2.5");
    expect(record.slug).toBe("ltx-2-5");
    expect(record.state).toBe("disabled");
    expect(record.currentRevision).toBe(1);
    expect(record.version).toBe(1);
    expect(outsideServiceNotes).toEqual([]);

    const [entry] = await auditEntriesFor(db, record.id);
    expect(entry?.action).toBe("create");
    expect(entry?.before).toBeNull();
  });

  test("content-addresses the Workflow: two Models from the same Workflow share one row", async () => {
    const { db } = await testDb;
    const repository = await repo();
    await repository.createFromWorkflow("First", VALID_WORKFLOW, SYSTEM);
    await repository.createFromWorkflow("Second", VALID_WORKFLOW, SYSTEM);

    const rows = await db.select().from(workflows);
    expect(rows.length).toBe(1);
  });

  test("rejects a UI-format save", async () => {
    const repository = await repo();
    await expect(
      repository.createFromWorkflow(
        "LTX 2.5",
        { nodes: [], links: [] },
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("rejects a link to a missing node", async () => {
    const repository = await repo();
    await expect(
      repository.createFromWorkflow(
        "LTX 2.5",
        { "1": { class_type: "KSampler", inputs: { model: ["ghost", 0] } } },
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("refuses an outside-service node whose key is set, and never stores it", async () => {
    const { db } = await testDb;
    const repository = await repo();
    await expect(
      repository.createFromWorkflow(
        "LTX 2.5",
        {
          "1": {
            class_type: "GemmaAPITextEncode",
            inputs: { api_key: "secret-value" },
          },
        },
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);

    expect(await db.select().from(workflows)).toEqual([]);
  });

  test("allows an outside-service node with an empty key, and notes it", async () => {
    const repository = await repo();
    const { outsideServiceNotes } = await repository.createFromWorkflow(
      "LTX 2.5",
      {
        "1": {
          class_type: "GemmaAPITextEncode",
          inputs: { api_key: "" },
        },
      },
      SYSTEM,
    );

    expect(outsideServiceNotes).toEqual([
      { nodeId: "1", classType: "GemmaAPITextEncode", keySet: false },
    ]);
  });

  test("rejects a Workflow over 10 MB", async () => {
    const repository = await repo();
    const big = {
      "1": { class_type: "X", inputs: { blob: "a".repeat(11 * 1024 * 1024) } },
    };
    await expect(
      repository.createFromWorkflow("LTX 2.5", big, SYSTEM),
    ).rejects.toThrow(ValidationFailed);
  });

  test("rejects a duplicate name case-insensitively", async () => {
    const repository = await repo();
    await repository.createFromWorkflow("LTX 2.5", VALID_WORKFLOW, SYSTEM);
    await expect(
      repository.createFromWorkflow("ltx 2.5", VALID_WORKFLOW, SYSTEM),
    ).rejects.toThrow(NameTaken);
  });

  test("appends a suffix when the slugified name collides", async () => {
    const repository = await repo();
    const a = await repository.createFromWorkflow(
      "Model",
      VALID_WORKFLOW,
      SYSTEM,
    );
    await repository.updateDetails(
      a.record.id,
      {
        name: "Model",
        slug: "model",
        description: "",
        maxRunTimeMinutes: 30,
      },
      a.record.version,
      SYSTEM,
    );
    const b = await repository.createFromWorkflow(
      "Model!",
      VALID_WORKFLOW,
      SYSTEM,
    );
    expect(b.record.slug).toBe("model-2");
  });

  test("updateDetails rejects a stale version", async () => {
    const repository = await repo();
    const { record } = await repository.createFromWorkflow(
      "LTX 2.5",
      VALID_WORKFLOW,
      SYSTEM,
    );
    await expect(
      repository.updateDetails(
        record.id,
        {
          name: "LTX 2.5",
          slug: "ltx-2-5",
          description: "",
          maxRunTimeMinutes: 30,
        },
        record.version + 1,
        SYSTEM,
      ),
    ).rejects.toThrow(StaleVersion);
  });

  test("updateDetails rejects a slug already taken by another Model", async () => {
    const repository = await repo();
    await repository.createFromWorkflow("First", VALID_WORKFLOW, SYSTEM);
    const second = await repository.createFromWorkflow(
      "Second",
      VALID_WORKFLOW,
      SYSTEM,
    );
    await expect(
      repository.updateDetails(
        second.record.id,
        {
          name: "Second",
          slug: "first",
          description: "",
          maxRunTimeMinutes: 30,
        },
        second.record.version,
        SYSTEM,
      ),
    ).rejects.toThrow(SlugTaken);
  });

  test("soft-deletes a Model, freeing its name and slug for reuse", async () => {
    const repository = await repo();
    const { record } = await repository.createFromWorkflow(
      "LTX 2.5",
      VALID_WORKFLOW,
      SYSTEM,
    );
    await repository.softDelete(record.id, record.version, SYSTEM);

    expect(await repository.get(record.id)).toBeNull();
    const { record: reused } = await repository.createFromWorkflow(
      "LTX 2.5",
      VALID_WORKFLOW,
      SYSTEM,
    );
    expect(reused.slug).toBe("ltx-2-5");
  });

  test("softDelete on an already-deleted Model throws NotFound", async () => {
    const repository = await repo();
    const { record } = await repository.createFromWorkflow(
      "LTX 2.5",
      VALID_WORKFLOW,
      SYSTEM,
    );
    await repository.softDelete(record.id, record.version, SYSTEM);
    await expect(
      repository.softDelete(record.id, record.version + 1, SYSTEM),
    ).rejects.toThrow(NotFound);
  });

  test("reorders Models with up/down, swapping sortOrder", async () => {
    const repository = await repo();
    const a = await repository.createFromWorkflow("A", VALID_WORKFLOW, SYSTEM);
    const b = await repository.createFromWorkflow("B", VALID_WORKFLOW, SYSTEM);

    let list = await repository.list();
    expect(list.map((m) => m.id)).toEqual([a.record.id, b.record.id]);

    await repository.reorder(b.record.id, "up", SYSTEM);
    list = await repository.list();
    expect(list.map((m) => m.id)).toEqual([b.record.id, a.record.id]);

    await repository.reorder(b.record.id, "up", SYSTEM);
    list = await repository.list();
    expect(list.map((m) => m.id)).toEqual([b.record.id, a.record.id]);
  });

  test("get returns the Workflow's nodes, filterable client-side", async () => {
    const repository = await repo();
    const { record } = await repository.createFromWorkflow(
      "LTX 2.5",
      VALID_WORKFLOW,
      SYSTEM,
    );
    const detail = await repository.get(record.id);
    expect(detail?.nodes).toEqual(
      expect.arrayContaining([
        { id: "1", classType: "LoadImage", title: null },
        { id: "2", classType: "KSampler", title: null },
      ]),
    );
  });

  describe("updateTerms and acceptance (issue #61)", () => {
    test("a first non-blank body starts version 1; a quiet edit keeps it; askAgain bumps it", async () => {
      const repository = await repo();
      const { record } = await repository.createFromWorkflow(
        "LTX 2.5",
        VALID_WORKFLOW,
        SYSTEM,
      );

      const afterFirst = await repository.updateTerms(
        record.id,
        {
          termsBody: "v1",
          licenseUrl: "",
          attribution: "",
          askAgain: false,
        },
        record.termsRevision,
        SYSTEM,
      );
      expect(afterFirst.termsVersion).toBe(1);

      const afterQuietEdit = await repository.updateTerms(
        record.id,
        {
          termsBody: "v1, reworded",
          licenseUrl: "",
          attribution: "",
          askAgain: false,
        },
        afterFirst.termsRevision,
        SYSTEM,
      );
      expect(afterQuietEdit.termsVersion).toBe(1);

      const afterAskAgain = await repository.updateTerms(
        record.id,
        {
          termsBody: "v2",
          licenseUrl: "",
          attribution: "",
          askAgain: true,
        },
        afterQuietEdit.termsRevision,
        SYSTEM,
      );
      expect(afterAskAgain.termsVersion).toBe(2);
    });

    test("409s a stale termsRevision", async () => {
      const repository = await repo();
      const { record } = await repository.createFromWorkflow(
        "LTX 2.5",
        VALID_WORKFLOW,
        SYSTEM,
      );

      await expect(
        repository.updateTerms(
          record.id,
          { termsBody: "v1", licenseUrl: "", attribution: "", askAgain: false },
          record.termsRevision + 1,
          SYSTEM,
        ),
      ).rejects.toThrow(StaleVersion);
    });

    test("tracks each user's accepted version separately, overwriting on re-accept", async () => {
      const { db } = await testDb;
      const repository = await repo();
      const { record } = await repository.createFromWorkflow(
        "LTX 2.5",
        VALID_WORKFLOW,
        SYSTEM,
      );
      const [user] = await db
        .insert(users)
        .values({ googleSub: "sub-1", email: "a@example.com", name: "A" })
        .returning();
      if (!user) throw new Error("failed to insert user");

      expect(
        await repository.getAcceptedTermsVersion(record.id, user.id),
      ).toBeNull();

      await repository.acceptTerms(record.id, user.id, 1);
      expect(await repository.getAcceptedTermsVersion(record.id, user.id)).toBe(
        1,
      );

      await repository.acceptTerms(record.id, user.id, 2);
      expect(await repository.getAcceptedTermsVersion(record.id, user.id)).toBe(
        2,
      );
    });
  });

  describe("hasEnabledNonVideoModel (issue #65)", () => {
    const IMAGE_WORKFLOW = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const VIDEO_WORKFLOW = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      "2": { class_type: "SaveVideo", inputs: { video: ["1", 0] } },
    };

    async function enableWithOutput(
      repository: ModelRepository,
      workflow: Record<string, unknown>,
      outputNodeId: string,
    ) {
      const { record } = await repository.createFromWorkflow(
        "M",
        workflow as never,
        SYSTEM,
      );
      const { record: afterModes } = await repository.updateModes(
        record.id,
        [{ name: "Default", description: "", outputNodeIds: [outputNodeId] }],
        record.version,
        SYSTEM,
      );
      await repository.setState(
        record.id,
        "enabled",
        afterModes.version,
        SYSTEM,
      );
    }

    test("false when every enabled Model's main output is video", async () => {
      const repository = await repo();
      await enableWithOutput(repository, VIDEO_WORKFLOW, "2");
      expect(await repository.hasEnabledNonVideoModel()).toBe(false);
    });

    test("true once an enabled Model's main output is image or audio", async () => {
      const repository = await repo();
      await enableWithOutput(repository, IMAGE_WORKFLOW, "2");
      expect(await repository.hasEnabledNonVideoModel()).toBe(true);
    });
  });

  describe("createTestRevision (issue #74 CEO review)", () => {
    test("two Tests of the same Model at once don't race on the same revisionNumber", async () => {
      const repository = await repo();
      const { record } = await repository.createFromWorkflow(
        "LTX 2.5",
        VALID_WORKFLOW,
        SYSTEM,
      );
      const mode = {
        name: "Default",
        description: "",
        outputNodes: [
          { nodeId: "2", classType: "KSampler", title: null, kind: null },
        ],
        inputSettings: [],
      };

      // Before the fix, concurrent calls all read the same `min()` and
      // raced to insert the same testRevisionNumber, 500ing on
      // model_revisions_model_number_unique; locking the Model's row
      // serializes them instead. 8 at once reproduces the race
      // reliably (2 at once sometimes happens to interleave safely).
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          repository.createTestRevision(record.id, [], mode),
        ),
      );

      expect(new Set(results.map((r) => r.revisionId)).size).toBe(8);
      const { db } = await testDb;
      const rows = await db
        .select()
        .from(modelRevisions)
        .where(eq(modelRevisions.modelId, record.id));
      const testRevisionNumbers = rows
        .filter((row) => row.isTest)
        .map((row) => row.revisionNumber);
      expect(new Set(testRevisionNumbers).size).toBe(8);
      expect(testRevisionNumbers.sort((x, y) => x - y)).toEqual([
        -8, -7, -6, -5, -4, -3, -2, -1,
      ]);
    });
  });
});
