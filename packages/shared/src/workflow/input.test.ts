import { describe, expect, test } from "bun:test";
import {
  applyInputValues,
  buildInputValuesSchema,
  buildPrompt,
  imageUploadLimitIssue,
  listBindableFields,
  relevantInputs,
  toInputIssues,
  uploadFileName,
  validateBinding,
  validateInputDefinition,
} from "./input.js";
import type {
  ImageUploadInputDefinition,
  NumberInputDefinition,
  SeedInputDefinition,
  SelectInputDefinition,
  TextInputDefinition,
} from "./input.js";
import type { Workflow } from "./types.js";

const workflow: Workflow = {
  "1": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a cat" },
    _meta: { title: "Prompt" },
  },
  "2": {
    class_type: "KSampler",
    inputs: { steps: 20, seed: 0, model: ["1", 0] },
  },
  "3": {
    class_type: "SaveImage",
    inputs: { images: ["2", 0], filename_prefix: "ComfyUI" },
  },
};

describe("listBindableFields", () => {
  test("lists only literal (non-link) fields", () => {
    const fields = listBindableFields(workflow);
    expect(fields.map((f) => `${f.nodeId}.${f.field}`).sort()).toEqual([
      "1.text",
      "2.seed",
      "2.steps",
      "3.filename_prefix",
    ]);
  });
});

describe("validateBinding", () => {
  const ctx = {
    workflow,
    outputNodeIds: new Set(["3"]),
    usedFields: new Set<string>(),
  };

  test("refuses a link-fed field", () => {
    expect(validateBinding("text", "2", "model", ctx)).toContain("link");
  });

  test("refuses filename_prefix on an output node", () => {
    expect(validateBinding("text", "3", "filename_prefix", ctx)).toContain(
      "filename_prefix",
    );
  });

  test("refuses a field already bound to another Input", () => {
    const used = { ...ctx, usedFields: new Set(["1::text"]) };
    expect(validateBinding("text", "1", "text", used)).toContain(
      "already bound",
    );
  });

  test("refuses a type mismatch", () => {
    expect(validateBinding("number", "1", "text", ctx)).toContain(
      "number field",
    );
  });

  test("accepts a value-holding, unbound, non-output field", () => {
    expect(validateBinding("text", "1", "text", ctx)).toBeNull();
  });
});

describe("validateInputDefinition", () => {
  const ctx = {
    workflow,
    outputNodeIds: new Set(["3"]),
    usedFields: new Set<string>(),
  };

  test("refuses a non-UUID id", () => {
    const input: TextInputDefinition = {
      id: "i1",
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
    };
    expect(validateInputDefinition(input, [], ctx)).toContain(
      "id must be a UUID",
    );
  });

  test("refuses an id already used by another Input", () => {
    const input: TextInputDefinition = {
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
    };
    expect(
      validateInputDefinition(input, [], ctx, [
        "11111111-1111-1111-1111-111111111111",
      ]),
    ).toContain("id must be unique");
  });

  test("accepts a well-formed text Input", () => {
    const input: TextInputDefinition = {
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
    };
    expect(validateInputDefinition(input, [], ctx)).toEqual([]);
  });

  test("refuses a duplicate label", () => {
    const input: TextInputDefinition = {
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
    };
    expect(validateInputDefinition(input, ["prompt"], ctx)).toContain(
      "label must be unique",
    );
  });

  test("refuses a number Input with max <= min or step <= 0", () => {
    const input: NumberInputDefinition = {
      id: "22222222-2222-2222-2222-222222222222",
      kind: "number",
      group: "settings",
      label: "Steps",
      help: "",
      default: null,
      numberMode: "integer",
      min: 20,
      max: 10,
      step: 0,
      bindings: [
        { nodeId: "2", field: "steps", classType: "KSampler", title: null },
      ],
    };
    const errors = validateInputDefinition(input, [], ctx);
    expect(errors).toContain("max must be greater than min");
    expect(errors).toContain("step must be greater than 0");
  });

  test("refuses a select Input with fewer than 2 options", () => {
    const input: SelectInputDefinition = {
      id: "33333333-3333-3333-3333-333333333333",
      kind: "select",
      group: "settings",
      label: "Quality",
      help: "",
      default: null,
      options: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          label: "Fast",
          values: [10],
        },
      ],
      bindings: [
        { nodeId: "2", field: "steps", classType: "KSampler", title: null },
      ],
    };
    expect(validateInputDefinition(input, [], ctx)).toContain(
      "needs 2-50 options",
    );
  });

  test("refuses an option missing a value per bound field", () => {
    const input: SelectInputDefinition = {
      id: "33333333-3333-3333-3333-333333333333",
      kind: "select",
      group: "settings",
      label: "Quality",
      help: "",
      default: null,
      options: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          label: "Fast",
          values: [],
        },
        {
          id: "55555555-5555-5555-5555-555555555555",
          label: "Slow",
          values: [40],
        },
      ],
      bindings: [
        { nodeId: "2", field: "steps", classType: "KSampler", title: null },
      ],
    };
    expect(
      validateInputDefinition(input, [], ctx).some((e) =>
        e.includes("value for each bound field"),
      ),
    ).toBe(true);
  });

  test("refuses a duplicate option id", () => {
    const input: SelectInputDefinition = {
      id: "33333333-3333-3333-3333-333333333333",
      kind: "select",
      group: "settings",
      label: "Quality",
      help: "",
      default: null,
      options: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          label: "Fast",
          values: [10],
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          label: "Slow",
          values: [40],
        },
      ],
      bindings: [
        { nodeId: "2", field: "steps", classType: "KSampler", title: null },
      ],
    };
    expect(
      validateInputDefinition(input, [], ctx).some((e) =>
        e.includes("used more than once"),
      ),
    ).toBe(true);
  });

  test("refuses a boolean-field option value sent as a string", () => {
    const boolWorkflow: Workflow = {
      ...workflow,
      "4": {
        class_type: "Toggle",
        inputs: { enabled: true },
      },
    };
    const boolCtx = { ...ctx, workflow: boolWorkflow };
    const input: SelectInputDefinition = {
      id: "33333333-3333-3333-3333-333333333333",
      kind: "select",
      group: "settings",
      label: "Mode",
      help: "",
      default: null,
      options: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          label: "Off",
          values: ["false"],
        },
        {
          id: "55555555-5555-5555-5555-555555555555",
          label: "On",
          values: [true],
        },
      ],
      bindings: [
        { nodeId: "4", field: "enabled", classType: "Toggle", title: null },
      ],
    };
    expect(
      validateInputDefinition(input, [], boolCtx).some((e) =>
        e.includes("must be a boolean"),
      ),
    ).toBe(true);
  });

  test("refuses a COMBO option value not in the Backend's choices", () => {
    const comboCtx = {
      ...ctx,
      fieldSpecs: new Map([
        [
          "KSampler",
          {
            sampler_name: {
              type: "COMBO",
              options: ["euler", "euler_ancestral"],
            },
          },
        ],
      ]),
    };
    const samplerWorkflow: Workflow = {
      ...workflow,
      "2": {
        class_type: "KSampler",
        inputs: { ...workflow["2"]?.inputs, sampler_name: "euler" },
      },
    };
    const input: SelectInputDefinition = {
      id: "33333333-3333-3333-3333-333333333333",
      kind: "select",
      group: "settings",
      label: "Sampler",
      help: "",
      default: null,
      options: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          label: "Euler",
          values: ["euler"],
        },
        {
          id: "55555555-5555-5555-5555-555555555555",
          label: "Ghost",
          values: ["ghost"],
        },
      ],
      bindings: [
        {
          nodeId: "2",
          field: "sampler_name",
          classType: "KSampler",
          title: null,
        },
      ],
    };
    const errors = validateInputDefinition(input, [], {
      ...comboCtx,
      workflow: samplerWorkflow,
    });
    expect(errors.some((e) => e.includes("Backend's choices"))).toBe(true);
  });

  test("accepts any string value for a V3-form COMBO with no known options (issue #46)", () => {
    const comboCtx = {
      ...ctx,
      fieldSpecs: new Map([
        [
          "KSampler",
          {
            sampler_name: { type: "COMBO", options: undefined },
          },
        ],
      ]),
    };
    const samplerWorkflow: Workflow = {
      ...workflow,
      "2": {
        class_type: "KSampler",
        inputs: { ...workflow["2"]?.inputs, sampler_name: "euler" },
      },
    };
    const input: SelectInputDefinition = {
      id: "33333333-3333-3333-3333-333333333333",
      kind: "select",
      group: "settings",
      label: "Sampler",
      help: "",
      default: null,
      options: [
        {
          id: "44444444-4444-4444-4444-444444444444",
          label: "Euler",
          values: ["euler"],
        },
        {
          id: "55555555-5555-5555-5555-555555555555",
          label: "Ghost",
          values: ["ghost"],
        },
      ],
      bindings: [
        {
          nodeId: "2",
          field: "sampler_name",
          classType: "KSampler",
          title: null,
        },
      ],
    };
    const errors = validateInputDefinition(input, [], {
      ...comboCtx,
      workflow: samplerWorkflow,
    });
    expect(errors.some((e) => e.includes("Backend's choices"))).toBe(false);
  });

  test("refuses a decimal number Input bound to an INT field, when known", () => {
    const intCtx = {
      ...ctx,
      fieldSpecs: new Map([["KSampler", { steps: { type: "INT" } }]]),
    };
    const input: NumberInputDefinition = {
      id: "22222222-2222-2222-2222-222222222222",
      kind: "number",
      group: "settings",
      label: "Steps",
      help: "",
      default: null,
      numberMode: "decimal",
      min: 1,
      max: 100,
      step: 1,
      bindings: [
        { nodeId: "2", field: "steps", classType: "KSampler", title: null },
      ],
    };
    expect(
      validateInputDefinition(input, [], intCtx).some((e) =>
        e.includes("whole (INT)"),
      ),
    ).toBe(true);
  });
});

describe("buildInputValuesSchema / parseInputValues", () => {
  const textInput: TextInputDefinition = {
    id: "prompt",
    kind: "text",
    group: "describe",
    label: "Prompt",
    help: "",
    default: "",
    multiline: false,
    maxLength: 10,
    bindings: [
      { nodeId: "1", field: "text", classType: "CLIPTextEncode", title: null },
    ],
  };
  const numberInput: NumberInputDefinition = {
    id: "steps",
    kind: "number",
    group: "settings",
    label: "Steps",
    help: "",
    default: null,
    numberMode: "integer",
    min: 10,
    max: 50,
    step: 5,
    bindings: [
      { nodeId: "2", field: "steps", classType: "KSampler", title: null },
    ],
  };
  const selectInput: SelectInputDefinition = {
    id: "quality",
    kind: "select",
    group: "settings",
    label: "Quality",
    help: "",
    default: null,
    options: [
      { id: "fast", label: "Fast", values: [10] },
      { id: "slow", label: "Slow", values: [40] },
    ],
    bindings: [
      { nodeId: "2", field: "steps", classType: "KSampler", title: null },
    ],
  };

  const schema = buildInputValuesSchema([textInput, numberInput, selectInput]);

  test("strict: a value for an unknown Input is an error", () => {
    const result = schema.safeParse({ ghost: "x" });
    expect(result.success).toBe(false);
  });

  test("turns a one-line text's line breaks into spaces", () => {
    const result = schema.safeParse({ prompt: "a\nb" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.prompt).toBe("a b");
  });

  test("a number must sit on min + k*step", () => {
    expect(schema.safeParse({ steps: 22 }).success).toBe(false);
    expect(schema.safeParse({ steps: 25 }).success).toBe(true);
  });

  test("a select value must be one of the option ids", () => {
    expect(schema.safeParse({ quality: "ghost" }).success).toBe(false);
    expect(schema.safeParse({ quality: "fast" }).success).toBe(true);
  });

  test("every Input is optional (blank is allowed)", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  test("requiredIds (issue #48) rejects a blank/missing required Input", () => {
    const required = buildInputValuesSchema(
      [textInput, numberInput, selectInput],
      new Set(["prompt"]),
    );
    expect(required.safeParse({ prompt: "" }).success).toBe(false);
    expect(required.safeParse({}).success).toBe(false);
    expect(required.safeParse({ prompt: "hi" }).success).toBe(true);
  });

  test("toInputIssues maps a failure onto path/code/message", () => {
    const result = schema.safeParse({ steps: 1000 });
    if (result.success) throw new Error("expected failure");
    const issues = toInputIssues(result.error);
    expect(issues[0]).toMatchObject({ path: "steps" });
    expect(issues[0]?.code).toBeTruthy();
    expect(issues[0]?.message).toBeTruthy();
  });
});

describe("relevantInputs", () => {
  test("keeps only Inputs with a binding on the Mode's Path", () => {
    const onPath: TextInputDefinition = {
      id: "a",
      kind: "text",
      group: "describe",
      label: "A",
      help: "",
      default: "",
      multiline: false,
      maxLength: 100,
      bindings: [
        {
          nodeId: "1",
          field: "text",
          classType: "CLIPTextEncode",
          title: null,
        },
      ],
    };
    const offPath: TextInputDefinition = {
      ...onPath,
      id: "b",
      label: "B",
      bindings: [{ nodeId: "99", field: "text", classType: "X", title: null }],
    };
    expect(relevantInputs([onPath, offPath], workflow, ["3"])).toEqual([
      onPath,
    ]);
  });

  test("keeps an Input on a branch only reachable via a visible Input's bound switch field (issue #48)", () => {
    const switchWorkflow: Workflow = {
      prim: { class_type: "PrimitiveBoolean", inputs: { value: true } },
      switch: {
        class_type: "ComfySwitchNode",
        inputs: { switch: ["prim", 0], on_true: ["a", 0], on_false: ["b", 0] },
      },
      a: { class_type: "LoadImage", inputs: {} },
      b: {
        class_type: "LoadImage",
        inputs: { strength: 1 },
      },
      out: { class_type: "SaveImage", inputs: { image: ["switch", 0] } },
    };
    const onFalseBranch: NumberInputDefinition = {
      id: "strength",
      kind: "number",
      group: "settings",
      label: "Strength",
      help: "",
      default: null,
      numberMode: "decimal",
      min: 0,
      max: 1,
      step: 0.1,
      bindings: [
        { nodeId: "b", field: "strength", classType: "LoadImage", title: null },
      ],
    };

    expect(relevantInputs([onFalseBranch], switchWorkflow, ["out"])).toEqual(
      [],
    );
    expect(
      relevantInputs(
        [onFalseBranch],
        switchWorkflow,
        ["out"],
        new Set(["prim::value"]),
      ),
    ).toEqual([onFalseBranch]);
  });
});

describe("applyInputValues / buildPrompt", () => {
  const promptInput: TextInputDefinition = {
    id: "prompt",
    kind: "text",
    group: "describe",
    label: "Prompt",
    help: "",
    default: "fallback",
    multiline: true,
    maxLength: 2000,
    bindings: [
      { nodeId: "1", field: "text", classType: "CLIPTextEncode", title: null },
    ],
  };
  const stepsInput: NumberInputDefinition = {
    id: "steps",
    kind: "number",
    group: "settings",
    label: "Steps",
    help: "",
    default: 20,
    numberMode: "integer",
    min: 10,
    max: 50,
    step: 5,
    bindings: [
      { nodeId: "2", field: "steps", classType: "KSampler", title: null },
    ],
  };

  test("writes a submitted value into every bound field", () => {
    const applied = applyInputValues(workflow, [promptInput, stepsInput], {
      prompt: "a dog",
      steps: 30,
    });
    expect(applied["1"]?.inputs.text).toBe("a dog");
    expect(applied["2"]?.inputs.steps).toBe(30);
  });

  test("leaves the Workflow's own value when the Input is blank", () => {
    const applied = applyInputValues(workflow, [promptInput, stepsInput], {});
    expect(applied["1"]?.inputs.text).toBe("fallback");
    expect(applied["2"]?.inputs.steps).toBe(20);
  });

  test("never mutates the original Workflow", () => {
    applyInputValues(workflow, [promptInput], { prompt: "mutated?" });
    expect(workflow["1"]?.inputs.text).toBe("a cat");
  });

  test("buildPrompt freezes the result like buildFrozenPrompt", () => {
    const { prompt, nodeTypes } = buildPrompt(
      workflow,
      [promptInput, stepsInput],
      { prompt: "a dog", steps: 30 },
      ["3"],
      "gen-1",
    );
    expect(prompt["1"]?.inputs.text).toBe("a dog");
    expect(prompt["2"]?.inputs.steps).toBe(30);
    expect(prompt["3"]?.inputs.filename_prefix).toBe("studio/gen-1/");
    expect(nodeTypes).toEqual(["CLIPTextEncode", "KSampler", "SaveImage"]);
  });

  test("a select Input writes each binding's value for the chosen option", () => {
    const selectInput: SelectInputDefinition = {
      id: "quality",
      kind: "select",
      group: "settings",
      label: "Quality",
      help: "",
      default: null,
      options: [
        { id: "fast", label: "Fast", values: [10] },
        { id: "slow", label: "Slow", values: [40] },
      ],
      bindings: [
        { nodeId: "2", field: "steps", classType: "KSampler", title: null },
      ],
    };
    const applied = applyInputValues(workflow, [selectInput], {
      quality: "slow",
    });
    expect(applied["2"]?.inputs.steps).toBe(40);
  });
});

describe("Image Upload Inputs (issue #50)", () => {
  const loaderWorkflow: Workflow = {
    "10": {
      class_type: "LoadImage",
      inputs: { image: "example.png" },
    },
    "11": {
      class_type: "SaveImage",
      inputs: { images: ["10", 0], filename_prefix: "ComfyUI" },
    },
  };
  const uploadInput: ImageUploadInputDefinition = {
    id: "8a3c1c5e-2d4b-4d55-9d0e-3f1f0f6b7a01",
    kind: "image_upload",
    group: "describe",
    label: "Start frame",
    help: "",
    maxSizeMb: 20,
    maxLongSide: 4096,
    bindings: [
      { nodeId: "10", field: "image", classType: "LoadImage", title: null },
    ],
  };
  const ctx = {
    workflow: loaderWorkflow,
    outputNodeIds: new Set(["11"]),
    usedFields: new Set<string>(),
  };
  const uploadId = "0c6b3d2a-6f6a-4b8e-9f8e-1a2b3c4d5e6f";

  test("binds a loader field the Backend flags image_upload", () => {
    const withSpecs = {
      ...ctx,
      fieldSpecs: new Map([
        ["LoadImage", { image: { type: "COMBO", imageUpload: true } }],
      ]),
    };
    expect(
      validateBinding("image_upload", "10", "image", withSpecs),
    ).toBeNull();
  });

  test("refuses a field the Backend reports without the image_upload flag", () => {
    const withSpecs = {
      ...ctx,
      fieldSpecs: new Map([
        ["LoadImage", { image: { type: "COMBO", options: ["a.png"] } }],
      ]),
    };
    expect(validateBinding("image_upload", "10", "image", withSpecs)).toContain(
      "image upload loader",
    );
  });

  test("without the Backend's field shapes, falls back to a text field", () => {
    expect(validateBinding("image_upload", "10", "image", ctx)).toBeNull();
    expect(
      validateBinding("image_upload", "12", "steps", {
        ...ctx,
        workflow: {
          ...loaderWorkflow,
          "12": { class_type: "KSampler", inputs: { steps: 20 } },
        },
      }),
    ).toContain("image upload loader");
  });

  test("max size must be 1 to MAX_UPLOAD_MB, max long side a positive whole number", () => {
    const withCeiling = { ...ctx, maxUploadMb: 500 };
    expect(validateInputDefinition(uploadInput, [], withCeiling)).toEqual([]);
    expect(
      validateInputDefinition(
        { ...uploadInput, maxSizeMb: 0 },
        [],
        withCeiling,
      ),
    ).toContain("max size must be 1-500 MB");
    expect(
      validateInputDefinition(
        { ...uploadInput, maxSizeMb: 501 },
        [],
        withCeiling,
      ),
    ).toContain("max size must be 1-500 MB");
    expect(
      validateInputDefinition(
        { ...uploadInput, maxLongSide: 0 },
        [],
        withCeiling,
      ),
    ).toContain("max long side must be a whole number of pixels, at least 1");
    expect(
      validateInputDefinition(
        { ...uploadInput, maxLongSide: null },
        [],
        withCeiling,
      ),
    ).toEqual([]);
  });

  test("a shown Image Upload is always required and takes an Upload id", () => {
    const schema = buildInputValuesSchema([uploadInput]);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ [uploadInput.id]: "not-an-id" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ [uploadInput.id]: uploadId }).success).toBe(true);
  });

  test("buildPrompt writes the Upload's Backend file name into the loader field", () => {
    const { prompt } = buildPrompt(
      loaderWorkflow,
      [uploadInput],
      { [uploadInput.id]: uploadFileName(uploadId, "png") },
      ["11"],
      "gen-1",
    );
    expect(prompt["10"]?.inputs.image).toBe(`studio/${uploadId}.png`);
  });

  test("a missing value leaves the loader's own file name", () => {
    const applied = applyInputValues(loaderWorkflow, [uploadInput], {});
    expect(applied["10"]?.inputs.image).toBe("example.png");
  });

  test("imageUploadLimitIssue checks size and, once known, the long side", () => {
    const mb = 1024 * 1024;
    expect(imageUploadLimitIssue({ size: 20 * mb }, uploadInput)).toBeNull();
    expect(imageUploadLimitIssue({ size: 20 * mb + 1 }, uploadInput)).toBe(
      "is larger than 20 MB",
    );
    expect(
      imageUploadLimitIssue(
        { size: mb, width: 4097, height: 100 },
        uploadInput,
      ),
    ).toBe("is larger than 4096 px on its long side");
    expect(
      imageUploadLimitIssue(
        { size: mb, width: 5000, height: 5000 },
        { ...uploadInput, maxLongSide: null },
      ),
    ).toBeNull();
  });
});

describe("Seed Input (issue #47)", () => {
  const ctx = {
    workflow,
    outputNodeIds: new Set(["3"]),
    usedFields: new Set<string>(),
  };

  function seedInput(
    overrides: Partial<SeedInputDefinition> = {},
  ): SeedInputDefinition {
    return {
      id: "66666666-6666-6666-6666-666666666666",
      kind: "seed",
      group: "settings",
      label: "Seed",
      help: "",
      max: 1000,
      bindings: [
        { nodeId: "2", field: "seed", classType: "KSampler", title: null },
      ],
      ...overrides,
    };
  }

  test("accepts a Seed Input bound to one INT field, with a max", () => {
    expect(validateInputDefinition(seedInput(), [], ctx)).toEqual([]);
  });

  test("refuses more than one bound field", () => {
    const errors = validateInputDefinition(
      seedInput({
        bindings: [
          { nodeId: "2", field: "seed", classType: "KSampler", title: null },
          { nodeId: "2", field: "steps", classType: "KSampler", title: null },
        ],
      }),
      [],
      ctx,
    );
    expect(errors.some((e) => e.includes("exactly one"))).toBe(true);
  });

  test("refuses a non-whole-number field, when known", () => {
    const floatCtx = {
      ...ctx,
      fieldSpecs: new Map([["KSampler", { seed: { type: "FLOAT" } }]]),
    };
    const errors = validateInputDefinition(seedInput(), [], floatCtx);
    expect(errors.some((e) => e.includes("whole-number"))).toBe(true);
  });

  test("accepts a null max (checked at enable time, not here)", () => {
    expect(validateInputDefinition(seedInput({ max: null }), [], ctx)).toEqual(
      [],
    );
  });

  test("refuses a max at or above 2^53", () => {
    const errors = validateInputDefinition(
      seedInput({ max: 2 ** 53 }),
      [],
      ctx,
    );
    expect(errors.some((e) => e.includes("below"))).toBe(true);
  });

  test("writes the submitted seed straight to its bound field, no default fallback", () => {
    const applied = applyInputValues(workflow, [seedInput()], {
      "66666666-6666-6666-6666-666666666666": 42,
    });
    expect(applied["2"]?.inputs.seed).toBe(42);
  });

  test("leaves the Workflow's own seed when blank", () => {
    const applied = applyInputValues(workflow, [seedInput()], {});
    expect(applied["2"]?.inputs.seed).toBe(0);
  });
});
