import { describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import type postgres from "postgres";
import type { BackendRepository } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import { ProblemsMonitor } from "./monitor.js";
import { ProblemsRegistry } from "./problems.js";

function fakeSql(reachable: boolean): postgres.Sql {
  const fn = (() =>
    reachable
      ? Promise.resolve([])
      : Promise.reject(new Error("down"))) as unknown as postgres.Sql;
  return fn;
}

function fakeBackendRepository(
  backends: Array<{ id: string; name: string }>,
): BackendRepository {
  return { list: async () => backends } as unknown as BackendRepository;
}

function fakeBackendsService(since: Map<string, Date>): BackendsService {
  return {
    unreachableSince: (id: string) => since.get(id) ?? null,
  } as unknown as BackendsService;
}

describe("ProblemsMonitor", () => {
  test("sets db_unreachable when the database is down, clears it when up", async () => {
    const clock = new FakeClock();
    const registry = new ProblemsRegistry(() => clock.now());
    const downMonitor = new ProblemsMonitor(
      registry,
      clock,
      fakeSql(false),
      fakeBackendRepository([]),
      fakeBackendsService(new Map()),
      "/nonexistent",
      10,
    );
    await downMonitor.runChecks();
    expect(registry.list().map((p) => p.code)).toContain("db_unreachable");

    const upMonitor = new ProblemsMonitor(
      registry,
      clock,
      fakeSql(true),
      fakeBackendRepository([]),
      fakeBackendsService(new Map()),
      "/nonexistent",
      10,
    );
    await upMonitor.runChecks();
    expect(registry.list().map((p) => p.code)).not.toContain("db_unreachable");
  });

  test("raises backend_unreachable only after the 5-minute grace period", async () => {
    const clock = new FakeClock();
    const registry = new ProblemsRegistry(() => clock.now());
    const since = new Map([["b1", clock.now()]]);
    const monitor = new ProblemsMonitor(
      registry,
      clock,
      fakeSql(true),
      fakeBackendRepository([{ id: "b1", name: "GPU 1" }]),
      fakeBackendsService(since),
      "/nonexistent",
      10,
    );

    await monitor.runChecks();
    expect(registry.list().map((p) => p.code)).not.toContain(
      "backend_unreachable",
    );

    clock.advance(5 * 60 * 1000);
    await monitor.runChecks();
    expect(registry.list().map((p) => p.code)).toContain("backend_unreachable");
  });

  test("clears backend_unreachable once the Backend is reachable again", async () => {
    const clock = new FakeClock();
    const registry = new ProblemsRegistry(() => clock.now());
    const since = new Map([["b1", clock.now()]]);
    const monitor = new ProblemsMonitor(
      registry,
      clock,
      fakeSql(true),
      fakeBackendRepository([{ id: "b1", name: "GPU 1" }]),
      fakeBackendsService(since),
      "/nonexistent",
      10,
    );
    clock.advance(5 * 60 * 1000);
    await monitor.runChecks();
    expect(registry.list().map((p) => p.code)).toContain("backend_unreachable");

    since.delete("b1");
    await monitor.runChecks();
    expect(registry.list().map((p) => p.code)).not.toContain(
      "backend_unreachable",
    );
  });

  test("raises disk_low under twice MIN_FREE_DISK_GB, using the real disk", async () => {
    const clock = new FakeClock();
    const registry = new ProblemsRegistry(() => clock.now());
    // An unreasonably high floor guarantees this disk reads as low.
    const monitor = new ProblemsMonitor(
      registry,
      clock,
      fakeSql(true),
      fakeBackendRepository([]),
      fakeBackendsService(new Map()),
      ".",
      1_000_000,
    );
    await monitor.runChecks();
    expect(registry.list().map((p) => p.code)).toContain("disk_low");
  });
});
