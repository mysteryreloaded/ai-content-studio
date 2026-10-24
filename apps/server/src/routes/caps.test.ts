// Caps (issue #53): the daily Cap counts the rolling 24h excluding
// failed Generations, the concurrent Cap counts queued through saving,
// and a Submission that would exceed either is refused whole. Also
// covers the `GET /api/generations/caps` status the Workbench foot
// reads.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  backends,
  generations,
  modelBackends,
  modelRevisions,
  models,
  siteSettings,
  users,
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
    DATA_DIR: "/tmp/ai-content-studio-test-data",
    SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    BACKENDS_ENABLED: true,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    MAX_UPLOAD_MB: 500,
    FFMPEG_CONCURRENCY: 2,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a cat" },
    _meta: { title: "Prompt" },
  },
  "2": {
    class_type: "KSampler",
    inputs: { steps: 20, cfg: 8, model: ["1", 0] },
  },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

describe("Caps (issue #53)", () => {
  const testDb = createTestDatabase("caps_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(generations);
    await db.delete(modelBackends);
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(backends);
    await db.delete(users);
    await db
      .update(siteSettings)
      .set({ dailyCap: 20, concurrentCap: 4, capsRevision: 1 });
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

  async function headersFor(
    role: "admin" | "user",
    overrides: {
      dailyCapOverride?: number | null;
      concurrentCapOverride?: number | null;
    } = {},
  ) {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: `sub-${role}-${crypto.randomUUID()}`,
        email: `${role}@example.com`,
        name: role,
        role,
        status: "active",
        dailyCapOverride: overrides.dailyCapOverride ?? null,
        concurrentCapOverride: overrides.concurrentCapOverride ?? null,
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

  /** Builds and enables one Model with a single Mode and no Inputs, ready to submit against. */
  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "Fake", baseUrl: fakeUrl, auth: "none" }),
    });
    const backend = (await backendRes.json()) as { id: string };
    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });
    // Lets backendsService's monitor poll the fake ComfyUI server once,
    // so it's reachable by the time `/enable` checks readiness.
    clock.advance(30_000);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      }),
    });
    const { record: afterModes } = (await modesRes.json()) as {
      record: { version: number };
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
    const modesListRes = await app.request(`/api/models/${model.slug}`, {
      headers: adminHeaders,
    });
    const { model: workbenchModel } = (await modesListRes.json()) as {
      model: { revision: number; modes: Array<{ id: string }> };
    };
    const modeId = workbenchModel.modes[0]?.id;
    if (!modeId) throw new Error("mode not found");

    return { slug: model.slug, modeId, revision: workbenchModel.revision };
  }

  async function submit(
    app: Awaited<ReturnType<typeof build>>["app"],
    headers: Record<string, string>,
    slug: string,
    modeId: string,
    revision: number,
  ) {
    return app.request(`/api/models/${slug}/generations`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ modeId, revision, values: {} }),
    });
  }

  test("the daily Cap refuses a Submission that would exceed it, leaving the count unchanged", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    const { app, backendsService } = await build();
    try {
      const { db } = await testDb;
      const adminHeaders = (await headersFor("admin")).headers;
      const { headers: userHeaders, userId } = await headersFor("user", {
        dailyCapOverride: 2,
      });

      const { slug, modeId, revision } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const first = await submit(app, userHeaders, slug, modeId, revision);
      expect(first.status).toBe(201);
      const second = await submit(app, userHeaders, slug, modeId, revision);
      expect(second.status).toBe(201);

      const third = await submit(app, userHeaders, slug, modeId, revision);
      expect(third.status).toBe(409);
      const body = (await third.json()) as {
        error: string;
        cap: number;
        remaining: number;
      };
      expect(body.error).toBe("daily_cap_exceeded");
      expect(body.cap).toBe(2);
      expect(body.remaining).toBe(0);

      const rows = await db
        .select()
        .from(generations)
        .where(eq(generations.userId, userId));
      expect(rows.length).toBe(2);
    } finally {
      backendsService.stop();
      fake.stop();
    }
  });

  test("the concurrent Cap refuses a Submission while enough Generations are still unfinished", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    const { app, backendsService } = await build();
    try {
      const adminHeaders = (await headersFor("admin")).headers;
      const { headers: userHeaders } = await headersFor("user", {
        concurrentCapOverride: 1,
      });

      const { slug, modeId, revision } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const first = await submit(app, userHeaders, slug, modeId, revision);
      expect(first.status).toBe(201);

      const second = await submit(app, userHeaders, slug, modeId, revision);
      expect(second.status).toBe(409);
      const body = (await second.json()) as { error: string };
      expect(body.error).toBe("concurrent_cap_exceeded");
    } finally {
      backendsService.stop();
      fake.stop();
    }
  });

  test("a 0 override blocks a user from generating at all", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    const { app, backendsService } = await build();
    try {
      const adminHeaders = (await headersFor("admin")).headers;
      const { headers: userHeaders } = await headersFor("user", {
        dailyCapOverride: 0,
      });

      const { slug, modeId, revision } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const res = await submit(app, userHeaders, slug, modeId, revision);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("daily_cap_exceeded");
    } finally {
      backendsService.stop();
      fake.stop();
    }
  });

  test("GET /api/generations/caps reports the Site defaults and current usage", async () => {
    const { app, backendsService } = await build();
    try {
      const { headers } = await headersFor("user");

      const res = await app.request("/api/generations/caps", { headers });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        dailyCap: number;
        dailyUsed: number;
        concurrentCap: number;
        concurrentUsed: number;
        oldestCountedSubmittedAt: string | null;
      };
      expect(body.dailyCap).toBe(20);
      expect(body.dailyUsed).toBe(0);
      expect(body.concurrentCap).toBe(4);
      expect(body.concurrentUsed).toBe(0);
      expect(body.oldestCountedSubmittedAt).toBeNull();
    } finally {
      backendsService.stop();
    }
  });

  test("a failed Generation doesn't count toward the daily Cap", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    const { app, backendsService } = await build();
    try {
      const { db } = await testDb;
      const adminHeaders = (await headersFor("admin")).headers;
      const { headers: userHeaders } = await headersFor("user");

      const { slug, modeId, revision } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const submitRes = await submit(app, userHeaders, slug, modeId, revision);
      expect(submitRes.status).toBe(201);
      const { generations: created } = (await submitRes.json()) as {
        generations: Array<{ id: string }>;
      };
      const generationId = created[0]?.id as string;
      await db
        .update(generations)
        .set({ state: "failed" })
        .where(eq(generations.id, generationId));

      const res = await app.request("/api/generations/caps", {
        headers: userHeaders,
      });
      const body = (await res.json()) as {
        dailyUsed: number;
        concurrentUsed: number;
      };
      expect(body.dailyUsed).toBe(0);
      expect(body.concurrentUsed).toBe(0);
    } finally {
      backendsService.stop();
      fake.stop();
    }
  });

  test("cancelling a Generation frees its concurrent slot, so a submit at the Cap succeeds again (issue #54)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    const { app, backendsService } = await build();
    try {
      const adminHeaders = (await headersFor("admin")).headers;
      const { headers: userHeaders } = await headersFor("user", {
        concurrentCapOverride: 1,
      });

      const { slug, modeId, revision } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const first = await submit(app, userHeaders, slug, modeId, revision);
      expect(first.status).toBe(201);
      const { generations: created } = (await first.json()) as {
        generations: Array<{ submissionId: string }>;
      };
      const submissionId = created[0]?.submissionId as string;

      const atCap = await submit(app, userHeaders, slug, modeId, revision);
      expect(atCap.status).toBe(409);

      const cancelRes = await app.request(
        `/api/submissions/${submissionId}/cancel`,
        { method: "POST", headers: userHeaders },
      );
      expect(cancelRes.status).toBe(200);

      const afterCancel = await submit(
        app,
        userHeaders,
        slug,
        modeId,
        revision,
      );
      expect(afterCancel.status).toBe(201);
    } finally {
      backendsService.stop();
      fake.stop();
    }
  });

  test("the daily Cap skips a Generation cancelled while still queued, but counts one cancelled after it started running (issue #54, ADR 0009)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    const { app, backendsService } = await build();
    try {
      const { db } = await testDb;
      const adminHeaders = (await headersFor("admin")).headers;
      const { headers: userHeaders } = await headersFor("user");

      const { slug, modeId, revision } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const cancelledQueued = await submit(
        app,
        userHeaders,
        slug,
        modeId,
        revision,
      );
      const { generations: queuedGen } = (await cancelledQueued.json()) as {
        generations: Array<{ id: string }>;
      };
      await db
        .update(generations)
        .set({ state: "cancelled", tries: 0 })
        .where(eq(generations.id, queuedGen[0]?.id as string));

      const cancelledRunning = await submit(
        app,
        userHeaders,
        slug,
        modeId,
        revision,
      );
      const { generations: runningGen } = (await cancelledRunning.json()) as {
        generations: Array<{ id: string }>;
      };
      await db
        .update(generations)
        .set({ state: "cancelled", tries: 1 })
        .where(eq(generations.id, runningGen[0]?.id as string));

      const res = await app.request("/api/generations/caps", {
        headers: userHeaders,
      });
      const body = (await res.json()) as { dailyUsed: number };
      expect(body.dailyUsed).toBe(1);
    } finally {
      backendsService.stop();
      fake.stop();
    }
  });
});
