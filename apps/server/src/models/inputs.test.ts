// `ModelRepository.updateInputs` (issue #46): validates against the
// current revision's Workflow, always makes a new revision, and carries
// the current Modes forward unchanged. Also covers `updateModes` carrying
// the current Inputs forward (same freezing rule, the other direction).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { TextInputDefinition } from "@ai-content-studio/shared";
import { FakeClock } from "@ai-content-studio/shared";
import type { AuditActor } from "../audit/audit.js";
import { modelRevisions, models, workflows } from "../db/schema.js";
import { createTestDatabase } from "../test/database.js";
import { ModelRepository, NotFound, StaleVersion } from "./repository.js";
import { ValidationFailed } from "./validation.js";

const SYSTEM: AuditActor = { type: "system" };

const WORKFLOW = {
  "1": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a cat" },
    _meta: { title: "Prompt" },
  },
  "2": {
    class_type: "KSampler",
    inputs: { steps: 20, model: ["1", 0] },
  },
  "3": {
    class_type: "SaveImage",
    inputs: { images: ["2", 0], filename_prefix: "ComfyUI" },
  },
};

function promptInput(
  overrides: Partial<TextInputDefinition> = {},
): TextInputDefinition {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "text",
    group: "describe",
    label: "Prompt",
    help: "",
    default: "",
    multiline: true,
    maxLength: 2000,
    bindings: [
      {
        nodeId: "1",
        field: "text",
        classType: "CLIPTextEncode",
        title: "Prompt",
      },
    ],
    ...overrides,
  };
}

describe("ModelRepository Inputs", () => {
  const testDb = createTestDatabase("inputs_repository_test");
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

  test("saves Inputs and bumps the Model to a new revision", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );
    expect(model.currentRevision).toBe(1);

    const { record, inputs } = await repository.updateInputs(
      model.id,
      [promptInput()],
      model.version,
      SYSTEM,
    );

    expect(record.currentRevision).toBe(2);
    expect(record.version).toBe(2);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.label).toBe("Prompt");

    const detail = await repository.get(model.id);
    expect(detail?.inputs).toHaveLength(1);
  });

  test("refuses a non-UUID Input id", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );

    await expect(
      repository.updateInputs(
        model.id,
        [promptInput({ id: "not-a-uuid" })],
        model.version,
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("refuses two Inputs with the same id", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );

    await expect(
      repository.updateInputs(
        model.id,
        [
          promptInput(),
          promptInput({
            label: "Prompt 2",
            bindings: [
              {
                nodeId: "2",
                field: "steps",
                classType: "KSampler",
                title: null,
              },
            ],
            kind: "text",
          }),
        ],
        model.version,
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("refuses binding filename_prefix on an output node", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );
    await repository.updateModes(
      model.id,
      [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      model.version,
      SYSTEM,
    );

    await expect(
      repository.updateInputs(
        model.id,
        [
          promptInput({
            bindings: [
              {
                nodeId: "3",
                field: "filename_prefix",
                classType: "SaveImage",
                title: null,
              },
            ],
          }),
        ],
        2,
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("refuses a stale version", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );

    await expect(
      repository.updateInputs(
        model.id,
        [promptInput()],
        model.version + 1,
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(StaleVersion);
  });

  test("refuses a missing Model", async () => {
    const repository = await repo();
    await expect(
      repository.updateInputs(
        "00000000-0000-0000-0000-000000000000",
        [promptInput()],
        1,
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(NotFound);
  });

  test("carries the current Modes forward unchanged onto the new revision", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );
    const { record: afterModes } = await repository.updateModes(
      model.id,
      [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      model.version,
      SYSTEM,
    );

    await repository.updateInputs(
      model.id,
      [promptInput()],
      afterModes.version,
      SYSTEM,
    );

    const detail = await repository.get(model.id);
    expect(detail?.modes).toHaveLength(1);
    expect(detail?.modes[0]?.name).toBe("Default");
    expect(detail?.inputs).toHaveLength(1);
  });

  test("updateModes carries the current Inputs forward unchanged onto the new revision", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );
    const { record: afterInputs } = await repository.updateInputs(
      model.id,
      [promptInput()],
      model.version,
      SYSTEM,
    );

    await repository.updateModes(
      model.id,
      [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      afterInputs.version,
      SYSTEM,
    );

    const detail = await repository.get(model.id);
    expect(detail?.inputs).toHaveLength(1);
    expect(detail?.inputs[0]?.label).toBe("Prompt");
    expect(detail?.modes).toHaveLength(1);
  });
});
