// `/api/generations/:id/cancel` (issue #189): the owner cancelling just
// one of a Submission's own Generations — the route-level view of
// `cancelGeneration` (issue #54).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  assets,
  backends,
  generations,
  modelBackends,
  modelRevisions,
  models,
  uploads,
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
    DATA_DIR: "/tmp/ai-content-studio-test-data-generations-cancel",
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

describe("/api/generations/:id/cancel (issue #189)", () => {
  const testDb = createTestDatabase("generations_cancel_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(assets);
    await db.delete(uploads);
    await db.delete(generations);
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

  async function headersFor(role: "admin" | "user", suffix = "") {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: `sub-${role}${suffix}`,
        email: `${role}${suffix}@example.com`,
        name: `${role}${suffix}`,
        role,
        status: "active",
      })
      .returning();
    if (!user) throw new Error("failed to insert user");
    const session = await createSession(db, clock, user.id);
    return {
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
      },
      userId: user.id,
    };
  }

  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
    name: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name, workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Fake-${name}`,
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

    const enableRes = await app.request(
      `/api/admin/models/${model.id}/enable`,
      {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ version: afterModes.version }),
      },
    );
    expect(enableRes.status).toBe(200);

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
  ): Promise<{ generationId: string; submissionId: string }> {
    const res = await app.request(`/api/models/${slug}/generations`, {
      method: "POST",
      headers: { ...userHeaders, "content-type": "application/json" },
      body: JSON.stringify({ modeId, revision: 2 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      generations: Array<{ id: string; submissionId: string }>;
    };
    const first = body.generations[0];
    if (!first) throw new Error("submit created no Generation");
    return { generationId: first.id, submissionId: first.submissionId };
  }

  async function cancel(
    app: Awaited<ReturnType<typeof build>>["app"],
    userHeaders: Record<string, string>,
    generationId: string,
  ) {
    return app.request(`/api/generations/${generationId}/cancel`, {
      method: "POST",
      headers: userHeaders,
    });
  }

  async function stateOf(generationId: string) {
    const { db } = await testDb;
    const [row] = await db
      .select({
        state: generations.state,
        endedAt: generations.endedAt,
        userId: generations.userId,
        submissionId: generations.submissionId,
      })
      .from(generations)
      .where(eq(generations.id, generationId));
    if (!row) throw new Error(`no Generation ${generationId}`);
    return row;
  }

  /** A second, `running` Generation in the same Submission, inserted directly so the dispatcher (which this file's frozen clock never lets tick) can't touch it. */
  async function insertRunningSibling(generationId: string): Promise<string> {
    const { db } = await testDb;
    const [row] = await db
      .select()
      .from(generations)
      .where(eq(generations.id, generationId));
    if (!row) throw new Error(`no Generation ${generationId}`);
    const siblingId = randomUUID();
    await db.insert(generations).values({
      id: siblingId,
      modelId: row.modelId,
      revisionId: row.revisionId,
      modeId: row.modeId,
      userId: row.userId,
      submissionId: row.submissionId,
      state: "running",
      builtPrompt: row.builtPrompt,
      nodeTypes: row.nodeTypes,
      startedAt: clock.now(),
      queuedAt: row.queuedAt,
      submittedAt: row.submittedAt,
    });
    return siblingId;
  }

  test("a queued Generation cancels at once", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      expect((await stateOf(generationId)).state).toBe("queued");

      const res = await cancel(app, userHeaders, generationId);
      expect(res.status).toBe(204);

      const row = await stateOf(generationId);
      expect(row.state).toBe("cancelled");
      expect(row.endedAt).not.toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a running Generation moves to cancelling, until its Backend confirms", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      const { db } = await testDb;
      await db
        .update(generations)
        .set({ state: "running", startedAt: clock.now() })
        .where(eq(generations.id, generationId));

      const res = await cancel(app, userHeaders, generationId);
      expect(res.status).toBe(204);

      const row = await stateOf(generationId);
      expect(row.state).toBe("cancelling");
      // Not confirmed yet: the Backend's interrupt hasn't been reported.
      expect(row.endedAt).toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("an ended Generation is a no-op 204", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      const { db } = await testDb;
      await db
        .update(generations)
        .set({ state: "succeeded", endedAt: clock.now() })
        .where(eq(generations.id, generationId));

      const res = await cancel(app, userHeaders, generationId);
      expect(res.status).toBe(204);

      expect((await stateOf(generationId)).state).toBe("succeeded");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("404 for a missing id or someone else's Generation", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");
      const { headers: otherHeaders } = await headersFor("user", "-2");

      const missing = await cancel(app, userHeaders, randomUUID());
      expect(missing.status).toBe(404);
      expect((await missing.json()) as { error: string }).toEqual({
        error: "not found",
      });

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );

      const notOwner = await cancel(app, otherHeaders, generationId);
      expect(notOwner.status).toBe(404);
      expect((await notOwner.json()) as { error: string }).toEqual({
        error: "not found",
      });

      // The stranger's attempt changed nothing.
      expect((await stateOf(generationId)).state).toBe("queued");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("the other Generations of the same Submission stay under way", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId, submissionId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      const siblingId = await insertRunningSibling(generationId);

      const res = await cancel(app, userHeaders, generationId);
      expect(res.status).toBe(204);

      const cancelled = await stateOf(generationId);
      expect(cancelled.state).toBe("cancelled");
      expect(cancelled.submissionId).toBe(submissionId);

      // The sibling of the same Submission keeps running, untouched.
      const sibling = await stateOf(siblingId);
      expect(sibling.state).toBe("running");
      expect(sibling.submissionId).toBe(submissionId);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
