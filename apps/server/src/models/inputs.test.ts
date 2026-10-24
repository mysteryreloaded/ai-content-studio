// `ModelRepository.updateInputs` (issue #46): validates against the
// current revision's Workflow, always makes a new revision, and carries
// the current Modes forward unchanged. Also covers `updateModes` carrying
// the current Inputs forward (same freezing rule, the other direction).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  SeedInputDefinition,
  TextInputDefinition,
} from "@ai-content-studio/shared";
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

function seedInput(
  overrides: Partial<SeedInputDefinition> = {},
): SeedInputDefinition {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    kind: "seed",
    group: "settings",
    label: "Seed",
    help: "",
    max: 1000,
    bindings: [
      { nodeId: "2", field: "steps", classType: "KSampler", title: null },
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

  test("refuses two Seed Inputs (issue #47)", async () => {
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
          seedInput(),
          seedInput({
            id: "33333333-3333-3333-3333-333333333333",
            label: "Seed 2",
            bindings: [
              {
                nodeId: "1",
                field: "text",
                classType: "CLIPTextEncode",
                title: "Prompt",
              },
            ],
          }),
        ],
        model.version,
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("saves a single Seed Input", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );

    const { inputs } = await repository.updateInputs(
      model.id,
      [seedInput()],
      model.version,
      SYSTEM,
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.kind).toBe("seed");
  });

  test("refuses a Seed Input with no max while the Model is enabled (ADR 0007)", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );

    const enabled = await repository.setState(
      model.id,
      "enabled",
      model.version,
      SYSTEM,
    );

    await expect(
      repository.updateInputs(
        model.id,
        [seedInput({ max: null })],
        enabled.version,
        SYSTEM,
      ),
    ).rejects.toThrow(ValidationFailed);
  });

  test("allows a Seed Input with no max while the Model is disabled", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );

    const { inputs } = await repository.updateInputs(
      model.id,
      [seedInput({ max: null })],
      model.version,
      SYSTEM,
    );
    expect(inputs[0]?.kind).toBe("seed");
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

  test("revalidates a carried fixed inputSetting against the narrowed Input, reverting it to optional (issue #48)", async () => {
    const repository = await repo();
    const { record: model } = await repository.createFromWorkflow(
      "M1",
      WORKFLOW,
      SYSTEM,
    );
    const { record: afterInputs } = await repository.updateInputs(
      model.id,
      [promptInput({ maxLength: 2000 })],
      model.version,
      SYSTEM,
    );

    const { record: afterModes } = await repository.updateModes(
      model.id,
      [
        {
          name: "Default",
          description: "",
          outputNodeIds: ["3"],
          inputSettings: [
            {
              inputId: promptInput().id,
              state: "fixed",
              fixedValue: "a".repeat(100),
              label: "",
            },
          ],
        },
      ],
      afterInputs.version,
      SYSTEM,
    );

    await repository.updateInputs(
      model.id,
      [promptInput({ maxLength: 50 })],
      afterModes.version,
      SYSTEM,
    );

    const detail = await repository.get(model.id);
    expect(detail?.modes[0]?.inputSettings).toEqual([
      {
        inputId: promptInput().id,
        state: "optional",
        fixedValue: null,
        label: "",
      },
    ]);
  });

  test("drops a carried inputSetting whose Input was removed (issue #48)", async () => {
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

    const { record: afterModes } = await repository.updateModes(
      model.id,
      [
        {
          name: "Default",
          description: "",
          outputNodeIds: ["3"],
          inputSettings: [
            {
              inputId: promptInput().id,
              state: "hidden",
              fixedValue: null,
              label: "",
            },
          ],
        },
      ],
      afterInputs.version,
      SYSTEM,
    );

    await repository.updateInputs(model.id, [], afterModes.version, SYSTEM);

    const detail = await repository.get(model.id);
    expect(detail?.modes[0]?.inputSettings).toEqual([]);
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
