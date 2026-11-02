// This file registers its own happy-dom instance (bun test --isolate
// gives it a clean process).
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { GenerationState } from "../notifications/types.js";
import type { SessionUser } from "../useSession.js";
import type { ActiveGenerationSummary } from "./generationsStream.js";

await GlobalRegistrator.register();

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { isUnderway, useActiveGenerations, underwayCount, underwayCountFor } =
  await import("./generationsStream.js");
const { drainMacrotasks, renderWithProviders } = await import(
  "../test/render.js"
);

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await drainMacrotasks();
  await GlobalRegistrator.unregister();
});

const USER: SessionUser = {
  id: "u1",
  email: "user@example.com",
  name: "A User",
  picture: null,
  role: "user",
  status: "active",
  termsAcceptedVersion: null,
};

const PENDING_USER: SessionUser = { ...USER, status: "pending" };

// The surface of the real EventSource that `useEventStream` touches
// (addEventListener, onerror, close), with a record of every open.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (event: { data: string }) => void) {
    const list = this.listeners[type] ?? [];
    list.push(cb);
    this.listeners[type] = list;
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb({ data: JSON.stringify(data) });
    }
  }
}

beforeEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource =
    FakeEventSource;
  FakeEventSource.instances = [];
});

function mockAuth(user: SessionUser | null, meCalls?: { n: number }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) {
      if (meCalls) meCalls.n += 1;
      if (!user) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json(user);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

/** A Generation summary in the stream's JSON shape (Dates as ISO strings). */
function generation(
  id: string,
  state: GenerationState,
  model: "ltx" | "wan",
  extra: Partial<ActiveGenerationSummary> = {},
): ActiveGenerationSummary {
  return {
    id,
    state,
    modelId: `model-${model}`,
    modelSlug: model,
    modelName: model === "ltx" ? "LTX 2.5" : "Wan 2.2",
    modeId: "mode-1",
    modeName: "Standard",
    submissionId: `sub-${id}`,
    deletedAt: null,
    removedAt: null,
    ...extra,
  };
}

/** Renders the one store's counts, for the assertions below. */
function Probe() {
  const active = useActiveGenerations();
  return (
    <div>
      <span data-testid="count">{underwayCount(active.generations)}</span>
      <span data-testid="ltx">
        {underwayCountFor(active.generations, "ltx")}
      </span>
      <span data-testid="wan">
        {underwayCountFor(active.generations, "wan")}
      </span>
    </div>
  );
}

async function stream(): Promise<FakeEventSource> {
  await waitFor(() => {
    expect(
      FakeEventSource.instances.some(
        (s) => s.url === "/api/generations/stream",
      ),
    ).toBe(true);
  });
  const source = FakeEventSource.instances.find(
    (s) => s.url === "/api/generations/stream",
  ) as FakeEventSource;
  return source;
}

describe("underwayCount / underwayCountFor (issue #188)", () => {
  test("counts UNDERWAY_STATES and not removed; underwayCountFor per Model", () => {
    const generations: ActiveGenerationSummary[] = [
      // two Models: LTX has one under way, one finished and one
      // tombstoned; Wan has one under way and one failed.
      generation("g1", "running", "ltx"),
      generation("g2", "cancelling", "ltx"),
      generation("g3", "succeeded", "ltx"),
      generation("g4", "queued", "ltx", { deletedAt: "2026-11-02T00:00:00Z" }),
      generation("g5", "queued", "wan"),
      generation("g6", "failed", "wan"),
    ];

    // biome-ignore lint/style/noNonNullAssertion: fixed-length array built in this test
    expect(isUnderway(generations[0]!)).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: fixed-length array built in this test
    expect(isUnderway(generations[2]!)).toBe(false); // terminal
    // biome-ignore lint/style/noNonNullAssertion: fixed-length array built in this test
    expect(isUnderway(generations[3]!)).toBe(false); // tombstoned

    expect(underwayCount(generations)).toBe(3); // g1, g2, g5
    expect(underwayCountFor(generations, "ltx")).toBe(2);
    expect(underwayCountFor(generations, "wan")).toBe(1);
    expect(underwayCountFor(generations, "unknown")).toBe(0);
  });

  test("an Admin-removed Generation (removedAt) still counts", () => {
    const generations: ActiveGenerationSummary[] = [
      generation("g1", "running", "wan", {
        removedAt: "2026-11-02T00:00:00Z",
      }),
    ];
    expect(underwayCount(generations)).toBe(1);
  });
});

describe("useActiveGenerations (issue #188)", () => {
  test("a snapshot then a change update the counts; removed and ended Generations stop counting", async () => {
    mockAuth(USER);
    renderWithProviders(<Probe />);
    const source = await stream();

    // Each `setQueryData` schedules one re-render outside React's own
    // bookkeeping, so the assertions below wait for it to land.
    const expectCounts = (count: string, ltx: string, wan: string) =>
      waitFor(() => {
        expect(screen.getByTestId("count").textContent).toBe(count);
        expect(screen.getByTestId("ltx").textContent).toBe(ltx);
        expect(screen.getByTestId("wan").textContent).toBe(wan);
      });

    // Snapshot: two under way across two Models, plus one finished and
    // one tombstoned that must not count.
    source.emit("snapshot", {
      generations: [
        generation("g1", "running", "ltx"),
        generation("g2", "queued", "wan"),
        generation("g3", "succeeded", "ltx"),
        generation("g4", "running", "wan", {
          deletedAt: "2026-11-02T00:00:00Z",
        }),
      ],
    });
    await expectCounts("2", "1", "1");

    // Change: g2 reaches a terminal state → only g1 remains.
    source.emit("change", generation("g2", "succeeded", "wan"));
    await expectCounts("1", "1", "0");

    // Change: a new Generation for ltx starts → it is prepended and
    // counted.
    source.emit("change", generation("g5", "queued", "ltx"));
    await expectCounts("2", "2", "0");

    // Change: g1 is tombstoned (its state is still under way, but the
    // owner deleted it) → it stops counting.
    source.emit("change", {
      ...generation("g1", "cancelling", "ltx"),
      deletedAt: "2026-11-02T00:00:02Z",
    });
    await expectCounts("1", "1", "0");

    // Change: the last one ends → back to 0.
    source.emit("change", generation("g5", "cancelled", "ltx"));
    await expectCounts("0", "0", "0");
  });

  test("pending users and signed-out visitors open no generations stream (issue #188's AC)", async () => {
    const meCalls = { n: 0 };
    mockAuth(PENDING_USER, meCalls);
    renderWithProviders(<Probe />);
    // Wait for the session to resolve as a signed-in (pending) user,
    // then give the gated effect a couple of turns to (not) open.
    await waitFor(() => expect(meCalls.n).toBeGreaterThan(0));
    await drainMacrotasks();
    expect(
      FakeEventSource.instances.some(
        (s) => s.url === "/api/generations/stream",
      ),
    ).toBe(false);

    cleanup();

    mockAuth(null, meCalls);
    renderWithProviders(<Probe />);
    await waitFor(() => expect(meCalls.n).toBeGreaterThan(1));
    await drainMacrotasks();
    expect(
      FakeEventSource.instances.some(
        (s) => s.url === "/api/generations/stream",
      ),
    ).toBe(false);
  });
});
