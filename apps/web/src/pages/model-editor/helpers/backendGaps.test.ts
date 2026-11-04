import { describe, expect, test } from "bun:test";
import type {
  CheckModelBackend,
  CheckModelInput,
  CheckModelMode,
} from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
import { backendModeGaps } from "./backendGaps.js";

const WORKFLOW: Workflow = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { image: ["2", 0] } },
};

function model(workflow: Workflow = WORKFLOW): CheckModelInput {
  return { workflow, inputs: [], modes: [] };
}

function mode(outputNodeIds: string[]): CheckModelMode {
  return { id: "mode-1", name: "Mode 1", outputNodeIds, inputSettings: [] };
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
    nodeTypes: new Set(["CheckpointLoaderSimple", "KSampler", "SaveImage"]),
    fieldSpecs: new Map(),
    ...overrides,
  };
}

describe("backendModeGaps", () => {
  test("is an error when no attached Backend can run the Mode", () => {
    const b1 = backend("b1", {
      nodeTypes: new Set(["CheckpointLoaderSimple"]),
    });
    const b2 = backend("b2", { nodeTypes: new Set(["KSampler"]) });
    const gaps = backendModeGaps(model(), [mode(["3"])], b1, [b1, b2]);
    expect(gaps).toEqual([
      {
        mode: mode(["3"]),
        missingNodeType: "SaveImage",
        pack: "ComfyUI core",
        severity: "error",
      },
    ]);
  });

  test("is a warning when another attached Backend can run the Mode", () => {
    const b1 = backend("b1", {
      nodeTypes: new Set(["CheckpointLoaderSimple"]),
    });
    const b2 = backend("b2"); // has everything
    const gaps = backendModeGaps(model(), [mode(["3"])], b1, [b1, b2]);
    expect(gaps[0]?.severity).toBe("warning");
  });

  test("a missing partner (outside-service) node is always an error, even when another Backend can run it", () => {
    const workflow: Workflow = {
      "1": { class_type: "GemmaAPITextEncode", inputs: {} },
      "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
    };
    const b1 = backend("b1", { nodeTypes: new Set(["SaveImage"]) });
    const b2 = backend("b2", {
      nodeTypes: new Set(["GemmaAPITextEncode", "SaveImage"]),
    });
    const gaps = backendModeGaps(model(workflow), [mode(["2"])], b1, [b1, b2]);
    expect(gaps).toEqual([
      {
        mode: mode(["2"]),
        missingNodeType: "GemmaAPITextEncode",
        pack: null,
        severity: "error",
      },
    ]);
  });

  test("a Backend that can already run the Mode has no gap", () => {
    const b1 = backend("b1");
    const gaps = backendModeGaps(model(), [mode(["3"])], b1, [b1]);
    expect(gaps).toEqual([]);
  });
});
