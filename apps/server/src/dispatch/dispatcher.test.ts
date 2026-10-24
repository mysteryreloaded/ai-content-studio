// Unit tests for Dispatcher's matching rule (issue #44's AC): an eligible
// Backend is enabled, reachable, idle, attached to the Generation's Model
// and has its node types; the user with the fewest starting-or-running
// Generations is matched first, then oldest. Exercises `buildPlan`
// directly against fake deps, no database or network involved.

import { describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import type { BackendRecord } from "../backends/repository.js";
import { Dispatcher, type DispatcherDeps } from "./dispatcher.js";
import type { QueuedGeneration, RunDetail } from "./queue.js";

function fakeBackend(overrides: Partial<BackendRecord> = {}): BackendRecord {
  return {
    id: "backend-1",
    name: "Backend",
    baseUrl: "http://localhost",
    auth: "none",
    headerName: null,
    enabled: true,
    draining: false,
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeGeneration(
  overrides: Partial<QueuedGeneration> = {},
): QueuedGeneration {
  return {
    id: "gen-1",
    modelId: "model-1",
    modeId: "mode-1",
    userId: "user-1",
    nodeTypes: ["KSampler"],
    tries: 0,
    submittedAt: new Date("2026-01-01T00:00:00Z"),
    isTest: false,
    pinnedBackendId: null,
    ...overrides,
  };
}

interface Setup {
  queued: QueuedGeneration[];
  activeCounts?: Map<string, number>;
  busyBackendIds?: Set<string>;
  backends: BackendRecord[];
  /** Backend id -> reachability; defaults to "reachable" for every listed Backend. */
  reachability?: Map<string, "reachable" | "unreachable" | "unknown">;
  /** Backend id -> node types it knows; defaults to the Generation's own types (so it always matches) unless set. */
  nodeTypes?: Map<string, Set<string> | null>;
  /** Model id -> Backends attached to it; defaults to every Backend attached to every Model. */
  attachedByModel?: Map<string, BackendRecord[]>;
}

function buildPlan(setup: Setup, testsOnly = false) {
  const reachability = setup.reachability ?? new Map();
  const nodeTypes = setup.nodeTypes ?? new Map();
  const deps: Partial<DispatcherDeps> = {
    queue: {
      listQueued: async () => setup.queued,
      activeCountsByUser: async () => setup.activeCounts ?? new Map(),
      busyBackendIds: async () => setup.busyBackendIds ?? new Set(),
      pendingCancelBackendIds: async () => new Set<string>(),
    } as unknown as DispatcherDeps["queue"],
    backendRepository: {
      list: async () => setup.backends,
    } as unknown as DispatcherDeps["backendRepository"],
    backendsService: {
      healthFor: (id: string) => ({
        reachability: reachability.get(id) ?? "reachable",
        comfyuiVersion: null,
        vramTotal: null,
        vramFree: null,
        credentialsError: false,
      }),
      nodeTypesFor: async (backend: BackendRecord) =>
        nodeTypes.has(backend.id)
          ? nodeTypes.get(backend.id)
          : new Set(setup.queued.flatMap((g) => g.nodeTypes)),
    } as unknown as DispatcherDeps["backendsService"],
    modelBackendsRepository: {
      listForModel: async (modelId: string) =>
        setup.attachedByModel?.get(modelId) ?? setup.backends,
    } as unknown as DispatcherDeps["modelBackendsRepository"],
  };
  const dispatcher = new Dispatcher(deps as DispatcherDeps);
  // biome-ignore lint/suspicious/noExplicitAny: reaching into the private matching algorithm under test
  return (dispatcher as any).buildPlan(testsOnly) as Promise<
    { generation: QueuedGeneration; backend: BackendRecord }[]
  >;
}

describe("Dispatcher.buildPlan", () => {
  test("matches a queued Generation to an eligible free Backend", async () => {
    const generation = fakeGeneration();
    const backend = fakeBackend();
    const plan = await buildPlan({ queued: [generation], backends: [backend] });
    expect(plan).toEqual([{ generation, backend }]);
  });

  test("skips a disabled Backend even when otherwise eligible", async () => {
    const generation = fakeGeneration();
    const backend = fakeBackend({ enabled: false });
    const plan = await buildPlan({ queued: [generation], backends: [backend] });
    expect(plan).toEqual([]);
  });

  test("skips an unreachable Backend", async () => {
    const generation = fakeGeneration();
    const backend = fakeBackend();
    const plan = await buildPlan({
      queued: [generation],
      backends: [backend],
      reachability: new Map([[backend.id, "unreachable"]]),
    });
    expect(plan).toEqual([]);
  });

  test("skips a busy Backend", async () => {
    const generation = fakeGeneration();
    const backend = fakeBackend();
    const plan = await buildPlan({
      queued: [generation],
      backends: [backend],
      busyBackendIds: new Set([backend.id]),
    });
    expect(plan).toEqual([]);
  });

  test("skips a Backend that doesn't know all the Generation's node types", async () => {
    const generation = fakeGeneration({ nodeTypes: ["KSampler", "VAEDecode"] });
    const backend = fakeBackend();
    const plan = await buildPlan({
      queued: [generation],
      backends: [backend],
      nodeTypes: new Map([[backend.id, new Set(["KSampler"])]]),
    });
    expect(plan).toEqual([]);
  });

  test("skips a Backend whose node types are unknown (not yet learned)", async () => {
    const generation = fakeGeneration();
    const backend = fakeBackend();
    const plan = await buildPlan({
      queued: [generation],
      backends: [backend],
      nodeTypes: new Map([[backend.id, null]]),
    });
    expect(plan).toEqual([]);
  });

  test("skips a Backend not attached to the Generation's Model", async () => {
    const generation = fakeGeneration({ modelId: "model-1" });
    const backend = fakeBackend();
    const otherModelBackend = fakeBackend({ id: "backend-2" });
    const plan = await buildPlan({
      queued: [generation],
      backends: [backend, otherModelBackend],
      attachedByModel: new Map([["model-1", [otherModelBackend]]]),
    });
    expect(plan).toEqual([{ generation, backend: otherModelBackend }]);
  });

  test("orders by fewest starting-or-running Generations for the user first", async () => {
    const busyUser = fakeGeneration({
      id: "gen-busy-user",
      userId: "busy-user",
      submittedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const idleUser = fakeGeneration({
      id: "gen-idle-user",
      userId: "idle-user",
      submittedAt: new Date("2026-01-02T00:00:00Z"),
    });
    const onlyBackend = fakeBackend();

    const plan = await buildPlan({
      queued: [busyUser, idleUser],
      activeCounts: new Map([
        ["busy-user", 3],
        ["idle-user", 0],
      ]),
      backends: [onlyBackend],
    });

    // Only one free Backend: the idle user's Generation wins the match,
    // even though it was submitted later.
    expect(plan).toEqual([{ generation: idleUser, backend: onlyBackend }]);
  });

  test("falls back to submission order (oldest first) when active counts tie", async () => {
    const older = fakeGeneration({
      id: "gen-older",
      userId: "user-a",
      submittedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = fakeGeneration({
      id: "gen-newer",
      userId: "user-b",
      submittedAt: new Date("2026-01-02T00:00:00Z"),
    });
    const onlyBackend = fakeBackend();

    const plan = await buildPlan({
      // listQueued is documented to already return oldest-first; buildPlan's
      // sort is a stable sort on active count alone, so a tie preserves
      // this incoming order.
      queued: [older, newer],
      backends: [onlyBackend],
    });

    expect(plan).toEqual([{ generation: older, backend: onlyBackend }]);
  });

  test("matches as many queued Generations as there are eligible free Backends", async () => {
    const genA = fakeGeneration({ id: "gen-a", userId: "user-a" });
    const genB = fakeGeneration({ id: "gen-b", userId: "user-b" });
    const backendA = fakeBackend({ id: "backend-a" });
    const backendB = fakeBackend({ id: "backend-b" });

    const plan = await buildPlan({
      queued: [genA, genB],
      backends: [backendA, backendB],
    });

    expect(plan).toHaveLength(2);
    expect(plan.map((p) => p.generation.id).sort()).toEqual(["gen-a", "gen-b"]);
  });

  test("returns no plan when nothing is queued", async () => {
    const plan = await buildPlan({ queued: [], backends: [fakeBackend()] });
    expect(plan).toEqual([]);
  });

  test("returns no plan when no Backend is free", async () => {
    const plan = await buildPlan({ queued: [fakeGeneration()], backends: [] });
    expect(plan).toEqual([]);
  });
});

describe("Dispatcher resilience to a DB outage", () => {
  test("tick() settles without rejecting when both the Log write and the query that failed also fail, and a later wake() still ticks", async () => {
    let listQueuedCalls = 0;
    let logCalls = 0;
    let loggerErrorCalls = 0;

    const deps: Partial<DispatcherDeps> = {
      clock: {
        now: () => new Date("2026-01-01T00:00:00Z"),
        setTimeout: (cb: () => void) => {
          cb();
          return 0 as unknown as ReturnType<
            DispatcherDeps["clock"]["setTimeout"]
          >;
        },
        clearTimeout: () => {},
      } as unknown as DispatcherDeps["clock"],
      queue: {
        listQueued: async () => {
          listQueuedCalls += 1;
          throw new Error("connection terminated");
        },
        activeCountsByUser: async () => new Map(),
        busyBackendIds: async () => new Set(),
        pendingBackendCancels: async () => [],
        pendingCancelBackendIds: async () => new Set<string>(),
      } as unknown as DispatcherDeps["queue"],
      backendRepository: {
        list: async () => [],
      } as unknown as DispatcherDeps["backendRepository"],
      backendsService: {
        healthFor: () => ({
          reachability: "reachable" as const,
          comfyuiVersion: null,
          vramTotal: null,
          vramFree: null,
          credentialsError: false,
        }),
        nodeTypesFor: async () => new Set<string>(),
      } as unknown as DispatcherDeps["backendsService"],
      modelBackendsRepository: {
        listForModel: async () => [],
      } as unknown as DispatcherDeps["modelBackendsRepository"],
      logWriter: {
        log: async () => {
          logCalls += 1;
          throw new Error("database is down");
        },
      } as unknown as DispatcherDeps["logWriter"],
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {
          loggerErrorCalls += 1;
        },
      },
    };
    const dispatcher = new Dispatcher(deps as DispatcherDeps);

    // biome-ignore lint/suspicious/noExplicitAny: reaching into the private tick() under test
    await expect((dispatcher as any).tick()).resolves.toBeUndefined();
    expect(listQueuedCalls).toBe(1);
    expect(logCalls).toBe(1);
    expect(loggerErrorCalls).toBe(1);

    // The DB is still down, but a later wake() must still attempt a tick
    // instead of being stuck forever behind the first failure's `ticking`
    // flag never resetting.
    dispatcher.wake();

    // Let the second tick's own (also failing) claim and Log write settle
    // — now one more microtask away than before, behind retryPendingCancels'
    // own query — so neither leaves an unhandled rejection behind.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listQueuedCalls).toBe(2);
    expect(logCalls).toBe(2);
    expect(loggerErrorCalls).toBe(2);
  });
});

describe("Dispatcher Pause gating (issue #59)", () => {
  test("claimBatch claims nothing while Paused, even with a free Backend", async () => {
    const generation = fakeGeneration();
    const backend = fakeBackend();

    const deps: Partial<DispatcherDeps> = {
      clock: new FakeClock(),
      isPaused: async () => true,
      queue: {
        listQueued: async () => [generation],
        activeCountsByUser: async () => new Map(),
        busyBackendIds: async () => new Set(),
        pendingCancelBackendIds: async () => new Set(),
      } as unknown as DispatcherDeps["queue"],
      backendRepository: {
        list: async () => [backend],
      } as unknown as DispatcherDeps["backendRepository"],
      backendsService: {
        healthFor: () => ({
          reachability: "reachable" as const,
          comfyuiVersion: null,
          vramTotal: null,
          vramFree: null,
          credentialsError: false,
        }),
        nodeTypesFor: async () => new Set(generation.nodeTypes),
      } as unknown as DispatcherDeps["backendsService"],
      modelBackendsRepository: {
        listForModel: async () => [backend],
      } as unknown as DispatcherDeps["modelBackendsRepository"],
    };
    const dispatcher = new Dispatcher(deps as DispatcherDeps);

    // biome-ignore lint/suspicious/noExplicitAny: reaching into the private claimBatch() under test
    const claimed = await (dispatcher as any).claimBatch();
    expect(claimed).toEqual([]);
  });

  test("buildPlan(testsOnly) keeps a Test but drops a real Submission (issue #74's AC)", async () => {
    const real = fakeGeneration({ id: "gen-real", isTest: false });
    const testGen = fakeGeneration({
      id: "gen-test",
      isTest: true,
      pinnedBackendId: "backend-1",
    });
    const backend = fakeBackend();

    const everyGenPlan = await buildPlan(
      { queued: [real, testGen], backends: [backend] },
      false,
    );
    expect(everyGenPlan).toHaveLength(1);

    const pausedPlan = await buildPlan(
      { queued: [real, testGen], backends: [backend] },
      true,
    );
    expect(pausedPlan).toEqual([{ generation: testGen, backend }]);
  });

  test("buildPlan only matches a Test to its own pinned Backend, not Any", async () => {
    const pinned = fakeBackend({ id: "backend-pinned" });
    const other = fakeBackend({ id: "backend-other" });
    const testGen = fakeGeneration({ pinnedBackendId: pinned.id });

    const plan = await buildPlan({
      queued: [testGen],
      backends: [other, pinned],
      attachedByModel: new Map([[testGen.modelId, [other, pinned]]]),
    });
    expect(plan).toEqual([{ generation: testGen, backend: pinned }]);
  });

  test("the 15-minute no-usable-Backend wait freezes while Paused and resumes counting after", async () => {
    const clock = new FakeClock();
    const generation = fakeGeneration();
    let paused = false;
    let markFailedCalls = 0;
    const detail = {
      id: generation.id,
      userId: generation.userId,
      modelId: generation.modelId,
    } as unknown as RunDetail;

    const deps: Partial<DispatcherDeps> = {
      clock,
      isPaused: async () => paused,
      waitingForBackendTimeoutMs: 10_000,
      queue: {
        listQueued: async () => [generation],
        detailForRun: async () => detail,
        markFailed: async () => {
          markFailedCalls += 1;
          return true;
        },
      } as unknown as DispatcherDeps["queue"],
      generationsRepository: {
        finalizeIfPendingDeletion: async () => null,
      },
      modelBackendsRepository: {
        // No Backend attached at all: never usable, so only the Paused
        // clock matters for whether the 15-minute wait advances.
        listForModel: async () => [],
      } as unknown as DispatcherDeps["modelBackendsRepository"],
      generationEvents: {
        publish: () => {},
      } as unknown as DispatcherDeps["generationEvents"],
      logWriter: {
        log: async () => {},
      } as unknown as DispatcherDeps["logWriter"],
    };
    const dispatcher = new Dispatcher(deps as DispatcherDeps);
    // biome-ignore lint/suspicious/noExplicitAny: reaching into the private watchdog sweep under test
    const sweep = () => (dispatcher as any).failLongQueuedWithoutBackend();

    await sweep(); // records "no usable Backend since" now (0ms elapsed)
    clock.advance(6_000);
    await sweep(); // 6s unpaused elapsed; below the 10s threshold
    expect(markFailedCalls).toBe(0);

    // The sweep that first observes Pause becoming true registers the
    // transition at that instant (0ms elapsed so far this Pause), the
    // same as a real ~30s-interval watchdog tick landing right as a
    // Pause starts.
    paused = true;
    await sweep();
    clock.advance(20_000); // 20s of wall time, entirely Paused
    await sweep();
    expect(markFailedCalls).toBe(0); // still 6s unpaused elapsed: frozen

    clock.advance(20_000); // more wall time, still Paused: still frozen
    await sweep();
    expect(markFailedCalls).toBe(0);

    paused = false;
    await sweep(); // registers the Resume at this instant
    clock.advance(3_000);
    await sweep(); // 6s + 3s = 9s unpaused elapsed; still below 10s
    expect(markFailedCalls).toBe(0);

    clock.advance(2_000);
    await sweep(); // 11s unpaused elapsed: past the 10s threshold
    expect(markFailedCalls).toBe(1);
  });
});

describe("Dispatcher.retryPendingCancels (issue #54)", () => {
  function setup(reachability: "reachable" | "unreachable" | "unknown"): {
    dispatcher: Dispatcher;
    backendGetCalls: number;
    clearCalls: string[];
  } {
    let backendGetCalls = 0;
    const clearCalls: string[] = [];
    const deps: Partial<DispatcherDeps> = {
      queue: {
        pendingBackendCancels: async () => [
          { generationId: "gen-1", backendId: "backend-1" },
        ],
        clearPendingBackendCancel: async (generationId: string) => {
          clearCalls.push(generationId);
        },
      } as unknown as DispatcherDeps["queue"],
      backendRepository: {
        get: async () => {
          backendGetCalls += 1;
          return fakeBackend();
        },
      } as unknown as DispatcherDeps["backendRepository"],
      backendsService: {
        healthFor: () => ({
          reachability,
          comfyuiVersion: null,
          vramTotal: null,
          vramFree: null,
          credentialsError: false,
        }),
      } as unknown as DispatcherDeps["backendsService"],
    };
    return {
      dispatcher: new Dispatcher(deps as DispatcherDeps),
      backendGetCalls,
      clearCalls,
    };
  }

  test("skips a Backend still 'unknown' right after boot, instead of waiting out cancelJob's own timeout for it", async () => {
    const { dispatcher, clearCalls } = setup("unknown");
    // biome-ignore lint/suspicious/noExplicitAny: reaching into the private method under test
    await (dispatcher as any).retryPendingCancels();
    expect(clearCalls).toEqual([]);
  });

  test("skips an unreachable Backend the same way", async () => {
    const { dispatcher, clearCalls } = setup("unreachable");
    // biome-ignore lint/suspicious/noExplicitAny: reaching into the private method under test
    await (dispatcher as any).retryPendingCancels();
    expect(clearCalls).toEqual([]);
  });
});
