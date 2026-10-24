// End-to-end: a real fake-comfyui stands in for a Backend, dispatched to
// by the real Dispatcher/runner against a real Postgres (issue #44). This
// exercises claim -> submit -> /ws+/api/jobs polling -> save -> succeeded,
// and that `/api/assets/:id` then serves the saved file.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { buildFrozenPrompt, systemClock } from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
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
import { GenerationEvents } from "../generations/events.js";
import { GenerationsRepository } from "../generations/repository.js";
import { ModelBackendsRepository } from "../models/model-backends.js";
import { ModelRepository } from "../models/repository.js";
import { assetsRoute } from "../routes/assets.js";
import { createLocalStorage } from "../storage/storage.js";
import { createTestDatabase } from "../test/database.js";
import { UploadsRepository } from "../uploads/repository.js";
import { Dispatcher } from "./dispatcher.js";
import { DispatchQueue } from "./queue.js";

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

  async function setup(tmpDir: string) {
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
      storage,
      generationEvents,
      pollIntervalMs: 15,
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
      expect(generation?.error).toContain("boom");
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

  test("sends each Upload to /upload/image before the prompt, skipping a fresh same-size copy (issue #50)", async () => {
    const tmpDir = `/tmp/dispatcher-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      storage,
      dispatcher,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "uploader@example.com");
      const { model, mode, revisionId } = await createModelWithMode(
        modelRepository,
        "M4",
      );
      const backend = await backendRepository.create(
        { name: "Fake4", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      const uploadsRepository = new UploadsRepository(db);
      const now = systemClock.now();
      async function completeUpload(content: string) {
        const id = randomUUID();
        const bytes = new TextEncoder().encode(content);
        const storageKey = `uploads/${id}/original`;
        await storage.write(storageKey, bytes);
        await uploadsRepository.create({
          id,
          userId: user.id,
          originalName: "photo.png",
          declaredType: "image/png",
          size: bytes.length,
          modelId: null,
          inputId: null,
          storageKey,
          createdAt: now,
        });
        await uploadsRepository.markComplete(id, {
          kind: "image",
          extension: "png",
          contentType: "image/png",
          width: 1,
          height: 1,
          probe: {
            formatName: "png_pipe",
            codecName: "png",
            width: 1,
            height: 1,
            pixFmt: null,
          },
          thumbnailKey: `uploads/${id}/thumb.webp`,
          completedAt: now,
        });
        return { id, bytes };
      }
      const missing = await completeUpload("missing on the Backend");
      const fresh = await completeUpload("already there");
      const stale = await completeUpload("there, but old");
      fake.putInputFile("studio", `${fresh.id}.png`, fresh.bytes, now);
      fake.putInputFile(
        "studio",
        `${stale.id}.png`,
        stale.bytes,
        new Date(now.getTime() - 13 * 60 * 60 * 1000),
      );

      const generationId = randomUUID();
      const { prompt, nodeTypes } = buildFrozenPrompt(
        WORKFLOW,
        ["2"],
        generationId,
      );
      fake.script(generationId, { steps: 1, stepIntervalMs: 5 });
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
        uploadIds: [missing.id, fresh.id, stale.id],
        submittedAt: now,
      });

      await dispatcher.runUntilIdle();

      expect(fake.uploadCount).toBe(2);
      const sent = fake.inputFile("studio", `${missing.id}.png`);
      expect(new TextDecoder().decode(sent?.bytes)).toBe(
        "missing on the Backend",
      );
      expect(
        fake.inputFile("studio", `${stale.id}.png`)?.lastModified.getTime(),
      ).toBeGreaterThan(now.getTime() - 60_000);

      const summaries =
        await generationsRepository.listRecentSubmissionsForModel(
          model.id,
          user.id,
          8,
        );
      expect(summaries[0]?.generations[0]?.state).toBe("succeeded");
    } finally {
      fake.stop();
      await Bun.$`rm -rf ${tmpDir}`.quiet();
    }
  });
});
