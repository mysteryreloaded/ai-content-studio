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

  test("rejects a node missing class_type", () => {
    const result = parseApiFormatWorkflow({ "1": { inputs: {} } });
    expect(result.ok).toBe(false);
  });

  test("rejects a node missing inputs", () => {
    const result = parseApiFormatWorkflow({ "1": { class_type: "X" } });
    expect(result.ok).toBe(false);
  });

  test("rejects an empty Workflow", () => {
    expect(parseApiFormatWorkflow({}).ok).toBe(false);
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
