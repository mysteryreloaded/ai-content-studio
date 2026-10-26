// End-to-end coverage for issue #55 (reliable dispatch): lost tries are
// retried elsewhere and eventually give up, real failures end with a
// plain reason and ComfyUI's raw error in a Log entry, a drained
// Backend takes nothing new, the watchdog's two timeouts fire off
// pre-dated timestamps (no real waiting), and boot recovery reattaches
// to whatever a restart left `starting`/`running`/`saving`.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { buildFrozenPrompt, systemClock } from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import { createLogEntryWriter } from "../backends/log-entries.js";
import { BackendRepository } from "../backends/repository.js";
import { BackendsService } from "../backends/service.js";
import {
  assets,
  backends,
  generations,
  logEntries,
  modelRevisions,
  models,
  modes,
  users,
  workflows,
} from "../db/schema.js";
import { AssetsRepository } from "../generations/assets-repository.js";
import { GenerationEvents } from "../generations/events.js";
import { GenerationsRepository } from "../generations/repository.js";
import { MediaRunner } from "../media/media.js";
import { ModelBackendsRepository } from "../models/model-backends.js";
import { ModelRepository } from "../models/repository.js";
import { createLocalStorage } from "../storage/storage.js";
import { createTestDatabase } from "../test/database.js";
import { Dispatcher } from "./dispatcher.js";
import { DispatchQueue } from "./queue.js";
import { recoverInFlightGenerations } from "./recovery.js";

const SYSTEM: AuditActor = { type: "system" };
const SECRET_KEY = randomBytes(32).toString("base64");

const WORKFLOW: Workflow = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": {
    class_type: "SaveImage",
    inputs: { images: ["1", 0], filename_prefix: "studio" },
  },
};

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

describe("Reliable dispatch (issue #55)", () => {
  const testDb = createTestDatabase("reliability_e2e_test");

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(assets);
    await db.delete(generations);
    await db.delete(modes);
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
    await db.delete(backends);
    await db.delete(logEntries);
    await db.delete(users);
  });

  async function setup(
    tmpDir: string,
    overrides: { waitingForBackendTimeoutMs?: number } = {},
  ) {
    const { db, sql } = await testDb;
    const modelRepository = new ModelRepository(db, systemClock);
    const modelBackendsRepository = new ModelBackendsRepository(
      db,
      systemClock,
    );
    const backendRepository = new BackendRepository(
      db,
      systemClock,
      SECRET_KEY,
    );
    const logWriter = createLogEntryWriter(db, systemClock, silentLogger());
    const backendsService = new BackendsService(
      backendRepository,
      systemClock,
      logWriter,
      true,
    );
    const generationsRepository = new GenerationsRepository(db);
    const assetsRepository = new AssetsRepository(db);
    const generationEvents = new GenerationEvents();
    const queue = new DispatchQueue(db);
    const storage = createLocalStorage(tmpDir);

    const dispatcher = new Dispatcher({
      sql,
      clock: systemClock,
      logWriter,
      logger: silentLogger(),
      backendRepository,
      backendsService,
      modelBackendsRepository,
      queue,
      assetsRepository,
      generationsRepository,
      storage,
      generationEvents,
      pollIntervalMs: 15,
      savingBackoffBudgetMs: 200,
      savingBackoffBaseMs: 20,
      media: new MediaRunner(2),
      siteName: "localhost",
      c2pa: null,
      getSiteTitle: async () => "localhost",
      ...overrides,
    });

    return {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      assetsRepository,
      generationEvents,
      queue,
      storage,
      dispatcher,
    };
  }

  /** Lets a real BackendsService report this one Backend reachable without waiting for its 30s poll schedule. */
  function forceReachable(backendsService: BackendsService, backendId: string) {
    const original = backendsService.healthFor.bind(backendsService);
    backendsService.healthFor = (id: string) =>
      id === backendId
        ? {
            reachability: "reachable" as const,
            comfyuiVersion: null,
            vramTotal: null,
            vramFree: null,
            credentialsError: false,
          }
        : original(id);
  }

  async function insertUser(db: Awaited<typeof testDb>["db"], email: string) {
    const [row] = await db
      .insert(users)
      .values({ googleSub: randomUUID(), email, name: email })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return row;
  }

  async function createModelWithMode(
    modelRepository: ModelRepository,
    name: string,
  ) {
    const { record: model } = await modelRepository.createFromWorkflow(
      name,
      WORKFLOW,
      SYSTEM,
    );
    const { modes: savedModes } = await modelRepository.updateModes(
      model.id,
      [{ name: "Mode 1", description: "", outputNodeIds: ["2"] }],
      model.version,
      SYSTEM,
    );
    const mode = savedModes[0];
    if (!mode) throw new Error("mode not created");
    const detail = await modelRepository.get(model.id);
    if (!detail) throw new Error("model detail missing");
    return { model, mode, revisionId: detail.revisionId };
  }

  async function logDetailsFor(
    db: Awaited<typeof testDb>["db"],
    generationId: string,
  ): Promise<string[]> {
    const rows = await db
      .select()
      .from(logEntries)
      .where(eq(logEntries.generationId, generationId));
    return rows.map((row) => row.details ?? "");
  }

  test("a 503 while starting is a lost try, retried, then fails after 2 tries", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "unreachable@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "Unreachable",
      );
      const backend = await backendRepository.create(
        { name: "Flaky", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);
      // Warms the node-knowledge cache while the fake is still reachable,
      // so buildPlan can still match this Backend once it goes down.
      await backendsService.nodeTypesFor(backend);

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });

      // The Backend is down for every /prompt call, so each try is lost;
      // runUntilIdle drains both tries (the second's requeue wakes the
      // dispatcher right back up) before returning.
      fake.setUnreachable(true);

      await dispatcher.runUntilIdle();
      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      expect(generation?.state).toBe("failed");
      expect(generation?.error).toBe("the GPU server couldn't run this");
      expect(generation?.tries).toBe(2);

      const details = await logDetailsFor(db, generationId);
      expect(details).toHaveLength(2);
      expect(details.every((d) => d.includes("503"))).toBe(true);
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("a missing-node rejection is a lost try that refetches node knowledge, not an outright failure", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "missingnode@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "MissingNode",
      );
      const backend = await backendRepository.create(
        { name: "StaleKnowledge", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      const generationId = randomUUID();
      // `nodeTypes` (what buildPlan matches against) looks fine, but the
      // actual frozen prompt references a node type the fake's fixture
      // doesn't know — the stale-knowledge scenario the AC describes.
      const { prompt } = buildFrozenPrompt(WORKFLOW, ["2"], generationId);
      const staleePrompt: Workflow = {
        ...prompt,
        "99": { class_type: "TotallyMadeUpNode", inputs: {} },
      };

      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: staleePrompt,
        nodeTypes: ["SaveImage", "LoadImage"],
        submittedAt: systemClock.now(),
      });

      // Rejected for the missing node both tries (runUntilIdle drains
      // both — the requeue after try 1 wakes the dispatcher right back
      // up), exhausting after 2.
      await dispatcher.runUntilIdle();
      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      expect(generation?.state).toBe("failed");
      expect(generation?.error).toBe("the GPU server couldn't run this");
      expect(generation?.tries).toBe(2);

      const details = await logDetailsFor(db, generationId);
      expect(details.some((d) => d.includes("missing_node"))).toBe(true);
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("a restart that forgets the job (404) is a lost try", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "restart@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "Restart",
      );
      const backend = await backendRepository.create(
        { name: "Restarty", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      // Many steps, a slow cadence: the job is still running when the
      // fake "restarts" and forgets it mid-poll.
      fake.script(generationId, { steps: 1000, stepIntervalMs: 50 });

      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });

      const runPromise = dispatcher.runUntilIdle();
      // Waits for the real submit to actually land (not a fixed delay,
      // to avoid racing it under system load) before restarting the
      // fake out from under it.
      for (let i = 0; i < 200; i++) {
        const [row] = await db
          .select({ state: generations.state })
          .from(generations)
          .where(eq(generations.id, generationId));
        if (row?.state === "running") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      fake.restart();
      // The retry's own resubmission needs its own script too — a
      // restart forgets scripts along with jobs (issue #55's AC).
      fake.script(generationId, {
        steps: 1,
        stepIntervalMs: 5,
        outputs: {
          "2": {
            images: [
              { filename: "retried.png", subfolder: "studio", type: "output" },
            ],
          },
        },
      });
      await runPromise;

      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      // Lost once to the restart, then recovered on its retry — not an
      // outright failure, and not stuck at a single spent try either.
      expect(generation?.state).toBe("succeeded");
      expect(generation?.tries).toBe(2);

      const details = await logDetailsFor(db, generationId);
      expect(details.some((d) => d.includes("no longer knew this job"))).toBe(
        true,
      );
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("failed-without-retry categories: 413, any other rejection, and no outputs", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "nofretry@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "NoRetry",
      );
      const backend = await backendRepository.create(
        { name: "Strict", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      async function submitOne(
        reject: { status: number; error?: string } | undefined,
        scriptOutputs = true,
      ) {
        const generationId = randomUUID();
        const { prompt, nodeTypes } = buildFrozenPrompt(
          WORKFLOW,
          ["2"],
          generationId,
        );
        if (reject) {
          fake.script(generationId, { reject });
        } else if (!scriptOutputs) {
          fake.script(generationId, { steps: 1, stepIntervalMs: 5 }); // no outputs field
        }
        await generationsRepository.create({
          id: generationId,
          modelId: model.id,
          revisionId,
          modeId: mode.id,
          modeName: mode.name,
          userId: user.id,
          submissionId: randomUUID(),
          builtPrompt: prompt,
          nodeTypes,
          submittedAt: systemClock.now(),
        });
        await dispatcher.runUntilIdle();
        const summaries =
          await generationsRepository.listRecentSubmissionsForModel(
            model.id,
            user.id,
            8,
          );
        return summaries.find((s) => s.generations[0]?.id === generationId)
          ?.generations[0];
      }

      const tooLarge = await submitOne({ status: 413 });
      expect(tooLarge?.state).toBe("failed");
      expect(tooLarge?.error).toBe("the Backend rejected this as too large");
      expect(tooLarge?.tries).toBe(1);

      const otherRejection = await submitOne({
        status: 400,
        error: "bad prompt shape",
      });
      expect(otherRejection?.state).toBe("failed");
      expect(otherRejection?.error).toBe(
        "the GPU server rejected this Generation",
      );
      expect(otherRejection?.tries).toBe(1);

      const noOutputs = await submitOne(undefined, false);
      expect(noOutputs?.state).toBe("failed");
      expect(noOutputs?.error).toBe("the GPU server produced no usable output");
      expect(noOutputs?.tries).toBe(1);
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("a drained Backend takes no new Generations but isn't excluded from being seen as unusable", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "drain@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "Drained",
      );
      const backend = await backendRepository.create(
        { name: "Draining", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);
      await backendRepository.setDraining(
        backend.id,
        true,
        backend.version,
        SYSTEM,
      );

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });

      await dispatcher.runUntilIdle();
      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      expect(generation?.state).toBe("queued");
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("the watchdog fails a long-queued Generation with no usable Backend", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    // Tracked continuously from the first watchdog tick that finds no
    // usable Backend at all (issue #55's AC), not from `queuedAt`: a
    // zero threshold still needs a second tick to actually fail it.
    const { db, modelRepository, generationsRepository, dispatcher } =
      await setup(tmpDir, { waitingForBackendTimeoutMs: 0 });

    try {
      const user = await insertUser(db, "nobackend@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "NoBackend",
      );
      // No Backend at all attached to this Model.
      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });
      // First tick only records "no usable Backend since now"; the
      // second one finds the (zero) threshold already passed.
      await dispatcher.runWatchdogOnce();
      await dispatcher.runWatchdogOnce();

      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      expect(generation?.state).toBe("failed");
      expect(generation?.error).toBe("no server available for this Model");
    } finally {
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("the watchdog loses a try stuck in starting past its 10-minute cap", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      generationsRepository,
      dispatcher,
    } = await setup(tmpDir);

    try {
      const user = await insertUser(db, "stuckstarting@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "StuckStarting",
      );
      const backend = await backendRepository.create(
        { name: "NeverConfirmed", baseUrl: "http://127.0.0.1:1", auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });
      // Simulate a claim that never got past `starting`.
      await db
        .update(generations)
        .set({
          state: "starting",
          backendId: backend.id,
          tries: 1,
          startedAt: new Date(Date.now() - 11 * 60_000),
        })
        .where(eq(generations.id, generationId));

      await dispatcher.runWatchdogOnce();

      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      expect(generation?.state).toBe("queued");
      // Lost, but still only 1 try spent — `tries` only climbs again
      // once a later claim actually starts a next try.
      expect(generation?.tries).toBe(1);
    } finally {
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("boot recovery saves a Generation ComfyUI finished while the studio was down", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      assetsRepository,
      storage,
      queue,
      generationEvents,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "recoversaved@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "RecoverSaved",
      );
      const backend = await backendRepository.create(
        { name: "SurvivedRestart", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      fake.script(generationId, {
        steps: 1,
        stepIntervalMs: 5,
        outputs: {
          "2": {
            images: [
              {
                filename: "recovered.png",
                subfolder: "studio",
                type: "output",
              },
            ],
          },
        },
      });

      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });
      // Claim it onto the Backend and actually submit+finish the job on
      // the fake, as if a previous process had started it and then died
      // before it could poll the completion.
      await db
        .update(generations)
        .set({ state: "running", backendId: backend.id, tries: 1 })
        .where(eq(generations.id, generationId));
      const target = {
        baseUrl: backend.baseUrl,
        headers: {},
      };
      const { submitPrompt } = await import("../comfyui/client.js");
      await submitPrompt(target, generationId, prompt);
      await new Promise((resolve) => setTimeout(resolve, 30));

      await recoverInFlightGenerations({
        queue,
        assetsRepository,
        generationsRepository,
        storage,
        backendRepository,
        backendsService,
        backendsEnabled: backendsService.enabled,
        generationEvents,
        logWriter: createLogEntryWriter(db, systemClock, silentLogger()),
        clock: systemClock,
        // biome-ignore lint/suspicious/noExplicitAny: test-only access to the Dispatcher's private ProgressTracker
        progress: (dispatcher as any).progress,
        onFreed: () => {},
        media: new MediaRunner(2),
        siteName: "localhost",
        c2pa: null,
        getSiteTitle: async () => "localhost",
      });

      const savedAssets =
        await assetsRepository.listForGeneration(generationId);
      expect(savedAssets).toHaveLength(1);

      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      expect(generation?.state).toBe("succeeded");
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("boot recovery marks the try lost when the Backend no longer knows the job", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      assetsRepository,
      storage,
      queue,
      generationEvents,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "recoverlost@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "RecoverLost",
      );
      const backend = await backendRepository.create(
        { name: "ForgotTheJob", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });
      // Claimed by a previous process, but the fake never actually got
      // the submit (e.g. the process died first) — /api/jobs/:id 404s.
      await db
        .update(generations)
        .set({ state: "running", backendId: backend.id, tries: 1 })
        .where(eq(generations.id, generationId));

      await recoverInFlightGenerations({
        queue,
        assetsRepository,
        generationsRepository,
        storage,
        backendRepository,
        backendsService,
        backendsEnabled: backendsService.enabled,
        generationEvents,
        logWriter: createLogEntryWriter(db, systemClock, silentLogger()),
        clock: systemClock,
        // biome-ignore lint/suspicious/noExplicitAny: test-only access to the Dispatcher's private ProgressTracker
        progress: (dispatcher as any).progress,
        onFreed: () => {},
        media: new MediaRunner(2),
        siteName: "localhost",
        c2pa: null,
        getSiteTitle: async () => "localhost",
      });

      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      expect(generation?.state).toBe("queued");
      expect(generation?.tries).toBe(1);
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("boot recovery never contacts a Backend while BACKENDS_ENABLED=false (issue #77 CEO review: a restore drill)", async () => {
    const tmpDir = `/tmp/reliability-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      assetsRepository,
      storage,
      queue,
      generationEvents,
      dispatcher,
    } = await setup(tmpDir);

    try {
      const user = await insertUser(db, "recoverdrill@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "RecoverDrill",
      );
      // No fake ComfyUI is started at all: a baseUrl nobody listens on,
      // so if recovery tried to reach it, readJobWithGrace would hang
      // retrying for its full 2-minute grace window (real time, this
      // suite's systemClock) instead of returning almost at once.
      const backend = await backendRepository.create(
        { name: "Unreachable", baseUrl: "http://127.0.0.1:1", auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: user.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });
      await db
        .update(generations)
        .set({ state: "running", backendId: backend.id, tries: 1 })
        .where(eq(generations.id, generationId));

      await recoverInFlightGenerations({
        queue,
        assetsRepository,
        storage,
        backendRepository,
        backendsService,
        backendsEnabled: false,
        generationEvents,
        logWriter: createLogEntryWriter(db, systemClock, silentLogger()),
        clock: systemClock,
        // biome-ignore lint/suspicious/noExplicitAny: test-only access to the Dispatcher's private ProgressTracker
        progress: (dispatcher as any).progress,
        onFreed: () => {},
        media: new MediaRunner(2),
        siteName: "localhost",
        c2pa: null,
        getSiteTitle: async () => "localhost",
      });

      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      const generation = summaries[0]?.generations[0];
      expect(generation?.state).toBe("queued");
      expect(generation?.tries).toBe(1);
    } finally {
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });
});
