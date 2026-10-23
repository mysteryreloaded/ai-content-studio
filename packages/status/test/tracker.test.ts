import { describe, expect, test } from "bun:test";
import { fakeClock } from "../src/clock";
import { ProblemsTracker } from "../src/tracker";

describe("ProblemsTracker", () => {
  test("an immediate code becomes a Problem as soon as it is reported", () => {
    const tracker = new ProblemsTracker(fakeClock());
    tracker.report("db_unreachable", "primary", true, "connection refused");

    const [problem] = tracker.list();
    expect(problem?.code).toBe("db_unreachable");
    expect(problem?.target).toBe("primary");
    expect(problem?.message).toBe("connection refused");
  });

  test("clears the moment the caller reports the condition false", () => {
    const tracker = new ProblemsTracker(fakeClock());
    tracker.report("disk_low", "/data", true, "12 GB free");
    expect(tracker.list()).toHaveLength(1);

    tracker.report("disk_low", "/data", false, "");
    expect(tracker.list()).toHaveLength(0);
  });

  test("clear() removes a Problem by code and target", () => {
    const tracker = new ProblemsTracker(fakeClock());
    tracker.report("job_failed", "gen-1", true, "lost try");
    tracker.clear("job_failed", "gen-1");
    expect(tracker.list()).toHaveLength(0);
  });

  test("a delayed code stays hidden until it has held for its delay", () => {
    const clock = fakeClock();
    const tracker = new ProblemsTracker(clock);
    tracker.report("model_without_backend", "mode-1", true, "no reachable Backend");

    expect(tracker.list()).toHaveLength(0);

    clock.advance(5 * 60_000 - 1);
    expect(tracker.list()).toHaveLength(0);

    clock.advance(1);
    expect(tracker.list()).toHaveLength(1);
  });

  test("re-reporting true while already pending keeps the original since", () => {
    const clock = fakeClock();
    const tracker = new ProblemsTracker(clock);
    tracker.report("backend_unreachable", "be-1", true, "no response");
    clock.advance(2 * 60_000);
    tracker.report("backend_unreachable", "be-1", true, "still no response");
    clock.advance(3 * 60_000);

    const [problem] = tracker.list();
    expect(problem?.since.getTime()).toBe(clock.now().getTime() - 5 * 60_000);
    expect(problem?.message).toBe("still no response");
  });

  test("reporting false while still pending (before the delay elapses) drops it", () => {
    const clock = fakeClock();
    const tracker = new ProblemsTracker(clock);
    tracker.report("generating_paused", "studio", true, "Paused");
    clock.advance(60_000);
    tracker.report("generating_paused", "studio", false, "");
    clock.advance(4 * 60 * 60_000);
    expect(tracker.list()).toHaveLength(0);
  });

  test("suppresses db_unreachable and model_without_backend while Paused, not the rest", () => {
    const tracker = new ProblemsTracker(fakeClock());
    tracker.report("db_unreachable", "primary", true, "down");
    tracker.report("disk_low", "/data", true, "low");

    const codes = tracker.list({ paused: true }).map((p) => p.code);
    expect(codes).toEqual(["disk_low"]);
    expect(tracker.list({ paused: false }).map((p) => p.code).sort()).toEqual([
      "db_unreachable",
      "disk_low",
    ]);
  });

  test("isHealthy reflects the same filtering as list()", () => {
    const tracker = new ProblemsTracker(fakeClock());
    tracker.report("db_unreachable", "primary", true, "down");
    expect(tracker.isHealthy()).toBe(false);
    expect(tracker.isHealthy({ paused: true })).toBe(true);
  });

  test("tracks several targets of the same code independently", () => {
    const tracker = new ProblemsTracker(fakeClock());
    tracker.report("backend_failing", "be-1", true, "3 failed tries");
    tracker.report("backend_failing", "be-2", true, "3 failed tries");
    expect(tracker.list()).toHaveLength(2);

    tracker.clear("backend_failing", "be-1");
    const remaining = tracker.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.target).toBe("be-2");
  });

  test("list() is sorted oldest-since first", () => {
    const clock = fakeClock();
    const tracker = new ProblemsTracker(clock);
    tracker.report("job_failed", "gen-2", true, "failed");
    clock.advance(1000);
    tracker.report("job_failed", "gen-1", true, "failed");

    const targets = tracker.list().map((p) => p.target);
    expect(targets).toEqual(["gen-2", "gen-1"]);
  });
});
