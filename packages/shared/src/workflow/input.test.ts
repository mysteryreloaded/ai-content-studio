import { describe, expect, test } from "bun:test";
import {
  applyInputValues,
  buildInputValuesSchema,
  buildPrompt,
  listBindableFields,
  relevantInputs,
  toInputIssues,
  validateBinding,
  validateInputDefinition,
} from "./input.js";
import type {
  NumberInputDefinition,
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

  test("accepts a well-formed text Input", () => {
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
    expect(validateInputDefinition(input, [], ctx)).toEqual([]);
  });

  test("refuses a duplicate label", () => {
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
    expect(validateInputDefinition(input, ["prompt"], ctx)).toContain(
      "label must be unique",
    );
  });

  test("refuses a number Input with max <= min or step <= 0", () => {
    const input: NumberInputDefinition = {
      id: "i2",
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
      id: "i3",
      kind: "select",
      group: "settings",
      label: "Quality",
      help: "",
      default: null,
      options: [{ id: "o1", label: "Fast", values: [10] }],
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
      id: "i3",
      kind: "select",
      group: "settings",
      label: "Quality",
      help: "",
      default: null,
      options: [
        { id: "o1", label: "Fast", values: [] },
        { id: "o2", label: "Slow", values: [40] },
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
