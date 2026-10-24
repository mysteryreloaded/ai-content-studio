// `/api/admin/models`: create from a Workflow, list/edit/reorder/delete and
// History (issue #40).

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
  MAX_UPLOAD_MB: 500,
};

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const VALID_WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
};

describe("/api/admin/models", () => {
  const testDb = createTestDatabase("admin_models_route_test");
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

  async function makeUser(role: "user" | "admin", email: string) {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({ googleSub: `sub-${email}`, email, name: email, role })
      .returning();
    if (!user) throw new Error("failed to insert test user");
    return user;
  }

  async function cookieFor(userId: string): Promise<string> {
    const { db } = await testDb;
    const session = await createSession(db, clock, userId);
    return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
  }

  async function adminHeaders() {
    const admin = await makeUser("admin", "admin@example.com");
    return { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(admin.id) };
  }

  test("a non-Admin is forbidden", async () => {
    const app = await build();
    const user = await makeUser("user", "user@example.com");
    const res = await app.request("/api/admin/models", {
      headers: { ...SAME_ORIGIN_HEADERS, Cookie: await cookieFor(user.id) },
    });
    expect(res.status).toBe(403);
  });

  test("creates a disabled Model from a name and an API-format Workflow", async () => {
    const app = await build();
    const headers = await adminHeaders();

    const res = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX 2.5", workflow: VALID_WORKFLOW }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      model: { id: string; state: string; currentRevision: number };
    };
    expect(body.model.state).toBe("disabled");
    expect(body.model.currentRevision).toBe(1);

    const listRes = await app.request("/api/admin/models", { headers });
    const listBody = (await listRes.json()) as { models: { id: string }[] };
    expect(listBody.models.map((m) => m.id)).toEqual([body.model.id]);

    const getRes = await app.request(`/api/admin/models/${body.model.id}`, {
      headers,
    });
    const getBody = (await getRes.json()) as {
      nodes: { id: string; classType: string; title: string | null }[];
    };
    expect(getBody.nodes).toEqual([
      { id: "1", classType: "LoadImage", title: null },
    ]);
  });

  test("refuses a UI-format save with the expected message", async () => {
    const app = await build();
    const headers = await adminHeaders();

    const res = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "LTX 2.5",
        workflow: { nodes: [], links: [] },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: { message: string }[] };
    expect(body.errors[0]?.message).toBe(
      "This is a UI save; export it with Export (API)",
    );
  });

  test("edits Details and rejects a stale version with 409", async () => {
    const app = await build();
    const headers = await adminHeaders();

    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX 2.5", workflow: VALID_WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; version: number };
    };

    const updateRes = await app.request(`/api/admin/models/${model.id}`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "LTX 2.5 Updated",
        slug: "ltx-2-5",
        description: "desc",
        maxRunTimeMinutes: 45,
        version: model.version,
      }),
    });
    expect(updateRes.status).toBe(200);

    const staleRes = await app.request(`/api/admin/models/${model.id}`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "LTX 2.5 Updated",
        slug: "ltx-2-5",
        description: "desc",
        maxRunTimeMinutes: 45,
        version: model.version,
      }),
    });
    expect(staleRes.status).toBe(409);
  });

  test("reorders with move-up/move-down and lists History after a save", async () => {
    const app = await build();
    const headers = await adminHeaders();

    const aRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "A", workflow: VALID_WORKFLOW }),
    });
    const a = (await aRes.json()) as { model: { id: string } };
    const bRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "B", workflow: VALID_WORKFLOW }),
    });
    const b = (await bRes.json()) as { model: { id: string } };

    const moveRes = await app.request(
      `/api/admin/models/${b.model.id}/move-up`,
      { method: "POST", headers },
    );
    expect(moveRes.status).toBe(200);
    const moved = (await moveRes.json()) as { models: { id: string }[] };
    expect(moved.models.map((m) => m.id)).toEqual([b.model.id, a.model.id]);

    const historyRes = await app.request(
      `/api/admin/models/${a.model.id}/history`,
      { headers },
    );
    const history = (await historyRes.json()) as {
      entries: { action: string }[];
    };
    expect(history.entries.some((e) => e.action === "create")).toBe(true);
  });

  test("soft-deletes a Model with a version, returning 204", async () => {
    const app = await build();
    const headers = await adminHeaders();

    const createdRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX 2.5", workflow: VALID_WORKFLOW }),
    });
    const created = (await createdRes.json()) as {
      model: { id: string; version: number };
    };

    const deleteRes = await app.request(
      `/api/admin/models/${created.model.id}?version=${created.model.version}`,
      { method: "DELETE", headers },
    );
    expect(deleteRes.status).toBe(204);

    const getRes = await app.request(`/api/admin/models/${created.model.id}`, {
      headers,
    });
    expect(getRes.status).toBe(404);
  });

  describe("PUT /:id/terms (issue #61)", () => {
    async function createModel(app: Awaited<ReturnType<typeof build>>) {
      const headers = await adminHeaders();
      const res = await app.request("/api/admin/models", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ name: "LTX 2.5", workflow: VALID_WORKFLOW }),
      });
      const { model } = (await res.json()) as {
        model: { id: string; termsRevision: number };
      };
      return { headers, model };
    }

    test("sets the terms, starting a version, and bumps termsRevision", async () => {
      const app = await build();
      const { headers, model } = await createModel(app);

      const res = await app.request(`/api/admin/models/${model.id}/terms`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          revision: model.termsRevision,
          termsBody: "# Terms",
          licenseUrl: "https://example.com/license",
          attribution: "Model by Example Corp",
          askAgain: false,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        termsBody: string;
        licenseUrl: string;
        attribution: string;
        termsVersion: number | null;
        termsRevision: number;
      };
      expect(body.termsBody).toBe("# Terms");
      expect(body.licenseUrl).toBe("https://example.com/license");
      expect(body.attribution).toBe("Model by Example Corp");
      expect(body.termsVersion).toBe(1);
      expect(body.termsRevision).toBe(model.termsRevision + 1);
    });

    test("a quiet text edit keeps the version; 'ask everyone to accept again' bumps it", async () => {
      const app = await build();
      const { headers, model } = await createModel(app);

      const first = await app.request(`/api/admin/models/${model.id}/terms`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          revision: model.termsRevision,
          termsBody: "v1",
          licenseUrl: "",
          attribution: "",
          askAgain: false,
        }),
      });
      const afterFirst = (await first.json()) as {
        termsVersion: number;
        termsRevision: number;
      };

      const quietEdit = await app.request(
        `/api/admin/models/${model.id}/terms`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            revision: afterFirst.termsRevision,
            termsBody: "v1, lightly reworded",
            licenseUrl: "",
            attribution: "",
            askAgain: false,
          }),
        },
      );
      const afterQuiet = (await quietEdit.json()) as {
        termsVersion: number;
        termsRevision: number;
      };
      expect(afterQuiet.termsVersion).toBe(afterFirst.termsVersion);

      const askAgain = await app.request(
        `/api/admin/models/${model.id}/terms`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            revision: afterQuiet.termsRevision,
            termsBody: "v2",
            licenseUrl: "",
            attribution: "",
            askAgain: true,
          }),
        },
      );
      const afterAskAgain = (await askAgain.json()) as { termsVersion: number };
      expect(afterAskAgain.termsVersion).toBe(afterFirst.termsVersion + 1);
    });

    test("409s a stale termsRevision", async () => {
      const app = await build();
      const { headers, model } = await createModel(app);

      const res = await app.request(`/api/admin/models/${model.id}/terms`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          revision: model.termsRevision + 1,
          termsBody: "v1",
          licenseUrl: "",
          attribution: "",
          askAgain: false,
        }),
      });
      expect(res.status).toBe(409);
    });

    test("rejects a non-http(s) license URL and an Attribution over 120 characters", async () => {
      const app = await build();
      const { headers, model } = await createModel(app);

      const badUrl = await app.request(`/api/admin/models/${model.id}/terms`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          revision: model.termsRevision,
          termsBody: "",
          licenseUrl: "not-a-url",
          attribution: "",
          askAgain: false,
        }),
      });
      expect(badUrl.status).toBe(400);

      const badAttribution = await app.request(
        `/api/admin/models/${model.id}/terms`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            revision: model.termsRevision,
            termsBody: "",
            licenseUrl: "",
            attribution: "x".repeat(121),
            askAgain: false,
          }),
        },
      );
      expect(badAttribution.status).toBe(400);
    });
  });
});
