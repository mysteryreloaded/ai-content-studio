// End-to-end: Testing a Generation from the Model editor (issue #74),
// against a real Postgres and a fake ComfyUI standing in for a Backend.
// Exercises submitTestGeneration -> Dispatcher -> fake ComfyUI -> saved
// Asset, and the AC's own list: unnumbered revision, no Audit entry,
// never current, excluded from Caps, runs on a disabled Model and
// during a Pause, a pinned Backend is honoured, and the last 5 Tests
// list.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { systemClock } from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import type { AuditActor } from "../audit/audit.js";
import { createLogEntryWriter } from "../backends/log-entries.js";
import { BackendRepository } from "../backends/repository.js";
import { BackendsService } from "../backends/service.js";
import {
  auditEntries,
  backends,
  generations,
  modelRevisions,
  models,
  modes,
  users,
  workflows,
} from "../db/schema.js";
import { Dispatcher } from "../dispatch/dispatcher.js";
import { DispatchQueue } from "../dispatch/queue.js";
import { MediaRunner } from "../media/media.js";
import { ModelBackendsRepository } from "../models/model-backends.js";
import { ModelRepository } from "../models/repository.js";
import { createLocalStorage } from "../storage/storage.js";
import { createTestDatabase } from "../test/database.js";
import { UploadsRepository } from "../uploads/repository.js";
import { AssetsRepository } from "./assets-repository.js";
import { getCapsStatus } from "./caps.js";
import { GenerationEvents } from "./events.js";
import { GenerationsRepository } from "./repository.js";
import {
  TestModeHasErrors,
  TestNoBackend,
  submitTestGeneration,
} from "./test-submission.js";

const SYSTEM: AuditActor = { type: "system" };

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

async function insertUser(
  db: Awaited<ReturnType<typeof createTestDatabase>>["db"],
  email: string,
) {
  const [row] = await db
    .insert(users)
    .values({ googleSub: randomUUID(), email, name: email })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

describe("submitTestGeneration end-to-end (issue #74)", () => {
  const testDb = createTestDatabase("test_submission_e2e_test");

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(generations);
    await db.delete(modes);
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
    await db.delete(backends);
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
      "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    );
    const logWriter = createLogEntryWriter(db, systemClock, silentLogger());
    const backendsService = new BackendsService(
      backendRepository,
      systemClock,
      logWriter,
      true,
    );
    const generationsRepository = new GenerationsRepository(db);
    const uploadsRepository = new UploadsRepository(db);
    const generationEvents = new GenerationEvents();
    const queue = new DispatchQueue(db);
    const storage = createLocalStorage(tmpDir);
    const pausedRef = { value: false };

    const dispatcher = new Dispatcher({
      sql,
      clock: systemClock,
      logWriter,
      logger: silentLogger(),
      backendRepository,
      backendsService,
      modelBackendsRepository,
      queue,
      assetsRepository: new AssetsRepository(db),
      generationsRepository,
      storage,
      generationEvents,
      media: new MediaRunner(2),
      siteName: "localhost",
      c2pa: null,
      getSiteTitle: async () => "Test Studio",
      pollIntervalMs: 15,
      isPaused: async () => pausedRef.value,
    });

    const testDeps = {
      modelRepository,
      modelBackendsRepository,
      backendsService,
      generationsRepository,
      generationEvents,
      clock: systemClock,
      uploadsRepository,
      hasFreeDisk: async () => true,
      onGenerationQueued: dispatcher.wake,
    };

    return {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      dispatcher,
      testDeps,
      pausedRef,
    };
  }

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

  async function createModel(modelRepository: ModelRepository, name: string) {
    const { record: model } = await modelRepository.createFromWorkflow(
      name,
      WORKFLOW,
      SYSTEM,
    );
    return model;
  }

  const draftMode = {
    name: "Test Mode",
    description: "",
    outputNodeIds: ["2"],
    inputSettings: [],
  };

  test("runs to succeeded, on an unnumbered revision, with no Audit entry and never current", async () => {
    const tmpDir = `/tmp/test-submission-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      generationsRepository,
      dispatcher,
      testDeps,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "admin@example.com");
      const model = await createModel(modelRepository, "M1");
      const backend = await backendRepository.create(
        { name: "Fake", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      const entriesBefore = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.targetId, model.id));

      const { generation } = await submitTestGeneration(
        {
          modelId: model.id,
          userId: user.id,
          mode: draftMode,
          inputs: [],
          values: {},
          backendId: null,
        },
        testDeps,
      );
      expect(generation.isTest).toBe(true);

      fake.script(generation.id, {
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

      await dispatcher.runUntilIdle();

      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generation.id));
      expect(row?.state).toBe("succeeded");
      expect(row?.isTest).toBe(true);

      const [modelRow] = await db
        .select()
        .from(models)
        .where(eq(models.id, model.id));
      expect(modelRow?.currentRevision).toBe(1);

      const [revisionRow] = await db
        .select()
        .from(modelRevisions)
        .where(eq(modelRevisions.id, row?.revisionId ?? ""));
      expect(revisionRow?.isTest).toBe(true);
      expect(revisionRow?.revisionNumber).toBeLessThan(0);

      const entriesAfter = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.targetId, model.id));
      expect(entriesAfter).toHaveLength(entriesBefore.length);
      expect(entriesAfter.map((e) => e.id).sort()).toEqual(
        entriesBefore.map((e) => e.id).sort(),
      );

      const tests = await generationsRepository.listRecentTestsForModel(
        model.id,
        user.id,
        5,
      );
      expect(tests.map((t) => t.id)).toContain(generation.id);
    } finally {
      fake.stop();
    }
  });

  test("blocked while the Mode has errors (no output nodes chosen)", async () => {
    const tmpDir = `/tmp/test-submission-e2e-${randomUUID()}`;
    const { db, modelRepository, testDeps } = await setup(tmpDir);
    const user = await insertUser(db, "admin2@example.com");
    const model = await createModel(modelRepository, "M2");

    await expect(
      submitTestGeneration(
        {
          modelId: model.id,
          userId: user.id,
          mode: { ...draftMode, outputNodeIds: [] },
          inputs: [],
          values: {},
          backendId: null,
        },
        testDeps,
      ),
    ).rejects.toBeInstanceOf(TestModeHasErrors);
  });

  test("runs on a disabled Model and doesn't count toward Caps", async () => {
    const tmpDir = `/tmp/test-submission-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      testDeps,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "admin3@example.com");
      const model = await createModel(modelRepository, "M3");
      const backend = await backendRepository.create(
        { name: "Fake", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      // The Model is left `disabled` (createFromWorkflow's own default).
      const before = await getCapsStatus(db, systemClock, user.id);

      const { generation } = await submitTestGeneration(
        {
          modelId: model.id,
          userId: user.id,
          mode: draftMode,
          inputs: [],
          values: {},
          backendId: null,
        },
        testDeps,
      );
      expect(generation.isTest).toBe(true);

      const after = await getCapsStatus(db, systemClock, user.id);
      expect(after.dailyUsed).toBe(before.dailyUsed);
      expect(after.concurrentUsed).toBe(before.concurrentUsed);
    } finally {
      fake.stop();
    }
  });

  test("a pinned Backend refuses when it can't run the Mode, even with another attached Backend that could", async () => {
    const tmpDir = `/tmp/test-submission-e2e-${randomUUID()}`;
    const {
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      testDeps,
      db,
    } = await setup(tmpDir);

    const fakeGood = startFakeComfyUi({ port: 0 });
    const fakeBad = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "admin4@example.com");
      const model = await createModel(modelRepository, "M4");

      const good = await backendRepository.create(
        { name: "Good", baseUrl: fakeGood.url, auth: "none" },
        SYSTEM,
      );
      const bad = await backendRepository.create(
        { name: "Bad", baseUrl: fakeBad.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, good.id, SYSTEM);
      await modelBackendsRepository.attach(model.id, bad.id, SYSTEM);
      backendsService.watch(good);
      backendsService.watch(bad);
      forceReachable(backendsService, good.id);
      forceReachable(backendsService, bad.id);

      // `bad`'s own stub never ran a real prompt for SaveImage's class
      // type to be known; stubbing its nodeTypesFor to omit it is enough
      // to prove the pin, without depending on either fake's own startup
      // object_info timing.
      const originalNodeTypesFor =
        backendsService.nodeTypesFor.bind(backendsService);
      backendsService.nodeTypesFor = async (backend) =>
        backend.id === bad.id
          ? new Set(["LoadImage"])
          : originalNodeTypesFor(backend);

      await expect(
        submitTestGeneration(
          {
            modelId: model.id,
            userId: user.id,
            mode: draftMode,
            inputs: [],
            values: {},
            backendId: bad.id,
          },
          testDeps,
        ),
      ).rejects.toBeInstanceOf(TestNoBackend);
    } finally {
      fakeGood.stop();
      fakeBad.stop();
    }
  });

  test("still dispatches a Test while Paused", async () => {
    const tmpDir = `/tmp/test-submission-e2e-${randomUUID()}`;
    const {
      db,
      modelRepository,
      modelBackendsRepository,
      backendRepository,
      backendsService,
      dispatcher,
      testDeps,
      pausedRef,
    } = await setup(tmpDir);

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const user = await insertUser(db, "admin5@example.com");
      const model = await createModel(modelRepository, "M5");
      const backend = await backendRepository.create(
        { name: "Fake", baseUrl: fake.url, auth: "none" },
        SYSTEM,
      );
      await modelBackendsRepository.attach(model.id, backend.id, SYSTEM);
      backendsService.watch(backend);
      forceReachable(backendsService, backend.id);

      pausedRef.value = true;

      const { generation } = await submitTestGeneration(
        {
          modelId: model.id,
          userId: user.id,
          mode: draftMode,
          inputs: [],
          values: {},
          backendId: null,
        },
        testDeps,
      );

      fake.script(generation.id, {
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

      await dispatcher.runUntilIdle();

      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generation.id));
      expect(row?.state).toBe("succeeded");
    } finally {
      fake.stop();
    }
  });
});
