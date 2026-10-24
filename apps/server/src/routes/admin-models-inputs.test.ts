// `PUT /api/admin/models/:id/inputs` (issue #46): validation errors, a new
// revision on success, and the current Modes carried forward unchanged.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import { modelRevisions, models, users, workflows } from "../db/schema.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const TEST_ENV: Env = {
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
  BACKENDS_ENABLED: false,
  STATUS_TOKEN: undefined,
  MIN_FREE_DISK_GB: 10,
};

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
    await db.delete(modelRevisions);
    await db.delete(models);
    await db.delete(workflows);
    await db.delete(users);
  });

  async function build() {
    const { db, sql } = await testDb;
    const { app } = await createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env: TEST_ENV,
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
    return app;
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
    app: Awaited<ReturnType<typeof build>>,
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
    const app = await build();
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
    const app = await build();
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

  test("carries the current Modes forward unchanged onto the new revision", async () => {
    const app = await build();
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
});
