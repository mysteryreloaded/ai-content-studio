// Disable's cancellation and SSE-closing behavior (issue #64's AC):
// "queued, starting and running Generations cancelled" and "SSE closed
// (then 401)". Kept separate from admin-users.test.ts, which covers the
// route's own status/Audit/guard behavior with lightweight fixtures —
// this file needs a real Model/Backend to get Generations into those
// states.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { desc, eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  backends,
  generations,
  logEntries,
  modelBackends,
  modelRevisions,
  models,
  sessions,
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
    DATA_DIR: "/tmp/ai-content-studio-test-data-disable-cancellation",
    SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    BACKENDS_ENABLED: true,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    FFMPEG_CONCURRENCY: 2,
    MAX_UPLOAD_MB: 500,
    LOG_RETENTION_DAYS: 30,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "2": { class_type: "KSampler", inputs: { seed: 0, model: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("disabling a user cancels their work and closes their SSE stream", () => {
  const testDb = createTestDatabase("admin_users_disable_cancellation_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(generations);
    await db.delete(logEntries);
    await db.delete(modelBackends);
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
    await db.delete(backends);
    await db.delete(sessions);
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

  async function insertUser(overrides: Partial<typeof users.$inferInsert>) {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: crypto.randomUUID(),
        email: `${crypto.randomUUID()}@example.com`,
        name: "Test User",
        role: "user",
        status: "active",
        ...overrides,
      })
      .returning();
    if (!user) throw new Error("failed to insert user");
    return user;
  }

  async function headersFor(userId: string) {
    const { db } = await testDb;
    const session = await createSession(db, clock, userId);
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
      "content-type": "application/json",
    };
  }

  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "M", workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "Fake", baseUrl: fakeUrl, auth: "none" }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: adminHeaders,
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
      headers: adminHeaders,
      body: JSON.stringify({ version: afterModes.version }),
    });

    return {
      modelId: model.id as string,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
    };
  }

  async function submit(
    app: Awaited<ReturnType<typeof build>>["app"],
    userHeaders: Record<string, string>,
    slug: string,
    modeId: string,
  ): Promise<string> {
    const res = await app.request(`/api/models/${slug}/generations`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ modeId, revision: 2 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { generations: Array<{ id: string }> };
    const first = body.generations[0];
    if (!first) throw new Error("submit created no Generation");
    return first.id;
  }

  /** A row in a given `state`, bypassing the real dispatch pipeline (mirrors account.test.ts's own helper). */
  async function insertGeneration(
    modelId: string,
    modeId: string,
    userId: string,
    state: typeof generations.$inferInsert.state,
  ): Promise<string> {
    const { db } = await testDb;
    const [revision] = await db
      .select({ id: modelRevisions.id })
      .from(modelRevisions)
      .where(eq(modelRevisions.modelId, modelId))
      .orderBy(desc(modelRevisions.revisionNumber))
      .limit(1);
    if (!revision) throw new Error("no revision for this Model");
    const [row] = await db
      .insert(generations)
      .values({
        id: crypto.randomUUID(),
        modelId,
        revisionId: revision.id,
        modeId,
        userId,
        submissionId: crypto.randomUUID(),
        state,
        builtPrompt: {},
        nodeTypes: [],
        uploadIds: [],
        queuedAt: clock.now(),
        submittedAt: clock.now(),
      })
      .returning({ id: generations.id });
    if (!row) throw new Error("insert returned no row");
    return row.id;
  }

  test("cancels a queued Generation outright and moves a running one to cancelling", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const admin = await insertUser({ role: "admin", status: "active" });
      const adminHeaders = await headersFor(admin.id);
      const model = await buildEnabledModel(app, adminHeaders, fake.url);

      const target = await insertUser({});
      const targetHeaders = await headersFor(target.id);

      const queuedId = await submit(
        app,
        targetHeaders,
        model.slug,
        model.modeId,
      );
      const runningId = await insertGeneration(
        model.modelId,
        model.modeId,
        target.id,
        "running",
      );

      const res = await app.request(`/api/admin/users/${target.id}/disable`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ reason: "Abusive prompts" }),
      });
      expect(res.status).toBe(200);

      const [queuedRow] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, queuedId));
      expect(queuedRow?.state).toBe("cancelled");

      // A `running` Generation only moves to `cancelling` (issue #54):
      // the runner's own poll loop confirms it against the Backend
      // later, independent of this request.
      const [runningRow] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, runningId));
      expect(runningRow?.state).toBe("cancelling");

      // Disable doesn't Tombstone anything (unlike a delete): the rows
      // and any Assets they already made are left alone.
      expect(queuedRow?.deletedAt).toBeNull();
      expect(runningRow?.deletedAt).toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("closes the target's open SSE stream", async () => {
    const { app } = await build();
    const admin = await insertUser({ role: "admin", status: "active" });
    const adminHeaders = await headersFor(admin.id);
    const target = await insertUser({});
    const targetHeaders = await headersFor(target.id);

    const streamRes = await app.request("/api/generations/stream", {
      headers: targetHeaders,
    });
    expect(streamRes.status).toBe(200);
    const reader = streamRes.body?.getReader();
    if (!reader) throw new Error("no stream body");
    const decoder = new TextDecoder();

    const snapshotChunk = await reader.read();
    expect(decoder.decode(snapshotChunk.value)).toContain("event: snapshot");

    const disableRes = await app.request(
      `/api/admin/users/${target.id}/disable`,
      { method: "POST", headers: adminHeaders },
    );
    expect(disableRes.status).toBe(200);

    const nextChunk = await reader.read();
    expect(nextChunk.done).toBe(true);
  });
});
