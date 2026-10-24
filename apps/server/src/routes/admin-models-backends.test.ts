// `/api/admin/models/:id/backends`: attach/detach, and the missing node
// types each attached, reachable Backend lacks (issue #41).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  backends,
  modelBackends,
  modelRevisions,
  models,
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

function testEnv(backendsEnabled: boolean): Env {
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
    BACKENDS_ENABLED: backendsEnabled,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    MAX_UPLOAD_MB: 500,
    FFMPEG_CONCURRENCY: 2,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW_NEEDING_UPSCALE = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": { class_type: "ImageUpscaleWithModel", inputs: { image: ["1", 0] } },
};

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("/api/admin/models/:id/backends", () => {
  const testDb = createTestDatabase("admin_models_backends_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(modelBackends);
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
    await db.delete(backends);
    await db.delete(users);
  });

  async function build(backendsEnabled = true) {
    const { db, sql } = await testDb;
    const created = await createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env: testEnv(backendsEnabled),
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
    return created;
  }

  async function adminHeaders() {
    const { db } = await testDb;
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

  async function createModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    headers: Record<string, string>,
  ) {
    const res = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "M1", workflow: WORKFLOW_NEEDING_UPSCALE }),
    });
    const body = (await res.json()) as { model: { id: string } };
    return body.model.id;
  }

  test("attaches and detaches a Backend, many-to-many", async () => {
    const { app, backendsService } = await build(false);
    const headers = await adminHeaders();
    const modelId = await createModel(app, headers);

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "B1",
        baseUrl: "http://localhost:1",
        auth: "none",
      }),
    });
    const backend = (await backendRes.json()) as { id: string };

    const attachRes = await app.request(
      `/api/admin/models/${modelId}/backends`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ backendId: backend.id }),
      },
    );
    expect(attachRes.status).toBe(204);

    const listRes = await app.request(`/api/admin/models/${modelId}/backends`, {
      headers,
    });
    const listBody = (await listRes.json()) as {
      backends: { backend: { id: string }; reachable: boolean }[];
    };
    expect(listBody.backends.map((b) => b.backend.id)).toEqual([backend.id]);
    expect(listBody.backends[0]?.reachable).toBe(false);

    const detachRes = await app.request(
      `/api/admin/models/${modelId}/backends/${backend.id}`,
      { method: "DELETE", headers },
    );
    expect(detachRes.status).toBe(204);

    const afterDetach = await app.request(
      `/api/admin/models/${modelId}/backends`,
      { headers },
    );
    const afterDetachBody = (await afterDetach.json()) as {
      backends: unknown[];
    };
    expect(afterDetachBody.backends).toEqual([]);

    backendsService.stop();
  });

  test("lists missing node types for a reachable Backend, and skips an unreachable one with a note", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build(true);
      const headers = await adminHeaders();
      const modelId = await createModel(app, headers);

      const backendRes = await app.request("/api/admin/backends", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Fake",
          baseUrl: fake.url,
          auth: "none",
        }),
      });
      const backend = (await backendRes.json()) as { id: string };

      await app.request(`/api/admin/models/${modelId}/backends`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ backendId: backend.id }),
      });

      // The health monitor hasn't polled yet, so this reachable Backend
      // still starts out skipped with a note.
      const beforePoll = await app.request(
        `/api/admin/models/${modelId}/backends`,
        { headers },
      );
      const beforePollBody = (await beforePoll.json()) as {
        backends: { reachable: boolean; note: string | null }[];
      };
      expect(beforePollBody.backends[0]?.reachable).toBe(false);
      expect(beforePollBody.backends[0]?.note).not.toBeNull();

      // Fire the monitor's scheduled poll (every 30s) and let the
      // underlying fetch resolve.
      clock.advance(30_000);
      await flushMicrotasks();
      expect(backendsService.healthFor(backend.id).reachability).toBe(
        "reachable",
      );

      const afterPoll = await app.request(
        `/api/admin/models/${modelId}/backends`,
        { headers },
      );
      const afterPollBody = (await afterPoll.json()) as {
        backends: {
          reachable: boolean;
          missingNodeTypes: string[] | null;
          note: string | null;
        }[];
      };
      expect(afterPollBody.backends[0]?.reachable).toBe(true);
      expect(afterPollBody.backends[0]?.note).toBeNull();
      expect(afterPollBody.backends[0]?.missingNodeTypes).toEqual([
        "ImageUpscaleWithModel",
      ]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("refuses to attach a Backend that doesn't exist", async () => {
    const { app, backendsService } = await build(false);
    const headers = await adminHeaders();
    const modelId = await createModel(app, headers);

    const res = await app.request(`/api/admin/models/${modelId}/backends`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        backendId: "00000000-0000-0000-0000-000000000000",
      }),
    });
    expect(res.status).toBe(404);
    backendsService.stop();
  });
});
