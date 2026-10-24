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

/**
 * Node "3" keeps its id but is now a VHS_VideoCombine (CEO review): a
 * Mode saved against it as a SaveImage would silently run and keep its
 * stale "image" kind if checkModel didn't catch the classType change.
 * Node "4" is a genuine SaveImage the rebind picker can repoint onto.
 */
const WORKFLOW_RUNNABLE_OUTPUT_BECOMES_VIDEO = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0], steps: 20 } },
  "3": { class_type: "VHS_VideoCombine", inputs: { images: ["2", 0] } },
  "4": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

/**
 * Two things break at once (round-2 CEO review: a *partial* rebind):
 * node "2" (a Steps Input's own binding) is gone, renamed "6"; node "3"
 * (the Mode's own output) keeps its id but is now a VHS_VideoCombine.
 * Node "7" is a fresh SaveImage the rebind picker can repoint the
 * Mode's output onto — leaving node "2"/"6" un-rebound on purpose.
 */
const WORKFLOW_PARTIAL_REBIND = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
  "6": { class_type: "KSampler", inputs: { model: ["1", 0], steps: 20 } },
  "3": { class_type: "VHS_VideoCombine", inputs: { images: ["6", 0] } },
  "7": { class_type: "SaveImage", inputs: { images: ["6", 0] } },
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

    return { model, headers, version: enabled.version, backendId: backend.id };
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
      const { model, headers, version, backendId } = await buildEnabledModel(
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

  test("POST restore 400s an enabled Model whose restored state breaks, and accepts it with disable: true", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version, backendId } = await buildEnabledModel(
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

      await app.request(`/api/admin/backends/${backendId}?version=1`, {
        method: "DELETE",
        headers,
      });
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

  test("PUT /:id/workflow 400s when a Mode's output node's class changed, and the rebind picker fixes it without disabling", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version, backendId } = await buildEnabledModel(
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
            workflow: WORKFLOW_RUNNABLE_OUTPUT_BECOMES_VIDEO,
          }),
        },
      );
      expect(blockedRes.status).toBe(400);
      const blockedBody = (await blockedRes.json()) as {
        error: string;
        reasons: string[];
      };
      expect(blockedBody.error).toContain("disable");
      expect(blockedBody.reasons.some((r) => r.includes("rebind"))).toBe(true);

      const rebindRes = await app.request(
        `/api/admin/models/${model.id}/workflow`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version,
            workflow: WORKFLOW_RUNNABLE_OUTPUT_BECOMES_VIDEO,
            rebind: [{ nodeId: "3", newNodeId: "4" }],
          }),
        },
      );
      expect(rebindRes.status).toBe(200);
      const rebound = (await rebindRes.json()) as {
        record: { state: string };
        modes: {
          outputNodes: {
            nodeId: string;
            classType: string;
            kind: string | null;
            title: string | null;
          }[];
        }[];
      };
      expect(rebound.record.state).toBe("enabled");
      expect(rebound.modes[0]?.outputNodes).toEqual([
        { nodeId: "4", classType: "SaveImage", kind: "image", title: null },
      ]);

      // Stops this Backend's health monitor before the shared FakeClock
      // (reused test-to-test) can advance into a poll for a row the next
      // test's cleanup has already deleted.
      await app.request(`/api/admin/backends/${backendId}?version=1`, {
        method: "DELETE",
        headers,
      });
    } finally {
      await fake.stop();
    }
  });

  test("PUT /:id/workflow with a partial rebind 400s, then saves and disables with disable: true (round-2 CEO review)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version, backendId } = await buildEnabledModel(
        app,
        fake.url,
      );

      const inputsRes = await app.request(
        `/api/admin/models/${model.id}/inputs`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version,
            inputs: [
              {
                id: "00000000-0000-0000-0000-000000000001",
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
                  {
                    nodeId: "2",
                    field: "steps",
                    classType: "KSampler",
                    title: null,
                  },
                ],
              },
            ],
          }),
        },
      );
      expect(inputsRes.status).toBe(200);
      const { record: withInput } = (await inputsRes.json()) as {
        record: { version: number };
      };

      // Two things break: the Steps Input's own binding (node "2", now
      // renamed "6") and the Mode's own output node ("3", now a
      // VHS_VideoCombine). Only the Mode's output is rebound (onto the
      // fresh "7"); the Input's binding is left on "Leave broken".
      const blockedRes = await app.request(
        `/api/admin/models/${model.id}/workflow`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version: withInput.version,
            workflow: WORKFLOW_PARTIAL_REBIND,
            rebind: [{ nodeId: "3", newNodeId: "7" }],
          }),
        },
      );
      expect(blockedRes.status).toBe(400);
      const blockedBody = (await blockedRes.json()) as {
        error: string;
        reasons: string[];
      };
      expect(blockedBody.error).toContain("disable");
      // The rebound output node is no longer a reason; only the
      // untouched, still-broken Steps Input binding is left.
      expect(blockedBody.reasons.some((r) => r.includes("rebind"))).toBe(false);

      const disabledRes = await app.request(
        `/api/admin/models/${model.id}/workflow`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version: withInput.version,
            workflow: WORKFLOW_PARTIAL_REBIND,
            rebind: [{ nodeId: "3", newNodeId: "7" }],
            disable: true,
          }),
        },
      );
      expect(disabledRes.status).toBe(200);
      const disabled = (await disabledRes.json()) as {
        record: { state: string };
        modes: { outputNodes: { nodeId: string; classType: string }[] }[];
        inputs: { bindings: { nodeId: string }[] }[];
      };
      expect(disabled.record.state).toBe("disabled");
      expect(disabled.modes[0]?.outputNodes[0]?.nodeId).toBe("7");
      // The untouched Steps Input's binding carries forward verbatim,
      // still pointed at the now-missing node "2".
      expect(disabled.inputs[0]?.bindings[0]?.nodeId).toBe("2");

      await app.request(`/api/admin/backends/${backendId}?version=1`, {
        method: "DELETE",
        headers,
      });
    } finally {
      await fake.stop();
    }
  });

  test("POST restore refuses a max-null Seed Input onto an enabled Model, like updateInputs", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const { model, headers, version, backendId } = await buildEnabledModel(
        app,
        fake.url,
      );

      // Revision 2 (pre-enable, from buildEnabledModel's Modes save) has
      // no Inputs; add a max-null Seed there via another Inputs save
      // while disabled, then restore straight to it while enabled.
      const disableRes = await app.request(
        `/api/admin/models/${model.id}/disable`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version }),
        },
      );
      const disabled = (await disableRes.json()) as { version: number };

      const inputsRes = await app.request(
        `/api/admin/models/${model.id}/inputs`,
        {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            version: disabled.version,
            inputs: [
              {
                id: "00000000-0000-0000-0000-000000000099",
                kind: "seed",
                group: "settings",
                label: "Seed",
                help: "",
                max: null,
                bindings: [
                  {
                    nodeId: "2",
                    field: "steps",
                    classType: "KSampler",
                    title: null,
                  },
                ],
              },
            ],
          }),
        },
      );
      expect(inputsRes.status).toBe(200);
      const { record: afterInputs } = (await inputsRes.json()) as {
        record: { version: number };
      };

      const enableRes = await app.request(
        `/api/admin/models/${model.id}/enable`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: afterInputs.version }),
        },
      );
      expect(enableRes.status).toBe(400);

      // Enable refuses the max-null Seed too, so get back to enabled by
      // restoring the earlier, Seed-less revision, then try restoring
      // the max-null-Seed revision back onto that enabled Model.
      const revisionsRes = await app.request(
        `/api/admin/models/${model.id}/revisions`,
        { headers },
      );
      const { revisions } = (await revisionsRes.json()) as {
        revisions: { revisionNumber: number; inputCount: number }[];
      };
      const seedRevision = revisions.find((r) => r.inputCount === 1);
      const seedlessRevision = revisions.find((r) => r.inputCount === 0);
      if (!seedRevision || !seedlessRevision) {
        throw new Error("expected both a Seed and a Seed-less revision");
      }

      const restoreSeedlessRes = await app.request(
        `/api/admin/models/${model.id}/revisions/${seedlessRevision.revisionNumber}/restore`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: afterInputs.version }),
        },
      );
      expect(restoreSeedlessRes.status).toBe(200);
      const { record: afterRestoreSeedless } =
        (await restoreSeedlessRes.json()) as { record: { version: number } };

      const enableAgainRes = await app.request(
        `/api/admin/models/${model.id}/enable`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: afterRestoreSeedless.version }),
        },
      );
      expect(enableAgainRes.status).toBe(200);
      const enabled = (await enableAgainRes.json()) as { version: number };

      const blockedRestore = await app.request(
        `/api/admin/models/${model.id}/revisions/${seedRevision.revisionNumber}/restore`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: enabled.version }),
        },
      );
      expect(blockedRestore.status).toBe(400);
      const blockedBody = (await blockedRestore.json()) as {
        reasons: string[];
      };
      expect(blockedBody.reasons.some((r) => r.includes("needs a max"))).toBe(
        true,
      );

      const disabledRestore = await app.request(
        `/api/admin/models/${model.id}/revisions/${seedRevision.revisionNumber}/restore`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ version: enabled.version, disable: true }),
        },
      );
      expect(disabledRestore.status).toBe(200);

      await app.request(`/api/admin/backends/${backendId}?version=1`, {
        method: "DELETE",
        headers,
      });
    } finally {
      await fake.stop();
    }
  });
});
