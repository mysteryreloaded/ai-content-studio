import { describe, expect, test } from "bun:test";
import {
  computeModePath,
  inferOutputNodeKind,
  isPreviewNodeClass,
  resolveModeOutputNodes,
  validateModeName,
} from "./mode.js";
import type { Workflow } from "./types.js";

describe("resolveModeOutputNodes", () => {
  const workflow: Workflow = {
    "1": { class_type: "LoadImage", inputs: {} },
    "2": {
      class_type: "SaveImage",
      inputs: { image: ["1", 0] },
      _meta: { title: "Final frame" },
    },
    "3": { class_type: "PreviewImage", inputs: { image: ["1", 0] } },
  };

  test("resolves ordered output nodes, inferring kind and title", () => {
    const result = resolveModeOutputNodes(workflow, ["2"]);
    expect(result).toEqual({
      ok: true,
      outputNodes: [
        {
          nodeId: "2",
          classType: "SaveImage",
          title: "Final frame",
          kind: "image",
        },
      ],
    });
  });

  test("refuses an empty list", () => {
    const result = resolveModeOutputNodes(workflow, []);
    expect(result.ok).toBe(false);
  });

  test("refuses a node that isn't in the Workflow", () => {
    const result = resolveModeOutputNodes(workflow, ["ghost"]);
    expect(result).toEqual({
      ok: false,
      errors: ['output node "ghost" is not in the Workflow'],
    });
  });

  test("refuses a preview node", () => {
    const result = resolveModeOutputNodes(workflow, ["3"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("preview node");
    }
  });

  test("refuses a node named twice", () => {
    const result = resolveModeOutputNodes(workflow, ["2", "2"]);
    expect(result.ok).toBe(false);
  });
});

describe("inferOutputNodeKind / isPreviewNodeClass", () => {
  test("infers known save classes", () => {
    expect(inferOutputNodeKind("SaveImage")).toBe("image");
    expect(inferOutputNodeKind("VHS_VideoCombine")).toBe("video");
    expect(inferOutputNodeKind("SaveAudio")).toBe("audio");
  });

  test("returns null for an unknown class", () => {
    expect(inferOutputNodeKind("SomeCustomSaver")).toBeNull();
  });

  test("flags known preview classes", () => {
    expect(isPreviewNodeClass("PreviewImage")).toBe(true);
    expect(isPreviewNodeClass("SaveImage")).toBe(false);
  });
});

describe("computeModePath", () => {
  test("delegates to computePath", () => {
    const workflow: Workflow = {
      "1": { class_type: "LoadImage", inputs: {} },
      "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
    };
    const path = computeModePath(workflow, ["2"]);
    expect(path.nodeIds).toEqual(new Set(["1", "2"]));
  });
});

describe("validateModeName", () => {
  test("accepts a unique 1-60 character name", () => {
    expect(validateModeName("First/last frame", ["Other"])).toBeNull();
  });

  test("refuses an empty name", () => {
    expect(validateModeName("", [])).not.toBeNull();
  });

  test("refuses a name over 60 characters", () => {
    expect(validateModeName("a".repeat(61), [])).not.toBeNull();
  });

  test("refuses a name that collides case-insensitively", () => {
    expect(validateModeName("Default", ["default"])).not.toBeNull();
  });
});
