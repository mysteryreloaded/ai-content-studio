import { describe, expect, test } from "bun:test";
import { buildFrozenPrompt } from "./frozen-prompt.js";
import type { Workflow } from "./types.js";

describe("buildFrozenPrompt", () => {
  test("keeps only the Mode's Path and stamps the output node's filename_prefix", () => {
    const workflow: Workflow = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
      "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
      "4": { class_type: "SaveImage", inputs: { images: ["99", 0] } },
    };

    const { prompt, nodeTypes } = buildFrozenPrompt(workflow, ["3"], "gen-1");

    expect(Object.keys(prompt).sort()).toEqual(["1", "2", "3"]);
    expect(prompt["3"]?.inputs.filename_prefix).toBe("studio/gen-1/");
    expect(nodeTypes).toEqual(["KSampler", "LoadImage", "SaveImage"]);
  });

  test("stamps every output node when a Mode has several", () => {
    const workflow: Workflow = {
      shared: { class_type: "CheckpointLoader", inputs: {} },
      a: { class_type: "SaveVideo", inputs: { video: ["shared", 0] } },
      b: { class_type: "SaveImage", inputs: { image: ["shared", 0] } },
    };

    const { prompt } = buildFrozenPrompt(workflow, ["a", "b"], "gen-2");

    expect(prompt.a?.inputs.filename_prefix).toBe("studio/gen-2/");
    expect(prompt.b?.inputs.filename_prefix).toBe("studio/gen-2/");
  });

  test("never mutates the original Workflow", () => {
    const workflow: Workflow = {
      "1": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };

    buildFrozenPrompt(workflow, ["1"], "gen-3");

    expect(workflow["1"]?.inputs.filename_prefix).toBeUndefined();
  });
});
