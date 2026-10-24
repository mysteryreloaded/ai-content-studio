// The Mode × Input grid's effect on the Workbench and submit (issue #48):
// a hidden Input never reaches the Workbench, a fixed Input's value is
// written regardless of what's submitted, a required Input's absence is
// a 400, and a Mode-specific label overrides the Input's own.

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
  "1": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a cat" },
    _meta: { title: "Prompt" },
  },
  "2": {
    class_type: "KSampler",
    inputs: { steps: 20, model: ["1", 0] },
  },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

const PROMPT_ID = "11111111-1111-1111-1111-111111111111";
const STEPS_ID = "22222222-2222-2222-2222-222222222222";

const INPUTS = [
  {
    id: PROMPT_ID,
    kind: "text",
    group: "describe",
    label: "Prompt",
    help: "",
    default: "",
    multiline: false,
    maxLength: 2000,
    bindings: [
      { nodeId: "1", field: "text", classType: "CLIPTextEncode", title: null },
    ],
  },
  {
    id: STEPS_ID,
    kind: "number",
    group: "settings",
    label: "Steps",
    help: "",
    default: null,
    numberMode: "integer",
    min: 1,
    max: 50,
    step: 1,
    bindings: [
      { nodeId: "2", field: "steps", classType: "KSampler", title: null },
    ],
  },
];

describe("Mode × Input grid effects (issue #48)", () => {
  const testDb = createTestDatabase("mode_input_settings_route_test");
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
      ...SAME_ORIGIN_HEADERS,
      Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
    };
  }

  async function flushMicrotasks() {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  /** Builds an enabled Model with Prompt (text) and Steps (number) Inputs, a Mode naming `inputSettings`. */
  async function buildModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    fakeUrl: string,
    inputSettings: unknown[],
  ) {
    const adminHeaders = await headersFor("admin");

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
    clock.advance(30_000);
    await flushMicrotasks();

    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ version: model.version, inputs: INPUTS }),
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
    expect(modesRes.status).toBe(200);
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { version: number };
      modes: Array<{ id: string }>;
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
    const enabled = (await enableRes.json()) as { currentRevision: number };

    return {
      model,
      modeId: modes[0]?.id as string,
      revision: enabled.currentRevision,
    };
  }

  test("a hidden Input never reaches the Workbench", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { model } = await buildModel(app, fake.url, [
        { inputId: STEPS_ID, state: "hidden", fixedValue: null, label: "" },
      ]);

      const userHeaders = await headersFor("user");
      const res = await app.request(`/api/models/${model.slug}`, {
        headers: userHeaders,
      });
      const body = (await res.json()) as {
        model: { modes: Array<{ inputs: Array<{ id: string }> }> };
      };
      const inputIds = body.model.modes[0]?.inputs.map((i) => i.id) ?? [];
      expect(inputIds).toEqual([PROMPT_ID]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a hidden Input's own default isn't written; the Workflow's own value stands (issue #48)", async () => {
    // STEPS_ID has no default, so this bug (buildPrompt applying a
    // hidden Input's default rather than leaving the field alone)
    // can't show through it; a dedicated Input/Workflow with a
    // non-blank default is needed to catch a regression here.
    const HIDDEN_WORKFLOW = {
      "1": {
        class_type: "CLIPTextEncode",
        inputs: { text: "a cat", seed: 7 },
        _meta: { title: "Prompt" },
      },
      "2": { class_type: "KSampler", inputs: { steps: 20, model: ["1", 0] } },
      "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
    };
    const SEED_ID = "33333333-3333-3333-3333-333333333333";
    const HIDDEN_INPUTS = [
      INPUTS[0],
      {
        id: SEED_ID,
        kind: "number",
        group: "settings",
        label: "Seed",
        help: "",
        default: 999,
        numberMode: "integer",
        min: 0,
        max: 1000,
        step: 1,
        bindings: [
          {
            nodeId: "1",
            field: "seed",
            classType: "CLIPTextEncode",
            title: null,
          },
        ],
      },
    ];

    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const adminHeaders = await headersFor("admin");

      const createRes = await app.request("/api/admin/models", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ name: "LTX", workflow: HIDDEN_WORKFLOW }),
      });
      const { model } = (await createRes.json()) as {
        model: { id: string; slug: string; version: number };
      };

      const backendRes = await app.request("/api/admin/backends", {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ name: "Fake", baseUrl: fake.url, auth: "none" }),
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
            inputs: HIDDEN_INPUTS,
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
            modes: [
              {
                name: "Default",
                description: "",
                outputNodeIds: ["3"],
                inputSettings: [
                  {
                    inputId: SEED_ID,
                    state: "hidden",
                    fixedValue: null,
                    label: "",
                  },
                ],
              },
            ],
          }),
        },
      );
      const { record: afterModes, modes } = (await modesRes.json()) as {
        record: { version: number };
        modes: Array<{ id: string }>;
      };

      const enableRes = await app.request(
        `/api/admin/models/${model.id}/enable`,
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ version: afterModes.version }),
        },
      );
      const enabled = (await enableRes.json()) as { currentRevision: number };

      const { db } = await testDb;
      const userHeaders = await headersFor("user");
      const res = await app.request(`/api/models/${model.slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          modeId: modes[0]?.id,
          revision: enabled.currentRevision,
          values: { [PROMPT_ID]: "dog" },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        generations: Array<{ id: string }>;
      };
      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, body.generations[0]?.id as string));
      const prompt = row?.builtPrompt as Record<
        string,
        { inputs: Record<string, unknown> }
      >;
      expect(prompt["1"]?.inputs.seed).toBe(7);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a fixed Input's value is written regardless of what's submitted, and doesn't reach the Workbench", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { model, modeId, revision } = await buildModel(app, fake.url, [
        { inputId: STEPS_ID, state: "fixed", fixedValue: 33, label: "" },
      ]);

      const userHeaders = await headersFor("user");

      const workbenchRes = await app.request(`/api/models/${model.slug}`, {
        headers: userHeaders,
      });
      const workbenchBody = (await workbenchRes.json()) as {
        model: { modes: Array<{ inputs: Array<{ id: string }> }> };
      };
      expect(workbenchBody.model.modes[0]?.inputs.map((i) => i.id)).toEqual([
        PROMPT_ID,
      ]);

      const res = await app.request(`/api/models/${model.slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          modeId,
          revision,
          values: { [PROMPT_ID]: "dog" },
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        generations: Array<{ id: string }>;
      };
      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, body.generations[0]?.id as string));
      const prompt = row?.builtPrompt as Record<
        string,
        { inputs: Record<string, unknown> }
      >;
      expect(prompt["2"]?.inputs.steps).toBe(33);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a required Input's absence is a 400", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { model, modeId, revision } = await buildModel(app, fake.url, [
        { inputId: PROMPT_ID, state: "required", fixedValue: null, label: "" },
      ]);

      const userHeaders = await headersFor("user");
      const res = await app.request(`/api/models/${model.slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision, values: {} }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a Mode-specific label overrides the Input's own on the Workbench", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { model } = await buildModel(app, fake.url, [
        {
          inputId: PROMPT_ID,
          state: "optional",
          fixedValue: null,
          label: "Describe the scene",
        },
      ]);

      const userHeaders = await headersFor("user");
      const res = await app.request(`/api/models/${model.slug}`, {
        headers: userHeaders,
      });
      const body = (await res.json()) as {
        model: {
          modes: Array<{ inputs: Array<{ id: string; label: string }> }>;
        };
      };
      expect(body.model.modes[0]?.inputs[0]).toMatchObject({
        id: PROMPT_ID,
        label: "Describe the scene",
      });

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
