import { describe, expect, test } from "bun:test";
import type { SeedInputDefinition } from "./input.js";
import {
  SEED_UPPER_BOUND,
  isSeedInput,
  randomSeedBase,
  seedBoundFor,
  validateSeedRange,
} from "./seed.js";

function seedInput(max: number | null): SeedInputDefinition {
  return {
    id: "seed",
    kind: "seed",
    group: "settings",
    label: "Seed",
    help: "",
    max,
    bindings: [
      { nodeId: "2", field: "seed", classType: "KSampler", title: null },
    ],
  };
}

describe("isSeedInput", () => {
  test("narrows a Seed Input", () => {
    expect(isSeedInput(seedInput(100))).toBe(true);
  });
});

describe("seedBoundFor", () => {
  test("uses the Input's own max", () => {
    expect(seedBoundFor(seedInput(100))).toBe(100);
  });

  test("falls back to the upper bound when max is unset", () => {
    expect(seedBoundFor(seedInput(null))).toBe(SEED_UPPER_BOUND);
  });

  test("caps a max above the upper bound", () => {
    expect(seedBoundFor(seedInput(SEED_UPPER_BOUND + 1000))).toBe(
      SEED_UPPER_BOUND,
    );
  });
});

describe("validateSeedRange", () => {
  test("accepts a seed that leaves room for every Generation", () => {
    expect(validateSeedRange(97, 4, 100)).toBeNull();
  });

  test("refuses a negative seed", () => {
    expect(validateSeedRange(-1, 1, 100)).toContain("non-negative");
  });

  test("refuses a non-integer seed", () => {
    expect(validateSeedRange(1.5, 1, 100)).toContain("whole number");
  });

  test("refuses a seed where s + count - 1 exceeds the bound", () => {
    expect(validateSeedRange(98, 4, 100)).toContain("100");
  });

  test("accepts a seed sitting exactly on the bound with count 1", () => {
    expect(validateSeedRange(100, 1, 100)).toBeNull();
  });
});

describe("randomSeedBase", () => {
  test("always leaves room for count consecutive seeds under bound", () => {
    for (let i = 0; i < 200; i++) {
      const base = randomSeedBase(4, 100);
      expect(base).toBeGreaterThanOrEqual(0);
      expect(base + 3).toBeLessThanOrEqual(100);
    }
  });

  test("draws below 2^53 at the upper bound", () => {
    const base = randomSeedBase(1, SEED_UPPER_BOUND);
    expect(base).toBeLessThanOrEqual(SEED_UPPER_BOUND);
    expect(Number.isInteger(base)).toBe(true);
  });
});
