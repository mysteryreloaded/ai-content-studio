// One table of cases (issue #46, CEO review round 2) run through both
// `parseInputValues` directly and a real `POST /:slug/generations`: every
// case's validity must agree between the two, and a valid case's submitted
// values must land in the Generation's built_prompt.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import {
  FakeClock,
  type InputDefinition,
  parseInputValues,
  relevantInputs,
  toInputIssues,
} from "@ai-content-studio/shared";
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
import { ModelRepository } from "../models/repository.js";
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

const TEXT_INPUT_ID = "11111111-1111-1111-1111-111111111111";
const NUMBER_INPUT_ID = "22222222-2222-2222-2222-222222222222";
const SELECT_INPUT_ID = "33333333-3333-3333-3333-333333333333";
const FAST_OPTION_ID = "44444444-4444-4444-4444-444444444444";
const SLOW_OPTION_ID = "55555555-5555-5555-5555-555555555555";

const INPUTS = [
  {
    id: TEXT_INPUT_ID,
    kind: "text",
    group: "describe",
    label: "Prompt",
    help: "",
    default: "",
    multiline: false,
    maxLength: 5,
    bindings: [
      {
        nodeId: "1",
        field: "text",
        classType: "CLIPTextEncode",
        title: "Prompt",
      },
    ],
  },
  {
    id: NUMBER_INPUT_ID,
    kind: "number",
    group: "settings",
    label: "Steps",
    help: "",
    default: null,
    numberMode: "integer",
    min: 10,
    max: 50,
    step: 5,
    bindings: [
      { nodeId: "2", field: "steps", classType: "KSampler", title: null },
    ],
  },
  {
    id: SELECT_INPUT_ID,
    kind: "select",
    group: "settings",
    label: "Quality",
    help: "",
    default: null,
    options: [
      { id: FAST_OPTION_ID, label: "Fast", values: [4] },
      { id: SLOW_OPTION_ID, label: "Slow", values: [12] },
    ],
    bindings: [
      { nodeId: "2", field: "cfg", classType: "KSampler", title: null },
    ],
  },
];

interface Case {
  name: string;
  values: Record<string, unknown>;
  valid: boolean;
  /** Only for a valid case: the built_prompt fields the submitted (or left-alone) values should produce. */
  expectedPrompt?: { text: string; steps: number; cfg: number };
}

const CASES: Case[] = [
  {
    name: "every Input blank: the Workflow's own values are kept",
    values: {},
    valid: true,
    expectedPrompt: { text: "a cat", steps: 20, cfg: 8 },
  },
  {
    name: "text, number and select all submitted: every bound field is written",
    values: {
      [TEXT_INPUT_ID]: "dog",
      [NUMBER_INPUT_ID]: 25,
      [SELECT_INPUT_ID]: SLOW_OPTION_ID,
    },
    valid: true,
    expectedPrompt: { text: "dog", steps: 25, cfg: 12 },
  },
  {
    name: "text over its max length is refused",
    values: { [TEXT_INPUT_ID]: "toolongtext" },
    valid: false,
  },
  {
    name: "a number off min + k*step is refused",
    values: { [NUMBER_INPUT_ID]: 22 },
    valid: false,
  },
  {
    name: "a number outside min/max is refused",
    values: { [NUMBER_INPUT_ID]: 1000 },
    valid: false,
  },
  {
    name: "a select value that isn't one of the option ids is refused",
    values: { [SELECT_INPUT_ID]: "ghost" },
    valid: false,
  },
  {
    name: "a value for an unknown Input is refused (strict)",
    values: { "ghost-input": "x" },
    valid: false,
  },
];

describe("parseInputValues and POST /:slug/generations agree on every case", () => {
  const testDb = createTestDatabase("generations_input_values_test");
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

  test("every case: parseInputValues and the submit route agree, and a valid case's values land in built_prompt", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
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

      const modesRes = await app.request(
        `/api/admin/models/${model.id}/modes`,
        {
          method: "PUT",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            version: model.version,
            modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
          }),
        },
      );
      const { record: afterModes } = (await modesRes.json()) as {
        record: { version: number };
        modes: Array<{ id: string }>;
      };

      const inputsRes = await app.request(
        `/api/admin/models/${model.id}/inputs`,
        {
          method: "PUT",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ version: afterModes.version, inputs: INPUTS }),
        },
      );
      const { record: afterInputs } = (await inputsRes.json()) as {
        record: { version: number };
      };

      const enableRes = await app.request(
        `/api/admin/models/${model.id}/enable`,
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ version: afterInputs.version }),
        },
      );
      expect(enableRes.status).toBe(200);

      const repository = new ModelRepository(db, clock);
      const detail = await repository.get(model.id);
      if (!detail) throw new Error("model not found");
      const modeId = detail.modes[0]?.id as string;
      const relevant = relevantInputs(detail.inputs, detail.workflow, ["3"]);
      const schema = parseInputValues(
        detail.revisionId,
        modeId,
        relevant as InputDefinition[],
      );

      const userHeaders = await headersFor("user");

      for (const testCase of CASES) {
        const parsed = schema.safeParse(testCase.values);
        expect(parsed.success).toBe(testCase.valid);

        const res = await app.request(`/api/models/${model.slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId,
            revision: detail.model.currentRevision,
            values: testCase.values,
          }),
        });

        if (testCase.valid) {
          expect(res.status).toBe(201);
          const body = (await res.json()) as {
            generations: Array<{ id: string }>;
          };
          const generationId = body.generations[0]?.id as string;
          const [row] = await db
            .select()
            .from(generations)
            .where(eq(generations.id, generationId));
          const prompt = row?.builtPrompt as Record<
            string,
            { inputs: Record<string, unknown> }
          >;
          if (testCase.expectedPrompt) {
            expect(prompt["1"]?.inputs.text).toBe(testCase.expectedPrompt.text);
            expect(prompt["2"]?.inputs.steps).toBe(
              testCase.expectedPrompt.steps,
            );
            expect(prompt["2"]?.inputs.cfg).toBe(testCase.expectedPrompt.cfg);
          }
        } else {
          expect(res.status).toBe(400);
          const body = (await res.json()) as {
            error: string;
            issues?: unknown[];
          };
          expect(body.error).toBe("invalid");
          expect(body.issues?.length).toBeGreaterThan(0);
          if (!parsed.success) {
            expect(toInputIssues(parsed.error).length).toBeGreaterThan(0);
          }
        }
      }

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
