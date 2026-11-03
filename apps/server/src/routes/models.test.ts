// `/api/models/:slug` (the Workbench) and `/:slug/generations` (submit,
// live stream via SSE) — issue #43.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
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
    LOG_RETENTION_DAYS: 30,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  // A file the fake Backend lists: enabling checks a fixed loader file is there (issue #50).
  "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "2": { class_type: "KSampler", inputs: { seed: 0, model: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

// Like `WORKFLOW`, with a second loader (node "4") on the Mode's path —
// node "2" links to it — so a second Upload Input bound there is
// relevant at submit time (issue #190's list thumbnails).
const UPLOAD_WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "2": {
    class_type: "KSampler",
    inputs: { seed: 0, model: ["1", 0], image: ["4", 0] },
  },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
  "4": { class_type: "LoadImage", inputs: { image: "" } },
};

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("/api/models/:slug and :slug/generations", () => {
  const testDb = createTestDatabase("models_workbench_route_test");
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
        googleSub: `sub-${role}`,
        email: `${role}@example.com`,
        name: role,
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

  /** Builds a fully enabled Model with one Mode, attached to a reachable fake Backend. */
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

    // Let the health monitor see the fake Backend as reachable.
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
      modelId: model.id,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
      backendId: backend.id,
    };
  }

  /** Like `buildEnabledModel`, but with a Seed Input bound to node "2"'s `seed` field (issue #47). */
  async function buildEnabledModelWithSeed(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
    max = 1000,
    inputSettings: unknown[] = [],
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX Seeded", workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "Fake2", baseUrl: fakeUrl, auth: "none" }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          inputs: [
            {
              id: "66666666-6666-6666-6666-666666666666",
              kind: "seed",
              group: "settings",
              label: "Seed",
              help: "",
              max,
              bindings: [
                {
                  nodeId: "2",
                  field: "seed",
                  classType: "KSampler",
                  title: null,
                },
              ],
            },
          ],
        }),
      },
    );
    const { record: afterInputs } = (await inputsRes.json()) as {
      record: { version: number };
    };

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        version: afterInputs.version,
        modes: [
          {
            name: "Default",
            description: "",
            outputNodeIds: ["3"],
            inputSettings,
          },
        ],
      }),
    });
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { id: string; version: number; currentRevision: number };
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
      modelId: model.id,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
      revision: afterModes.currentRevision,
      seedInputId: "66666666-6666-6666-6666-666666666666",
    };
  }

  /** Like `buildEnabledModel`, but with a text Input bound to node "1"'s `image` field, standing in for a prompt (issue #47). */
  async function buildEnabledModelWithPrompt(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX Prompt", workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "Fake3", baseUrl: fakeUrl, auth: "none" }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const promptInputId = "77777777-7777-7777-7777-777777777777";
    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          inputs: [
            {
              id: promptInputId,
              kind: "text",
              group: "describe",
              label: "Prompt",
              help: "",
              default: "",
              multiline: true,
              maxLength: 2000,
              bindings: [
                {
                  nodeId: "1",
                  field: "image",
                  classType: "LoadImage",
                  title: null,
                },
              ],
            },
          ],
        }),
      },
    );
    const { record: afterInputs } = (await inputsRes.json()) as {
      record: { version: number };
    };

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        version: afterInputs.version,
        modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      }),
    });
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { id: string; version: number; currentRevision: number };
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
      modelId: model.id,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
      revision: afterModes.currentRevision,
      promptInputId,
    };
  }

  /** Like `buildEnabledModel`, but with two image Upload Inputs, each bound to one of the two loaders on the Mode's path (issue #190's list thumbnails). */
  async function buildEnabledModelWithUploads(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX Uploads", workflow: UPLOAD_WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "Fake4", baseUrl: fakeUrl, auth: "none" }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const inputA = "66666666-6666-4666-8666-666666666666";
    const inputB = "55555555-5555-4555-8555-555555555555";
    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          inputs: [
            {
              id: inputA,
              kind: "image_upload",
              group: "describe",
              label: "Photo",
              help: "",
              maxSizeMb: 5,
              maxLongSide: 300,
              bindings: [
                {
                  nodeId: "1",
                  field: "image",
                  classType: "LoadImage",
                  title: null,
                },
              ],
            },
            {
              id: inputB,
              kind: "image_upload",
              group: "describe",
              label: "Second photo",
              help: "",
              maxSizeMb: 5,
              maxLongSide: 300,
              bindings: [
                {
                  nodeId: "4",
                  field: "image",
                  classType: "LoadImage",
                  title: null,
                },
              ],
            },
          ],
        }),
      },
    );
    const { record: afterInputs } = (await inputsRes.json()) as {
      record: { version: number };
    };

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        version: afterInputs.version,
        modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      }),
    });
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { id: string; version: number; currentRevision: number };
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
      modelId: model.id,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
      revision: afterModes.currentRevision,
      inputA,
      inputB,
    };
  }

  test("GET /api/models lists enabled Models without a session (issue #65)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      await buildEnabledModel(app, adminHeaders, fake.url);

      const res = await app.request("/api/models", {
        headers: SAME_ORIGIN_HEADERS,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        models: Array<{ name: string }>;
      };
      expect(body.models.map((model) => model.name)).toEqual(["LTX"]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("404s a Model that doesn't exist or isn't enabled", async () => {
    const { app, backendsService } = await build();
    const { headers } = await headersFor("user");

    const res = await app.request("/api/models/ghost", { headers });
    expect(res.status).toBe(404);

    backendsService.stop();
  });

  test("serves the Workbench's name, description and Modes for an enabled Model", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}`, {
        headers: userHeaders,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        model: {
          name: string;
          modes: Array<{
            id: string;
            name: string;
            description: string;
            inputs: unknown[];
            menuGroup: string;
            hasSeed: boolean;
          }>;
        };
      };
      expect(body.model.name).toBe("LTX");
      expect(body.model.modes).toEqual([
        {
          id: modeId,
          name: "Default",
          description: "",
          inputs: [],
          menuGroup: "prompt",
          hasSeed: false,
        },
      ]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("submits a Generation, freezing its prompt with the filename_prefix stamped", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders, userId } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        generations: Array<{ id: string; state: string; userId: string }>;
      };
      expect(body.generations.length).toBe(1);
      const generation = body.generations[0] as {
        id: string;
        state: string;
        userId: string;
      };
      expect(generation.state).toBe("queued");
      expect(generation.userId).toBe(userId);

      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generation.id));
      expect(row?.nodeTypes.sort()).toEqual([
        "KSampler",
        "LoadImage",
        "SaveImage",
      ]);
      const prompt = row?.builtPrompt as Record<
        string,
        { inputs: Record<string, unknown> }
      >;
      expect(prompt["3"]?.inputs.filename_prefix).toBe(
        `studio/${generation.id}/`,
      );

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("refuses a submit with 503 paused while generating is Paused, and never queues anything", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const pauseRes = await app.request("/api/admin/site-settings/pause", {
        method: "POST",
        headers: adminHeaders,
      });
      expect(pauseRes.status).toBe(200);

      const { headers: userHeaders } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("paused");

      const rows = await db.select().from(generations);
      expect(rows).toHaveLength(0);

      const resumeRes = await app.request("/api/admin/site-settings/resume", {
        method: "POST",
        headers: adminHeaders,
      });
      expect(resumeRes.status).toBe(200);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("refuses a submit with 409 model_changed when the revision is stale", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 1 }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("model_changed");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("refuses a submit with 400 no_backend once its only Backend is detached", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { modelId, slug, modeId, backendId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      // Enabling doesn't require staying attached: detach the Backend
      // without disabling the Model, so a submit now finds none usable.
      await app.request(`/api/admin/models/${modelId}/backends/${backendId}`, {
        method: "DELETE",
        headers: adminHeaders,
      });

      const { headers: userHeaders } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("no_backend");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("refuses a submit holding a blocked word (issue #66), per field, and logs a warning naming the user and the word", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");

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
        body: JSON.stringify({
          name: "Fake",
          baseUrl: fake.url,
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

      const promptInputId = "22222222-2222-2222-2222-222222222222";
      const inputsRes = await app.request(
        `/api/admin/models/${model.id}/inputs`,
        {
          method: "PUT",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            version: model.version,
            inputs: [
              {
                id: promptInputId,
                kind: "text",
                group: "describe",
                label: "Image",
                help: "",
                default: "",
                multiline: false,
                maxLength: 2000,
                bindings: [
                  {
                    nodeId: "1",
                    field: "image",
                    classType: "LoadImage",
                    title: null,
                  },
                ],
              },
            ],
          }),
        },
      );
      const { record: afterInputs } = (await inputsRes.json()) as {
        record: { version: number };
      };

      const modesRes = await app.request(
        `/api/admin/models/${model.id}/modes`,
        {
          method: "PUT",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            version: afterInputs.version,
            modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
          }),
        },
      );
      const { record: afterModes, modes } = (await modesRes.json()) as {
        record: { version: number };
        modes: Array<{ id: string }>;
      };

      await app.request(`/api/admin/models/${model.id}/enable`, {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ version: afterModes.version }),
      });

      await app.request("/api/admin/site-settings/blocked-words", {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ revision: 1, text: "Forbidden" }),
      });

      const { headers: userHeaders, userId } = await headersFor("user");
      const res = await app.request(`/api/models/${model.slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          modeId: modes[0]?.id,
          revision: afterModes.version,
          values: { [promptInputId]: "a FORBIDDEN cat" },
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: string;
        issues: Array<{ path: string; code: string; message: string }>;
      };
      expect(body.error).toBe("invalid");
      expect(body.issues).toEqual([
        {
          path: promptInputId,
          code: "blocked_word",
          message: "Your prompt contains a blocked word",
        },
      ]);

      const generationRows = await db.select().from(generations);
      expect(generationRows).toHaveLength(0);

      const warnings = (await db.select().from(logEntries)).filter(
        (row) => row.level === "warning",
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.userId).toBe(userId);
      expect(warnings[0]?.details).toBe("forbidden");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("lists this Model's latest Submissions for the signed-in user", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });

      const listRes = await app.request(`/api/models/${slug}/generations`, {
        headers: userHeaders,
      });
      const body = (await listRes.json()) as {
        submissions: Array<{ modeName: string; generations: unknown[] }>;
      };
      expect(body.submissions.length).toBe(1);
      expect(body.submissions[0]?.modeName).toBe("Default");
      expect(body.submissions[0]?.generations.length).toBe(1);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("the Submissions list shows a Submission's used Uploads — in Input order, de-duplicated, a removed one flagged without a thumbnail — and its Assets' shape (issue #190)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId, revision, inputA, inputB } =
        await buildEnabledModelWithUploads(app, adminHeaders, fake.url);

      const { headers: userHeaders, userId } = await headersFor("user");
      const uploadAId = crypto.randomUUID();
      const uploadBId = crypto.randomUUID();
      await db.insert(uploads).values([
        {
          id: uploadAId,
          userId,
          status: "complete",
          originalName: "a.png",
          declaredType: "image/png",
          size: 10,
          storageKey: "uploads/test/a.png",
          kind: "image",
          extension: "png",
          width: 100,
          height: 100,
          thumbnailKey: "uploads/test/a.thumb.png",
          createdAt: clock.now(),
        },
        {
          id: uploadBId,
          userId,
          status: "complete",
          originalName: "b.png",
          declaredType: "image/png",
          size: 10,
          storageKey: "uploads/test/b.png",
          kind: "image",
          extension: "png",
          width: 100,
          height: 100,
          thumbnailKey: "uploads/test/b.thumb.png",
          createdAt: clock.now(),
        },
      ]);

      const submitRes = await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          modeId,
          revision,
          values: { [inputA]: uploadAId, [inputB]: uploadBId },
        }),
      });
      expect(submitRes.status).toBe(201);
      const submitted = (await submitRes.json()) as {
        generations: Array<{ id: string; submissionId: string }>;
      };
      const first = submitted.generations[0];
      if (!first) throw new Error("submit created no Generation");

      const [submittedRow] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, first.id));
      if (!submittedRow) throw new Error("missing Generation");
      // The Submission's own Generation carries the Uploads in the
      // Mode's Input order (issue #50's Set-deduped order).
      expect(submittedRow.uploadIds).toEqual([uploadAId, uploadBId]);

      // A second Generation in the same Submission, using the same
      // Uploads: the list must show each Upload once, in that order.
      await db.insert(generations).values({
        id: crypto.randomUUID(),
        modelId: submittedRow.modelId,
        revisionId: submittedRow.revisionId,
        modeId: submittedRow.modeId,
        userId: submittedRow.userId,
        submissionId: submittedRow.submissionId,
        builtPrompt: submittedRow.builtPrompt,
        nodeTypes: submittedRow.nodeTypes,
        uploadIds: [uploadAId, uploadBId],
        queuedAt: submittedRow.submittedAt,
        submittedAt: submittedRow.submittedAt,
      });

      // An Admin removes Upload B: its list entry stays, flagged, with
      // no thumbnail (its file is gone — issue #68).
      await db
        .update(uploads)
        .set({ removedAt: clock.now(), removedReason: "too large" })
        .where(eq(uploads.id, uploadBId));

      // One Asset, with its media shape (issue #190's Asset fields).
      await db.insert(assets).values({
        generationId: first.id,
        nodeId: "3",
        sortOrder: 0,
        kind: "image",
        comfyuiFilename: "ComfyUI_00001_.png",
        contentType: "image/png",
        size: 123456,
        storageKey: "assets/test/ComfyUI_00001_.png",
        width: 512,
        height: 512,
        durationMs: null,
      });

      const listRes = await app.request(`/api/models/${slug}/generations`, {
        headers: userHeaders,
      });
      expect(listRes.status).toBe(200);
      const body = (await listRes.json()) as {
        hasMore: boolean;
        submissions: Array<{
          prompt: string | null;
          uploads: Array<{
            id: string;
            kind: "image" | "video" | "audio";
            thumbnailKey: string | null;
            removed: boolean;
          }>;
          generations: Array<{
            id: string;
            assets: Array<{
              size: number;
              width: number | null;
              height: number | null;
              durationMs: number | null;
            }>;
          }>;
        }>;
      };
      expect(body.submissions).toHaveLength(1);
      expect(body.hasMore).toBe(false);
      // No text Input on this Model: nothing to show as a prompt.
      expect(body.submissions[0]?.prompt).toBeNull();
      // Both Generations used both Uploads: each Upload once, Input order.
      expect(body.submissions[0]?.uploads).toEqual([
        {
          id: uploadAId,
          kind: "image",
          thumbnailKey: "uploads/test/a.thumb.png",
          removed: false,
        },
        {
          id: uploadBId,
          kind: "image",
          thumbnailKey: null,
          removed: true,
        },
      ]);
      const assetsEntry = body.submissions[0]?.generations.find(
        (generation) => generation.id === first.id,
      )?.assets[0];
      expect(assetsEntry).toMatchObject({
        kind: "image",
        size: 123456,
        width: 512,
        height: 512,
        durationMs: null,
      });

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("the Submissions list's hasMore is false at exactly 8 Submissions and true at 9 (issue #190)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      const submit = () =>
        app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision: 2 }),
        });

      const emptyRes = await app.request(`/api/models/${slug}/generations`, {
        headers: userHeaders,
      });
      const emptyBody = (await emptyRes.json()) as {
        submissions: unknown[];
        hasMore: boolean;
      };
      expect(emptyBody.submissions).toEqual([]);
      expect(emptyBody.hasMore).toBe(false);

      for (let i = 0; i < 8; i++) {
        const res = await submit();
        expect(res.status).toBe(201);
        // Settle the dispatched job (the fake finishes it in real time;
        // the runner polls on the fake clock) so the per-user
        // concurrent cap of 4 is back to 0 before the next submit.
        clock.advance(1_000);
        await flushMicrotasks();
        clock.advance(1_000);
        await flushMicrotasks();
      }

      const listRes = await app.request(`/api/models/${slug}/generations`, {
        headers: userHeaders,
      });
      const listBody = (await listRes.json()) as {
        submissions: Array<{ submissionId: string }>;
        hasMore: boolean;
      };
      // Exactly 8: the list holds the route's whole page, no older one.
      expect(listBody.submissions).toHaveLength(8);
      expect(listBody.hasMore).toBe(false);

      const ninth = await submit();
      expect(ninth.status).toBe(201);
      clock.advance(1_000);
      await flushMicrotasks();
      clock.advance(1_000);
      await flushMicrotasks();
      const listMore = await app.request(`/api/models/${slug}/generations`, {
        headers: userHeaders,
      });
      const moreBody = (await listMore.json()) as {
        submissions: Array<{ submissionId: string }>;
        hasMore: boolean;
      };
      expect(moreBody.submissions).toHaveLength(8);
      expect(moreBody.hasMore).toBe(true);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("streams a snapshot, then a change event on submit, over SSE", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      const streamRes = await app.request("/api/generations/stream", {
        headers: userHeaders,
      });
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(streamRes.headers.get("x-accel-buffering")).toBe("no");

      const reader = streamRes.body?.getReader();
      if (!reader) throw new Error("no stream body");
      const decoder = new TextDecoder();

      const firstChunk = await reader.read();
      const firstText = decoder.decode(firstChunk.value);
      expect(firstText).toContain("event: snapshot");
      expect(firstText).toContain('"generations":[]');

      await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });

      const secondChunk = await reader.read();
      const secondText = decoder.decode(secondChunk.value);
      expect(secondText).toContain("event: change");
      expect(secondText).toContain('"state":"queued"');

      await reader.cancel();
      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("sends a heartbeat every few seconds so the stream stays open", async () => {
    const { app, backendsService } = await build();
    const { headers: userHeaders } = await headersFor("user");

    const streamRes = await app.request("/api/generations/stream", {
      headers: userHeaders,
    });
    const reader = streamRes.body?.getReader();
    if (!reader) throw new Error("no stream body");
    const decoder = new TextDecoder();

    const snapshotChunk = await reader.read();
    expect(decoder.decode(snapshotChunk.value)).toContain("event: snapshot");

    clock.advance(5_000);
    await flushMicrotasks();

    const heartbeatChunk = await reader.read();
    expect(decoder.decode(heartbeatChunk.value)).toContain(": heartbeat");

    await reader.cancel();
    backendsService.stop();
  });

  test("refuses to delete a Model with an unfinished Generation", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { modelId, slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });

      const deleteRes = await app.request(
        `/api/admin/models/${modelId}?version=3`,
        { method: "DELETE", headers: adminHeaders },
      );
      expect(deleteRes.status).toBe(409);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  describe("Seeds and 1-4 variants per Submission (issue #47)", () => {
    test("submits with no Seed Input and ignores an extra count: always 1 Generation", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId } = await buildEnabledModel(
          app,
          adminHeaders,
          fake.url,
        );

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision: 2, count: 4 }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as { generations: Array<unknown> };
        expect(body.generations.length).toBe(1);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("a Seed Input's count creates that many Generations sharing submission_id and submitted_at", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { db } = await testDb;
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision } = await buildEnabledModelWithSeed(
          app,
          adminHeaders,
          fake.url,
        );

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision, count: 3 }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
          generations: Array<{ id: string; submissionId: string }>;
        };
        expect(body.generations.length).toBe(3);
        const submissionIds = new Set(
          body.generations.map((g) => g.submissionId),
        );
        expect(submissionIds.size).toBe(1);

        const rows = await db
          .select()
          .from(generations)
          .where(
            eq(
              generations.submissionId,
              body.generations[0]?.submissionId as string,
            ),
          );
        expect(rows.length).toBe(3);
        const submittedAts = new Set(
          rows.map((r) => r.submittedAt.toISOString()),
        );
        expect(submittedAts.size).toBe(1);

        // Random seeds drawn below 2^53, consecutive s, s+1, s+2 (ADR 0007).
        const seeds = rows
          .map((r) => {
            const prompt = r.builtPrompt as Record<
              string,
              { inputs: Record<string, unknown> }
            >;
            return prompt["2"]?.inputs.seed as number;
          })
          .sort((a, b) => a - b);
        expect(seeds[1]).toBe((seeds[0] as number) + 1);
        expect(seeds[2]).toBe((seeds[0] as number) + 2);
        expect(seeds[0]).toBeGreaterThanOrEqual(0);
        expect(seeds[2]).toBeLessThan(Number.MAX_SAFE_INTEGER);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("a hidden Seed Input still enables the count picker, and draws+writes a seed per Generation (issue #48 CEO review, reverses round 5)", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { db } = await testDb;
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision } = await buildEnabledModelWithSeed(
          app,
          adminHeaders,
          fake.url,
          1000,
          [
            {
              inputId: "66666666-6666-6666-6666-666666666666",
              state: "hidden",
              fixedValue: null,
              label: "",
            },
          ],
        );

        const { headers: userHeaders } = await headersFor("user");

        // The Workbench isn't shown the hidden Seed Input itself, but is
        // still flagged that this Mode's Path holds one, so it shows the
        // count picker.
        const workbenchRes = await app.request(`/api/models/${slug}`, {
          headers: userHeaders,
        });
        const workbenchBody = (await workbenchRes.json()) as {
          model: { modes: Array<{ inputs: unknown[]; hasSeed: boolean }> };
        };
        expect(workbenchBody.model.modes[0]?.inputs).toEqual([]);
        expect(workbenchBody.model.modes[0]?.hasSeed).toBe(true);

        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision, count: 3 }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
          generations: Array<{ id: string }>;
        };
        // A hidden Seed still draws, so a submitted count of 3 still
        // makes 3 Generations.
        expect(body.generations.length).toBe(3);

        const rows = await db
          .select()
          .from(generations)
          .where(
            eq(
              generations.submissionId,
              (
                await db
                  .select()
                  .from(generations)
                  .where(eq(generations.id, body.generations[0]?.id as string))
              )[0]?.submissionId as string,
            ),
          );
        const seeds = rows
          .map(
            (row) =>
              (
                row.builtPrompt as Record<
                  string,
                  { inputs: Record<string, unknown> }
                >
              )["2"]?.inputs.seed as number,
          )
          .sort((a, b) => a - b);
        // Each drawn, and consecutive (hidden doesn't mean "don't draw":
        // every Generation in the batch still gets its own seed).
        expect(new Set(seeds).size).toBe(3);
        expect(seeds[1]).toBe((seeds[0] as number) + 1);
        expect(seeds[2]).toBe((seeds[0] as number) + 2);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("a user-supplied seed runs s, s+1, ... s+count-1", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { db } = await testDb;
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision, seedInputId } =
          await buildEnabledModelWithSeed(app, adminHeaders, fake.url);

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId,
            revision,
            count: 2,
            values: { [seedInputId]: 500 },
          }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
          generations: Array<{ id: string }>;
        };

        const rows = await db
          .select()
          .from(generations)
          .where(eq(generations.id, body.generations[0]?.id as string));
        const other = await db
          .select()
          .from(generations)
          .where(eq(generations.id, body.generations[1]?.id as string));
        const seedsSeen = [...rows, ...other]
          .map((r) => {
            const prompt = r.builtPrompt as Record<
              string,
              { inputs: Record<string, unknown> }
            >;
            return prompt["2"]?.inputs.seed as number;
          })
          .sort((a, b) => a - b);
        expect(seedsSeen).toEqual([500, 501]);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("refuses a seed where s + count - 1 exceeds the Seed Input's max", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision, seedInputId } =
          await buildEnabledModelWithSeed(app, adminHeaders, fake.url, 10);

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId,
            revision,
            count: 4,
            values: { [seedInputId]: 9 },
          }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("invalid_seed");

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("refuses a null seed as an invalid issue on the seed's own path", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision, seedInputId } =
          await buildEnabledModelWithSeed(app, adminHeaders, fake.url);

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId,
            revision,
            values: { [seedInputId]: null },
          }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: string;
          issues: Array<{ path: string }>;
        };
        expect(body.error).toBe("invalid");
        expect(body.issues.some((issue) => issue.path === seedInputId)).toBe(
          true,
        );

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("refuses a string seed as an invalid issue on the seed's own path", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision, seedInputId } =
          await buildEnabledModelWithSeed(app, adminHeaders, fake.url);

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId,
            revision,
            values: { [seedInputId]: "not a number" },
          }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as {
          error: string;
          issues: Array<{ path: string }>;
        };
        expect(body.error).toBe("invalid");
        expect(body.issues.some((issue) => issue.path === seedInputId)).toBe(
          true,
        );

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("refuses a count outside 1-4", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision } = await buildEnabledModelWithSeed(
          app,
          adminHeaders,
          fake.url,
        );

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision, count: 5 }),
        });
        expect(res.status).toBe(400);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("the Submissions list shows a custom prompt as-is, and a blank one as a default", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision, promptInputId } =
          await buildEnabledModelWithPrompt(app, adminHeaders, fake.url);

        const { headers: userHeaders } = await headersFor("user");
        await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId,
            revision,
            values: { [promptInputId]: "a custom prompt" },
          }),
        });

        const listRes = await app.request(`/api/models/${slug}/generations`, {
          headers: userHeaders,
        });
        const body = (await listRes.json()) as {
          submissions: Array<{ prompt: string | null }>;
        };
        expect(body.submissions[0]?.prompt).toBe("a custom prompt");

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("a blank prompt shows the Workflow's own value, prefixed", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { slug, modeId, revision } = await buildEnabledModelWithPrompt(
          app,
          adminHeaders,
          fake.url,
        );

        const { headers: userHeaders } = await headersFor("user");
        await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision }),
        });

        const listRes = await app.request(`/api/models/${slug}/generations`, {
          headers: userHeaders,
        });
        const body = (await listRes.json()) as {
          submissions: Array<{ prompt: string | null }>;
        };
        expect(body.submissions[0]?.prompt).toBe("Default prompt: example.png");

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });
  });

  describe("Model terms and Attribution (issue #61)", () => {
    async function setTerms(
      app: Awaited<ReturnType<typeof build>>["app"],
      adminHeaders: Record<string, string>,
      modelId: string,
      overrides: Partial<{
        termsBody: string;
        licenseUrl: string;
        attribution: string;
        askAgain: boolean;
      }> = {},
    ) {
      const getRes = await app.request(`/api/admin/models/${modelId}`, {
        headers: adminHeaders,
      });
      const { model } = (await getRes.json()) as {
        model: { termsRevision: number };
      };
      const res = await app.request(`/api/admin/models/${modelId}/terms`, {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          revision: model.termsRevision,
          termsBody: "Be nice.",
          licenseUrl: "https://example.com/license",
          attribution: "Model by Example Corp",
          askAgain: false,
          ...overrides,
        }),
      });
      return (await res.json()) as { termsVersion: number | null };
    }

    test("the Workbench detail carries terms and Attribution, unaccepted at first", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { modelId, slug } = await buildEnabledModel(
          app,
          adminHeaders,
          fake.url,
        );
        await setTerms(app, adminHeaders, modelId);

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}`, {
          headers: userHeaders,
        });
        const body = (await res.json()) as {
          model: {
            attribution: string;
            terms: {
              version: number;
              body: string;
              licenseUrl: string;
              accepted: boolean;
            } | null;
          };
        };
        expect(body.model.attribution).toBe("Model by Example Corp");
        expect(body.model.terms?.version).toBe(1);
        expect(body.model.terms?.body).toBe("Be nice.");
        expect(body.model.terms?.accepted).toBe(false);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("submitting without accepting gets model_terms_required; queued work stays untouched", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { db } = await testDb;
        const { headers: adminHeaders } = await headersFor("admin");
        const { modelId, slug, modeId } = await buildEnabledModel(
          app,
          adminHeaders,
          fake.url,
        );
        await setTerms(app, adminHeaders, modelId);

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision: 2 }),
        });
        expect(res.status).toBe(409);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("model_terms_required");

        const rows = await db.select().from(generations);
        expect(rows).toEqual([]);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("accepting the current version lets the Generation through; a re-ask gates it again", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { modelId, slug, modeId } = await buildEnabledModel(
          app,
          adminHeaders,
          fake.url,
        );
        await setTerms(app, adminHeaders, modelId);

        const { headers: userHeaders } = await headersFor("user");
        const acceptRes = await app.request(
          `/api/models/${slug}/terms/accept`,
          { method: "POST", headers: userHeaders },
        );
        expect(acceptRes.status).toBe(200);

        const submitRes = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision: 2 }),
        });
        expect(submitRes.status).toBe(201);

        // "Ask everyone to accept again" invalidates that acceptance.
        await setTerms(app, adminHeaders, modelId, { askAgain: true });

        const secondSubmitRes = await app.request(
          `/api/models/${slug}/generations`,
          {
            method: "POST",
            headers: { ...userHeaders, "content-type": "application/json" },
            body: JSON.stringify({ modeId, revision: 2 }),
          },
        );
        expect(secondSubmitRes.status).toBe(409);
        const body = (await secondSubmitRes.json()) as { error: string };
        expect(body.error).toBe("model_terms_required");

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });
  });
});
