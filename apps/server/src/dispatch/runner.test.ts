// Unit coverage for issue #55's reliability fixes, at the runner level:
// a FakeClock (ADR 0006) drives every timeout instantly against a real
// fake-comfyui, with fake queue/assets/storage deps standing in for
// Postgres — no database involved, unlike the full-stack e2e tests next
// to this file.

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock, buildFrozenPrompt } from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
import type { BackendRecord } from "../backends/repository.js";
import { GenerationEvents } from "../generations/events.js";
import type { GenerationEvent } from "../generations/events.js";
import { MediaRunner } from "../media/media.js";
import { createLocalStorage } from "../storage/storage.js";
import { ProgressTracker } from "./progress.js";
import type { RunDetail } from "./queue.js";
import { recoverInFlightGenerations } from "./recovery.js";
import {
  type RunnerDeps,
  pollUntilDone,
  readJobWithGrace,
  runClaimedGeneration,
  saveWithBackoff,
} from "./runner.js";

const WORKFLOW: Workflow = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": {
    class_type: "SaveImage",
    inputs: { images: ["1", 0], filename_prefix: "studio" },
  },
};

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

function fakeDetail(
  generationId: string,
  prompt: Workflow,
  overrides: Partial<RunDetail> = {},
): RunDetail {
  return {
    id: generationId,
    revisionId: randomUUID(),
    modelId: randomUUID(),
    modelSlug: "model",
    modelName: "Model",
    modeId: randomUUID(),
    modeName: "Mode",
    userId: randomUUID(),
    submissionId: randomUUID(),
    submittedAt: new Date("2026-01-01T00:00:00Z"),
    builtPrompt: prompt,
    outputNodes: [
      { nodeId: "2", classType: "SaveImage", title: null, kind: null },
    ],
    maxRunTimeMinutes: 30,
    uploads: [],
    ...overrides,
  };
}

interface QueueCalls {
  markSaving: { id: string; tries: number }[];
  markSucceeded: { id: string; tries: number }[];
  markFailed: { id: string; tries: number; error: string }[];
  loseTry: { id: string; tries: number; exhaustedMessage: string }[];
}

function fakeQueue(loseTryOutcome: "retried" | "exhausted" = "retried") {
  const calls: QueueCalls = {
    markSaving: [],
    markSucceeded: [],
    markFailed: [],
    loseTry: [],
  };
  const queue = {
    markRunning: async () => true,
    markSaving: async (id: string, tries: number) => {
      calls.markSaving.push({ id, tries });
      return true;
    },
    markSucceeded: async (id: string, tries: number) => {
      calls.markSucceeded.push({ id, tries });
      return true;
    },
    markFailed: async (id: string, tries: number, error: string) => {
      calls.markFailed.push({ id, tries, error });
      return true;
    },
    loseTry: async (id: string, tries: number, exhaustedMessage: string) => {
      calls.loseTry.push({ id, tries, exhaustedMessage });
      return loseTryOutcome;
    },
    listUnfinished: async () => [],
    detailForRun: async () => null,
    // issue #54: never cancelling in this suite's own scenarios.
    currentState: async () => "running" as const,
  };
  return { queue, calls };
}

function fakeAssetsRepository() {
  return {
    createIfAbsent: async () => null,
    listForGeneration: async () => [],
  };
}

/** Moves the FakeClock forward and yields to the real event loop, so an in-flight real `fetch` to the fake ComfyUI (or a resolved `delay()`) gets to run before the next advance. */
async function tick(clock: FakeClock, ms: number): Promise<void> {
  clock.advance(ms);
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Ticks the clock forward in small steps, interleaved with a real wait
 * for the in-flight async work each step unblocks, until `promise`
 * settles — instead of the test having to predict its exact delay
 * schedule (e.g. `saveWithBackoff`'s doubling backoff).
 */
async function driveUntilSettled<T>(
  clock: FakeClock,
  promise: Promise<T>,
  stepMs: number,
  maxSteps = 200,
): Promise<T> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let i = 0; i < maxSteps && !settled; i++) {
    await tick(clock, stepMs);
  }
  return promise;
}

function baseDeps(
  clock: FakeClock,
  queue: ReturnType<typeof fakeQueue>["queue"],
  overrides: Partial<RunnerDeps> = {},
): RunnerDeps {
  const generationEvents = new GenerationEvents();
  return {
    // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for DispatchQueue
    queue: queue as any,
    // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for AssetsRepository
    assetsRepository: fakeAssetsRepository() as any,
    storage: createLocalStorage(`/tmp/runner-test-${randomUUID()}`),
    backendRepository: { decryptedCredentials: async () => null },
    backendsService: {
      healthFor: () => ({
        reachability: "reachable" as const,
        comfyuiVersion: null,
        vramTotal: null,
        vramFree: null,
        credentialsError: false,
      }),
      unreachableSince: () => null,
      invalidateNodeKnowledge: () => {},
    },
    generationEvents,
    // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for LogEntryWriter
    logWriter: { log: async () => {} } as any,
    clock,
    progress: new ProgressTracker(clock),
    onFreed: () => {},
    pollIntervalMs: 10_000,
    media: new MediaRunner(2),
    siteName: "localhost",
    c2pa: null,
    getSiteTitle: async () => "localhost",
    ...overrides,
  };
}

describe("pollUntilDone's poll-failure tolerance (issue #55)", () => {
  let fake: ReturnType<typeof startFakeComfyUi> | null = null;

  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  test("a poll blip under 2 minutes survives: the run still completes once the Backend answers again", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const backend = fakeBackend({ baseUrl: fake.url });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    const detail = fakeDetail(generationId, prompt);
    fake.script(generationId, {
      steps: 2,
      stepIntervalMs: 10,
      outputs: {
        "2": { images: [{ filename: "a.png", subfolder: "", type: "output" }] },
      },
    });
    await fetch(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        prompt_id: generationId,
        client_id: generationId,
      }),
    });

    const clock = new FakeClock();
    const { queue, calls } = fakeQueue();
    const deps = baseDeps(clock, queue);
    const target = { baseUrl: fake.url, headers: {} };

    fake.setUnreachable(true);
    const run = pollUntilDone(backend, detail, 1, target, deps);

    // Several blips, well under the 2-minute grace period.
    await tick(clock, 10_000);
    await tick(clock, 10_000);
    await tick(clock, 10_000);
    expect(calls.loseTry).toHaveLength(0);
    expect(calls.markFailed).toHaveLength(0);

    fake.setUnreachable(false);
    await tick(clock, 10_000);
    await tick(clock, 10_000);
    await run;

    expect(calls.loseTry).toHaveLength(0);
    expect(calls.markFailed).toHaveLength(0);
    expect(calls.markSaving).toHaveLength(1);
    expect(calls.markSucceeded).toHaveLength(1);
  });

  test("continuous poll failure past 2 minutes loses the try instead of hanging forever", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const backend = fakeBackend({ baseUrl: fake.url });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    const detail = fakeDetail(generationId, prompt);
    await fetch(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        prompt_id: generationId,
        client_id: generationId,
      }),
    });

    const clock = new FakeClock();
    const { queue, calls } = fakeQueue();
    const deps = baseDeps(clock, queue);
    const target = { baseUrl: fake.url, headers: {} };

    const events: GenerationEvent[] = [];
    deps.generationEvents.subscribe(detail.userId, (event) =>
      events.push(event),
    );

    fake.setUnreachable(true);
    const run = pollUntilDone(backend, detail, 1, target, deps);

    // 15 * 10s = 150s of continuous failure, past the 2-minute grace period.
    for (let i = 0; i < 15; i++) await tick(clock, 10_000);
    await run;

    expect(calls.markFailed).toHaveLength(0);
    expect(calls.loseTry).toHaveLength(1);
    expect(calls.loseTry[0]?.tries).toBe(1);

    // The "Retrying…" card: a lost-but-retried try publishes `queued` again.
    const change = events.find((event) => event.type === "change");
    expect(change?.type === "change" && change.generation.state).toBe("queued");
  });
});

describe("pollUntilDone's max-run-time timeout (issue #55)", () => {
  let fake: ReturnType<typeof startFakeComfyUi> | null = null;

  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  test("a run past its max run time is interrupted on the Backend and fails as timed out", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const backend = fakeBackend({ baseUrl: fake.url });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    // A run time far too short to let this job finish on its own.
    const detail = fakeDetail(generationId, prompt, { maxRunTimeMinutes: 1 });
    fake.script(generationId, { steps: 1, stepIntervalMs: 999_999 });
    await fetch(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        prompt_id: generationId,
        client_id: generationId,
      }),
    });

    const clock = new FakeClock();
    const { queue, calls } = fakeQueue();
    const deps = baseDeps(clock, queue);
    const target = { baseUrl: fake.url, headers: {} };

    const run = pollUntilDone(backend, detail, 1, target, deps);
    for (let i = 0; i < 8; i++) await tick(clock, 10_000);
    await run;

    expect(calls.markFailed).toHaveLength(1);
    expect(calls.markFailed[0]?.error).toBe("timed out");

    // `/interrupt` really reached the Backend (not just a client-side give-up).
    const res = await fetch(`${fake.url}/api/jobs/${generationId}`);
    const job = (await res.json()) as { status: string; error: string | null };
    expect(job.status).toBe("failed");
    expect(job.error).toBe("interrupted");
  });

  test("hitting max run time after the cancel's own interrupt was sent still interrupts and marks it pendingBackendCancel, instead of assuming it worked (issue #54)", async () => {
    // A bare HTTP stand-in instead of fake-comfyui: `/api/jobs/:id/cancel`
    // reports success but the Backend never actually stops the run — its
    // own `/api/jobs/:id` keeps reporting `running` right through the
    // max-run-time deadline, the way a wedged ComfyUI process would.
    let interruptCalls = 0;
    let cancelCalls = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/interrupt") {
          interruptCalls += 1;
          return new Response(null, { status: 200 });
        }
        if (url.pathname.endsWith("/cancel")) {
          cancelCalls += 1;
          return new Response(null, { status: 204 });
        }
        if (url.pathname.startsWith("/api/jobs/")) {
          return Response.json({ id: generationId, status: "running" });
        }
        return new Response(null, { status: 404 });
      },
    });
    const backend = fakeBackend({ baseUrl: `http://localhost:${server.port}` });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    const detail = fakeDetail(generationId, prompt, { maxRunTimeMinutes: 1 });

    const clock = new FakeClock();
    const markCancelledCalls: {
      id: string;
      tries: number;
      pendingBackendCancel: boolean;
    }[] = [];
    const queue = {
      // `cancelling` from the very first check: the loop sends the
      // interrupt on its first iteration, then keeps polling a Backend
      // that never actually stops.
      currentState: async () => "cancelling" as const,
      markCancelled: async (
        id: string,
        tries: number,
        opts: { pendingBackendCancel: boolean },
      ) => {
        markCancelledCalls.push({ id, tries, ...opts });
        return true;
      },
    };
    const deps = baseDeps(
      clock,
      // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for DispatchQueue
      queue as any,
    );
    const target = { baseUrl: `http://localhost:${server.port}`, headers: {} };

    try {
      const run = pollUntilDone(backend, detail, 1, target, deps);
      for (let i = 0; i < 8; i++) await tick(clock, 10_000);
      await run;

      expect(cancelCalls).toBeGreaterThan(0);
      expect(interruptCalls).toBe(1);
      expect(markCancelledCalls).toEqual([
        { id: generationId, tries: 1, pendingBackendCancel: true },
      ]);
    } finally {
      server.stop(true);
    }
  });
});

describe("pollUntilDone tolerates a dropped /ws (issue #55)", () => {
  let fake: ReturnType<typeof startFakeComfyUi> | null = null;

  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  test("a dropped /ws doesn't stall the run: polling `/api/jobs` alone still finishes it", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const backend = fakeBackend({ baseUrl: fake.url });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    const detail = fakeDetail(generationId, prompt);
    fake.script(generationId, {
      steps: 3,
      stepIntervalMs: 10,
      outputs: {
        "2": { images: [{ filename: "a.png", subfolder: "", type: "output" }] },
      },
    });
    await fetch(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        prompt_id: generationId,
        client_id: generationId,
      }),
    });

    const clock = new FakeClock();
    const { queue, calls } = fakeQueue();
    const deps = baseDeps(clock, queue, { pollIntervalMs: 20 });
    const target = { baseUrl: fake.url, headers: {} };

    const run = pollUntilDone(backend, detail, 1, target, deps);
    await tick(clock, 20);
    fake.dropWs();
    for (let i = 0; i < 15; i++) await tick(clock, 20);
    await run;

    expect(calls.loseTry).toHaveLength(0);
    expect(calls.markSucceeded).toHaveLength(1);
  });
});

describe("saveWithBackoff (issue #55)", () => {
  let fake: ReturnType<typeof startFakeComfyUi> | null = null;

  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  test("retries a failing save with backoff, then succeeds once the write starts landing", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    const detail = fakeDetail(generationId, prompt);
    fake.script(generationId, {
      steps: 1,
      outputs: {
        "2": { images: [{ filename: "a.png", subfolder: "", type: "output" }] },
      },
    });
    await fetch(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        prompt_id: generationId,
        client_id: generationId,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const jobRes = await fetch(`${fake.url}/api/jobs/${generationId}`);
    const job = (await jobRes.json()) as Parameters<typeof saveWithBackoff>[2];

    const clock = new FakeClock();
    const { queue } = fakeQueue();
    let attempts = 0;
    const deps = baseDeps(clock, queue, {
      savingBackoffBaseMs: 1_000,
      savingBackoffBudgetMs: 60_000,
      assetsRepository: {
        createIfAbsent: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("disk full");
          return null;
        },
        // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for AssetsRepository
      } as any,
    });
    const target = { baseUrl: fake.url, headers: {} };

    const resultPromise = saveWithBackoff(target, detail, job, deps);
    const result = await driveUntilSettled(clock, resultPromise, 1_000);

    expect(attempts).toBe(3);
    expect(result.ok).toBe(true);
  });
});

describe("boot recovery resumes polling instead of losing the try at once (issue #55)", () => {
  let fake: ReturnType<typeof startFakeComfyUi> | null = null;

  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  test("readJobWithGrace tolerates a brief unreachable spell at boot, then reads the job fine", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    fake.script(generationId, { steps: 2, stepIntervalMs: 60_000 });
    await fetch(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        prompt_id: generationId,
        client_id: generationId,
      }),
    });

    const clock = new FakeClock();
    const target = { baseUrl: fake.url, headers: {} };
    fake.setUnreachable(true);

    const resultPromise = readJobWithGrace(target, generationId, {
      clock,
      pollIntervalMs: 10_000,
    });
    await tick(clock, 10_000);
    await tick(clock, 10_000);
    fake.setUnreachable(false);
    await tick(clock, 10_000);

    const job = await resultPromise;
    expect(job?.status).toBe("running");
  });

  test("recoverInFlightGenerations reattaches a still-running job through a boot-time blip instead of losing it", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const backend = fakeBackend({ baseUrl: fake.url });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    const detail = fakeDetail(generationId, prompt);
    fake.script(generationId, {
      steps: 2,
      stepIntervalMs: 50,
      outputs: {
        "2": { images: [{ filename: "a.png", subfolder: "", type: "output" }] },
      },
    });
    await fetch(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        prompt_id: generationId,
        client_id: generationId,
      }),
    });

    const clock = new FakeClock();
    const { queue, calls } = fakeQueue();
    const deps = baseDeps(clock, queue, { pollIntervalMs: 10_000 });
    const recoveryDeps = {
      ...deps,
      queue: {
        ...queue,
        listUnfinished: async () => [
          {
            id: generationId,
            state: "running" as const,
            backendId: backend.id,
            tries: 1,
          },
        ],
        detailForRun: async () => detail,
        // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for DispatchQueue
      } as any,
      backendRepository: {
        get: async () => backend,
        decryptedCredentials: async () => null,
        // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for BackendRepository
      } as any,
    };

    fake.setUnreachable(true);
    const recovery = recoverInFlightGenerations(recoveryDeps);
    await tick(clock, 10_000);
    await tick(clock, 10_000);
    fake.setUnreachable(false);
    await tick(clock, 10_000);
    await recovery;

    // Resumed polling instead of losing the try at once: no lost-try report.
    expect(calls.loseTry).toHaveLength(0);

    // The fire-and-forget `pollUntilDone` it handed off to then finishes
    // the run normally once the job completes.
    for (let i = 0; i < 20 && calls.markSucceeded.length === 0; i++) {
      await tick(clock, 10_000);
    }
    expect(calls.markSucceeded).toHaveLength(1);
  });
});

describe("reconciling a cancel that raced a terminal write (issue #54)", () => {
  let fake: ReturnType<typeof startFakeComfyUi> | null = null;

  afterEach(() => {
    fake?.stop();
    fake = null;
  });

  test("markRunning losing to a cancel still sends the Backend's interrupt and finalizes, instead of sticking cancelling", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const backend = fakeBackend({ baseUrl: fake.url });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    const detail = fakeDetail(generationId, prompt);
    // Hangs until /api/jobs/:id/cancel is called: the submit itself
    // must succeed (and really reach the Backend) for this race to be
    // the one at hand.
    fake.script(generationId, { hang: true });

    const clock = new FakeClock();
    const markCancelledCalls: {
      id: string;
      tries: number;
      pendingBackendCancel: boolean;
    }[] = [];
    const queue = {
      markRunning: async () => false,
      currentState: async () => "cancelling" as const,
      markCancelled: async (
        id: string,
        tries: number,
        opts: { pendingBackendCancel: boolean },
      ) => {
        markCancelledCalls.push({ id, tries, ...opts });
        return true;
      },
    };
    const deps = baseDeps(
      clock,
      // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for DispatchQueue
      queue as any,
    );
    const events: GenerationEvent[] = [];
    deps.generationEvents.subscribe(detail.userId, (event) =>
      events.push(event),
    );

    await runClaimedGeneration(backend, detail, 1, deps);

    expect(markCancelledCalls).toEqual([
      { id: generationId, tries: 1, pendingBackendCancel: false },
    ]);
    const change = [...events]
      .reverse()
      .find((event) => event.type === "change");
    expect(change?.type === "change" && change.generation.state).toBe(
      "cancelled",
    );
  });

  test("markSaving losing to a cancel that raced the job finishing still confirms it, instead of sticking cancelling", async () => {
    fake = startFakeComfyUi({ port: 0 });
    const backend = fakeBackend({ baseUrl: fake.url });
    const generationId = randomUUID();
    const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
    const detail = fakeDetail(generationId, prompt);
    fake.script(generationId, {
      steps: 1,
      stepIntervalMs: 10,
      outputs: {
        "2": { images: [{ filename: "a.png", subfolder: "", type: "output" }] },
      },
    });
    await fetch(`${fake.url}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        prompt_id: generationId,
        client_id: generationId,
      }),
    });

    const clock = new FakeClock();
    const markCancelledCalls: {
      id: string;
      tries: number;
      pendingBackendCancel: boolean;
    }[] = [];
    const queue = {
      // The row raced to `cancelling` between the job completing and
      // this write, so it no-ops the same way a watchdog sweep would.
      markSaving: async () => false,
      currentState: async () => "cancelling" as const,
      markCancelled: async (
        id: string,
        tries: number,
        opts: { pendingBackendCancel: boolean },
      ) => {
        markCancelledCalls.push({ id, tries, ...opts });
        return true;
      },
    };
    const deps = baseDeps(
      clock,
      // biome-ignore lint/suspicious/noExplicitAny: a hand-rolled fake standing in for DispatchQueue
      queue as any,
    );
    const events: GenerationEvent[] = [];
    deps.generationEvents.subscribe(detail.userId, (event) =>
      events.push(event),
    );
    const target = { baseUrl: fake.url, headers: {} };

    const run = pollUntilDone(backend, detail, 1, target, deps);
    await driveUntilSettled(clock, run, 1_000);

    expect(markCancelledCalls).toEqual([
      { id: generationId, tries: 1, pendingBackendCancel: false },
    ]);
    const change = [...events]
      .reverse()
      .find((event) => event.type === "change");
    expect(change?.type === "change" && change.generation.state).toBe(
      "cancelled",
    );
  });
});
