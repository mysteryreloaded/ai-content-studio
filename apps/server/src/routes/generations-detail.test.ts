// `/api/generations/:id` (issue #57): one Generation's own detail, and
// deleting it or a whole Submission, into a Tombstone.

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
    DATA_DIR: "/tmp/ai-content-studio-test-data-generations-detail",
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

// A video loader the Mode's output runs off (the fake's object-info
// fixture has no VHS nodes, so LoadVideoCustom's flagged "video" field
// is the loader); only a Video Upload Input can feed it (no
// fixed-file check).
const VIDEO_WORKFLOW = {
  "4": { class_type: "LoadVideoCustom", inputs: { video: "" } },
  "3": { class_type: "SaveImage", inputs: { images: ["4", 0] } },
};

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("/api/generations/:id (issue #57)", () => {
  const testDb = createTestDatabase("generations_detail_route_test");
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
  ): Promise<{ generationId: string; submissionId: string }> {
    const res = await app.request(`/api/models/${slug}/generations`, {
      method: "POST",
      headers: { ...userHeaders, "content-type": "application/json" },
      body: JSON.stringify({ modeId, revision: 2 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      generations: Array<{ id: string; submissionId: string }>;
    };
    const first = body.generations[0];
    if (!first) throw new Error("submit created no Generation");
    return { generationId: first.id, submissionId: first.submissionId };
  }

  /** Like `buildEnabledModel`, but a `VIDEO_WORKFLOW` Model with one trimmable video Upload Input bound to the loader (issue #51/#190). */
  async function buildEnabledModelWithVideo(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
    name: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name, workflow: VIDEO_WORKFLOW }),
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

    const videoInputId = "22222222-2222-2222-2222-222222222222";
    const inputsRes = await app.request(
      `/api/admin/models/${model.id}/inputs`,
      {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          version: model.version,
          inputs: [
            {
              id: videoInputId,
              kind: "video_upload",
              group: "describe",
              label: "Clip",
              help: "",
              maxSizeMb: 50,
              maxLongSide: null,
              minDurationMs: 0,
              maxDurationMs: 10_000,
              trimmable: true,
              bindings: [
                {
                  nodeId: "4",
                  field: "video",
                  classType: "LoadVideoCustom",
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
      modelId: model.id as string,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
      revision: afterModes.currentRevision,
      videoInputId,
    };
  }

  test("404s for someone else's Generation, and for a missing id", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: ownerHeaders } = await headersFor("user", "-owner");
      const { headers: otherHeaders } = await headersFor("user", "-other");

      const { generationId } = await submit(
        app,
        ownerHeaders,
        model.slug,
        model.modeId,
      );

      const asOwner = await app.request(`/api/generations/${generationId}`, {
        headers: ownerHeaders,
      });
      expect(asOwner.status).toBe(200);

      const asOther = await app.request(`/api/generations/${generationId}`, {
        headers: otherHeaders,
      });
      expect(asOther.status).toBe(404);

      const missing = await app.request(
        "/api/generations/00000000-0000-0000-0000-000000000000",
        { headers: ownerHeaders },
      );
      expect(missing.status).toBe(404);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("shows the Model, Mode, times and id of an ended Generation", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      const endedAt = clock.now();
      await db
        .update(generations)
        .set({ state: "succeeded", startedAt: endedAt, endedAt })
        .where(eq(generations.id, generationId));

      const res = await app.request(`/api/generations/${generationId}`, {
        headers: userHeaders,
      });
      expect(res.status).toBe(200);
      const detail = (await res.json()) as {
        id: string;
        state: string;
        modelName: string;
        modeName: string;
        deletedAt: string | null;
        settings: unknown[];
      };
      expect(detail.id).toBe(generationId);
      expect(detail.state).toBe("succeeded");
      expect(detail.modeName).toBe("Default");
      expect(detail.deletedAt).toBeNull();
      expect(Array.isArray(detail.settings)).toBe(true);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("deleting an ended Generation leaves a Tombstone and clears its Assets", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      await db
        .update(generations)
        .set({ state: "succeeded", endedAt: clock.now() })
        .where(eq(generations.id, generationId));
      await db.insert(assets).values({
        generationId,
        nodeId: "3",
        sortOrder: 0,
        kind: "image",
        comfyuiFilename: "out.png",
        contentType: "image/png",
        size: 10,
        storageKey: "generations/test/out.png",
      });

      const del = await app.request(`/api/generations/${generationId}`, {
        method: "DELETE",
        headers: userHeaders,
      });
      expect(del.status).toBe(200);

      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generationId));
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.builtPrompt).toEqual({});
      expect(row?.nodeTypes).toEqual([]);
      expect(row?.uploadIds).toEqual([]);
      // The owner, Model, Mode and state stay (CONTEXT.md's Tombstone).
      expect(row?.modelId).toBe(model.modelId);
      expect(row?.modeId).toBe(model.modeId);
      expect(row?.state).toBe("succeeded");

      const remainingAssets = await db
        .select()
        .from(assets)
        .where(eq(assets.generationId, generationId));
      expect(remainingAssets).toEqual([]);

      // 404 once it's already a Tombstone.
      const detail = await app.request(`/api/generations/${generationId}`, {
        headers: userHeaders,
      });
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as { settings: unknown[] };
      expect(body.settings).toEqual([]);

      const redelete = await app.request(`/api/generations/${generationId}`, {
        method: "DELETE",
        headers: userHeaders,
      });
      expect(redelete.status).toBe(404);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("refuses to delete a Generation that's still under way", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );

      const del = await app.request(`/api/generations/${generationId}`, {
        method: "DELETE",
        headers: userHeaders,
      });
      expect(del.status).toBe(404);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("deleting a Submission tombstones every one of its Generations", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId, submissionId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      const [first] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generationId));
      if (!first) throw new Error("missing Generation");
      await db.insert(generations).values({
        id: crypto.randomUUID(),
        modelId: first.modelId,
        revisionId: first.revisionId,
        modeId: first.modeId,
        userId: first.userId,
        submissionId: first.submissionId,
        state: "succeeded",
        queuedAt: first.submittedAt,
        endedAt: clock.now(),
        builtPrompt: first.builtPrompt,
        nodeTypes: first.nodeTypes,
        submittedAt: first.submittedAt,
      });
      await db
        .update(generations)
        .set({ state: "succeeded", endedAt: clock.now() })
        .where(eq(generations.id, generationId));

      const del = await app.request(`/api/submissions/${submissionId}`, {
        method: "DELETE",
        headers: userHeaders,
      });
      expect(del.status).toBe(200);

      const rows = await db
        .select()
        .from(generations)
        .where(eq(generations.submissionId, submissionId));
      expect(rows.length).toBe(2);
      for (const row of rows) expect(row.deletedAt).not.toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a Tombstone is left out of the Gallery and the Workbench's recent list, but still counts toward the daily Cap", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      await db
        .update(generations)
        .set({ state: "succeeded", endedAt: clock.now() })
        .where(eq(generations.id, generationId));

      const del = await app.request(`/api/generations/${generationId}`, {
        method: "DELETE",
        headers: userHeaders,
      });
      expect(del.status).toBe(200);

      const galleryRes = await app.request("/api/gallery", {
        headers: userHeaders,
      });
      expect(galleryRes.status).toBe(200);
      const gallery = (await galleryRes.json()) as {
        submissions: Array<{ submissionId: string }>;
      };
      expect(gallery.submissions).toEqual([]);

      const recentRes = await app.request(
        `/api/models/${model.slug}/generations`,
        { headers: userHeaders },
      );
      expect(recentRes.status).toBe(200);
      const recent = (await recentRes.json()) as {
        submissions: Array<{ submissionId: string }>;
      };
      expect(recent.submissions).toEqual([]);

      const capsRes = await app.request("/api/generations/caps", {
        headers: userHeaders,
      });
      expect(capsRes.status).toBe(200);
      const caps = (await capsRes.json()) as { dailyUsed: number };
      expect(caps.dailyUsed).toBe(1);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("deleting a Generation drops an Upload used only there, but keeps one a non-deleted Generation still shares", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders, userId } = await headersFor("user");

      const { generationId: deletedId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );
      const [deletedRow] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, deletedId));
      if (!deletedRow) throw new Error("missing Generation");

      const sharedUploadId = crypto.randomUUID();
      const onlyUploadId = crypto.randomUUID();
      const now = clock.now();
      await db.insert(uploads).values([
        {
          id: sharedUploadId,
          userId,
          status: "complete",
          originalName: "shared.png",
          declaredType: "image/png",
          size: 10,
          storageKey: "uploads/test/shared.png",
          createdAt: now,
        },
        {
          id: onlyUploadId,
          userId,
          status: "complete",
          originalName: "only.png",
          declaredType: "image/png",
          size: 10,
          storageKey: "uploads/test/only.png",
          createdAt: now,
        },
      ]);
      await db
        .update(generations)
        .set({
          state: "succeeded",
          endedAt: now,
          uploadIds: [sharedUploadId, onlyUploadId],
        })
        .where(eq(generations.id, deletedId));

      // A second, non-deleted Generation that still uses the shared Upload.
      await db.insert(generations).values({
        id: crypto.randomUUID(),
        modelId: deletedRow.modelId,
        revisionId: deletedRow.revisionId,
        modeId: deletedRow.modeId,
        userId: deletedRow.userId,
        submissionId: crypto.randomUUID(),
        state: "succeeded",
        queuedAt: deletedRow.submittedAt,
        endedAt: now,
        builtPrompt: deletedRow.builtPrompt,
        nodeTypes: deletedRow.nodeTypes,
        uploadIds: [sharedUploadId],
        submittedAt: deletedRow.submittedAt,
      });

      const del = await app.request(`/api/generations/${deletedId}`, {
        method: "DELETE",
        headers: userHeaders,
      });
      expect(del.status).toBe(200);

      const [sharedRow] = await db
        .select()
        .from(uploads)
        .where(eq(uploads.id, sharedUploadId));
      expect(sharedRow).toBeDefined();

      const [onlyRow] = await db
        .select()
        .from(uploads)
        .where(eq(uploads.id, onlyUploadId));
      expect(onlyRow).toBeUndefined();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a trimmed video's detail shows the range kept and the original's name; the range survives when the original is gone (issue #190)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId, revision, videoInputId } =
        await buildEnabledModelWithVideo(app, adminHeaders, fake.url, "V");

      const { headers: userHeaders, userId } = await headersFor("user");
      const originalId = crypto.randomUUID();
      const trimmedId = crypto.randomUUID();
      const plainId = crypto.randomUUID();
      await db.insert(uploads).values([
        {
          id: originalId,
          userId,
          status: "complete",
          originalName: "original.mp4",
          declaredType: "video/mp4",
          size: 10_000,
          storageKey: "uploads/test/original.mp4",
          kind: "video",
          extension: "mp4",
          width: 1920,
          height: 1080,
          durationMs: 5000,
          fps: 25,
          createdAt: clock.now(),
        },
        {
          id: trimmedId,
          userId,
          status: "complete",
          originalName: "clip.mp4",
          declaredType: "video/mp4",
          size: 8_000,
          storageKey: "uploads/test/clip.mp4",
          kind: "video",
          extension: "mp4",
          width: 1920,
          height: 1080,
          durationMs: 5500,
          fps: 25,
          trimmedFromId: originalId,
          trimStartMs: 2000,
          trimEndMs: 7500,
          createdAt: clock.now(),
        },
        {
          id: plainId,
          userId,
          status: "complete",
          originalName: "plain.mp4",
          declaredType: "video/mp4",
          size: 8_000,
          storageKey: "uploads/test/plain.mp4",
          kind: "video",
          extension: "mp4",
          width: 1280,
          height: 720,
          durationMs: 4000,
          createdAt: clock.now(),
        },
      ]);

      const submit = (uploadId: string) =>
        app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            modeId,
            revision,
            values: { [videoInputId]: uploadId },
          }),
        });

      const trimmedRes = await submit(trimmedId);
      expect(trimmedRes.status).toBe(201);
      const trimmed = (await trimmedRes.json()) as {
        generations: Array<{ id: string }>;
      };
      const trimmedGenId = trimmed.generations[0]?.id;
      if (!trimmedGenId) throw new Error("submit created no Generation");
      clock.advance(1_000);

      type UploadFacts = {
        id: string;
        name: string;
        size: number;
        durationMs: number | null;
        width: number | null;
        height: number | null;
        thumbnailKey: string | null;
        trimmedFromName: string | null;
        trimStartMs: number | null;
        trimEndMs: number | null;
        removed: boolean;
      };
      const detail = async () => {
        const res = await app.request(`/api/generations/${trimmedGenId}`, {
          headers: userHeaders,
        });
        expect(res.status).toBe(200);
        return (await res.json()) as {
          assets: Array<{
            kind: string;
            size: number;
            width: number | null;
            height: number | null;
            durationMs: number | null;
            fps: number | null;
          }>;
          settings: Array<{
            inputId: string;
            label: string;
            kind: string;
            display: string;
            upload: UploadFacts | null;
          }>;
        };
      };

      const first = await detail();
      // The trimmed Upload's own facts: the range kept, the original's
      // name, nothing removed.
      expect(first.settings).toEqual([
        {
          inputId: videoInputId,
          label: "Clip",
          kind: "upload",
          display: "clip.mp4",
          upload: {
            id: trimmedId,
            name: "clip.mp4",
            size: 8_000,
            durationMs: 5500,
            width: 1920,
            height: 1080,
            thumbnailKey: null,
            trimmedFromName: "original.mp4",
            trimStartMs: 2000,
            trimEndMs: 7500,
            removed: false,
          },
        },
      ]);

      // The original gets deleted: the range kept is the trimmed
      // Upload's own columns, so it stays; only the original's name is
      // gone (issue #51/#190).
      await db.delete(uploads).where(eq(uploads.id, originalId));
      const afterDelete = await detail();
      expect(afterDelete.settings[0]?.upload).toMatchObject({
        name: "clip.mp4",
        trimmedFromName: null,
        trimStartMs: 2000,
        trimEndMs: 7500,
        removed: false,
      });

      // A non-trimmed video Upload: all three trim facts null.
      const plainRes = await submit(plainId);
      expect(plainRes.status).toBe(201);
      const plain = (await plainRes.json()) as {
        generations: Array<{ id: string }>;
      };
      const plainGenId = plain.generations[0]?.id;
      if (!plainGenId) throw new Error("submit created no Generation");
      const plainDetail = await app.request(`/api/generations/${plainGenId}`, {
        headers: userHeaders,
      });
      expect(plainDetail.status).toBe(200);
      const plainBody = (await plainDetail.json()) as {
        settings: Array<{
          inputId: string;
          display: string;
          upload: UploadFacts | null;
        }>;
      };
      expect(plainBody.settings[0]?.display).toBe("plain.mp4");
      expect(plainBody.settings[0]?.upload).toMatchObject({
        id: plainId,
        name: "plain.mp4",
        trimmedFromName: null,
        trimStartMs: null,
        trimEndMs: null,
        removed: false,
      });

      // The main Asset's own finishing facts (issue #190's detail shape).
      await db.insert(assets).values({
        generationId: trimmedGenId,
        nodeId: "3",
        sortOrder: 0,
        kind: "video",
        comfyuiFilename: "ComfyUI_00001_.mp4",
        contentType: "video/mp4",
        size: 8_000,
        storageKey: "assets/test/ComfyUI_00001_.mp4",
        width: 1920,
        height: 1080,
        durationMs: 5500,
        fps: 25,
      });
      const withAsset = await detail();
      expect(withAsset.assets).toHaveLength(1);
      expect(withAsset.assets[0]).toMatchObject({
        kind: "video",
        size: 8_000,
        width: 1920,
        height: 1080,
        durationMs: 5500,
        fps: 25,
      });

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
