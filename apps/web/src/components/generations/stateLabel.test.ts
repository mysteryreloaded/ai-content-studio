// Issue #195's AC: "tests cover the cap and the indeterminate bar."
import { describe, expect, test } from "bun:test";
import { progressPercent } from "./stateLabel.js";
import type { GenerationProgress } from "./types.js";

function progress(overrides: Partial<GenerationProgress>): GenerationProgress {
  return {
    generationId: "g1",
    elapsedMs: 0,
    estimateMs: null,
    step: null,
    totalSteps: null,
    ...overrides,
  };
}

describe("progressPercent", () => {
  test("caps at 99 once elapsed time passes the estimate", () => {
    expect(
      progressPercent(progress({ elapsedMs: 120_000, estimateMs: 60_000 })),
    ).toBe(99);
  });

  test("is null without a progress reading", () => {
    expect(progressPercent(undefined)).toBeNull();
  });

  test("is null with no estimate yet", () => {
    expect(progressPercent(progress({ estimateMs: null }))).toBeNull();
  });

  test("is null with a zero (not-yet-meaningful) estimate", () => {
    expect(progressPercent(progress({ estimateMs: 0 }))).toBeNull();
  });

  test("is the elapsed/estimate ratio, rounded, below the cap", () => {
    expect(
      progressPercent(progress({ elapsedMs: 30_000, estimateMs: 60_000 })),
    ).toBe(50);
  });
});
