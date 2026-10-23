import { describe, expect, test } from "bun:test";
import { computePath, extractPath } from "./path.js";
import type { Workflow } from "./types.js";

describe("computePath", () => {
  test("includes an output node and every node it depends on", () => {
    const workflow: Workflow = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
      "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
      "4": { class_type: "SaveImage", inputs: { images: ["99", 0] } }, // unrelated branch
    };

    const path = computePath(workflow, ["3"]);

    expect(path.nodeIds).toEqual(new Set(["3", "2", "1"]));
    expect(path.missingOutputNodeIds).toEqual([]);
  });

  test("merges dependencies from several output nodes", () => {
    const workflow: Workflow = {
      shared: { class_type: "CheckpointLoader", inputs: {} },
      a: { class_type: "SaveVideo", inputs: { video: ["shared", 0] } },
      b: { class_type: "SaveImage", inputs: { image: ["shared", 0] } },
    };

    const path = computePath(workflow, ["a", "b"]);

    expect(path.nodeIds).toEqual(new Set(["a", "b", "shared"]));
  });

  test("reports an output node missing from the Workflow", () => {
    const workflow: Workflow = {
      "1": { class_type: "SaveImage", inputs: {} },
    };

    const path = computePath(workflow, ["1", "ghost"]);

    expect(path.missingOutputNodeIds).toEqual(["ghost"]);
    expect(path.nodeIds).toEqual(new Set(["1"]));
  });

  test("follows only the chosen side of a switch with a literal value", () => {
    const workflow: Workflow = {
      trueBranch: { class_type: "LoadImage", inputs: {} },
      falseBranch: { class_type: "LoadImage", inputs: {} },
      sw: {
        class_type: "ComfySwitchNode",
        inputs: {
          boolean: true,
          on_true: ["trueBranch", 0],
          on_false: ["falseBranch", 0],
        },
      },
      out: { class_type: "SaveImage", inputs: { image: ["sw", 0] } },
    };

    const path = computePath(workflow, ["out"]);

    expect(path.nodeIds).toEqual(new Set(["out", "sw", "trueBranch"]));
  });

  test("resolves a switch's value through a feeding primitive node", () => {
    const workflow: Workflow = {
      trueBranch: { class_type: "LoadImage", inputs: {} },
      falseBranch: { class_type: "LoadImage", inputs: {} },
      prim: { class_type: "PrimitiveBoolean", inputs: { value: false } },
      sw: {
        class_type: "ComfySwitchNode",
        inputs: {
          boolean: ["prim", 0],
          on_true: ["trueBranch", 0],
          on_false: ["falseBranch", 0],
        },
      },
      out: { class_type: "SaveImage", inputs: { image: ["sw", 0] } },
    };

    const path = computePath(workflow, ["out"]);

    expect(path.nodeIds).toEqual(new Set(["out", "sw", "prim", "falseBranch"]));
  });

  test("keeps both sides when the switch's value isn't known before sending", () => {
    const workflow: Workflow = {
      trueBranch: { class_type: "LoadImage", inputs: {} },
      falseBranch: { class_type: "LoadImage", inputs: {} },
      // Fed by an ordinary compute node (e.g. driven by a visible Input), not a primitive.
      computed: { class_type: "SomeComparisonNode", inputs: {} },
      sw: {
        class_type: "ComfySwitchNode",
        inputs: {
          boolean: ["computed", 0],
          on_true: ["trueBranch", 0],
          on_false: ["falseBranch", 0],
        },
      },
      out: { class_type: "SaveImage", inputs: { image: ["sw", 0] } },
    };

    const path = computePath(workflow, ["out"]);

    expect(path.nodeIds).toEqual(
      new Set(["out", "sw", "computed", "trueBranch", "falseBranch"]),
    );
  });

  test("supports subgraph node ids", () => {
    const workflow: Workflow = {
      "405:370": { class_type: "LoadImage", inputs: {} },
      out: { class_type: "SaveImage", inputs: { image: ["405:370", 0] } },
    };

    const path = computePath(workflow, ["out"]);

    expect(path.nodeIds).toEqual(new Set(["out", "405:370"]));
  });
});

describe("extractPath", () => {
  test("returns only the Path's nodes, links untouched", () => {
    const workflow: Workflow = {
      "1": { class_type: "LoadImage", inputs: {} },
      "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
      "3": { class_type: "SaveImage", inputs: { image: ["99", 0] } },
    };

    const path = computePath(workflow, ["2"]);
    const sub = extractPath(workflow, path);

    expect(Object.keys(sub).sort()).toEqual(["1", "2"]);
    expect(sub["2"]?.inputs.image).toEqual(["1", 0]);
  });
});
