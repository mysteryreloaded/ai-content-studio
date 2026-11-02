import { describe, expect, test } from "bun:test";
import {
  firstClickGenerationId,
  hasAnyOutcome,
  isSubmissionEnded,
  outcomeCounts,
  withoutOwnCancelledGenerations,
} from "./submissionOutcome.js";
import type { TrackedSubmission } from "./types.js";

function submission(
  generations: TrackedSubmission["generations"],
): TrackedSubmission {
  return {
    submissionId: "s1",
    modelName: "LTX 2.5",
    modeName: "First frame",
    generations,
  };
}

describe("isSubmissionEnded", () => {
  test("false while any Generation is still under way", () => {
    expect(
      isSubmissionEnded(
        submission([
          { id: "a", state: "succeeded" },
          { id: "b", state: "running" },
        ]),
      ),
    ).toBe(false);
  });

  test("true once every Generation is terminal", () => {
    expect(
      isSubmissionEnded(
        submission([
          { id: "a", state: "succeeded" },
          { id: "b", state: "failed" },
        ]),
      ),
    ).toBe(true);
  });

  test("a removed Generation counts as ended even mid-dispatch", () => {
    expect(
      isSubmissionEnded(
        submission([
          { id: "a", state: "succeeded" },
          { id: "b", state: "running", removed: true },
        ]),
      ),
    ).toBe(true);
  });
});

describe("outcomeCounts", () => {
  test("splits succeeded from failed/cancelled", () => {
    expect(
      outcomeCounts(
        submission([
          { id: "a", state: "succeeded" },
          { id: "b", state: "succeeded" },
          { id: "c", state: "failed" },
          { id: "d", state: "cancelled" },
        ]),
      ),
    ).toEqual({ ready: 2, failed: 2 });
  });

  test("skips removed Generations entirely", () => {
    expect(
      outcomeCounts(
        submission([
          { id: "a", state: "succeeded", removed: true },
          { id: "b", state: "failed" },
        ]),
      ),
    ).toEqual({ ready: 0, failed: 1 });
  });
});

describe("hasAnyOutcome", () => {
  test("false when everything was removed", () => {
    expect(hasAnyOutcome({ ready: 0, failed: 0 })).toBe(false);
  });

  test("true otherwise", () => {
    expect(hasAnyOutcome({ ready: 0, failed: 1 })).toBe(true);
  });
});

describe("withoutOwnCancelledGenerations (issue #189)", () => {
  const four = submission([
    { id: "a", state: "cancelled" },
    { id: "b", state: "succeeded" },
    { id: "c", state: "succeeded" },
    { id: "d", state: "succeeded" },
  ]);

  test("drops only the Generation the predicate marks own", () => {
    const copy = withoutOwnCancelledGenerations(four, (id) => id === "a");
    expect(copy.submissionId).toBe(four.submissionId);
    expect(copy.modelName).toBe(four.modelName);
    expect(copy.modeName).toBe(four.modeName);
    expect(copy.generations.map((g) => g.id)).toEqual(["b", "c", "d"]);
  });

  test("an empty predicate keeps every Generation", () => {
    const copy = withoutOwnCancelledGenerations(four, () => false);
    expect(copy.generations).toEqual(four.generations);
    expect(copy.generations).not.toBe(four.generations);
  });

  test("every Generation own-cancelled leaves an empty copy", () => {
    const copy = withoutOwnCancelledGenerations(four, () => true);
    expect(copy.generations).toEqual([]);
  });
});

describe("firstClickGenerationId", () => {
  test("prefers the first succeeded Generation", () => {
    expect(
      firstClickGenerationId(
        submission([
          { id: "a", state: "failed" },
          { id: "b", state: "succeeded" },
          { id: "c", state: "succeeded" },
        ]),
      ),
    ).toBe("b");
  });

  test("falls back to the first failed/cancelled one", () => {
    expect(
      firstClickGenerationId(
        submission([
          { id: "a", state: "cancelled" },
          { id: "b", state: "failed" },
        ]),
      ),
    ).toBe("a");
  });

  test("null once every Generation was removed", () => {
    expect(
      firstClickGenerationId(
        submission([{ id: "a", state: "succeeded", removed: true }]),
      ),
    ).toBeNull();
  });
});
