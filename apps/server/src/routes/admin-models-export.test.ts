// Export/import of a Model revision as one JSON file (issue #73): the
// editor header and each revision row export, the Models list imports,
// and the round-trip gives back an equal definition.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  modelRevisions,
  models,
  modes,
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

describe("Model export/import (issue #73)", () => {
  const testDb = createTestDatabase("admin_models_export_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(modes);
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

  /** A Model with a Mode, an Input and Model terms set, for the full export shape. */
  async function buildModel(app: Awaited<ReturnType<typeof build>>) {
    const headers = await adminHeaders();

    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW }),
    });
    expect(createRes.status).toBe(201);
    const { model } = (await createRes.json()) as {
      model: { id: string; version: number };
    };

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        modes: [
          {
            name: "Default",
            description: "the only Mode",
            outputNodeIds: ["2"],
            inputSettings: [],
          },
        ],
      }),
    });
    expect(modesRes.status).toBe(200);
    const { record: afterModes } = (await modesRes.json()) as {
      record: { version: number };
    };

    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          version: afterModes.version,
          inputs: [PROMPT_INPUT],
        }),
      },
    );
    expect(inputsRes.status).toBe(200);
    const { record: afterInputs } = (await inputsRes.json()) as {
      record: { version: number };
    };

    const termsRes = await app.request(`/api/admin/models/${model.id}/terms`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        revision: 1,
        termsBody: "Don't be evil.",
        licenseUrl: "https://example.com/license",
        attribution: "Made with LTX",
        askAgain: false,
      }),
    });
    expect(termsRes.status).toBe(200);

    return { model, headers, version: afterInputs.version };
  }

  test("exports the current revision from the editor header", async () => {
    const app = await build();
    const { model, headers } = await buildModel(app);

    const res = await app.request(`/api/admin/models/${model.id}/export`, {
      headers,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const file = (await res.json()) as Record<string, unknown>;
    expect(file.exportVersion).toBe(1);
    expect(file.id).toBe(model.id);
    expect(file.revisionNumber).toBe(3);
    expect(file.termsBody).toBe("Don't be evil.");
    expect(file.licenseUrl).toBe("https://example.com/license");
    expect(file.attribution).toBe("Made with LTX");
    expect(file.workflow).toEqual(WORKFLOW);
    expect(file.inputs).toEqual([PROMPT_INPUT]);
    expect((file.modes as unknown[]).length).toBe(1);
    expect(file).not.toHaveProperty("backends");
    expect(file).not.toHaveProperty("state");
  });

  test("exports one specific revision", async () => {
    const app = await build();
    const { model, headers } = await buildModel(app);

    const res = await app.request(
      `/api/admin/models/${model.id}/revisions/1/export`,
      { headers },
    );
    expect(res.status).toBe(200);
    const file = (await res.json()) as Record<string, unknown>;
    expect(file.revisionNumber).toBe(1);
    expect(file.modes).toEqual([]);
    expect(file.inputs).toEqual([]);
  });

  // The exported Model's own id, and every Mode row's own id, are already
  // taken in this same database (by the Model it was exported from, whose
  // Modes are kept forever even past a soft-delete) — so the import below
  // substitutes fresh ones, standing in for "a different studio's
  // database, where nothing by those ids exists yet", and the round-trip
  // is checked on content rather than on reusing a row that's still live
  // here.
  test("round-trip: exporting then importing gives an equal definition", async () => {
    const app = await build();
    const { model, headers } = await buildModel(app);

    const exportRes = await app.request(
      `/api/admin/models/${model.id}/export`,
      { headers },
    );
    const file = (await exportRes.json()) as {
      workflow: unknown;
      inputs: unknown;
      modes: { id: string; sortOrder: number; name: string }[];
      termsBody: string;
      licenseUrl: string;
      attribution: string;
    };
    const importId = "22222222-2222-2222-2222-222222222222";
    const payload = {
      ...file,
      id: importId,
      name: "LTX (imported)",
      slug: "ltx-imported",
      maxRunTimeMinutes: 30,
      revisionNumber: 1,
      exportVersion: 1,
      modes: file.modes.map((mode, index) => ({
        ...mode,
        id: `33333333-3333-3333-3333-33333333333${index}`,
      })),
    };

    const importRes = await app.request("/api/admin/models/import", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(importRes.status).toBe(201);
    const { model: imported } = (await importRes.json()) as {
      model: { id: string; state: string };
    };
    expect(imported.id).toBe(importId);
    expect(imported.state).toBe("disabled");

    const reExportRes = await app.request(
      `/api/admin/models/${imported.id}/export`,
      { headers },
    );
    expect(reExportRes.status).toBe(200);
    const reExported = (await reExportRes.json()) as Record<string, unknown>;

    expect(reExported.workflow).toEqual(file.workflow);
    expect(reExported.inputs).toEqual(file.inputs);
    expect(reExported.modes).toEqual(payload.modes);
    expect(reExported.termsBody).toBe(file.termsBody);
    expect(reExported.licenseUrl).toBe(file.licenseUrl);
    expect(reExported.attribution).toBe(file.attribution);

    const historyRes = await app.request(
      `/api/admin/models/${imported.id}/history`,
      { headers },
    );
    const { entries } = (await historyRes.json()) as {
      entries: { action: string }[];
    };
    expect(entries.some((e) => e.action === "import")).toBe(true);
  });

  test("importing a file whose id is already taken is refused", async () => {
    const app = await build();
    const { model, headers } = await buildModel(app);

    const exportRes = await app.request(
      `/api/admin/models/${model.id}/export`,
      { headers },
    );
    const file = await exportRes.json();

    const importRes = await app.request("/api/admin/models/import", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(file),
    });
    expect(importRes.status).toBe(409);
  });
});
