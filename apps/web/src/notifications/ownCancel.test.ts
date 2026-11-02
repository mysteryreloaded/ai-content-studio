import { describe, expect, test } from "bun:test";
import {
  isOwnCancelled,
  isOwnCancelledGeneration,
  markOwnCancel,
  markOwnCancelGeneration,
} from "./ownCancel.js";

// No happy-dom registration here: this file covers the module's own
// bookkeeping (the direct set writes behind `mark*`/`is*`), the same way
// `crossTab.ts`'s BroadcastChannel plumbing is left untested — the
// cross-tab delivery can only be exercised with two tabs anyway.

describe("markOwnCancel / isOwnCancelled", () => {
  test("marks that one Submission, not others", () => {
    markOwnCancel("sub-a");
    expect(isOwnCancelled("sub-a")).toBe(true);
    expect(isOwnCancelled("sub-b")).toBe(false);
  });
});

describe("markOwnCancelGeneration / isOwnCancelledGeneration (issue #189)", () => {
  test("marks that one Generation, not others", () => {
    markOwnCancelGeneration("gen-a");
    expect(isOwnCancelledGeneration("gen-a")).toBe(true);
    expect(isOwnCancelledGeneration("gen-b")).toBe(false);
  });

  test("a Generation's mark is not a Submission's mark, and vice versa", () => {
    markOwnCancelGeneration("gen-c");
    // Cancelling one Generation never marks the whole Submission.
    expect(isOwnCancelled("sub-c")).toBe(false);

    markOwnCancel("sub-d");
    // Cancelling the whole Submission never marks a single Generation.
    expect(isOwnCancelledGeneration("gen-d")).toBe(false);
  });
});
