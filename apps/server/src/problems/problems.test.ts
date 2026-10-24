import { describe, expect, test } from "bun:test";
import { ProblemsRegistry } from "./problems.js";

describe("ProblemsRegistry", () => {
  test("set adds a Problem and list returns it", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const registry = new ProblemsRegistry(() => now);
    registry.set("db_unreachable", null, "down");
    expect(registry.list()).toEqual([
      { code: "db_unreachable", target: null, message: "down", since: now },
    ]);
  });

  test("setting the same code+target again keeps the original since", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const registry = new ProblemsRegistry(() => now);
    registry.set("disk_low", "/data", "low");
    now = new Date("2026-01-01T00:05:00.000Z");
    registry.set("disk_low", "/data", "still low");
    const [problem] = registry.list();
    expect(problem?.since).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(problem?.message).toBe("still low");
  });

  test("clear removes a Problem", () => {
    const registry = new ProblemsRegistry(() => new Date());
    registry.set("db_unreachable", null, "down");
    registry.clear("db_unreachable", null);
    expect(registry.list()).toEqual([]);
  });

  test("different targets of the same code are tracked separately", () => {
    const registry = new ProblemsRegistry(() => new Date());
    registry.set("backend_unreachable", "b1", "one");
    registry.set("backend_unreachable", "b2", "two");
    registry.clear("backend_unreachable", "b1");
    expect(registry.list().map((p) => p.target)).toEqual(["b2"]);
  });

  test("clearStaleTargets drops targets no longer in keepTargets", () => {
    const registry = new ProblemsRegistry(() => new Date());
    registry.set("backend_unreachable", "b1", "one");
    registry.set("backend_unreachable", "b2", "two");
    registry.clearStaleTargets("backend_unreachable", new Set(["b2"]));
    expect(registry.list().map((p) => p.target)).toEqual(["b2"]);
  });

  test("list is sorted oldest-since first", () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const registry = new ProblemsRegistry(() => now);
    registry.set("disk_low", "/data", "low");
    now = new Date("2026-01-01T00:05:00.000Z");
    registry.set("db_unreachable", null, "down");
    expect(registry.list().map((p) => p.code)).toEqual([
      "disk_low",
      "db_unreachable",
    ]);
  });
});
