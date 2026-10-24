// Seed draw and validation (issue #47, ADR 0007): a Submission's 1-4
// Generations differ only by seed, drawn (or checked) as one consecutive
// run `s, s+1, ... s+count-1` under a single bound.

import type { InputDefinition, SeedInputDefinition } from "./input.js";

/** Random seeds are drawn below 2^53 (the largest integer JS represents exactly). */
export const SEED_UPPER_BOUND = Number.MAX_SAFE_INTEGER;

export function isSeedInput(
  input: InputDefinition,
): input is SeedInputDefinition {
  return input.kind === "seed";
}

/** The bound a Submission's seeds must stay under: the Input's own `max`, capped at {@link SEED_UPPER_BOUND}. */
export function seedBoundFor(input: SeedInputDefinition): number {
  return Math.min(input.max ?? SEED_UPPER_BOUND, SEED_UPPER_BOUND);
}

/** Refuses a seed that isn't a non-negative whole number, or where `s + count - 1` would exceed `bound`. */
export function validateSeedRange(
  seed: number,
  count: number,
  bound: number,
): string | null {
  if (!Number.isInteger(seed) || seed < 0) {
    return "must be a non-negative whole number";
  }
  if (seed + count - 1 > bound) {
    return `must leave room for ${count} seed${count === 1 ? "" : "s"} under the maximum of ${bound}`;
  }
  return null;
}

/** A random base seed for `count` consecutive seeds under `bound` (issue #47). */
export function randomSeedBase(count: number, bound: number): number {
  const upper = bound - (count - 1);
  return Math.floor(Math.random() * (upper + 1));
}
