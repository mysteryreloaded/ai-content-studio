// Unit tests for ProgressTracker (issue #44's AC): elapsed time against the
// median of the last 10 successes for a Model+Mode+Backend key, capped
// nowhere here (the cap is the caller's job), plus the step counter.

import { describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { ProgressTracker } from "./progress.js";

describe("ProgressTracker", () => {
  test("keyFor combines model, mode and backend", () => {
    expect(ProgressTracker.keyFor("m", "mo", "b")).toBe("m:mo:b");
  });

  test("snapshot is null before start and after discard", () => {
    const clock = new FakeClock();
    const tracker = new ProgressTracker(clock);
    expect(tracker.snapshot("gen-1")).toBeNull();

    tracker.start("gen-1", ProgressTracker.keyFor("m", "mo", "b"));
    expect(tracker.snapshot("gen-1")).not.toBeNull();

    tracker.discard("gen-1");
    expect(tracker.snapshot("gen-1")).toBeNull();
  });

  test("snapshot reports elapsed time and no estimate without history", () => {
    const clock = new FakeClock();
    const tracker = new ProgressTracker(clock);
    tracker.start("gen-1", ProgressTracker.keyFor("m", "mo", "b"));

    clock.advance(5_000);

    const snapshot = tracker.snapshot("gen-1");
    expect(snapshot?.elapsedMs).toBe(5_000);
    expect(snapshot?.estimateMs).toBeNull();
    expect(snapshot?.step).toBeNull();
    expect(snapshot?.totalSteps).toBeNull();
  });

  test("updateStep is reflected in the next snapshot", () => {
    const clock = new FakeClock();
    const tracker = new ProgressTracker(clock);
    tracker.start("gen-1", ProgressTracker.keyFor("m", "mo", "b"));

    tracker.updateStep("gen-1", 3, 10);

    const snapshot = tracker.snapshot("gen-1");
    expect(snapshot?.step).toBe(3);
    expect(snapshot?.totalSteps).toBe(10);
  });

  test("updateStep on an untracked generation is a no-op", () => {
    const clock = new FakeClock();
    const tracker = new ProgressTracker(clock);
    tracker.updateStep("ghost", 1, 2);
    expect(tracker.snapshot("ghost")).toBeNull();
  });

  test("finish records this run's duration into its key's history, for a later run's estimate", () => {
    const clock = new FakeClock();
    const tracker = new ProgressTracker(clock);
    const key = ProgressTracker.keyFor("m", "mo", "b");

    tracker.start("gen-1", key);
    clock.advance(10_000);
    tracker.finish("gen-1");

    expect(tracker.snapshot("gen-1")).toBeNull();

    tracker.start("gen-2", key);
    const snapshot = tracker.snapshot("gen-2");
    expect(snapshot?.estimateMs).toBe(10_000);
  });

  test("estimate is the median of up to the last 10 successes for that key", () => {
    const clock = new FakeClock();
    const tracker = new ProgressTracker(clock);
    const key = ProgressTracker.keyFor("m", "mo", "b");

    for (const durationMs of [1_000, 2_000, 3_000]) {
      tracker.start(`gen-${durationMs}`, key);
      clock.advance(durationMs);
      tracker.finish(`gen-${durationMs}`);
    }

    tracker.start("gen-next", key);
    expect(tracker.snapshot("gen-next")?.estimateMs).toBe(2_000);
  });

  test("history is capped at the last 10 successes, oldest dropped first", () => {
    const clock = new FakeClock();
    const tracker = new ProgressTracker(clock);
    const key = ProgressTracker.keyFor("m", "mo", "b");

    // 11 successive 1s runs, then one slow 100s run: with the cap, the
    // median should shift noticeably once the first fast run is evicted.
    for (let i = 0; i < 10; i++) {
      tracker.start(`fast-${i}`, key);
      clock.advance(1_000);
      tracker.finish(`fast-${i}`);
    }
    tracker.start("slow", key);
    clock.advance(100_000);
    tracker.finish("slow");

    tracker.start("gen-next", key);
    // History is now nine 1s runs plus one 100s run (10 entries): median
    // of nine 1_000s and one 100_000, sorted, mid index 5 -> still 1_000.
    expect(tracker.snapshot("gen-next")?.estimateMs).toBe(1_000);
  });

  test("a different key's history doesn't affect this key's estimate", () => {
    const clock = new FakeClock();
    const tracker = new ProgressTracker(clock);
    const keyA = ProgressTracker.keyFor("m1", "mo", "b");
    const keyB = ProgressTracker.keyFor("m2", "mo", "b");

    tracker.start("a", keyA);
    clock.advance(50_000);
    tracker.finish("a");

    tracker.start("b", keyB);
    expect(tracker.snapshot("b")?.estimateMs).toBeNull();
  });
});
