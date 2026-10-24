// End-to-end: a real fake-comfyui stands in for a Backend, dispatched to
// by the real Dispatcher/runner against a real Postgres (issue #44). This
// exercises claim -> submit -> /ws+/api/jobs polling -> save -> succeeded,
// and that `/api/assets/:id` then serves the saved file.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { buildFrozenPrompt, systemClock } from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
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
import {
  cancelGeneration,
  cancelSubmission,
} from "../generations/cancellation.js";
import { GenerationEvents } from "../generations/events.js";
import { GenerationsRepository } from "../generations/repository.js";
import { MediaRunner } from "../media/media.js";
import { ModelBackendsRepository } from "../models/model-backends.js";
import { ModelRepository } from "../models/repository.js";
import { assetsRoute } from "../routes/assets.js";
import { createLocalStorage } from "../storage/storage.js";
import { createTestDatabase } from "../test/database.js";
import { Dispatcher } from "./dispatcher.js";
import { DispatchQueue } from "./queue.js";

/** Polls `generations` directly: the runner/dispatcher move its state outside the repository's own request/response cycle. */
async function waitForState(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  generationId: string,
  states: readonly string[],
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db
      .select({ state: generations.state })
      .from(generations)
      .where(eq(generations.id, generationId));
    if (row && states.includes(row.state)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${generationId} to reach ${states}`);
}

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

type FakeSession = {
  user: {
    id: string;
    role: "user" | "admin";
    status: "active";
    termsAcceptedVersion: null;
  };
};

function fakeSession(
  userId: string,
  role: "user" | "admin" = "user",
): FakeSession {
  return {
    user: { id: userId, role, status: "active", termsAcceptedVersion: null },
  };
}

/** A minimal Hono app standing in for the real one, just enough to exercise `assetsRoute`'s own logic. */
function appAs(
  assetsRepository: AssetsRepository,
  storage: ReturnType<typeof createLocalStorage>,
  session: FakeSession,
) {
  const app = new Hono<{
    Variables: { session: FakeSession; termsVersion: number | null };
  }>();
  app.use(async (c, next) => {
    c.set("session", session);
    c.set("termsVersion", null);
    return next();
  });
  app.route(
    "/api/assets",
    assetsRoute(assetsRepository, storage, []) as unknown as Hono<{
      Variables: { session: FakeSession };
    }>,
  );
  return app;
}

describe("Dispatcher end-to-end against a fake ComfyUI", () => {
  const testDb = createTestDatabase("dispatcher_e2e_test");

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
    logWriterOverride?: (real: ReturnType<typeof createLogEntryWriter>) => {
      log: ReturnType<typeof createLogEntryWriter>["log"];
    },
    pollIntervalMs = 15,
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
    const realLogWriter = createLogEntryWriter(db, systemClock, silentLogger());
    const logWriter = logWriterOverride
      ? logWriterOverride(realLogWriter)
      : realLogWriter;
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
      storage,
      generationEvents,
      media: new MediaRunner(2),
      siteName: "localhost",
      c2pa: null,
      getSiteTitle: async () => "Test Studio",
      pollIntervalMs,
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

  test("dispatches a queued Generation, runs it, and saves its Asset", async () => {
    const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      assetsRepository,
      storage,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "user@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "M1",
      );

      const backend = await backendRepository.create(
        { name: "Fake", baseUrl: fake.url, auth: "none" },
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
        steps: 3,
        stepIntervalMs: 5,
        outputs: {
          "2": {
            images: [
              {
                filename: "studio_00001_.png",
                subfolder: "studio",
                type: "output",
              },
              {
                filename: "preview_00001_.png",
                subfolder: "studio",
                type: "temp",
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

      await dispatcher.runUntilIdle();

      const savedAssets =
        await assetsRepository.listForGeneration(generationId);
      expect(savedAssets).toHaveLength(1);
      const [asset] = savedAssets;
      if (!asset) throw new Error("no Asset saved");
      expect(asset.comfyuiFilename).toBe("studio_00001_.png");
      expect(asset.kind).toBe("image");

      const bytes = await storage.read(asset.storageKey);
      expect(bytes.toString()).toBe("fake-comfyui:studio_00001_.png");

      // succeeded is no longer "active" (it's done, not under way).
      const activeSummaries = await generationsRepository.listActiveForUser(
        user.id,
      );
      expect(activeSummaries).toHaveLength(0);
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("fails the Generation when the Backend reports failure, freeing it for the next run", async () => {
    const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
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
      const user = await insertUser(db, "user2@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "M2",
      );

      const backend = await backendRepository.create(
        { name: "Fake2", baseUrl: fake.url, auth: "none" },
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
      fake.script(generationId, { steps: 2, stepIntervalMs: 5, fail: "boom" });

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
      expect(generation?.state).toBe("failed");
      expect(generation?.error).toBe(
        "the GPU server reported an error while running this",
      );

      // ComfyUI's own raw error goes into the Log entry, not the card
      // (issue #55's AC).
      const [logEntry] = await db
        .select()
        .from(logEntries)
        .where(eq(logEntries.generationId, generationId));
      expect(logEntry?.details).toBe("boom");
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("/api/assets/:id serves the owner's Asset with Range support, and 404s for anyone else", async () => {
    const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
    const { db, modelRepository, assetsRepository, storage } =
      await setup(tmpDir);
    try {
      const owner = await insertUser(db, "owner@example.com");
      const stranger = await insertUser(db, "stranger@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "M3",
      );

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      const generationsRepository = new GenerationsRepository(db);
      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: owner.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });

      const storageKey = `assets/${generationId}/2/studio_00001_.png`;
      await storage.write(storageKey, new TextEncoder().encode("hello world"));
      const asset = await assetsRepository.createIfAbsent({
        generationId,
        nodeId: "2",
        sortOrder: 0,
        kind: "image",
        comfyuiFilename: "studio_00001_.png",
        contentType: "image/png",
        size: 11,
        storageKey,
      });
      if (!asset) throw new Error("asset not created");

      const ownerApp = appAs(assetsRepository, storage, fakeSession(owner.id));
      const res = await ownerApp.request(`/api/assets/${asset.id}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello world");
      expect(res.headers.get("cache-control")).toBe(
        "private, max-age=31536000, immutable",
      );

      const rangeRes = await ownerApp.request(`/api/assets/${asset.id}`, {
        headers: { range: "bytes=6-10" },
      });
      expect(rangeRes.status).toBe(206);
      expect(await rangeRes.text()).toBe("world");

      const strangerApp = appAs(
        assetsRepository,
        storage,
        fakeSession(stranger.id),
      );
      const forbiddenRes = await strangerApp.request(`/api/assets/${asset.id}`);
      expect(forbiddenRes.status).toBe(404);
    } finally {
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("serves a video Asset's poster/thumb, 404s when there's none, and names its download (issue #45)", async () => {
    const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
    const { db, modelRepository, assetsRepository, storage } =
      await setup(tmpDir);
    try {
      const owner = await insertUser(db, "owner2@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "M4",
      );

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      const generationsRepository = new GenerationsRepository(db);
      await generationsRepository.create({
        id: generationId,
        modelId: model.id,
        revisionId,
        modeId: mode.id,
        modeName: mode.name,
        userId: owner.id,
        submissionId: randomUUID(),
        builtPrompt: prompt,
        nodeTypes,
        submittedAt: systemClock.now(),
      });

      const videoKey = `assets/${generationId}/2/studio_00001_.mp4`;
      const posterKey = `${videoKey}.poster.jpg`;
      await storage.write(
        videoKey,
        new TextEncoder().encode("fake video bytes"),
      );
      await storage.write(
        posterKey,
        new TextEncoder().encode("fake poster bytes"),
      );
      const video = await assetsRepository.createIfAbsent({
        generationId,
        nodeId: "2",
        sortOrder: 0,
        kind: "video",
        comfyuiFilename: "studio_00001_.mp4",
        contentType: "video/mp4",
        size: 17,
        storageKey: videoKey,
        posterKey,
        width: 64,
        height: 48,
        durationMs: 1400,
        fps: 5,
      });
      if (!video) throw new Error("video asset not created");

      const imageKey = `assets/${generationId}/3/studio_00001_.png`;
      await storage.write(
        imageKey,
        new TextEncoder().encode("fake image bytes"),
      );
      const image = await assetsRepository.createIfAbsent({
        generationId,
        nodeId: "3",
        sortOrder: 1,
        kind: "image",
        comfyuiFilename: "studio_00001_.png",
        contentType: "image/png",
        size: 17,
        storageKey: imageKey,
      });
      if (!image) throw new Error("image asset not created");

      const ownerApp = appAs(assetsRepository, storage, fakeSession(owner.id));

      const posterRes = await ownerApp.request(
        `/api/assets/${video.id}/poster`,
      );
      expect(posterRes.status).toBe(200);
      expect(await posterRes.text()).toBe("fake poster bytes");
      expect(posterRes.headers.get("content-type")).toBe("image/jpeg");

      // The image Asset has no poster (only video gets one).
      const noPosterRes = await ownerApp.request(
        `/api/assets/${image.id}/poster`,
      );
      expect(noPosterRes.status).toBe(404);

      const downloadRes = await ownerApp.request(
        `/api/assets/${video.id}?download=1`,
      );
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("content-disposition")).toBe(
        `attachment; filename="m4-mode-1-${generationId.slice(-8)}.mp4"`,
      );

      const imageDownloadRes = await ownerApp.request(
        `/api/assets/${image.id}?download=1`,
      );
      expect(imageDownloadRes.headers.get("content-disposition")).toBe(
        `attachment; filename="m4-mode-1-${generationId.slice(-8)}.png"`,
      );
    } finally {
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  test("a rejecting warning Log write doesn't crash the run (Dule's fix #1)", async () => {
    const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      assetsRepository,
      dispatcher,
    } = await setup(tmpDir, (real) => ({
      // Asset finishing warns because the fake Backend's output isn't
      // real, decodable media; simulate that warning's own Log insert
      // failing (DB down) and confirm it's swallowed, not an unhandled
      // rejection that would kill the process.
      log: (entry) =>
        entry.level === "warning"
          ? Promise.reject(new Error("db down"))
          : real.log(entry),
    }));

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "user5@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "M5",
      );

      const backend = await backendRepository.create(
        { name: "Fake5", baseUrl: fake.url, auth: "none" },
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
        steps: 2,
        stepIntervalMs: 5,
        outputs: {
          "2": {
            images: [
              {
                filename: "studio_00001_.png",
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

      await dispatcher.runUntilIdle();

      const savedAssets =
        await assetsRepository.listForGeneration(generationId);
      expect(savedAssets).toHaveLength(1);
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });

  describe("cancelling a Generation (issue #54)", () => {
    test("a queued Generation cancels at once, with no Backend involved", async () => {
      const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
      const {
        db,
        modelRepository,
        generationsRepository,
        generationEvents,
        queue,
      } = await setup(tmpDir);
      try {
        const user = await insertUser(db, "cancel-queued@example.com");
        const { model, mode, revisionId } = await createModelWithMode(
          modelRepository,
          "CancelQueued",
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

        await cancelGeneration(generationId, user.id, {
          queue,
          generationsRepository,
          generationEvents,
          wakeDispatcher: () => {},
        });

        const [row] = await db
          .select({ state: generations.state })
          .from(generations)
          .where(eq(generations.id, generationId));
        expect(row?.state).toBe("cancelled");

        const active = await generationsRepository.listActiveForUser(user.id);
        expect(active).toHaveLength(0);
      } finally {
        await Bun.$`rm -rf ${tmpDir}`.quiet();
      }
    });

    test("another user can't cancel someone else's Generation", async () => {
      const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
      const {
        db,
        modelRepository,
        generationsRepository,
        generationEvents,
        queue,
      } = await setup(tmpDir);
      try {
        const owner = await insertUser(db, "owner-cancel@example.com");
        const stranger = await insertUser(db, "stranger-cancel@example.com");
        const { model, mode, revisionId } = await createModelWithMode(
          modelRepository,
          "CancelOwnership",
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
          userId: owner.id,
          submissionId: randomUUID(),
          builtPrompt: prompt,
          nodeTypes,
          submittedAt: systemClock.now(),
        });

        await expect(
          cancelGeneration(generationId, stranger.id, {
            queue,
            generationsRepository,
            generationEvents,
            wakeDispatcher: () => {},
          }),
        ).rejects.toThrow();

        const [row] = await db
          .select({ state: generations.state })
          .from(generations)
          .where(eq(generations.id, generationId));
        expect(row?.state).toBe("queued");
      } finally {
        await Bun.$`rm -rf ${tmpDir}`.quiet();
      }
    });

    test("a running Generation shows cancelling, then confirms once the Backend's interrupt is reported", async () => {
      const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
      const {
        db,
        modelRepository,
        modelBackendsRepository,
        backendRepository,
        backendsService,
        generationsRepository,
        generationEvents,
        queue,
        dispatcher,
      } = await setup(tmpDir);

      const fake = startFakeComfyUi({ port: 0 });
      try {
        const user = await insertUser(db, "cancel-running@example.com");
        const { model, mode, revisionId } = await createModelWithMode(
          modelRepository,
          "CancelRunning",
        );

        const backend = await backendRepository.create(
          { name: "FakeCancel", baseUrl: fake.url, auth: "none" },
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
        // Hangs until /api/jobs/:id/cancel is called (issue #54's AC).
        fake.script(generationId, { hang: true });

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
        await waitForState(db, generationId, ["running"]);

        await cancelGeneration(generationId, user.id, {
          queue,
          generationsRepository,
          generationEvents,
          wakeDispatcher: () => {},
        });

        const [cancellingRow] = await db
          .select({ state: generations.state })
          .from(generations)
          .where(eq(generations.id, generationId));
        expect(cancellingRow?.state).toBe("cancelling");

        await runPromise;

        const [row] = await db
          .select({
            state: generations.state,
            pendingBackendCancel: generations.pendingBackendCancel,
          })
          .from(generations)
          .where(eq(generations.id, generationId));
        expect(row?.state).toBe("cancelled");
        expect(row?.pendingBackendCancel).toBe(false);

        // The Backend is free again for the next Generation.
        expect(
          await generationsRepository.hasUnfinishedForBackend(backend.id),
        ).toBe(false);
      } finally {
        fake.stop();
        await Bun.$`rm -rf ${tmpDir}`.quiet();
      }
    });

    test("cancels anyway when the Backend is unreachable, then re-cancels it before it gets new work", async () => {
      const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
      const {
        db,
        modelRepository,
        modelBackendsRepository,
        backendRepository,
        backendsService,
        generationsRepository,
        generationEvents,
        queue,
        dispatcher,
        // A wide poll gap: deterministic room to cancel and flip the
        // Backend unreachable between two of the runner's own polls,
        // rather than racing its loop at a 15ms cadence.
      } = await setup(tmpDir, undefined, 300);

      const fake = startFakeComfyUi({ port: 0 });
      try {
        const user = await insertUser(db, "cancel-unreachable@example.com");
        const { model, mode, revisionId } = await createModelWithMode(
          modelRepository,
          "CancelUnreachable",
        );

        const backend = await backendRepository.create(
          { name: "FakeUnreachable", baseUrl: fake.url, auth: "none" },
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
        fake.script(generationId, { hang: true });

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
        await waitForState(db, generationId, ["running"]);

        // Cancel while still reachable, so the Generation is surely
        // `cancelling` in the database before the Backend drops offline:
        // the runner's next poll then always finds it that way, however
        // an in-flight `/api/jobs/:id` call it raced against resolves.
        await cancelGeneration(generationId, user.id, {
          queue,
          generationsRepository,
          generationEvents,
          wakeDispatcher: () => {},
        });
        fake.setUnreachable(true);

        await runPromise;

        const [row] = await db
          .select({
            state: generations.state,
            pendingBackendCancel: generations.pendingBackendCancel,
          })
          .from(generations)
          .where(eq(generations.id, generationId));
        expect(row?.state).toBe("cancelled");
        expect(row?.pendingBackendCancel).toBe(true);

        // The Backend's own job is still "running" there (never told),
        // so another tick must not hand it new work yet.
        fake.setUnreachable(false);

        const secondGenerationId = randomUUID();
        const second = buildFrozenPrompt(WORKFLOW, ["2"], secondGenerationId);
        fake.script(secondGenerationId, {
          steps: 1,
          stepIntervalMs: 5,
          outputs: {
            "2": {
              images: [
                {
                  filename: "studio_00001_.png",
                  subfolder: "studio",
                  type: "output",
                },
              ],
            },
          },
        });
        await generationsRepository.create({
          id: secondGenerationId,
          modelId: model.id,
          revisionId,
          modeId: mode.id,
          modeName: mode.name,
          userId: user.id,
          submissionId: randomUUID(),
          builtPrompt: second.prompt,
          nodeTypes: second.nodeTypes,
          submittedAt: systemClock.now(),
        });

        // This tick's own retryPendingCancels re-sends the Backend's
        // interrupt before buildPlan ever considers it for new work.
        await dispatcher.runUntilIdle();
        const [resentRow] = await db
          .select({ pendingBackendCancel: generations.pendingBackendCancel })
          .from(generations)
          .where(eq(generations.id, generationId));
        expect(resentRow?.pendingBackendCancel).toBe(false);

        await dispatcher.runUntilIdle();
        // The second Generation may only get matched on this call (its
        // Backend's node types are learned asynchronously), so give its
        // own run a moment to finish past "running".
        await waitForState(db, secondGenerationId, ["succeeded", "failed"]);
        const [secondRow] = await db
          .select({ state: generations.state })
          .from(generations)
          .where(eq(generations.id, secondGenerationId));
        expect(secondRow?.state).toBe("succeeded");
      } finally {
        fake.stop();
        await Bun.$`rm -rf ${tmpDir}`.quiet();
      }
    });

    test("cancelling a Submission cancels every one of its own unfinished Generations", async () => {
      const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
      const {
        db,
        modelRepository,
        generationsRepository,
        generationEvents,
        queue,
      } = await setup(tmpDir);
      try {
        const user = await insertUser(db, "cancel-submission@example.com");
        const { model, mode, revisionId } = await createModelWithMode(
          modelRepository,
          "CancelSubmission",
        );
        const submissionId = randomUUID();
        const generationIds = [randomUUID(), randomUUID()];
        for (const generationId of generationIds) {
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
            submissionId,
            builtPrompt: prompt,
            nodeTypes,
            submittedAt: systemClock.now(),
          });
        }

        await cancelSubmission(submissionId, user.id, {
          queue,
          generationsRepository,
          generationEvents,
          wakeDispatcher: () => {},
        });

        for (const generationId of generationIds) {
          const [row] = await db
            .select({ state: generations.state })
            .from(generations)
            .where(eq(generations.id, generationId));
          expect(row?.state).toBe("cancelled");
        }
      } finally {
        await Bun.$`rm -rf ${tmpDir}`.quiet();
      }
    });
  });
});
