// `PUT /api/admin/models/:id/inputs` (issue #46): validation errors, a new
// revision on success, and the current Modes carried forward unchanged.

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

const TEST_ENV: Env = testEnv(false);

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a cat" },
    _meta: { title: "Prompt" },
  },
  "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
};

const PROMPT_INPUT = {
  id: "11111111-1111-1111-1111-111111111111",
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
      field: "text",
      classType: "CLIPTextEncode",
      title: "Prompt",
    },
  ],
};

describe("PUT /api/admin/models/:id/inputs", () => {
  const testDb = createTestDatabase("admin_models_inputs_route_test");
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

  async function build(env: Env = TEST_ENV) {
    const { db, sql } = await testDb;
    const created = await createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env,
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
        name: "admin",
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
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW }),
    });
    const { model } = (await res.json()) as {
      model: { id: string; version: number };
    };
    return model;
  }

  test("400s a non-UUID Input id", async () => {
    const { app } = await build();
    const headers = await adminHeaders();
    const model = await createModel(app, headers);

    const res = await app.request(`/api/admin/models/${model.id}/inputs`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        inputs: [{ ...PROMPT_INPUT, id: "not-a-uuid" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  test("saves Inputs, bumping the version and revision", async () => {
    const { app } = await build();
    const headers = await adminHeaders();
    const model = await createModel(app, headers);

    const res = await app.request(`/api/admin/models/${model.id}/inputs`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ version: model.version, inputs: [PROMPT_INPUT] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      record: { version: number; currentRevision: number };
      inputs: Array<{ label: string }>;
    };
    expect(body.record.version).toBe(2);
    expect(body.record.currentRevision).toBe(2);
    expect(body.inputs[0]?.label).toBe("Prompt");
  });

  test("saves a Points Input bound to a video Input and Width/Height fields (issue #52)", async () => {
    const { app } = await build();
    const headers = await adminHeaders();

    const pointsWorkflow = {
      "1": { class_type: "VHS_LoadVideo", inputs: { video: "example.mp4" } },
      "2": {
        class_type: "EmptyLatentImage",
        inputs: { width: 512, height: 512 },
      },
      "3": { class_type: "PointsEditor", inputs: { points: "" } },
      "4": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
    };
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "Points model", workflow: pointsWorkflow }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; version: number };
    };

    const videoInput = {
      id: "22222222-2222-2222-2222-222222222222",
      kind: "video_upload",
      group: "describe",
      label: "Clip",
      help: "",
      maxSizeMb: 50,
      maxLongSide: null,
      minDurationMs: 0,
      maxDurationMs: 10_000,
      trimmable: true,
      bindings: [
        {
          nodeId: "1",
          field: "video",
          classType: "VHS_LoadVideo",
          title: null,
        },
      ],
    };
    const pointsInput = {
      id: "33333333-3333-3333-3333-333333333333",
      kind: "points",
      group: "describe",
      label: "Who to replace",
      help: "",
      videoInputId: videoInput.id,
      widthField: { nodeId: "2", field: "width" },
      heightField: { nodeId: "2", field: "height" },
      bindings: [
        {
          nodeId: "3",
          field: "points",
          classType: "PointsEditor",
          title: null,
        },
      ],
    };

    const res = await app.request(`/api/admin/models/${model.id}/inputs`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        inputs: [videoInput, pointsInput],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inputs: Array<{ kind: string; label: string }>;
    };
    expect(body.inputs.map((i) => i.kind)).toEqual(["video_upload", "points"]);
    expect(body.inputs[1]?.label).toBe("Who to replace");
  });

  test("carries the current Modes forward unchanged onto the new revision", async () => {
    const { app } = await build();
    const headers = await adminHeaders();
    const model = await createModel(app, headers);

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        modes: [{ name: "Default", description: "", outputNodeIds: ["2"] }],
      }),
    });
    const { record: afterModes } = (await modesRes.json()) as {
      record: { version: number };
    };

    await app.request(`/api/admin/models/${model.id}/inputs`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: afterModes.version,
        inputs: [PROMPT_INPUT],
      }),
    });

    const getRes = await app.request(`/api/admin/models/${model.id}`, {
      headers,
    });
    const detail = (await getRes.json()) as {
      modes: Array<{ name: string }>;
    };
    expect(detail.modes).toHaveLength(1);
    expect(detail.modes[0]?.name).toBe("Default");
  });

  test("saves a select Input bound to a V3-form COMBO field (issue #46)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build(testEnv(true));
      const headers = await adminHeaders();

      const modelRes = await app.request("/api/admin/models", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          name: "LTXV",
          workflow: {
            "1": {
              class_type: "LTXVConditioning",
              inputs: { frame_rate_option: "24" },
            },
            "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
          },
        }),
      });
      const { model } = (await modelRes.json()) as {
        model: { id: string; version: number };
      };

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
      await app.request(`/api/admin/models/${model.id}/backends`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ backendId: backend.id }),
      });

      const frameRateInput = {
        id: "22222222-2222-2222-2222-222222222222",
        kind: "select",
        group: "settings",
        label: "Frame rate",
        help: "",
        default: null,
        options: [
          {
            id: "33333333-3333-3333-3333-333333333333",
            label: "24 fps",
            values: ["24"],
          },
          {
            id: "44444444-4444-4444-4444-444444444444",
            label: "30 fps",
            values: ["30"],
          },
        ],
        bindings: [
          {
            nodeId: "1",
            field: "frame_rate_option",
            classType: "LTXVConditioning",
            title: null,
          },
        ],
      };

      const res = await app.request(`/api/admin/models/${model.id}/inputs`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          inputs: [frameRateInput],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        inputs: Array<{ label: string }>;
      };
      expect(body.inputs[0]?.label).toBe("Frame rate");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
