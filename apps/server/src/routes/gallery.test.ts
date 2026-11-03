// `/api/gallery`: the signed-in user's own Gallery across every Model
// (issue #56) — filters by Model and state, paged by cursor.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  assets,
  backends,
  generations,
  logEntries,
  modelBackends,
  modelRevisions,
  models,
  uploads,
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
    LOG_RETENTION_DAYS: 30,
    MAX_UPLOAD_MB: 500,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "2": { class_type: "KSampler", inputs: { seed: 0, model: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("/api/gallery", () => {
  const testDb = createTestDatabase("gallery_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(assets);
    await db.delete(uploads);
    await db.delete(generations);
    await db.delete(logEntries);
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

  async function headersFor(role: "admin" | "user", suffix = "") {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: `sub-${role}${suffix}`,
        email: `${role}${suffix}@example.com`,
        name: `${role}${suffix}`,
        role,
        status: "active",
      })
      .returning();
    if (!user) throw new Error("failed to insert user");
    const session = await createSession(db, clock, user.id);
    return {
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
      },
      userId: user.id,
    };
  }

  /** Builds a fully enabled Model with one Mode, attached to a reachable fake Backend. */
  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
    name: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name, workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Fake-${name}`,
        baseUrl: fakeUrl,
        auth: "none",
      }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        version: model.version,
        modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      }),
    });
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { id: string; version: number };
      modes: Array<{ id: string; name: string }>;
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

    return {
      modelId: model.id as string,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
    };
  }

  async function submit(
    app: Awaited<ReturnType<typeof build>>["app"],
    userHeaders: Record<string, string>,
    slug: string,
    modeId: string,
  ): Promise<string> {
    const res = await app.request(`/api/models/${slug}/generations`, {
      method: "POST",
      headers: { ...userHeaders, "content-type": "application/json" },
      body: JSON.stringify({ modeId, revision: 2 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      generations: Array<{ submissionId: string }>;
    };
    const submissionId = body.generations[0]?.submissionId;
    if (!submissionId) throw new Error("submit returned no submissionId");
    return submissionId;
  }

  /** Like `buildEnabledModel`, but with a text Input bound to node "1"'s `image` field, standing in for a prompt (issue #47). */
  async function buildEnabledModelWithPrompt(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
    name: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name, workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Fake-${name}-prompt`,
        baseUrl: fakeUrl,
        auth: "none",
      }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const promptInputId = "77777777-7777-7777-7777-777777777777";
    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          inputs: [
            {
              id: promptInputId,
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
                  field: "image",
                  classType: "LoadImage",
                  title: null,
                },
              ],
            },
          ],
        }),
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
        modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      }),
    });
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { id: string; version: number; currentRevision: number };
      modes: Array<{ id: string; name: string }>;
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

    return {
      modelId: model.id,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
      revision: afterModes.currentRevision,
      promptInputId,
    };
  }

  /** Like `buildEnabledModel`, but with one image Upload Input bound to node "1"'s `image` field (issue #190's list thumbnails). */
  async function buildEnabledModelWithUpload(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
    name: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name, workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: `Fake-${name}-upload`,
        baseUrl: fakeUrl,
        auth: "none",
      }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const uploadInputId = "66666666-6666-4666-8666-666666666666";
    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          inputs: [
            {
              id: uploadInputId,
              kind: "image_upload",
              group: "describe",
              label: "Photo",
              help: "",
              maxSizeMb: 5,
              maxLongSide: 300,
              bindings: [
                {
                  nodeId: "1",
                  field: "image",
                  classType: "LoadImage",
                  title: null,
                },
              ],
            },
          ],
        }),
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
        modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      }),
    });
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { id: string; version: number; currentRevision: number };
      modes: Array<{ id: string; name: string }>;
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

    return {
      modelId: model.id,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
      revision: afterModes.currentRevision,
      uploadInputId,
    };
  }

  test("lists this user's Submissions across every Model, newest first", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const modelA = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model A",
      );
      const modelB = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model B",
      );

      const { headers: userHeaders, userId } = await headersFor("user");
      const sub1 = await submit(app, userHeaders, modelA.slug, modelA.modeId);
      clock.advance(1_000);
      const sub2 = await submit(app, userHeaders, modelA.slug, modelA.modeId);
      clock.advance(1_000);
      const sub3 = await submit(app, userHeaders, modelB.slug, modelB.modeId);

      const res = await app.request("/api/gallery", {
        headers: userHeaders,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        submissions: Array<{ submissionId: string; modelId: string }>;
        hasMore: boolean;
      };
      expect(body.submissions.map((s) => s.submissionId)).toEqual([
        sub3,
        sub2,
        sub1,
      ]);
      expect(body.hasMore).toBe(false);
      for (const submission of body.submissions) {
        expect(
          [modelA.modelId, modelB.modelId].includes(submission.modelId),
        ).toBe(true);
      }
      expect(userId).toBeTruthy();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("filters by Model and paginates by cursor", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const modelA = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model A",
      );
      const modelB = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model B",
      );

      const { headers: userHeaders } = await headersFor("user");
      const sub1 = await submit(app, userHeaders, modelA.slug, modelA.modeId);
      clock.advance(1_000);
      const sub2 = await submit(app, userHeaders, modelA.slug, modelA.modeId);
      clock.advance(1_000);
      await submit(app, userHeaders, modelB.slug, modelB.modeId);

      const filtered = await app.request(
        `/api/gallery?model=${modelA.modelId}`,
        { headers: userHeaders },
      );
      const filteredBody = (await filtered.json()) as {
        submissions: Array<{ submissionId: string }>;
      };
      expect(filteredBody.submissions.map((s) => s.submissionId)).toEqual([
        sub2,
        sub1,
      ]);

      const page1 = await app.request(
        `/api/gallery?model=${modelA.modelId}&limit=1`,
        { headers: userHeaders },
      );
      const page1Body = (await page1.json()) as {
        submissions: Array<{ submissionId: string; submittedAt: string }>;
        hasMore: boolean;
      };
      expect(page1Body.submissions.map((s) => s.submissionId)).toEqual([sub2]);
      expect(page1Body.hasMore).toBe(true);

      const cursorAt = page1Body.submissions[0]?.submittedAt as string;
      const cursorId = page1Body.submissions[0]?.submissionId as string;
      const page2 = await app.request(
        `/api/gallery?model=${modelA.modelId}&limit=1&afterSubmittedAt=${encodeURIComponent(cursorAt)}&afterSubmissionId=${cursorId}`,
        { headers: userHeaders },
      );
      const page2Body = (await page2.json()) as {
        submissions: Array<{ submissionId: string }>;
        hasMore: boolean;
      };
      expect(page2Body.submissions.map((s) => s.submissionId)).toEqual([sub1]);
      expect(page2Body.hasMore).toBe(false);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a Submission with mixed-state Generations comes back whole under either state it holds", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const modelA = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model A",
      );

      const { headers: userHeaders } = await headersFor("user");
      const submissionId = await submit(
        app,
        userHeaders,
        modelA.slug,
        modelA.modeId,
      );
      const [first] = await db
        .select()
        .from(generations)
        .where(eq(generations.submissionId, submissionId));
      if (!first) throw new Error("submit created no Generation row");

      // A second variant of the same Submission, already succeeded,
      // while the first stays queued (ADR 0007: variants share a
      // submission_id and submitted_at).
      await db.insert(generations).values({
        id: crypto.randomUUID(),
        modelId: first.modelId,
        revisionId: first.revisionId,
        modeId: first.modeId,
        userId: first.userId,
        submissionId: first.submissionId,
        state: "succeeded",
        queuedAt: first.submittedAt,
        builtPrompt: first.builtPrompt,
        nodeTypes: first.nodeTypes,
        submittedAt: first.submittedAt,
      });

      for (const state of ["underway", "finished"]) {
        const res = await app.request(`/api/gallery?state=${state}`, {
          headers: userHeaders,
        });
        const body = (await res.json()) as {
          submissions: Array<{
            submissionId: string;
            generations: Array<{ state: string }>;
          }>;
        };
        expect(body.submissions.map((s) => s.submissionId)).toEqual([
          submissionId,
        ]);
        expect(
          body.submissions[0]?.generations.map((g) => g.state).sort(),
        ).toEqual(["queued", "succeeded"]);
      }

      const failed = await app.request("/api/gallery?state=failed", {
        headers: userHeaders,
      });
      const failedBody = (await failed.json()) as { submissions: unknown[] };
      expect(failedBody.submissions).toEqual([]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("filters by state bucket: queued Submissions are under way, not finished or failed", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const modelA = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model A",
      );

      const { headers: userHeaders } = await headersFor("user");
      const sub1 = await submit(app, userHeaders, modelA.slug, modelA.modeId);

      const underway = await app.request("/api/gallery?state=underway", {
        headers: userHeaders,
      });
      const underwayBody = (await underway.json()) as {
        submissions: Array<{ submissionId: string }>;
      };
      expect(underwayBody.submissions.map((s) => s.submissionId)).toEqual([
        sub1,
      ]);

      const finished = await app.request("/api/gallery?state=finished", {
        headers: userHeaders,
      });
      const finishedBody = (await finished.json()) as {
        submissions: unknown[];
      };
      expect(finishedBody.submissions).toEqual([]);

      const failed = await app.request("/api/gallery?state=failed", {
        headers: userHeaders,
      });
      const failedBody = (await failed.json()) as { submissions: unknown[] };
      expect(failedBody.submissions).toEqual([]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("never shows another user's Submissions", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const modelA = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model A",
      );

      const { headers: ownerHeaders } = await headersFor("user", "-owner");
      await submit(app, ownerHeaders, modelA.slug, modelA.modeId);

      const { headers: otherHeaders } = await headersFor("user", "-other");
      const res = await app.request("/api/gallery", {
        headers: otherHeaders,
      });
      const body = (await res.json()) as { submissions: unknown[] };
      expect(body.submissions).toEqual([]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("/api/gallery/models: used Models in Admin order, a deleted one sorted last", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const modelA = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model A",
      );
      const modelB = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Model B",
      );

      const { headers: userHeaders } = await headersFor("user");
      // Submitted to B first, A second: the filter list still follows
      // Admin (sortOrder) order, not usage order.
      await submit(app, userHeaders, modelB.slug, modelB.modeId);
      await submit(app, userHeaders, modelA.slug, modelA.modeId);

      const before = await app.request("/api/gallery/models", {
        headers: userHeaders,
      });
      const beforeBody = (await before.json()) as {
        models: Array<{ id: string; deleted: boolean }>;
      };
      expect(beforeBody.models.map((m) => m.id)).toEqual([
        modelA.modelId,
        modelB.modelId,
      ]);
      expect(beforeBody.models.every((m) => !m.deleted)).toBe(true);

      // Soft-delete Model A directly (bypassing the "has unfinished
      // Generations" guard, which isn't what this test is about).
      await db
        .update(models)
        .set({ deletedAt: clock.now() })
        .where(eq(models.id, modelA.modelId));

      const after = await app.request("/api/gallery/models", {
        headers: userHeaders,
      });
      const afterBody = (await after.json()) as {
        models: Array<{ id: string; deleted: boolean }>;
      };
      expect(afterBody.models.map((m) => m.id)).toEqual([
        modelB.modelId,
        modelA.modelId,
      ]);
      expect(
        afterBody.models.find((m) => m.id === modelA.modelId)?.deleted,
      ).toBe(true);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("shows a Submission's prompt — a custom one as-is, a blank one as the Model's own value, prefixed (issue #190)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const plain = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
        "Plain Model",
      );
      const prompted = await buildEnabledModelWithPrompt(
        app,
        adminHeaders,
        fake.url,
        "Prompt Model",
      );

      const { headers: userHeaders } = await headersFor("user");
      // The plain Model's revision is 2 (create + one Modes PUT); the
      // prompt Model's is 3 (an extra Inputs PUT bumped it).
      await submit(app, userHeaders, plain.slug, plain.modeId);
      clock.advance(1_000);
      const customRes = await app.request(
        `/api/models/${prompted.slug}/generations`,
        {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId: prompted.modeId,
            revision: prompted.revision,
            values: { [prompted.promptInputId]: "a red fox" },
          }),
        },
      );
      expect(customRes.status).toBe(201);
      clock.advance(1_000);
      const blankRes = await app.request(
        `/api/models/${prompted.slug}/generations`,
        {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId: prompted.modeId,
            revision: prompted.revision,
          }),
        },
      );
      expect(blankRes.status).toBe(201);

      const res = await app.request("/api/gallery", { headers: userHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        submissions: Array<{
          modelName: string;
          prompt: string | null;
          uploads: unknown[];
        }>;
      };
      // Newest first: the two prompt Model Submissions, then the plain one.
      expect(body.submissions.map((s) => s.modelName)).toEqual([
        "Prompt Model",
        "Prompt Model",
        "Plain Model",
      ]);
      // No Upload Inputs on any of these Models: nothing to show.
      expect(body.submissions.every((s) => s.uploads.length === 0)).toBe(true);
      // A blank prompt falls back to the Workflow's own value, prefixed
      // (issue #47's rule); a custom one shows as-is.
      expect(body.submissions[0]?.prompt).toBe("Default prompt: example.png");
      expect(body.submissions[1]?.prompt).toBe("a red fox");
      // The plain Model has no text Input: no prompt to show.
      expect(body.submissions[2]?.prompt).toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("shows a Submission's used Uploads — a removed one flagged without a thumbnail (issue #190)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId, revision, uploadInputId } =
        await buildEnabledModelWithUpload(
          app,
          adminHeaders,
          fake.url,
          "Upload Model",
        );

      const { headers: userHeaders, userId } = await headersFor("user");
      const uploadAId = crypto.randomUUID();
      const uploadBId = crypto.randomUUID();
      await db.insert(uploads).values([
        {
          id: uploadAId,
          userId,
          status: "complete",
          originalName: "a.png",
          declaredType: "image/png",
          size: 10,
          storageKey: "uploads/gallery-test/a.png",
          kind: "image",
          extension: "png",
          width: 100,
          height: 100,
          thumbnailKey: "uploads/gallery-test/a.thumb.png",
          createdAt: clock.now(),
        },
        {
          id: uploadBId,
          userId,
          status: "complete",
          originalName: "b.png",
          declaredType: "image/png",
          size: 10,
          storageKey: "uploads/gallery-test/b.png",
          kind: "image",
          extension: "png",
          width: 100,
          height: 100,
          thumbnailKey: "uploads/gallery-test/b.thumb.png",
          createdAt: clock.now(),
        },
      ]);

      // Each Submission uses one Upload; the first one is later removed
      // by an Admin (its file is gone — issue #68).
      const submitOne = (uploadId: string) =>
        app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId,
            revision,
            values: { [uploadInputId]: uploadId },
          }),
        });
      expect((await submitOne(uploadAId)).status).toBe(201);
      clock.advance(1_000);
      expect((await submitOne(uploadBId)).status).toBe(201);

      await db
        .update(uploads)
        .set({ removedAt: clock.now(), removedReason: "too large" })
        .where(eq(uploads.id, uploadAId));

      const res = await app.request("/api/gallery", { headers: userHeaders });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        submissions: Array<{
          prompt: string | null;
          uploads: Array<{
            id: string;
            kind: "image" | "video" | "audio";
            thumbnailKey: string | null;
            removed: boolean;
          }>;
        }>;
      };
      // No text Input on this Model: no prompt to show.
      expect(body.submissions.every((s) => s.prompt === null)).toBe(true);
      // Newest first: B (kept its thumbnail), then A (removed: flagged,
      // no thumbnail).
      expect(body.submissions[0]?.uploads).toEqual([
        {
          id: uploadBId,
          kind: "image",
          thumbnailKey: "uploads/gallery-test/b.thumb.png",
          removed: false,
        },
      ]);
      expect(body.submissions[1]?.uploads).toEqual([
        {
          id: uploadAId,
          kind: "image",
          thumbnailKey: null,
          removed: true,
        },
      ]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
