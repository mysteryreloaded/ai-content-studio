// `PUT /api/admin/models/:id/draft` (issue #218): the editor header's one
// Save, saving the whole draft (Details, Inputs, Modes, Terms, and an
// optional re-uploaded Workflow) as one revision and one audit entry.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  auditEntries,
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
