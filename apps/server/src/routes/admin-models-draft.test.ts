// `PUT /api/admin/models/:id/draft` (issue #218): the editor header's one
// Save, saving the whole draft (Details, Inputs, Modes, Terms, and an
// optional re-uploaded Workflow) as one revision and one audit entry.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  auditEntries,
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
  MAX_UPLOAD_MB: 500,
  FFMPEG_CONCURRENCY: 2,
  LOG_RETENTION_DAYS: 30,
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

describe("PUT /api/admin/models/:id/draft", () => {
  const testDb = createTestDatabase("admin_models_draft_route_test");
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
    await db.delete(users);
  });

  async function build() {
    const { db, sql } = await testDb;
    return createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env: TEST_ENV,
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
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
      model: {
        id: string;
        version: number;
        name: string;
        slug: string;
        description: string;
        maxRunTimeMinutes: number;
      };
    };
    return model;
  }

  function draftBodyFor(model: {
    version: number;
    name: string;
    slug: string;
    description: string;
    maxRunTimeMinutes: number;
  }) {
    return {
      version: model.version,
      details: {
        name: model.name,
        slug: model.slug,
        description: model.description,
        maxRunTimeMinutes: model.maxRunTimeMinutes,
      },
      terms: {
        termsBody: "",
        licenseUrl: "",
        attribution: "",
        askAgain: false,
      },
      inputs: [PROMPT_INPUT],
      modes: [
        {
          name: "Default",
          description: "",
          outputNodeIds: ["2"],
          inputSettings: [],
        },
      ],
      disable: false,
    };
  }

  test("one Save changing Details, Inputs and Modes makes exactly one revision and one audit entry", async () => {
    const { app } = await build();
    const { db } = await testDb;
    const headers = await adminHeaders();
    const model = await createModel(app, headers);

    const body = draftBodyFor(model);
    body.details.description = "a new description";

    const [revisionsBefore, auditBefore] = await Promise.all([
      db.select().from(modelRevisions),
      db.select().from(auditEntries).where(eq(auditEntries.targetId, model.id)),
    ]);

    const res = await app.request(`/api/admin/models/${model.id}/draft`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as {
      model: { version: number; currentRevision: number; description: string };
      inputs: Array<{ label: string }>;
      modes: Array<{ name: string }>;
    };
    expect(saved.model.version).toBe(2);
    expect(saved.model.currentRevision).toBe(2);
    expect(saved.model.description).toBe("a new description");
    expect(saved.inputs[0]?.label).toBe("Prompt");
    expect(saved.modes[0]?.name).toBe("Default");

    const [revisionsAfter, auditAfter] = await Promise.all([
      db.select().from(modelRevisions),
      db.select().from(auditEntries).where(eq(auditEntries.targetId, model.id)),
    ]);
    expect(revisionsAfter.length).toBe(revisionsBefore.length + 1);
    expect(auditAfter.length).toBe(auditBefore.length + 1);
  });

  test("a stale version 409s and writes nothing", async () => {
    const { app } = await build();
    const { db } = await testDb;
    const headers = await adminHeaders();
    const model = await createModel(app, headers);

    const [revisionsBefore, auditBefore] = await Promise.all([
      db.select().from(modelRevisions),
      db.select().from(auditEntries).where(eq(auditEntries.targetId, model.id)),
    ]);

    const body = draftBodyFor(model);
    body.version = model.version + 1;

    const res = await app.request(`/api/admin/models/${model.id}/draft`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(409);

    const [revisionsAfter, auditAfter] = await Promise.all([
      db.select().from(modelRevisions),
      db.select().from(auditEntries).where(eq(auditEntries.targetId, model.id)),
    ]);
    expect(revisionsAfter.length).toBe(revisionsBefore.length);
    expect(auditAfter.length).toBe(auditBefore.length);
  });

  test("disable: true disables the Model in the same Save", async () => {
    const { app } = await build();
    const headers = await adminHeaders();
    const model = await createModel(app, headers);

    const body = draftBodyFor(model);
    body.disable = true;

    const res = await app.request(`/api/admin/models/${model.id}/draft`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as { model: { state: string } };
    expect(saved.model.state).toBe("disabled");
  });

  test("an invalid Input returns its prefixed issue", async () => {
    const { app } = await build();
    const headers = await adminHeaders();
    const model = await createModel(app, headers);

    const body = draftBodyFor(model);
    body.inputs = [{ ...PROMPT_INPUT, label: "" }];

    const res = await app.request(`/api/admin/models/${model.id}/draft`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const error = (await res.json()) as {
      errors: Array<{ field: string; message: string }>;
    };
    expect(error.errors.some((e) => e.field === "inputs.0")).toBe(true);
  });
});

/**
 * Issue #218 CEO review: `saveDraft` must tolerate a broken Mode
 * output-node ref the same way `PUT /:id/workflow` already does
 * (ADR-0010) — a rebind-left-broken node is a soft `checkModel` issue
 * that only blocks saving an *enabled* Model without `disable`, never
 * a hard `ValidationFailed` from the repository itself. These tests
 * mirror `admin-models-revisions.test.ts`'s "saves a Mode with one
 * rebound and one 'Leave broken' output node" (round-3 CEO review),
 * ported to the one-Save `/draft` endpoint.
 */
describe("PUT /api/admin/models/:id/draft (Workflow re-upload tolerance)", () => {
  const WORKFLOW_TWO_OUTPUTS = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
    "2": { class_type: "KSampler", inputs: { model: ["1", 0], steps: 20 } },
    "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
    "4": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
  };

  /** "3" is renamed "6" (a rebind target); "4" is simply gone, left on "Leave broken" within the very same Mode. */
  const WORKFLOW_TWO_OUTPUTS_MIXED = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
    "2": { class_type: "KSampler", inputs: { model: ["1", 0], steps: 20 } },
    "6": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
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

  const testDb = createTestDatabase("admin_models_draft_workflow_route_test");
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
    const [admin] = await db
      .insert(users)
      .values({
        googleSub: "sub-admin",
        email: "admin@example.com",
        name: "admin",
        role: "admin",
        status: "active",
      })
      .returning();
    if (!admin) throw new Error("failed to insert admin");
    const session = await createSession(db, clock, admin.id);
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
    };
  }

  async function flushMicrotasks() {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const BLANK_TERMS = {
    termsBody: "",
    licenseUrl: "",
    attribution: "",
    askAgain: false,
  };

  /** An enabled Model with one Mode ("3"+"4", runnable) and one attached, reachable Backend. */
  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    fakeUrl: string,
  ) {
    const headers = await adminHeaders();

    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW_TWO_OUTPUTS }),
    });
    const { model } = (await createRes.json()) as {
      model: {
        id: string;
        version: number;
        name: string;
        slug: string;
        description: string;
        maxRunTimeMinutes: number;
      };
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
            outputNodeIds: ["3", "4"],
            inputSettings: [],
          },
        ],
      }),
    });
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

    return { model, headers, version: enabled.version };
  }

  test("a Workflow re-upload with one rebound and one 'Leave broken' output node 400s without disable, and saves one new revision with disable: true", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version } = await buildEnabledModel(
        app,
        fake.url,
      );
      const { db } = await testDb;

      const draftBody = {
        version,
        details: {
          name: model.name,
          slug: model.slug,
          description: model.description,
          maxRunTimeMinutes: model.maxRunTimeMinutes,
        },
        terms: BLANK_TERMS,
        workflow: {
          json: WORKFLOW_TWO_OUTPUTS_MIXED,
          rebind: [{ nodeId: "3", newNodeId: "6" }],
        },
        inputs: [],
        modes: [
          {
            name: "Default",
            description: "",
            outputNodeIds: ["3", "4"],
            inputSettings: [],
          },
        ],
        disable: false,
      };

      const blockedRes = await app.request(
        `/api/admin/models/${model.id}/draft`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(draftBody),
        },
      );
      expect(blockedRes.status).toBe(400);
      const blockedBody = (await blockedRes.json()) as { error: string };
      expect(blockedBody.error).toContain("disable");

      const revisionsBefore = await db.select().from(modelRevisions);

      const savedRes = await app.request(
        `/api/admin/models/${model.id}/draft`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ ...draftBody, disable: true }),
        },
      );
      expect(savedRes.status).toBe(200);
      const saved = (await savedRes.json()) as {
        model: { state: string; currentRevision: number };
        modes: {
          outputNodes: {
            nodeId: string;
            classType: string;
            kind: string | null;
            title: string | null;
          }[];
        }[];
      };
      expect(saved.model.state).toBe("disabled");
      expect(saved.model.currentRevision).toBe(3);
      expect(saved.modes[0]?.outputNodes).toEqual([
        { nodeId: "6", classType: "SaveImage", kind: "image", title: null },
        { nodeId: "4", classType: "SaveImage", kind: "image", title: null },
      ]);

      const revisionsAfter = await db.select().from(modelRevisions);
      expect(revisionsAfter.length).toBe(revisionsBefore.length + 1);
    } finally {
      await fake.stop();
    }
  });

  test("a Details-only Save with disable: true saves one new revision when the saved revision already has a broken output-node ref", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version } = await buildEnabledModel(
        app,
        fake.url,
      );
      const { db } = await testDb;

      // First land the Model on a revision whose Mode already has a
      // broken ("4") output node, same as the test above.
      const workflowDraftBody = {
        version,
        details: {
          name: model.name,
          slug: model.slug,
          description: model.description,
          maxRunTimeMinutes: model.maxRunTimeMinutes,
        },
        terms: BLANK_TERMS,
        workflow: {
          json: WORKFLOW_TWO_OUTPUTS_MIXED,
          rebind: [{ nodeId: "3", newNodeId: "6" }],
        },
        inputs: [],
        modes: [
          {
            name: "Default",
            description: "",
            outputNodeIds: ["3", "4"],
            inputSettings: [],
          },
        ],
        disable: true,
      };
      const firstRes = await app.request(
        `/api/admin/models/${model.id}/draft`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(workflowDraftBody),
        },
      );
      expect(firstRes.status).toBe(200);
      const afterWorkflow = (await firstRes.json()) as {
        model: { version: number; currentRevision: number };
        modes: { name: string; outputNodes: { nodeId: string }[] }[];
      };

      const revisionsBefore = await db.select().from(modelRevisions);

      // Now a Details-only edit, resubmitting the already-broken Mode
      // (and the unchanged Inputs) exactly as saved: this must not
      // re-resolve/re-validate them, since neither was touched.
      const detailsOnlyBody = {
        version: afterWorkflow.model.version,
        details: {
          name: model.name,
          slug: model.slug,
          description: "renamed",
          maxRunTimeMinutes: model.maxRunTimeMinutes,
        },
        terms: BLANK_TERMS,
        inputs: [],
        modes: afterWorkflow.modes.map((mode) => ({
          name: mode.name,
          description: "",
          outputNodeIds: mode.outputNodes.map((n) => n.nodeId),
          inputSettings: [],
        })),
        disable: true,
      };

      const secondRes = await app.request(
        `/api/admin/models/${model.id}/draft`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(detailsOnlyBody),
        },
      );
      expect(secondRes.status).toBe(200);
      const after = (await secondRes.json()) as {
        model: { currentRevision: number; description: string };
        modes: { outputNodes: { nodeId: string }[] }[];
      };
      expect(after.model.description).toBe("renamed");
      expect(after.model.currentRevision).toBe(
        afterWorkflow.model.currentRevision + 1,
      );
      expect(after.modes[0]?.outputNodes.map((n) => n.nodeId)).toEqual([
        "6",
        "4",
      ]);

      const revisionsAfter = await db.select().from(modelRevisions);
      expect(revisionsAfter.length).toBe(revisionsBefore.length + 1);
    } finally {
      await fake.stop();
    }
  });
});
