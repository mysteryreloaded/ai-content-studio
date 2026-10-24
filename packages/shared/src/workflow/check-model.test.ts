import { describe, expect, test } from "bun:test";
import {
  type CheckModelBackend,
  type CheckModelInput,
  type CheckModelMode,
  checkModel,
  hasBlockingErrors,
  modeBackendGaps,
} from "./check-model.js";
import type {
  NumberInputDefinition,
  PointsInputDefinition,
  SelectInputDefinition,
} from "./input.js";
import type { Workflow } from "./types.js";

const WORKFLOW: Workflow = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
  "2": {
    class_type: "KSampler",
    inputs: { model: ["1", 0], steps: 20 },
  },
  "3": { class_type: "SaveImage", inputs: { image: ["2", 0] } },
  "4": { class_type: "PreviewImage", inputs: { image: ["2", 0] } },
};

function mode(
  id: string,
  outputNodeIds: string[],
  overrides: Partial<CheckModelMode> = {},
): CheckModelMode {
  return { id, name: id, outputNodeIds, inputSettings: [], ...overrides };
}

function backend(
  id: string,
  overrides: Partial<CheckModelBackend> = {},
): CheckModelBackend {
  return {
    id,
    name: id,
    enabled: true,
    reachable: true,
    nodeTypes: new Set([
      "CheckpointLoaderSimple",
      "KSampler",
      "SaveImage",
      "PreviewImage",
    ]),
    fieldSpecs: new Map(),
    ...overrides,
  };
}

function stepsInput(
  overrides: Partial<NumberInputDefinition> = {},
): NumberInputDefinition {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    kind: "number",
    group: "settings",
    label: "Steps",
    help: "",
    numberMode: "integer",
    min: 1,
    max: 50,
    step: 1,
    default: null,
    bindings: [
      { nodeId: "2", field: "steps", classType: "KSampler", title: null },
    ],
    ...overrides,
  };
}

function pointsInput(
  overrides: Partial<PointsInputDefinition> = {},
): PointsInputDefinition {
  return {
    id: "00000000-0000-0000-0000-000000000002",
    kind: "points",
    group: "describe",
    label: "Who to replace",
    help: "",
    videoInputId: "00000000-0000-0000-0000-000000000003",
    widthField: { nodeId: "2", field: "steps" },
    heightField: { nodeId: "2", field: "steps" },
    bindings: [
      { nodeId: "7", field: "points", classType: "PointsEditor", title: null },
    ],
    ...overrides,
  };
}

function model(overrides: Partial<CheckModelInput> = {}): CheckModelInput {
  return {
    workflow: WORKFLOW,
    inputs: [],
    modes: [mode("mode-1", ["3"])],
    ...overrides,
  };
}

describe("checkModel", () => {
  test("a Model with a Mode and a runnable Backend has no issues", () => {
    const issues = checkModel(model(), [backend("b1")]);
    expect(issues).toEqual([]);
  });

  test("errors when there's no Mode", () => {
    const issues = checkModel(model({ modes: [] }), [backend("b1")]);
    expect(issues).toContainEqual({
      severity: "error",
      message: "needs at least one Mode",
    });
  });

  test("errors when no Backend is attached", () => {
    const issues = checkModel(model(), []);
    expect(issues).toContainEqual({
      severity: "error",
      message: "needs at least one attached Backend",
    });
  });

  test("errors when a Mode's output node is a preview node", () => {
    const issues = checkModel(model({ modes: [mode("mode-1", ["4"])] }), [
      backend("b1"),
    ]);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.modeId === "mode-1" &&
          issue.message.includes("preview node"),
      ),
    ).toBe(true);
  });

  test("errors when a Mode names an output node no longer in the Workflow", () => {
    const issues = checkModel(model({ modes: [mode("mode-1", ["ghost"])] }), [
      backend("b1"),
    ]);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes('"ghost"') &&
          issue.message.includes("not in the Workflow"),
      ),
    ).toBe(true);
  });

  test("errors when two Inputs bind the same field", () => {
    const a = stepsInput({
      id: "00000000-0000-0000-0000-000000000001",
      label: "Steps A",
    });
    const b = stepsInput({
      id: "00000000-0000-0000-0000-000000000002",
      label: "Steps B",
    });
    const issues = checkModel(model({ inputs: [a, b] }), [backend("b1")]);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes("already bound to another Input"),
      ),
    ).toBe(true);
  });

  test("errors when two Seed Inputs are defined", () => {
    const seedA = {
      id: "00000000-0000-0000-0000-000000000003",
      kind: "seed" as const,
      group: "settings" as const,
      label: "Seed A",
      help: "",
      max: 100,
      bindings: [
        { nodeId: "2", field: "a", classType: "KSampler", title: null },
      ],
    };
    const seedB = {
      ...seedA,
      id: "00000000-0000-0000-0000-000000000004",
      label: "Seed B",
    };
    const issues = checkModel(model({ inputs: [seedA, seedB] }), [
      backend("b1"),
    ]);
    expect(issues).toContainEqual({
      severity: "error",
      message: "a Model can have at most one Seed Input",
    });
  });

  test("errors when a select Input's default isn't one of its options", () => {
    const select: SelectInputDefinition = {
      id: "00000000-0000-0000-0000-000000000005",
      kind: "select",
      group: "settings",
      label: "Sampler",
      help: "",
      default: "ghost-option",
      options: [
        { id: "00000000-0000-0000-0000-000000000006", label: "A", values: [1] },
        { id: "00000000-0000-0000-0000-000000000007", label: "B", values: [2] },
      ],
      bindings: [
        { nodeId: "2", field: "steps", classType: "KSampler", title: null },
      ],
    };
    const issues = checkModel(model({ inputs: [select] }), [backend("b1")]);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.includes("default must be one of the options"),
      ),
    ).toBe(true);
  });

  test("errors when a number Input's range exceeds the bound field's own range", () => {
    const input = stepsInput({ min: 0, max: 50 });
    const backends = [
      backend("b1", {
        fieldSpecs: new Map([
          ["KSampler", { steps: { type: "INT", min: 1, max: 10 } }],
        ]),
      }),
    ];
    const issues = checkModel(model({ inputs: [input] }), backends);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" && issue.message.includes("own range"),
      ),
    ).toBe(true);
  });

  test("errors when a number Input's min doesn't sit on the bound INT field's step grid", () => {
    const input = stepsInput({ min: 0, max: 50 });
    const backends = [
      backend("b1", {
        fieldSpecs: new Map([
          ["KSampler", { steps: { type: "INT", min: 1, max: 100, step: 4 } }],
        ]),
      }),
    ];
    const issues = checkModel(model({ inputs: [input] }), backends);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message === '"Steps": this field takes 1 + a multiple of 4',
      ),
    ).toBe(true);
  });

  test("no step-grid error when the Input's own step grid is a subset of the field's", () => {
    const input = stepsInput({ min: 1, max: 97, step: 4 });
    const backends = [
      backend("b1", {
        fieldSpecs: new Map([
          ["KSampler", { steps: { type: "INT", min: 1, max: 100, step: 4 } }],
        ]),
      }),
    ];
    const issues = checkModel(model({ inputs: [input] }), backends);
    expect(issues.some((issue) => issue.message.includes("multiple of"))).toBe(
      false,
    );
  });

  test("errors when the Input's min sits on the grid but its own step doesn't divide the field's", () => {
    // min 1, step 1 on a field that only takes 1 + a multiple of 4 would
    // let an Admin pick 2, which the field itself rejects.
    const input = stepsInput({ min: 1, max: 97, step: 1 });
    const backends = [
      backend("b1", {
        fieldSpecs: new Map([
          ["KSampler", { steps: { type: "INT", min: 1, max: 100, step: 4 } }],
        ]),
      }),
    ];
    const issues = checkModel(model({ inputs: [input] }), backends);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message === '"Steps": this field takes 1 + a multiple of 4',
      ),
    ).toBe(true);
  });

  test("errors when a fixed Input value is outside its options", () => {
    const select: SelectInputDefinition = {
      id: "00000000-0000-0000-0000-000000000008",
      kind: "select",
      group: "settings",
      label: "Sampler",
      help: "",
      default: null,
      options: [
        { id: "00000000-0000-0000-0000-000000000009", label: "A", values: [1] },
      ],
      bindings: [
        { nodeId: "2", field: "steps", classType: "KSampler", title: null },
      ],
    };
    const m = mode("mode-1", ["3"], {
      inputSettings: [
        { inputId: select.id, state: "fixed", fixedValue: "ghost", label: "" },
      ],
    });
    const issues = checkModel(model({ inputs: [select], modes: [m] }), [
      backend("b1"),
    ]);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.modeId === "mode-1" &&
          issue.message.includes("one of its options"),
      ),
    ).toBe(true);
  });

  test("warns about a visible Input not on the Mode's Path", () => {
    // Node "5" isn't a dependency of mode-1's output node "3", so it's
    // never reached while walking the Path backwards from it.
    const offPathWorkflow: Workflow = {
      ...WORKFLOW,
      "5": { class_type: "KSampler", inputs: { steps: 10 } },
    };
    const offPathInput = stepsInput({
      bindings: [
        { nodeId: "5", field: "steps", classType: "KSampler", title: null },
      ],
    });
    const issues = checkModel(
      model({ workflow: offPathWorkflow, inputs: [offPathInput] }),
      [backend("b1")],
    );
    expect(
      issues.some(
        (issue) =>
          issue.severity === "warning" &&
          issue.message.includes("isn't on its Path"),
      ),
    ).toBe(true);
  });

  test("errors when a Points Input's Width or Height field is off the Mode's Path (issue #52)", () => {
    const pointsWorkflow: Workflow = {
      ...WORKFLOW,
      "7": { class_type: "PointsEditor", inputs: { points: "" } },
      // Not a dependency of output node "3": off the Path.
      "8": {
        class_type: "EmptyLatentImage",
        inputs: { width: 512, height: 512 },
      },
    };
    const offPathPoints = pointsInput({
      widthField: { nodeId: "8", field: "width" },
      heightField: { nodeId: "8", field: "height" },
    });
    const issues = checkModel(
      model({ workflow: pointsWorkflow, inputs: [offPathPoints] }),
      [backend("b1")],
    );
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.modeId === "mode-1" &&
          issue.message.includes("Width field is off"),
      ),
    ).toBe(true);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.modeId === "mode-1" &&
          issue.message.includes("Height field is off"),
      ),
    ).toBe(true);
  });

  test("no error when a Points Input's Width/Height fields are on the Mode's Path", () => {
    const pointsWorkflow: Workflow = {
      ...WORKFLOW,
      "7": { class_type: "PointsEditor", inputs: { points: "" } },
    };
    const issues = checkModel(
      model({ workflow: pointsWorkflow, inputs: [pointsInput()] }),
      [backend("b1")],
    );
    expect(issues.some((issue) => issue.message.includes("field is off"))).toBe(
      false,
    );
  });

  test("warns about duplicate Modes with the same Path and fixed values", () => {
    const issues = checkModel(
      model({ modes: [mode("mode-1", ["3"]), mode("mode-2", ["3"])] }),
      [backend("b1")],
    );
    expect(
      issues.some(
        (issue) =>
          issue.severity === "warning" &&
          issue.message.includes("same Path and fixed values"),
      ),
    ).toBe(true);
  });

  test("errors when no attached Backend can run the Mode", () => {
    const backends = [
      backend("b1", { nodeTypes: new Set(["CheckpointLoaderSimple"]) }),
    ];
    const issues = checkModel(model(), backends);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "error" &&
          issue.message.startsWith('Can\'t run "mode-1": missing'),
      ),
    ).toBe(true);
  });

  test("names the missing node's pack from the static NODE_PACKS table", () => {
    const backends = [
      backend("b1", { nodeTypes: new Set(["CheckpointLoaderSimple"]) }),
      backend("b2", {
        nodeTypes: new Set(["CheckpointLoaderSimple", "KSampler", "SaveImage"]),
      }),
    ];
    const issues = checkModel(model(), backends);
    const issue = issues.find((i) => i.backendId === "b1");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("pack ComfyUI core");
  });

  test("warns when only some Backends can run a Mode", () => {
    const backends = [
      backend("b1"),
      backend("b2", { nodeTypes: new Set(["CheckpointLoaderSimple"]) }),
    ];
    const issues = checkModel(model(), backends);
    expect(
      issues.some(
        (issue) =>
          issue.severity === "warning" &&
          issue.backendId === "b2" &&
          issue.message.includes("can't run"),
      ),
    ).toBe(true);
  });

  test("warns and skips checks for an unreachable Backend", () => {
    const issues = checkModel(model(), [backend("b1", { reachable: false })]);
    expect(issues).toContainEqual({
      severity: "warning",
      message: 'Backend "b1" is unreachable and skipped in these checks',
      backendId: "b1",
    });
  });
});

describe("modeBackendGaps", () => {
  test("lists only the Backends that can't run the Mode", () => {
    const backends = [
      backend("b1"),
      backend("b2", { nodeTypes: new Set(["CheckpointLoaderSimple"]) }),
    ];
    const gaps = modeBackendGaps(model(), mode("mode-1", ["3"]), backends);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      backendId: "b2",
      missingNodeType: "SaveImage",
      pack: "ComfyUI core",
    });
  });

  test("names an unknown class type's pack as null", () => {
    const customWorkflow: Workflow = {
      ...WORKFLOW,
      "6": { class_type: "SomeCustomSaver", inputs: { image: ["2", 0] } },
    };
    const customMode = mode("mode-1", ["6"]);
    const backends = [backend("b1", { nodeTypes: new Set(["KSampler"]) })];
    const gaps = modeBackendGaps(
      model({ workflow: customWorkflow }),
      customMode,
      backends,
    );
    expect(gaps[0]).toMatchObject({
      missingNodeType: "SomeCustomSaver",
      pack: null,
    });
  });
});

describe("hasBlockingErrors", () => {
  test("true when any issue is an error", () => {
    expect(hasBlockingErrors([{ severity: "warning", message: "x" }])).toBe(
      false,
    );
    expect(hasBlockingErrors([{ severity: "error", message: "x" }])).toBe(true);
  });
});
