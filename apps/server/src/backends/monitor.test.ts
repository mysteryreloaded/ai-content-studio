import { describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import type { LogEntryInput, LogEntryWriter } from "./log-entries.js";
import {
  BackendMonitor,
  type BackendTarget,
  CredentialsNeedReentry,
  type SystemStats,
} from "./monitor.js";

function fakeLogger() {
  const entries: LogEntryInput[] = [];
  const logger: LogEntryWriter = {
    async log(entry) {
      entries.push(entry);
    },
  };
  return { logger, entries };
}

function targetThatAlternates(
  stats: SystemStats,
  failing: { value: boolean },
): BackendTarget {
  return {
    id: "b1",
    name: "Test Backend",
    baseUrl: "http://localhost:8188",
    async fetchSystemStats() {
      if (failing.value) throw new Error("connection refused");
      return stats;
    },
  };
}

const STATS: SystemStats = {
  comfyuiVersion: "0.3.0",
  vramTotal: 24,
  vramFree: 20,
};

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BackendMonitor", () => {
  test("starts blank until polled", () => {
    const clock = new FakeClock();
    const { logger } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    const target = targetThatAlternates(STATS, { value: false });
    monitor.watch(target);
    expect(monitor.healthFor("b1").reachability).toBe("unknown");
  });

  test("becomes reachable after one success and holds health data", async () => {
    const clock = new FakeClock();
    const { logger } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    const target = targetThatAlternates(STATS, { value: false });
    monitor.watch(target);

    await monitor.poll(target);

    const health = monitor.healthFor("b1");
    expect(health.reachability).toBe("reachable");
    expect(health.comfyuiVersion).toBe("0.3.0");
    expect(health.vramFree).toBe(20);
  });

  test("stays reachable (not unreachable) after fewer than 3 failures", async () => {
    const clock = new FakeClock();
    const { logger } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    const failing = { value: false };
    const target = targetThatAlternates(STATS, failing);
    monitor.watch(target);

    await monitor.poll(target);
    failing.value = true;
    await monitor.poll(target);
    await monitor.poll(target);

    expect(monitor.healthFor("b1").reachability).toBe("reachable");
  });

  test("becomes unreachable after 3 consecutive failures and logs a warning", async () => {
    const clock = new FakeClock();
    const { logger, entries } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    const failing = { value: true };
    const target = targetThatAlternates(STATS, failing);
    monitor.watch(target);

    await monitor.poll(target);
    await monitor.poll(target);
    await monitor.poll(target);

    expect(monitor.healthFor("b1").reachability).toBe("unreachable");
    const warning = entries.find((e) => e.level === "warning");
    expect(warning?.message).toContain("became unreachable");
  });

  test("comes back after 1 success and logs info with downtime", async () => {
    const clock = new FakeClock();
    const { logger, entries } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    const failing = { value: true };
    const target = targetThatAlternates(STATS, failing);
    monitor.watch(target);

    await monitor.poll(target);
    await monitor.poll(target);
    await monitor.poll(target);
    expect(monitor.healthFor("b1").reachability).toBe("unreachable");

    clock.advance(60_000);
    failing.value = false;
    await monitor.poll(target);

    expect(monitor.healthFor("b1").reachability).toBe("reachable");
    const info = entries.find((e) => e.level === "info");
    expect(info?.message).toContain("reachable again");
    expect(info?.details).toContain("downtime_ms=60000");
  });

  test("polls automatically every 30s via the injected clock", async () => {
    const clock = new FakeClock();
    const { logger } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    let calls = 0;
    const target: BackendTarget = {
      id: "b2",
      name: "T",
      baseUrl: "http://x",
      async fetchSystemStats() {
        calls++;
        return STATS;
      },
    };
    monitor.watch(target);

    clock.advance(30_000);
    await flushMicrotasks();
    clock.advance(30_000);
    await flushMicrotasks();

    expect(calls).toBe(2);
  });

  test("a decrypt failure marks the Backend unreachable immediately and logs an error", async () => {
    const clock = new FakeClock();
    const { logger, entries } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    const target: BackendTarget = {
      id: "b3",
      name: "T",
      baseUrl: "http://x",
      async fetchSystemStats() {
        throw new CredentialsNeedReentry();
      },
    };
    monitor.watch(target);

    await monitor.poll(target);

    const health = monitor.healthFor("b3");
    expect(health.reachability).toBe("unreachable");
    expect(health.credentialsError).toBe(true);
    const error = entries.find((e) => e.level === "error");
    expect(error?.message).toContain("re-enter credentials");
  });

  test("logs the re-enter-credentials error once, not on every poll", async () => {
    const clock = new FakeClock();
    const { logger, entries } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    const target: BackendTarget = {
      id: "b3",
      name: "T",
      baseUrl: "http://x",
      async fetchSystemStats() {
        throw new CredentialsNeedReentry();
      },
    };
    monitor.watch(target);

    await monitor.poll(target);
    await monitor.poll(target);
    await monitor.poll(target);

    expect(entries.filter((e) => e.level === "error")).toHaveLength(1);
  });

  test("a stale poll from before an unwatch+watch (an edit) doesn't corrupt the new watch", async () => {
    const clock = new FakeClock();
    const { logger } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);

    let resolveOldFetch: (stats: SystemStats) => void = () => {};
    const oldTarget: BackendTarget = {
      id: "b5",
      name: "Old",
      baseUrl: "http://old",
      fetchSystemStats: () =>
        new Promise((resolve) => {
          resolveOldFetch = resolve;
        }),
    };
    monitor.watch(oldTarget);

    // Triggers the monitor's own scheduled poll, which starts the fetch
    // above and leaves it pending - standing in for a slow Backend whose
    // request is still in flight when it gets edited below.
    clock.advance(30_000);

    let newCalls = 0;
    const newTarget: BackendTarget = {
      id: "b5",
      name: "New",
      baseUrl: "http://new",
      async fetchSystemStats() {
        newCalls++;
        return STATS;
      },
    };
    monitor.unwatch("b5");
    monitor.watch(newTarget);

    // The stale request now resolves, after the edit replaced the watch.
    resolveOldFetch({ comfyuiVersion: "stale", vramTotal: 1, vramFree: 1 });
    await flushMicrotasks();
    await flushMicrotasks();

    // The stale result must not have overwritten the fresh watch's health.
    expect(monitor.healthFor("b5").comfyuiVersion).not.toBe("stale");
    expect(monitor.healthFor("b5").reachability).toBe("unknown");

    // Only the new watch's own loop should still be running.
    clock.advance(30_000);
    await flushMicrotasks();
    expect(newCalls).toBe(1);
  });

  test("unwatch stops further polling", async () => {
    const clock = new FakeClock();
    const { logger } = fakeLogger();
    const monitor = new BackendMonitor(clock, logger);
    let calls = 0;
    const target: BackendTarget = {
      id: "b4",
      name: "T",
      baseUrl: "http://x",
      async fetchSystemStats() {
        calls++;
        return STATS;
      },
    };
    monitor.watch(target);
    monitor.unwatch("b4");

    clock.advance(60_000);
    await flushMicrotasks();

    expect(calls).toBe(0);
    expect(monitor.healthFor("b4").reachability).toBe("unknown");
  });
});
