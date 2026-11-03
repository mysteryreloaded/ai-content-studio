// `/api/admin/overview` (issue #203): the new per-Model queue figures
// and per-Backend `enabled`/`draining`/`running` fields.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  backends,
  generations,
  modelBackends,
  modelRevisions,
  models,
  modes,
  users,
  workflows,
} from "../db/schema.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";

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
    DATA_DIR: "/tmp/ai-content-studio-test-data-admin-overview",
    SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    BACKENDS_ENABLED: true,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    MAX_UPLOAD_MB: 500,
    FFMPEG_CONCURRENCY: 2,
    LOG_RETENTION_DAYS: 30,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("GET /api/admin/overview (issue #203)", () => {
  const testDb = createTestDatabase("admin_overview_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(generations);
    await db.delete(modelBackends);
    await db.delete(modes);
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

  async function adminHeaders(db: Awaited<typeof testDb>["db"]) {
    const [admin] = await db
      .insert(users)
      .values({
        googleSub: "sub-admin",
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("failed to insert admin");
    const session = await createSession(db, clock, admin.id);
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
    };
  }

  /** Inserts a Model with one Mode, bypassing the full upload/enable API so the fixture stays small. */
  async function buildModel(
    db: Awaited<typeof testDb>["db"],
    name: string,
    sortOrder: number,
  ) {
    const workflowHash = `hash-${name}`;
    await db.insert(workflows).values({
      hash: workflowHash,
      json: {},
      nodeCount: 0,
      size: 0,
    });
    const [model] = await db
      .insert(models)
      .values({ name, slug: name.toLowerCase(), sortOrder, state: "enabled" })
      .returning();
    if (!model) throw new Error("failed to insert model");
    const [revision] = await db
      .insert(modelRevisions)
      .values({ modelId: model.id, revisionNumber: 1, workflowHash })
      .returning();
    if (!revision) throw new Error("failed to insert revision");
    const [mode] = await db
      .insert(modes)
      .values({
        revisionId: revision.id,
        sortOrder: 0,
        name: "Default",
        outputNodes: [],
      })
      .returning();
    if (!mode) throw new Error("failed to insert mode");
    return { modelId: model.id, revisionId: revision.id, modeId: mode.id };
  }

  async function insertGeneration(
    db: Awaited<typeof testDb>["db"],
    fields: {
      modelId: string;
      revisionId: string;
      modeId: string;
      userId: string;
      backendId?: string | null;
      state: "queued" | "starting" | "running" | "saving" | "succeeded";
      queuedAt: Date;
      startedAt?: Date | null;
    },
  ) {
    await db.insert(generations).values({
      id: randomUUID(),
      modelId: fields.modelId,
      revisionId: fields.revisionId,
      modeId: fields.modeId,
      userId: fields.userId,
      backendId: fields.backendId ?? null,
      submissionId: randomUUID(),
      state: fields.state,
      builtPrompt: {},
      nodeTypes: [],
      queuedAt: fields.queuedAt,
      startedAt: fields.startedAt ?? null,
      submittedAt: fields.queuedAt,
    });
  }

  test("reports per-Model queue figures and per-Backend enabled/draining/running", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const headers = await adminHeaders(db);
      const [user] = await db
        .insert(users)
        .values({ googleSub: "sub-user", email: "user@example.com", name: "U" })
        .returning();
      if (!user) throw new Error("failed to insert user");

      // Created through the API (not a direct insert) so `BackendsService.watch`
      // actually tracks it; advancing the clock past the monitor's 30s poll
      // interval then lets it become reachable, for the "usable" count below.
      const backendARes = await app.request("/api/admin/backends", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          name: "GPU A",
          baseUrl: fake.url,
          auth: "none",
        }),
      });
      const backendA = (await backendARes.json()) as { id: string };
      clock.advance(30_000);
      await flushMicrotasks();

      const [backendB] = await db
        .insert(backends)
        .values({
          name: "GPU B",
          baseUrl: "http://unused.invalid",
          enabled: false,
        })
        .returning();
      if (!backendB) throw new Error("failed to insert backend");

      const modelX = await buildModel(db, "ModelX", 0);
      await db.insert(modelBackends).values([
        { modelId: modelX.modelId, backendId: backendA.id },
        { modelId: modelX.modelId, backendId: backendB.id },
      ]);

      const now = clock.now();
      const oldest = new Date(now.getTime() - 60_000);

      // two queued, one running (on backendA), consistent with "N of M".
      await insertGeneration(db, {
        ...modelX,
        userId: user.id,
        state: "queued",
        queuedAt: oldest,
      });
      await insertGeneration(db, {
        ...modelX,
        userId: user.id,
        state: "queued",
        queuedAt: now,
      });
      await insertGeneration(db, {
        ...modelX,
        userId: user.id,
        backendId: backendA.id,
        state: "running",
        queuedAt: new Date(now.getTime() - 5_000),
        startedAt: new Date(now.getTime() - 2_000),
      });

      const res = await app.request("/api/admin/overview", { headers });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        models: Array<{
          id: string;
          queued: number;
          running: number;
          oldestQueuedAt: string | null;
          usableBackends: number;
          attachedBackends: number;
        }>;
        backends: Array<{
          id: string;
          enabled: boolean;
          draining: boolean;
          running: {
            generationId: string;
            modelName: string;
            modeName: string;
          } | null;
        }>;
      };

      const model = body.models.find((m) => m.id === modelX.modelId);
      expect(model?.queued).toBe(2);
      expect(model?.running).toBe(1);
      expect(model?.oldestQueuedAt).toBe(oldest.toISOString());
      expect(model?.attachedBackends).toBe(2);
      // backendB is disabled, so only backendA is usable ("1 of 2").
      expect(model?.usableBackends).toBe(1);

      const backendARow = body.backends.find((b) => b.id === backendA.id);
      expect(backendARow?.enabled).toBe(true);
      expect(backendARow?.draining).toBe(false);
      expect(backendARow?.running?.modelName).toBe("ModelX");
      expect(backendARow?.running?.modeName).toBe("Default");

      const backendBRow = body.backends.find((b) => b.id === backendB.id);
      expect(backendBRow?.enabled).toBe(false);
      expect(backendBRow?.running).toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("computes the 24h median wait from startedAt - queuedAt", async () => {
    const { app, backendsService } = await build();
    const { db } = await testDb;
    const headers = await adminHeaders(db);
    const [user] = await db
      .insert(users)
      .values({
        googleSub: "sub-user2",
        email: "user2@example.com",
        name: "U2",
      })
      .returning();
    if (!user) throw new Error("failed to insert user");

    const model = await buildModel(db, "ModelY", 1);
    const now = clock.now();

    // waits of 10s and 30s -> median 20s.
    await insertGeneration(db, {
      ...model,
      userId: user.id,
      state: "succeeded",
      queuedAt: new Date(now.getTime() - 40_000),
      startedAt: new Date(now.getTime() - 30_000),
    });
    await insertGeneration(db, {
      ...model,
      userId: user.id,
      state: "succeeded",
      queuedAt: new Date(now.getTime() - 60_000),
      startedAt: new Date(now.getTime() - 30_000),
    });
    // started over 24h ago: excluded from the window.
    await insertGeneration(db, {
      ...model,
      userId: user.id,
      state: "succeeded",
      queuedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
      startedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000 + 1000),
    });

    const res = await app.request("/api/admin/overview", { headers });
    const body = (await res.json()) as {
      models: Array<{ id: string; medianWait24hMs: number | null }>;
    };
    const row = body.models.find((m) => m.id === model.modelId);
    expect(row?.medianWait24hMs).toBe(20_000);

    backendsService.stop();
  });
});
