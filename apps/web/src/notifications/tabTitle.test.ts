import { describe, expect, test } from "bun:test";
import {
  endedTitle,
  faviconDotFor,
  formatOutcomeCounts,
  underwayTitle,
} from "./tabTitle.js";

describe("underwayTitle", () => {
  test("matches the AC's example", () => {
    expect(underwayTitle({ count: 2, modelName: "LTX 2.5" }, "My Studio")).toBe(
      "(2) LTX 2.5 · My Studio",
    );
  });
});

describe("formatOutcomeCounts", () => {
  test("both counts joined", () => {
    expect(formatOutcomeCounts({ ready: 3, failed: 1 })).toBe(
      "3 ready · 1 failed",
    );
  });

  test("only the non-zero count shows", () => {
    expect(formatOutcomeCounts({ ready: 3, failed: 0 })).toBe("3 ready");
    expect(formatOutcomeCounts({ ready: 0, failed: 1 })).toBe("1 failed");
  });
});

describe("endedTitle", () => {
  test("checkmark once anything succeeded", () => {
    expect(endedTitle({ ready: 3, failed: 1 }, "My Studio")).toBe(
      "✓ 3 ready · 1 failed · My Studio",
    );
  });

  test("✕ when nothing succeeded", () => {
    expect(endedTitle({ ready: 0, failed: 2 }, "My Studio")).toBe(
      "✕ 2 failed · My Studio",
    );
  });
});

describe("faviconDotFor", () => {
  test("null with nothing ended yet", () => {
    expect(faviconDotFor(null)).toBeNull();
    expect(faviconDotFor({ ready: 0, failed: 0 })).toBeNull();
  });

  test("accent once anything succeeded, even alongside failures", () => {
    expect(faviconDotFor({ ready: 1, failed: 1 })).toBe("accent");
  });

  test("the failure colour only when everything failed", () => {
    expect(faviconDotFor({ ready: 0, failed: 2 })).toBe("failure");
  });
});
