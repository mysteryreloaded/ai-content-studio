// Issue #71: re-uploading a Model's Workflow, and listing/restoring its
// numbered revisions, each gated by checkModel the same way Modes/Inputs
// saves are (issue #49: "Save and disable" / here, "Restore and disable").

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
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

const WORKFLOW_V1 = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
};

/** Node "2" is no longer an output node, breaking the Mode by node id. */
const WORKFLOW_V2_BREAKS_MODE = {
  "1": { class_type: "LoadImage", inputs: { image: "b.png" } },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
};

const WORKFLOW_RUNNABLE = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0], steps: 20 } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

/** Node "3", the Mode's output node, no longer exists, breaking the Mode by node id (ADR-0010's "missing" case). */
const WORKFLOW_RUNNABLE_BREAKS_OUTPUT = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0], steps: 20 } },
};

describe("Workflow re-upload and revisions/restore (issue #71)", () => {
  const testDb = createTestDatabase("admin_models_revisions_route_test");
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

  async function flushMicrotasks() {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  /** An enabled Model with one Mode ("3", runnable) and one attached, reachable Backend. */
  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    fakeUrl: string,
  ) {
    const headers = await adminHeaders();

    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW_RUNNABLE }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; version: number };
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
            outputNodeIds: ["3"],
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

  test("PUT /:id/workflow replaces the Workflow and bumps the revision", async () => {
    const { app } = await build();
    const headers = await adminHeaders();

    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW_V1 }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; version: number };
    };

    const res = await app.request(`/api/admin/models/${model.id}/workflow`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        workflow: WORKFLOW_V2_BREAKS_MODE,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { record: { currentRevision: number } };
    expect(body.record.currentRevision).toBe(2);

    const detailRes = await app.request(`/api/admin/models/${model.id}`, {
      headers,
    });
    const detail = (await detailRes.json()) as { workflow: unknown };
    expect(detail.workflow).toEqual(WORKFLOW_V2_BREAKS_MODE);
  });

  test("PUT /:id/workflow 400s an enabled Model whose carried-forward Mode breaks, and accepts it with disable: true", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version } = await buildEnabledModel(
        app,
        fake.url,
      );

      const blockedRes = await app.request(
        `/api/admin/models/${model.id}/workflow`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version,
            workflow: WORKFLOW_RUNNABLE_BREAKS_OUTPUT,
          }),
        },
      );
      expect(blockedRes.status).toBe(400);
      const blockedBody = (await blockedRes.json()) as { error: string };
      expect(blockedBody.error).toContain("disable");

      const disabledRes = await app.request(
        `/api/admin/models/${model.id}/workflow`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version,
            workflow: WORKFLOW_RUNNABLE_BREAKS_OUTPUT,
            disable: true,
          }),
        },
      );
      expect(disabledRes.status).toBe(200);
      const disabled = (await disabledRes.json()) as {
        record: { state: string };
      };
      expect(disabled.record.state).toBe("disabled");
    } finally {
      await fake.stop();
    }
  });

  test("POST restore 400s an enabled Model whose restored state breaks, and accepts it with disable: true", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version } = await buildEnabledModel(
        app,
        fake.url,
      );

      // Breaks the Mode, as an unprivileged (non-disable) re-upload would.
      const uploadRes = await app.request(
        `/api/admin/models/${model.id}/workflow`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version,
            workflow: WORKFLOW_RUNNABLE_BREAKS_OUTPUT,
            disable: true,
          }),
        },
      );
      const { record: afterUpload } = (await uploadRes.json()) as {
        record: { version: number };
      };

      // Revision 1 is pre-Modes (from createFromWorkflow) and revision 2
      // is the runnable one with the Default Mode (from updateModes in
      // buildEnabledModel); the broken one just made by `disable: true`
      // above is revision 3. Restore revision 2 (good) while still
      // disabled, then re-enable to prove restoring to a good revision
      // still works...
      const restoreGoodRes = await app.request(
        `/api/admin/models/${model.id}/revisions/2/restore`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: afterUpload.version }),
        },
      );
      expect(restoreGoodRes.status).toBe(200);
      const { record: afterRestore } = (await restoreGoodRes.json()) as {
        record: { version: number };
      };

      const enableRes = await app.request(
        `/api/admin/models/${model.id}/enable`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: afterRestore.version }),
        },
      );
      expect(enableRes.status).toBe(200);
      const enabled = (await enableRes.json()) as { version: number };

      // Now, while enabled and healthy, prove restoring back to the
      // broken revision (3) is gated the same way a save is.
      const blockedRestore = await app.request(
        `/api/admin/models/${model.id}/revisions/3/restore`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: enabled.version }),
        },
      );
      expect(blockedRestore.status).toBe(400);
      const blockedBody = (await blockedRestore.json()) as { error: string };
      expect(blockedBody.error).toContain("disable");

      const disabledRestore = await app.request(
        `/api/admin/models/${model.id}/revisions/3/restore`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: enabled.version, disable: true }),
        },
      );
      expect(disabledRestore.status).toBe(200);
      const disabled = (await disabledRestore.json()) as {
        record: { state: string };
      };
      expect(disabled.record.state).toBe("disabled");
    } finally {
      await fake.stop();
    }
  });

  test("GET /:id/revisions lists revisions newest first; POST restore inserts a copy as a new revision", async () => {
    const { app } = await build();
    const headers = await adminHeaders();

    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW_V1 }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; version: number };
    };

    const uploadRes = await app.request(
      `/api/admin/models/${model.id}/workflow`,
      {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          workflow: WORKFLOW_V2_BREAKS_MODE,
        }),
      },
    );
    const { record: afterUpload } = (await uploadRes.json()) as {
      record: { version: number; currentRevision: number };
    };
    expect(afterUpload.currentRevision).toBe(2);

    const listRes = await app.request(
      `/api/admin/models/${model.id}/revisions`,
      {
        headers,
      },
    );
    expect(listRes.status).toBe(200);
    const { revisions } = (await listRes.json()) as {
      revisions: { revisionNumber: number }[];
    };
    expect(revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);

    const restoreRes = await app.request(
      `/api/admin/models/${model.id}/revisions/1/restore`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ version: afterUpload.version }),
      },
    );
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as {
      record: { currentRevision: number };
    };
    expect(restored.record.currentRevision).toBe(3);

    const detailRes = await app.request(`/api/admin/models/${model.id}`, {
      headers,
    });
    const detail = (await detailRes.json()) as { workflow: unknown };
    expect(detail.workflow).toEqual(WORKFLOW_V1);
  });

  test("POST restore 404s an unknown revision number", async () => {
    const { app } = await build();
    const headers = await adminHeaders();

    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW_V1 }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; version: number };
    };

    const res = await app.request(
      `/api/admin/models/${model.id}/revisions/99/restore`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ version: model.version }),
      },
    );
    expect(res.status).toBe(404);
  });
});
