// Unit tests for Dispatcher's matching rule (issue #44's AC): an eligible
// Backend is enabled, reachable, idle, attached to the Generation's Model
// and has its node types; the user with the fewest starting-or-running
// Generations is matched first, then oldest. Exercises `buildPlan`
// directly against fake deps, no database or network involved.

import { describe, expect, test } from "bun:test";
import type { BackendRecord } from "../backends/repository.js";
import { Dispatcher, type DispatcherDeps } from "./dispatcher.js";
import type { QueuedGeneration } from "./queue.js";

function fakeBackend(overrides: Partial<BackendRecord> = {}): BackendRecord {
  return {
    id: "backend-1",
    name: "Backend",
    baseUrl: "http://localhost",
    auth: "none",
    headerName: null,
    enabled: true,
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
    submittedAt: new Date("2026-01-01T00:00:00Z"),
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

function buildPlan(setup: Setup) {
  const reachability = setup.reachability ?? new Map();
  const nodeTypes = setup.nodeTypes ?? new Map();
  const deps: Partial<DispatcherDeps> = {
    queue: {
      listQueued: async () => setup.queued,
      activeCountsByUser: async () => setup.activeCounts ?? new Map(),
      busyBackendIds: async () => setup.busyBackendIds ?? new Set(),
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
  return (dispatcher as any).buildPlan() as Promise<
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
