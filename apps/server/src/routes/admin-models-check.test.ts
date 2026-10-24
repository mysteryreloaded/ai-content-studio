// checkModel's rail (issue #49): an enabled Model with errors can only be
// saved by disabling it, and the editor's object-info endpoint surfaces
// each attached Backend's /object_info knowledge for the live rail.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
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
    DATA_DIR: "/tmp/ai-content-studio-test-data",
    SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    BACKENDS_ENABLED: true,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    FFMPEG_CONCURRENCY: 2,
    MAX_UPLOAD_MB: 500,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0], steps: 20 } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
  // No reachable Backend reports this class type (issue #49: "a Mode no
  // attached Backend can run").
  "4": { class_type: "FancyCustomSaver", inputs: { images: ["2", 0] } },
};

describe("checkModel's save gate and object-info route (issue #49)", () => {
  const testDb = createTestDatabase("admin_models_check_route_test");
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

  async function adminHeaders() {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: "sub-admin",
        email: "admin@example.com",
        name: "admin",
        role: "admin",
        status: "active",
      })
      .returning();
    if (!user) throw new Error("failed to insert user");
    const session = await createSession(db, clock, user.id);
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
    };
  }

  async function flushMicrotasks() {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  /** An enabled Model with one Mode ("3", runnable) and one attached, reachable Backend. */
  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    fakeUrl: string,
  ) {
    const headers = await adminHeaders();

    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Fake", baseUrl: fakeUrl, auth: "none" }),
    });
    const backend = (await backendRes.json()) as { id: string };
    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });
    clock.advance(30_000);
    await flushMicrotasks();

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        modes: [
          {
            name: "Default",
            description: "",
            outputNodeIds: ["3"],
            inputSettings: [],
          },
        ],
      }),
    });
    expect(modesRes.status).toBe(200);
    const { record: afterModes } = (await modesRes.json()) as {
      record: { version: number };
    };

    const enableRes = await app.request(
      `/api/admin/models/${model.id}/enable`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ version: afterModes.version }),
      },
    );
    expect(enableRes.status).toBe(200);
    const enabled = (await enableRes.json()) as { version: number };

    return { model, headers, version: enabled.version, backendId: backend.id };
  }

  test("GET /:id/object-info reports a Backend's node types, field specs and reachability", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { model, headers } = await buildEnabledModel(app, fake.url);

      const res = await app.request(
        `/api/admin/models/${model.id}/object-info`,
        {
          headers,
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        backends: Array<{
          name: string;
          enabled: boolean;
          reachable: boolean;
          nodeTypes: string[];
          fieldSpecs: Record<string, unknown>;
          nodePacks: Record<string, string>;
        }>;
      };
      expect(body.backends).toHaveLength(1);
      const backend = body.backends[0];
      expect(backend?.name).toBe("Fake");
      expect(backend?.enabled).toBe(true);
      expect(backend?.reachable).toBe(true);
      expect(backend?.nodeTypes).toContain("KSampler");
      expect(backend?.fieldSpecs.KSampler).toBeDefined();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("PUT /:id/modes 400s when saving the enabled Model would leave it with errors", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { model, headers, version } = await buildEnabledModel(
        app,
        fake.url,
      );

      const res = await app.request(`/api/admin/models/${model.id}/modes`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          version,
          modes: [
            {
              name: "Default",
              description: "",
              outputNodeIds: ["3"],
              inputSettings: [],
            },
            {
              name: "Fancy",
              description: "",
              outputNodeIds: ["4"],
              inputSettings: [],
            },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { reasons: string[] };
      expect(body.reasons.some((r) => r.includes("Fancy"))).toBe(true);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("PUT /:id/modes with disable:true saves anyway and disables the Model", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { model, headers, version } = await buildEnabledModel(
        app,
        fake.url,
      );

      const res = await app.request(`/api/admin/models/${model.id}/modes`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          version,
          disable: true,
          modes: [
            {
              name: "Default",
              description: "",
              outputNodeIds: ["3"],
              inputSettings: [],
            },
            {
              name: "Fancy",
              description: "",
              outputNodeIds: ["4"],
              inputSettings: [],
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { record: { state: string } };
      expect(body.record.state).toBe("disabled");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
