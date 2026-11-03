import { describe, expect, test } from "bun:test";
import {
  canonicalizeWorkflow,
  findMissingLinkTargets,
  looksLikeUiFormat,
  parseApiFormatWorkflow,
} from "./validate.js";

describe("looksLikeUiFormat", () => {
  test("recognizes a UI-format save", () => {
    expect(looksLikeUiFormat({ nodes: [], links: [] })).toBe(true);
  });

  test("rejects an API-format Workflow", () => {
    expect(
      looksLikeUiFormat({ "1": { class_type: "LoadImage", inputs: {} } }),
    ).toBe(false);
  });
});

describe("parseApiFormatWorkflow", () => {
  test("accepts a minimal valid Workflow", () => {
    const result = parseApiFormatWorkflow({
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
    });
    expect(result.ok).toBe(true);
  });

  test("refuses a UI-format save with the expected message", () => {
    const result = parseApiFormatWorkflow({ nodes: [], links: [] });
    expect(result).toEqual({
      ok: false,
      error: "This is a UI save; export it with Export (API)",
    });
  });

  test("rejects a node missing class_type with the packless fallback message", () => {
    const result = parseApiFormatWorkflow({ "7": { inputs: {} } });
    expect(result).toEqual({
      ok: false,
      error:
        'node "7" has no node type (class_type); export the Workflow with Export (API) from a ComfyUI that has all its custom nodes installed',
    });
  });

  test("rejects a node missing inputs", () => {
    const result = parseApiFormatWorkflow({ "1": { class_type: "X" } });
    expect(result).toEqual({
      ok: false,
      error: 'node "1" is missing inputs',
    });
  });

  test("rejects an empty Workflow", () => {
    expect(parseApiFormatWorkflow({}).ok).toBe(false);
  });
});

/**
 * Issue #229: a node without a `class_type` is usually one its pack was
 * missing on the machine that exported the Workflow, so the single error
 * names every affected pack (grouped by `_meta.cnr_id`, else `_meta.aux_id`)
 * and says how to fix it.
 */
describe("parseApiFormatWorkflow missing custom node packs", () => {
  const FIX =
    "Install them in that ComfyUI (Manager → Install Missing Custom Nodes), restart it, open the Workflow again with no red nodes, and use Export (API) again. The GPU Backends that run this Model need the same packs.";

  test("names a single pack with the node's title", () => {
    const result = parseApiFormatWorkflow({
      "196": {
        inputs: { UNKNOWN: 10 },
        _meta: {
          title: "Clip Length ( in seconds )",
          cnr_id: "comfyui-mxtoolkit",
          aux_id: "Smirnov75/ComfyUI-mxToolkit",
        },
      },
    });
    expect(result).toEqual({
      ok: false,
      error: `1 node has no node type because the ComfyUI this was exported from is missing its custom node pack: comfyui-mxtoolkit (node 196 "Clip Length ( in seconds )"). ${FIX}`,
    });
  });

  test("lists every pack, sorted, with the no-pack group first", () => {
    const result = parseApiFormatWorkflow({
      "21": {
        inputs: {},
        _meta: { cnr_id: "rgthree-comfy", title: "Reroute" },
      },
      "11": { inputs: {}, _meta: { cnr_id: "ComfyUI-GGUF" } },
      "10": {
        inputs: {},
        _meta: { cnr_id: "ComfyUI-GGUF", title: "Load GGUF" },
      },
      "7": { inputs: {} },
    });
    expect(result).toEqual({
      ok: false,
      error: `4 nodes have no node type because the ComfyUI this was exported from is missing their custom node packs: an unknown custom node pack (node 7), ComfyUI-GGUF (nodes 10 "Load GGUF", 11), rgthree-comfy (node 21 "Reroute"). ${FIX}`,
    });
  });

  test("falls back to _meta.aux_id when there is no cnr_id", () => {
    const result = parseApiFormatWorkflow({
      "196": {
        inputs: { UNKNOWN: 10 },
        _meta: {
          title: "Clip Length ( in seconds )",
          aux_id: "Smirnov75/ComfyUI-mxToolkit",
        },
      },
    });
    expect(result).toEqual({
      ok: false,
      error: `1 node has no node type because the ComfyUI this was exported from is missing its custom node pack: Smirnov75/ComfyUI-mxToolkit (node 196 "Clip Length ( in seconds )"). ${FIX}`,
    });
  });

  test("lists at most 3 nodes per pack, then +N more", () => {
    const result = parseApiFormatWorkflow({
      "5467": {
        inputs: {},
        _meta: {
          cnr_id: "comfyui-custom-scripts",
          title: "Math Expression 3🐍",
        },
      },
      "5443": {
        inputs: {},
        _meta: {
          cnr_id: "comfyui-custom-scripts",
          title: "Math Expression 1🐍",
        },
      },
      "5466": { inputs: {}, _meta: { cnr_id: "comfyui-custom-scripts" } },
      "5468": {
        inputs: {},
        _meta: {
          cnr_id: "comfyui-custom-scripts",
          title: "Math Expression 4🐍",
        },
      },
      "5469": { inputs: {}, _meta: { cnr_id: "comfyui-custom-scripts" } },
    });
    expect(result).toEqual({
      ok: false,
      error: `5 nodes have no node type because the ComfyUI this was exported from is missing their custom node packs: comfyui-custom-scripts (nodes 5443 "Math Expression 1🐍", 5466, 5467 "Math Expression 3🐍", +2 more). ${FIX}`,
    });
  });

  test("a single node with no _meta at all gets the fallback message with its id", () => {
    const result = parseApiFormatWorkflow({
      "7": { inputs: { UNKNOWN: 0 } },
    });
    expect(result).toEqual({
      ok: false,
      error:
        'node "7" has no node type (class_type); export the Workflow with Export (API) from a ComfyUI that has all its custom nodes installed',
    });
  });

  test("the missing-type message wins over a missing inputs in the same file", () => {
    const result = parseApiFormatWorkflow({
      "1": {
        inputs: { UNKNOWN: 10 },
        _meta: {
          cnr_id: "comfyui-mxtoolkit",
          title: "Clip Length ( in seconds )",
        },
      },
      "2": { class_type: "KSampler" },
    });
    expect(result).toEqual({
      ok: false,
      error: `1 node has no node type because the ComfyUI this was exported from is missing its custom node pack: comfyui-mxtoolkit (node 1 "Clip Length ( in seconds )"). ${FIX}`,
    });
  });

  test("stays under 600 characters for a Workflow with 12 missing nodes across 5 packs", () => {
    const result = parseApiFormatWorkflow({
      "5443": {
        inputs: { UNKNOWN: 10 },
        _meta: {
          cnr_id: "comfyui-custom-scripts",
          title: "Math Expression 1🐍",
        },
      },
      "5466": {
        inputs: { UNKNOWN: 0 },
        _meta: { cnr_id: "comfyui-custom-scripts" },
      },
      "5467": {
        inputs: { UNKNOWN: 1 },
        _meta: {
          cnr_id: "comfyui-custom-scripts",
          title: "Math Expression 3🐍",
        },
      },
      "5468": {
        inputs: { UNKNOWN: 2 },
        _meta: {
          cnr_id: "comfyui-custom-scripts",
          title: "Math Expression 4🐍",
        },
      },
      "9": { inputs: { UNKNOWN: 0 }, _meta: { cnr_id: "comfyui-easy-use" } },
      "10": {
        inputs: { UNKNOWN: 0 },
        _meta: { cnr_id: "comfyui-easy-use", title: "Load LoRA" },
      },
      "11": { inputs: { UNKNOWN: 0 }, _meta: { cnr_id: "comfyui-easy-use" } },
      "200": { inputs: { UNKNOWN: 0 }, _meta: { cnr_id: "ComfyUI-GGUF" } },
      "201": { inputs: { UNKNOWN: 0 }, _meta: { cnr_id: "ComfyUI-GGUF" } },
      "196": {
        inputs: { UNKNOWN: 10, UNKNOWN_1: 10, UNKNOWN_2: 0 },
        _meta: {
          title: "Clip Length ( in seconds )",
          cnr_id: "comfyui-mxtoolkit",
          aux_id: "Smirnov75/ComfyUI-mxToolkit",
          ver: "0.9.92",
        },
      },
      "300": { inputs: { UNKNOWN: 0 }, _meta: { cnr_id: "rgthree-comfy" } },
      "301": { inputs: { UNKNOWN: 0 }, _meta: { cnr_id: "rgthree-comfy" } },
    });
    if (result.ok) throw new Error("expected an error");
    expect(result.error.length).toBeLessThan(600);
    expect(result.error).toBe(
      `12 nodes have no node type because the ComfyUI this was exported from is missing their custom node packs: comfyui-custom-scripts (nodes 5443 "Math Expression 1🐍", 5466, 5467 "Math Expression 3🐍", +1 more), comfyui-easy-use (nodes 9, 10 "Load LoRA", 11), ComfyUI-GGUF (nodes 200, 201), comfyui-mxtoolkit (node 196 "Clip Length ( in seconds )"), rgthree-comfy (nodes 300, 301). ${FIX}`,
    );
  });
});

describe("findMissingLinkTargets", () => {
  test("finds a link to a node that isn't in the Workflow", () => {
    const result = parseApiFormatWorkflow({
      "1": { class_type: "KSampler", inputs: { model: ["ghost", 0] } },
    });
    if (!result.ok) throw new Error("expected ok");
    expect(findMissingLinkTargets(result.workflow)).toEqual(["ghost"]);
  });

  test("finds nothing when every link resolves", () => {
    const result = parseApiFormatWorkflow({
      "1": { class_type: "LoadImage", inputs: {} },
      "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
    });
    if (!result.ok) throw new Error("expected ok");
    expect(findMissingLinkTargets(result.workflow)).toEqual([]);
  });
});

describe("canonicalizeWorkflow", () => {
  test("produces the same string regardless of key order", () => {
    const a = canonicalizeWorkflow({
      "1": { class_type: "X", inputs: { b: 1, a: 2 } },
    });
    const b = canonicalizeWorkflow({
      "1": { inputs: { a: 2, b: 1 }, class_type: "X" },
    });
    expect(a).toEqual(b);
  });
});
