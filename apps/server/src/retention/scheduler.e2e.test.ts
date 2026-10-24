// End-to-end: the retention sweep (issue #69) against a real Postgres,
// exercising the advisory lock, each job, and the "failed job writes an
// error Log entry" AC.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock, type Workflow } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { createLogEntryWriter } from "../backends/log-entries.js";
import {
  assets,
  backends,
  generations,
  logEntries,
  modelBackends,
  modelRevisions,
  models,
  uploads,
  users,
  workflows,
} from "../db/schema.js";
import type { Env } from "../env.js";
import { GenerationsRepository } from "../generations/repository.js";
import type { Logger } from "../logger.js";
import { createLocalStorage } from "../storage/storage.js";
import { createTestDatabase } from "../test/database.js";
import { UploadsRepository } from "../uploads/repository.js";
import { RetentionScheduler } from "./scheduler.js";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function testEnv(): Env {
  return {
    DATABASE_URL: "unused",
    PORT: 3000,
    LOG_LEVEL: "error",
    PUBLIC_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    ADMIN_EMAILS: ["admin@example.com"],
    OIDC_ISSUER: undefined,
    DATA_DIR: "/tmp/ai-content-studio-test-data-retention",
    SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    BACKENDS_ENABLED: true,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    FFMPEG_CONCURRENCY: 2,
    MAX_UPLOAD_MB: 500,
    LOG_RETENTION_DAYS: 30,
    ASSET_RETENTION_DAYS: undefined,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };
const DAY_MS = 24 * 60 * 60 * 1000;

const WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "2": { class_type: "KSampler", inputs: { seed: 0, model: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("retention sweep (issue #69)", () => {
  const testDb = createTestDatabase("retention_scheduler_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(assets);
    await db.delete(uploads);
    await db.delete(generations);
    await db.delete(logEntries);
    await db.delete(modelBackends);
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
    await db.delete(backends);
    await db.delete(users);
  });

  async function build() {
    const { db, sql } = await testDb;
    return createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env: testEnv(),
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
  }

  async function headersFor(role: "admin" | "user") {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: `sub-${role}-${crypto.randomUUID()}`,
        email: `${role}-${crypto.randomUUID()}@example.com`,
        name: role,
        role,
        status: "active",
      })
      .returning();
    if (!user) throw new Error("failed to insert user");
    const { createSession, SESSION_COOKIE_NAME } = await import(
      "../auth/session.js"
    );
    const session = await createSession(db, clock, user.id);
    return {
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
      },
      userId: user.id as string,
    };
  }

  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: `M-${crypto.randomUUID()}`,
        workflow: WORKFLOW,
      }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Fake-${crypto.randomUUID()}`,
        baseUrl: fakeUrl,
        auth: "none",
      }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      }),
    });
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { id: string; version: number };
      modes: Array<{ id: string; name: string }>;
    };

    await app.request(`/api/admin/models/${model.id}/enable`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ version: afterModes.version }),
    });

    return {
      modelId: model.id as string,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
    };
  }

  async function submitEnded(
    app: Awaited<ReturnType<typeof build>>["app"],
    userHeaders: Record<string, string>,
    slug: string,
    modeId: string,
    endedAt: Date,
  ): Promise<string> {
    const { db } = await testDb;
    const res = await app.request(`/api/models/${slug}/generations`, {
      method: "POST",
      headers: { ...userHeaders, "content-type": "application/json" },
      body: JSON.stringify({ modeId, revision: 2 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      generations: Array<{ id: string }>;
    };
    const generationId = body.generations[0]?.id;
    if (!generationId) throw new Error("submit created no Generation");
    await db
      .update(generations)
      .set({ state: "succeeded", endedAt })
      .where(eq(generations.id, generationId));
    return generationId;
  }

  test("prunes an old Asset's Generation into a Tombstone, leaves a fresh one alone", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const { headers: userHeaders } = await headersFor("user");
      const model = await buildEnabledModel(app, adminHeaders, fake.url);

      const now = clock.now();
      const oldGenerationId = await submitEnded(
        app,
        userHeaders,
        model.slug,
        model.modeId,
        now,
      );
      const freshGenerationId = await submitEnded(
        app,
        userHeaders,
        model.slug,
        model.modeId,
        now,
      );

      await db.insert(assets).values([
        {
          generationId: oldGenerationId,
          nodeId: "3",
          sortOrder: 0,
          kind: "image",
          comfyuiFilename: "old.png",
          contentType: "image/png",
          size: 10,
          storageKey: `assets/${oldGenerationId}/old.png`,
          createdAt: new Date(now.getTime() - 40 * DAY_MS),
        },
        {
          generationId: freshGenerationId,
          nodeId: "3",
          sortOrder: 0,
          kind: "image",
          comfyuiFilename: "fresh.png",
          contentType: "image/png",
          size: 10,
          storageKey: `assets/${freshGenerationId}/fresh.png`,
          createdAt: now,
        },
      ]);

      const generationsRepository = new GenerationsRepository(db);
      const cutoff = new Date(now.getTime() - 30 * DAY_MS);
      const keys = await generationsRepository.pruneOldAssets(cutoff, now);
      expect(keys.assets).toEqual([
        expect.objectContaining({
          storageKey: `assets/${oldGenerationId}/old.png`,
        }),
      ]);

      const [oldRow] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, oldGenerationId));
      expect(oldRow?.deletedAt).not.toBeNull();
      expect(oldRow?.builtPrompt).toEqual({});

      const [freshRow] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, freshGenerationId));
      expect(freshRow?.deletedAt).toBeNull();

      const remainingAssets = await db
        .select()
        .from(assets)
        .where(eq(assets.generationId, freshGenerationId));
      expect(remainingAssets.length).toBe(1);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("deletes a stale, unused Upload but keeps one a non-deleted Generation still references", async () => {
    const { db } = await testDb;
    const { userId } = await headersFor("user");
    const now = clock.now();
    const staleCutoff = new Date(now.getTime() - DAY_MS);

    const usedId = crypto.randomUUID();
    const unusedId = crypto.randomUUID();
    const incompleteId = crypto.randomUUID();
    await db.insert(uploads).values([
      {
        id: usedId,
        userId,
        status: "complete",
        originalName: "used.png",
        declaredType: "image/png",
        size: 10,
        storageKey: `uploads/${usedId}/original`,
        createdAt: new Date(now.getTime() - 2 * DAY_MS),
        lastUsedAt: new Date(now.getTime() - 2 * DAY_MS),
      },
      {
        id: unusedId,
        userId,
        status: "complete",
        originalName: "unused.png",
        declaredType: "image/png",
        size: 10,
        storageKey: `uploads/${unusedId}/original`,
        createdAt: new Date(now.getTime() - 2 * DAY_MS),
        lastUsedAt: new Date(now.getTime() - 2 * DAY_MS),
      },
      {
        id: incompleteId,
        userId,
        status: "uploading",
        originalName: "incomplete.png",
        declaredType: "image/png",
        size: 100,
        receivedBytes: 10,
        storageKey: `uploads/${incompleteId}/original`,
        createdAt: new Date(now.getTime() - 2 * DAY_MS),
        lastUsedAt: new Date(now.getTime() - 2 * DAY_MS),
      },
    ]);

    // A referencing row doesn't need to be a real, fully-wired Generation
    // for this repository method: it only reads `uploadIds`/`deletedAt`.
    const fakeGenerationId = crypto.randomUUID();
    const [model] = await db
      .insert(models)
      .values({
        name: "Retention test model",
        slug: `retention-test-${crypto.randomUUID()}`,
        sortOrder: 0,
      })
      .returning();
    if (!model) throw new Error("failed to insert model");
    const [workflow] = await db
      .insert(workflows)
      .values({
        hash: crypto.randomUUID(),
        json: WORKFLOW,
        nodeCount: 3,
        size: 10,
      })
      .returning();
    if (!workflow) throw new Error("failed to insert workflow");
    const [revision] = await db
      .insert(modelRevisions)
      .values({
        modelId: model.id,
        revisionNumber: 1,
        workflowHash: workflow.hash,
        inputs: [],
      })
      .returning();
    if (!revision) throw new Error("failed to insert revision");
    const { modes } = await import("../db/schema.js");
    const [mode] = await db
      .insert(modes)
      .values({
        revisionId: revision.id,
        name: "Default",
        sortOrder: 0,
        outputNodes: [
          { nodeId: "3", classType: "SaveImage", title: "", kind: "image" },
        ],
      })
      .returning();
    if (!mode) throw new Error("failed to insert mode");
    await db.insert(generations).values({
      id: fakeGenerationId,
      modelId: model.id,
      revisionId: revision.id,
      modeId: mode.id,
      userId,
      submissionId: crypto.randomUUID(),
      builtPrompt: WORKFLOW,
      nodeTypes: [],
      uploadIds: [usedId],
      submittedAt: now,
      queuedAt: now,
    });

    const uploadsRepository = new UploadsRepository(db);
    const deleted = await uploadsRepository.deleteUnused(staleCutoff);
    const deletedIds = deleted.map((row) => row.id);
    expect(deletedIds).toContain(unusedId);
    expect(deletedIds).toContain(incompleteId);
    expect(deletedIds).not.toContain(usedId);

    const remaining = await db.select().from(uploads);
    expect(remaining.map((row) => row.id)).toEqual([usedId]);
  });

  test("GenerationsRepository.create touches a named Upload's own last-used clock", async () => {
    const { db } = await testDb;
    const { userId } = await headersFor("user");
    const now = clock.now();
    const uploadId = crypto.randomUUID();
    await db.insert(uploads).values({
      id: uploadId,
      userId,
      status: "complete",
      originalName: "a.png",
      declaredType: "image/png",
      size: 10,
      storageKey: `uploads/${uploadId}/original`,
      createdAt: new Date(now.getTime() - 2 * DAY_MS),
      lastUsedAt: new Date(now.getTime() - 2 * DAY_MS),
    });

    const [model] = await db
      .insert(models)
      .values({
        name: "Retention touch model",
        slug: `retention-touch-${crypto.randomUUID()}`,
        sortOrder: 0,
      })
      .returning();
    if (!model) throw new Error("failed to insert model");
    const [workflow] = await db
      .insert(workflows)
      .values({
        hash: crypto.randomUUID(),
        json: WORKFLOW,
        nodeCount: 3,
        size: 10,
      })
      .returning();
    if (!workflow) throw new Error("failed to insert workflow");
    const [revision] = await db
      .insert(modelRevisions)
      .values({
        modelId: model.id,
        revisionNumber: 1,
        workflowHash: workflow.hash,
        inputs: [],
      })
      .returning();
    if (!revision) throw new Error("failed to insert revision");
    const { modes } = await import("../db/schema.js");
    const [mode] = await db
      .insert(modes)
      .values({
        revisionId: revision.id,
        name: "Default",
        sortOrder: 0,
        outputNodes: [
          { nodeId: "3", classType: "SaveImage", title: "", kind: "image" },
        ],
      })
      .returning();
    if (!mode) throw new Error("failed to insert mode");

    const generationsRepository = new GenerationsRepository(db);
    await generationsRepository.create({
      id: crypto.randomUUID(),
      modelId: model.id,
      revisionId: revision.id,
      modeId: mode.id,
      modeName: mode.name,
      userId,
      submissionId: crypto.randomUUID(),
      builtPrompt: WORKFLOW as unknown as Workflow,
      nodeTypes: [],
      uploadIds: [uploadId],
      submittedAt: now,
    });

    const uploadsRepository = new UploadsRepository(db);
    const deleted = await uploadsRepository.deleteUnused(
      new Date(now.getTime() - DAY_MS),
    );
    expect(deleted.map((row) => row.id)).not.toContain(uploadId);
  });

  test("prunes a stale Log entry, keeps a fresh one", async () => {
    const { db } = await testDb;
    const now = clock.now();
    await db.insert(logEntries).values([
      {
        level: "info",
        source: "app",
        message: "old",
        createdAt: new Date(now.getTime() - 40 * DAY_MS),
      },
      {
        level: "info",
        source: "app",
        message: "fresh",
        createdAt: now,
      },
    ]);

    const { sql: rawSql } = await testDb;
    const logWriter = createLogEntryWriter(db, clock, silentLogger);
    const storage = createLocalStorage(
      "/tmp/ai-content-studio-test-retention-storage",
    );
    const scheduler = new RetentionScheduler({
      sql: rawSql,
      db,
      clock,
      storage,
      logWriter,
      logger: silentLogger,
      generationsRepository: {
        pruneOldAssets: async () => ({ assets: [], uploads: [] }),
      },
      uploadsRepository: new UploadsRepository(db),
      assetRetentionDays: null,
      logRetentionDays: 30,
    });

    await scheduler.runOnce();

    const remaining = await db.select().from(logEntries);
    expect(remaining.map((row) => row.message)).toEqual(["fresh"]);
  });

  test("a failed job writes an error Log entry, and the other jobs still run", async () => {
    const { db, sql: rawSql } = await testDb;
    const now = clock.now();
    await db.insert(logEntries).values({
      level: "info",
      source: "app",
      message: "old",
      createdAt: new Date(now.getTime() - 40 * DAY_MS),
    });

    const logWriter = createLogEntryWriter(db, clock, silentLogger);
    const storage = createLocalStorage(
      "/tmp/ai-content-studio-test-retention-storage-2",
    );
    const scheduler = new RetentionScheduler({
      sql: rawSql,
      db,
      clock,
      storage,
      logWriter,
      logger: silentLogger,
      generationsRepository: {
        pruneOldAssets: async () => {
          throw new Error("boom");
        },
      },
      uploadsRepository: new UploadsRepository(db),
      assetRetentionDays: 30,
      logRetentionDays: 30,
    });

    await scheduler.runOnce();

    const errorRows = await db
      .select()
      .from(logEntries)
      .where(eq(logEntries.level, "error"));
    expect(errorRows.length).toBe(1);
    expect(errorRows[0]?.message).toContain("asset retention");

    // The log job still ran despite the asset job's failure: the old
    // entry (inserted above `now`'s cutoff) is gone, leaving only this
    // failure's own fresh `error` entry.
    const remaining = await db.select().from(logEntries);
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.level).toBe("error");
  });

  test("skips the sweep while another instance holds the advisory lock", async () => {
    const { db, sql: rawSql } = await testDb;
    const now = clock.now();
    await db.insert(logEntries).values({
      level: "info",
      source: "app",
      message: "old",
      createdAt: new Date(now.getTime() - 40 * DAY_MS),
    });

    // A second reserved connection from the same pool is its own Postgres
    // session, the same as a second server instance's own connection
    // would be — advisory locks are per-session.
    const holder = await rawSql.reserve();
    await holder`select pg_advisory_lock(72738293)`;

    const logWriter = createLogEntryWriter(db, clock, silentLogger);
    const storage = createLocalStorage(
      "/tmp/ai-content-studio-test-retention-storage-3",
    );
    const scheduler = new RetentionScheduler({
      sql: rawSql,
      db,
      clock,
      storage,
      logWriter,
      logger: silentLogger,
      generationsRepository: {
        pruneOldAssets: async () => ({ assets: [], uploads: [] }),
      },
      uploadsRepository: new UploadsRepository(db),
      assetRetentionDays: null,
      logRetentionDays: 30,
    });

    try {
      await scheduler.runOnce();
      const remaining = await db.select().from(logEntries);
      expect(remaining.length).toBe(1);
    } finally {
      await holder`select pg_advisory_unlock(72738293)`;
      holder.release();
    }

    await scheduler.runOnce();
    const afterRelease = await db.select().from(logEntries);
    expect(afterRelease.length).toBe(0);
  });
});
