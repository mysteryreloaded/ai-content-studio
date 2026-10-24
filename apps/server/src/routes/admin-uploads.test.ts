// `/api/admin/uploads` (issue #68): a user's own Uploads, read-only, and
// Remove — failing a still-active Generation that used it, keeping an
// ended one's Assets.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  assets,
  backends,
  generations,
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
    DATA_DIR: "/tmp/ai-content-studio-test-data-admin-uploads",
    SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    BACKENDS_ENABLED: false,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    FFMPEG_CONCURRENCY: 2,
    MAX_UPLOAD_MB: 500,
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
};

describe("/api/admin/uploads (issue #68)", () => {
  const testDb = createTestDatabase("admin_uploads_route_test");
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(assets);
    await db.delete(uploads);
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

  /** A minimal Model/Mode, enough to own a Generation row (no Backend needed: BACKENDS_ENABLED is false and we write state directly). */
  async function minimalModel(userId: string) {
    const { db } = await testDb;
    const [workflow] = await db
      .insert(workflows)
      .values({ hash: "hash-1", json: WORKFLOW, nodeCount: 2, size: 100 })
      .returning();
    const [model] = await db
      .insert(models)
      .values({ name: "M", slug: "m", sortOrder: 0 })
      .returning();
    if (!workflow || !model) throw new Error("setup failed");
    const [revision] = await db
      .insert(modelRevisions)
      .values({
        modelId: model.id,
        revisionNumber: 1,
        workflowHash: workflow.hash,
        inputs: [],
      })
      .returning();
    if (!revision) throw new Error("setup failed");
    const { modes } = await import("../db/schema.js");
    const [mode] = await db
      .insert(modes)
      .values({
        revisionId: revision.id,
        sortOrder: 0,
        name: "Default",
        outputNodes: [
          { nodeId: "2", classType: "SaveImage", title: null, kind: "image" },
        ],
      })
      .returning();
    if (!mode) throw new Error("setup failed");
    const modelId = model.id;
    const revisionId = revision.id;
    const modeId = mode.id;

    async function insertGeneration(
      state: "queued" | "succeeded",
      uploadId: string,
    ) {
      const now = clock.now();
      const id = crypto.randomUUID();
      await db.insert(generations).values({
        id,
        modelId,
        revisionId,
        modeId,
        userId,
        submissionId: crypto.randomUUID(),
        state,
        builtPrompt: {
          "1": { class_type: "LoadImage", inputs: { image: "studio/x.png" } },
        },
        nodeTypes: ["LoadImage", "SaveImage"],
        uploadIds: [uploadId],
        queuedAt: now,
        submittedAt: now,
        endedAt: state === "succeeded" ? now : null,
      });
      return id;
    }

    return { modelId: model.id, modeId: mode.id, insertGeneration };
  }

  async function insertUpload(userId: string) {
    const { db } = await testDb;
    const id = crypto.randomUUID();
    await db.insert(uploads).values({
      id,
      userId,
      status: "complete",
      originalName: "photo.png",
      declaredType: "image/png",
      size: 10,
      storageKey: `uploads/${id}.png`,
      kind: "image",
      extension: "png",
      contentType: "image/png",
      createdAt: clock.now(),
      completedAt: clock.now(),
    });
    return id;
  }

  test("lists a user's own Uploads for an Admin", async () => {
    const { app } = await build();
    const { headers: adminHeaders } = await headersFor("admin");
    const { headers: userHeaders, userId } = await headersFor("user");
    const uploadId = await insertUpload(userId);

    const asUser = await app.request(`/api/admin/uploads?user=${userId}`, {
      headers: userHeaders,
    });
    expect(asUser.status).toBe(403);

    const asAdmin = await app.request(`/api/admin/uploads?user=${userId}`, {
      headers: adminHeaders,
    });
    expect(asAdmin.status).toBe(200);
    const body = (await asAdmin.json()) as { uploads: Array<{ id: string }> };
    expect(body.uploads.map((u) => u.id)).toContain(uploadId);
  });

  test("removing an Upload requires a reason, fails a still-active Generation using it, and keeps an ended one's Assets", async () => {
    const { app } = await build();
    const { db } = await testDb;
    const { headers: adminHeaders } = await headersFor("admin");
    const { userId } = await headersFor("user");
    const uploadId = await insertUpload(userId);
    const { insertGeneration } = await minimalModel(userId);

    const activeGenerationId = await insertGeneration("queued", uploadId);
    const endedGenerationId = await insertGeneration("succeeded", uploadId);
    await db.insert(assets).values({
      generationId: endedGenerationId,
      nodeId: "2",
      sortOrder: 0,
      kind: "image",
      comfyuiFilename: "out.png",
      contentType: "image/png",
      size: 10,
      storageKey: "generations/test/out.png",
    });

    const noReason = await app.request(
      `/api/admin/uploads/${uploadId}/remove`,
      {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ reason: "" }),
      },
    );
    expect(noReason.status).toBe(400);

    const remove = await app.request(`/api/admin/uploads/${uploadId}/remove`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Reported content" }),
    });
    expect(remove.status).toBe(200);

    const [uploadRow] = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    expect(uploadRow?.removedAt).not.toBeNull();
    expect(uploadRow?.removedReason).toBe("Reported content");

    const [active] = await db
      .select()
      .from(generations)
      .where(eq(generations.id, activeGenerationId));
    expect(active?.state).toBe("failed");
    expect(active?.error).toBe("an Upload was removed by an administrator");

    const [ended] = await db
      .select()
      .from(generations)
      .where(eq(generations.id, endedGenerationId));
    expect(ended?.state).toBe("succeeded");
    const endedAssets = await db
      .select()
      .from(assets)
      .where(eq(assets.generationId, endedGenerationId));
    expect(endedAssets.length).toBe(1);

    const second = await app.request(`/api/admin/uploads/${uploadId}/remove`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ reason: "again" }),
    });
    expect(second.status).toBe(409);
  });
});
