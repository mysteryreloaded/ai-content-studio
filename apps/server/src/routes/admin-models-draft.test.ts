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
    "5": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
  };

  /** "3" is renamed "6" (a rebind target); "4" is simply gone, left on "Leave broken" within the very same Mode. "5" (the Prompt Input's own bound node) is untouched. */
  const WORKFLOW_TWO_OUTPUTS_MIXED = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
    "2": { class_type: "KSampler", inputs: { model: ["1", 0], steps: 20 } },
    "6": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
  };

  const PROMPT_INPUT_ID = "22222222-2222-2222-2222-222222222222";

  /**
   * Issue #218 CEO review round 3: a real bound Input, whose key order
   * in the request body is deliberately different from how it's first
   * created — `sameInputDefinitions`' `JSON.stringify` comparison was
   * key-order-sensitive (it compared the zod-parsed body against
   * Postgres's own jsonb key order), so these tests only actually
   * exercise the "unchanged, carry forward verbatim" path with the
   * `isDeepStrictEqual` fix.
   */
  function promptInput(reorderedKeys: boolean) {
    const binding = {
      nodeId: "5",
      field: "text",
      classType: "CLIPTextEncode",
      title: null,
    };
    if (!reorderedKeys) {
      return {
        id: PROMPT_INPUT_ID,
        kind: "text",
        group: "describe",
        label: "Prompt",
        help: "",
        default: "",
        multiline: true,
        maxLength: 2000,
        bindings: [binding],
      };
    }
    return {
      bindings: [
        {
          title: null,
          classType: "CLIPTextEncode",
          field: "text",
          nodeId: "5",
        },
      ],
      maxLength: 2000,
      multiline: true,
      default: "",
      help: "",
      label: "Prompt",
      group: "describe",
      kind: "text",
      id: PROMPT_INPUT_ID,
    };
  }

  /** Same reordering trick as {@link promptInput}, for a Mode's (non-empty) `inputSettings`. */
  function promptInputSetting(reorderedKeys: boolean) {
    if (!reorderedKeys) {
      return [
        {
          inputId: PROMPT_INPUT_ID,
          state: "required",
          fixedValue: null,
          label: "Prompt",
        },
      ];
    }
    return [
      {
        label: "Prompt",
        fixedValue: null,
        state: "required",
        inputId: PROMPT_INPUT_ID,
      },
    ];
  }

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

    // A real bound Input (issue #218 CEO review round 3), so the
    // round-2 broken-ref tests below exercise `sameInputDefinitions`
    // against non-empty data, not just `[]`.
    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          inputs: [promptInput(false)],
        }),
      },
    );
    const { record: afterInputs } = (await inputsRes.json()) as {
      record: { version: number };
    };

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: afterInputs.version,
        modes: [
          {
            name: "Default",
            description: "",
            outputNodeIds: ["3", "4"],
            inputSettings: promptInputSetting(false),
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

    return { model, headers, version: enabled.version, backendId: backend.id };
  }

  test("a Workflow re-upload with one rebound and one 'Leave broken' output node 400s without disable, and saves one new revision with disable: true", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version, backendId } = await buildEnabledModel(
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
        // Reordered keys (issue #218 CEO review round 3): unchanged
        // from what's already saved, but not byte-identical JSON, so
        // this only carries forward verbatim with the
        // `isDeepStrictEqual` fix — a plain `JSON.stringify` compare
        // would see these as different and re-validate them fresh.
        inputs: [promptInput(true)],
        modes: [
          {
            name: "Default",
            description: "",
            outputNodeIds: ["3", "4"],
            inputSettings: promptInputSetting(true),
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
        inputs: { id: string; bindings: { nodeId: string }[] }[];
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
      expect(saved.model.currentRevision).toBe(4);
      expect(saved.inputs[0]?.bindings[0]?.nodeId).toBe("5");
      expect(saved.modes[0]?.outputNodes).toEqual([
        { nodeId: "6", classType: "SaveImage", kind: "image", title: null },
        { nodeId: "4", classType: "SaveImage", kind: "image", title: null },
      ]);

      const revisionsAfter = await db.select().from(modelRevisions);
      expect(revisionsAfter.length).toBe(revisionsBefore.length + 1);

      // Stops this Backend's health monitor before the shared FakeClock
      // (reused test-to-test) can advance into a poll for a row a later
      // test's cleanup has already deleted.
      await app.request(`/api/admin/backends/${backendId}?version=1`, {
        method: "DELETE",
        headers,
      });
    } finally {
      await fake.stop();
    }
  });

  test("a Details-only Save with disable: true saves one new revision when the saved revision already has a broken output-node ref", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version, backendId } = await buildEnabledModel(
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
        inputs: [promptInput(false)],
        modes: [
          {
            name: "Default",
            description: "",
            outputNodeIds: ["3", "4"],
            inputSettings: promptInputSetting(false),
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
        inputs: { id: string; bindings: { nodeId: string }[] }[];
        modes: { name: string; outputNodes: { nodeId: string }[] }[];
      };
      expect(afterWorkflow.inputs[0]?.bindings[0]?.nodeId).toBe("5");

      const revisionsBefore = await db.select().from(modelRevisions);

      // Now a Details-only edit, resubmitting the already-broken Mode
      // and the Input exactly as saved, but with reordered keys
      // (issue #218 CEO review round 3): this must not
      // re-resolve/re-validate them, since neither section was
      // actually touched — a plain `JSON.stringify` compare would
      // wrongly treat the reordered Input as "changed" and re-validate
      // it (and the broken Mode) fresh, 400ing.
      const detailsOnlyBody = {
        version: afterWorkflow.model.version,
        details: {
          name: model.name,
          slug: model.slug,
          description: "renamed",
          maxRunTimeMinutes: model.maxRunTimeMinutes,
        },
        terms: BLANK_TERMS,
        inputs: [promptInput(true)],
        modes: afterWorkflow.modes.map((mode) => ({
          name: mode.name,
          description: "",
          outputNodeIds: mode.outputNodes.map((n) => n.nodeId),
          inputSettings: promptInputSetting(true),
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
        inputs: { bindings: { nodeId: string }[] }[];
        modes: { outputNodes: { nodeId: string }[] }[];
      };
      expect(after.model.description).toBe("renamed");
      expect(after.model.currentRevision).toBe(
        afterWorkflow.model.currentRevision + 1,
      );
      expect(after.inputs[0]?.bindings[0]?.nodeId).toBe("5");
      expect(after.modes[0]?.outputNodes.map((n) => n.nodeId)).toEqual([
        "6",
        "4",
      ]);

      const revisionsAfter = await db.select().from(modelRevisions);
      expect(revisionsAfter.length).toBe(revisionsBefore.length + 1);

      // Stops this Backend's health monitor before the shared FakeClock
      // (reused test-to-test) can advance into a poll for a row a later
      // test's cleanup has already deleted.
      await app.request(`/api/admin/backends/${backendId}?version=1`, {
        method: "DELETE",
        headers,
      });
    } finally {
      await fake.stop();
    }
  });

  // Issue #218 CEO review round 3 (bug 2): a Workflow re-upload isn't
  // gated on every other draft being clean, so a Mode edited in the
  // very same Save (not resubmitted unchanged — it goes through the
  // fresh/validated path, not "carry forward verbatim") must still get
  // `rebind` applied to its own submitted output-node ids before
  // they're resolved against the new Workflow.
  test("a genuinely edited Mode in the same Save as a Workflow re-upload still gets rebind applied", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version, backendId } = await buildEnabledModel(
        app,
        fake.url,
      );

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
        inputs: [promptInput(false)],
        modes: [
          {
            // Renamed and down to one output node (issue #43/#71): a
            // genuine edit, not a resubmission of what's saved, so
            // this is the "fresh" path, not "unchanged, carry
            // forward". It still names the *old* node id "3" — the
            // editor carried that selection over from before the
            // re-upload — which only resolves once `rebind` repoints
            // it onto "6".
            name: "Renamed",
            description: "",
            outputNodeIds: ["3"],
            inputSettings: promptInputSetting(false),
          },
        ],
        disable: true,
      };

      const res = await app.request(`/api/admin/models/${model.id}/draft`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(draftBody),
      });
      expect(res.status).toBe(200);
      const saved = (await res.json()) as {
        modes: {
          name: string;
          outputNodes: {
            nodeId: string;
            classType: string;
            kind: string | null;
            title: string | null;
          }[];
        }[];
      };
      expect(saved.modes[0]?.name).toBe("Renamed");
      expect(saved.modes[0]?.outputNodes).toEqual([
        { nodeId: "6", classType: "SaveImage", kind: "image", title: null },
      ]);

      // Stops this Backend's health monitor before the shared FakeClock
      // (reused test-to-test) can advance into a poll for a row a later
      // test's cleanup has already deleted.
      await app.request(`/api/admin/backends/${backendId}?version=1`, {
        method: "DELETE",
        headers,
      });
    } finally {
      await fake.stop();
    }
  });

  // Issue #254 CEO review round 4: the enabled-Model gate swapped only
  // `nodeId` on a rebound binding, leaving its `classType` stale, so
  // `checkModel`'s `validateBinding` saw the new node's real class and
  // reported "now a LoraLoader, not the KSampler this binding was made
  // for" — a false positive that 400ed a Save the editor's own
  // (correct) `reboundInputsFrom` check had already cleared, with no
  // "Save and disable" offered either. `remapInputBindings` (shared
  // with `saveDraft`'s own fresh-validation rebind) fixes the gate to
  // take classType/title from the new node, same as a real save would.
  test("a rebound Input binding onto a different classType still saves an enabled Model without disable", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version, backendId } = await buildEnabledModel(
        app,
        fake.url,
      );

      const stepsInput = {
        id: "33333333-3333-3333-3333-333333333333",
        kind: "number",
        group: "settings",
        label: "Steps",
        help: "",
        numberMode: "integer",
        min: 1,
        max: 50,
        step: 1,
        default: null,
        bindings: [
          { nodeId: "2", field: "steps", classType: "KSampler", title: null },
        ],
      };

      const inputsRes = await app.request(
        `/api/admin/models/${model.id}/inputs`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version,
            inputs: [promptInput(false), stepsInput],
          }),
        },
      );
      expect(inputsRes.status).toBe(200);
      const { record: afterInputs } = (await inputsRes.json()) as {
        record: { version: number };
      };

      // "2" (a KSampler) is renamed "7" and becomes a LoraLoader — same
      // node id slot, different class, the exact repro from the CEO
      // report (a KSampler rebound onto a KSamplerAdvanced).
      const WORKFLOW_STEPS_REBOUND = {
        "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
        "7": {
          class_type: "LoraLoader",
          inputs: { model: ["1", 0], steps: 20 },
        },
        "3": { class_type: "SaveImage", inputs: { images: ["7", 0] } },
        "4": { class_type: "SaveImage", inputs: { images: ["7", 0] } },
        "5": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
      };

      const draftBody = {
        version: afterInputs.version,
        details: {
          name: model.name,
          slug: model.slug,
          description: model.description,
          maxRunTimeMinutes: model.maxRunTimeMinutes,
        },
        terms: BLANK_TERMS,
        workflow: {
          json: WORKFLOW_STEPS_REBOUND,
          rebind: [{ nodeId: "2", newNodeId: "7" }],
        },
        inputs: [promptInput(false), stepsInput],
        modes: [
          {
            name: "Default",
            description: "",
            outputNodeIds: ["3", "4"],
            inputSettings: promptInputSetting(false),
          },
        ],
        disable: false,
      };

      const res = await app.request(`/api/admin/models/${model.id}/draft`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(draftBody),
      });
      expect(res.status).toBe(200);
      const saved = (await res.json()) as {
        model: { state: string };
        inputs: {
          label: string;
          bindings: {
            nodeId: string;
            field: string;
            classType: string;
            title: string | null;
          }[];
        }[];
      };
      expect(saved.model.state).toBe("enabled");
      const steps = saved.inputs.find((i) => i.label === "Steps");
      expect(steps?.bindings[0]).toEqual({
        nodeId: "7",
        field: "steps",
        classType: "LoraLoader",
        title: null,
      });

      // Stops this Backend's health monitor before the shared FakeClock
      // (reused test-to-test) can advance into a poll for a row a later
      // test's cleanup has already deleted.
      await app.request(`/api/admin/backends/${backendId}?version=1`, {
        method: "DELETE",
        headers,
      });
    } finally {
      await fake.stop();
    }
  });
});
