// `/api/auth/account` DELETE (issue #63): a user's self-delete.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { desc, eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { SESSION_COOKIE_NAME, createSession } from "../auth/session.js";
import {
  assets,
  auditEntries,
  backends,
  generations,
  logEntries,
  modelBackends,
  modelRevisions,
  models,
  sessions,
  uploads,
  users,
  workflows,
} from "../db/schema.js";
import type { Env } from "../env.js";
import { deleteStorageFor } from "../generations/deletion.js";
import { GenerationsRepository } from "../generations/repository.js";
import type { Logger } from "../logger.js";
import { createLocalStorage } from "../storage/storage.js";
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
    DATA_DIR: "/tmp/ai-content-studio-test-data-account-deletion",
    SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
    BACKENDS_ENABLED: true,
    STATUS_TOKEN: undefined,
    MIN_FREE_DISK_GB: 10,
    FFMPEG_CONCURRENCY: 2,
    MAX_UPLOAD_MB: 500,
    LOG_RETENTION_DAYS: 30,
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

describe("DELETE /api/auth/account (issue #63)", () => {
  const testDb = createTestDatabase("account_deletion_route_test");
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
    await db.delete(sessions);
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

  async function insertUser(overrides: Partial<typeof users.$inferInsert>) {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: crypto.randomUUID(),
        email: `${crypto.randomUUID()}@example.com`,
        name: "Test User",
        role: "user",
        status: "active",
        ...overrides,
      })
      .returning();
    if (!user) throw new Error("failed to insert user");
    return user;
  }

  async function headersFor(userId: string) {
    const { db } = await testDb;
    const session = await createSession(db, clock, userId);
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
      "content-type": "application/json",
    };
  }

  async function buildEnabledModel(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    fakeUrl: string,
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "M", workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "Fake", baseUrl: fakeUrl, auth: "none" }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ backendId: backend.id }),
    });

    clock.advance(30_000);
    await flushMicrotasks();

    const modesRes = await app.request(`/api/admin/models/${model.id}/modes`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        version: model.version,
        modes: [{ name: "Default", description: "", outputNodeIds: ["3"] }],
      }),
    });
    const { record: afterModes, modes } = (await modesRes.json()) as {
      record: { id: string; version: number };
      modes: Array<{ id: string; name: string }>;
    };

    await app.request(`/api/admin/models/${model.id}/enable`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ version: afterModes.version }),
    });

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
      headers: userHeaders,
      body: JSON.stringify({ modeId, revision: 2 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { generations: Array<{ id: string }> };
    const first = body.generations[0];
    if (!first) throw new Error("submit created no Generation");
    return first.id;
  }

  /**
   * Inserts a Generation row directly in a given `state` (round 4's new
   * tests): the real submission endpoint refuses below `MIN_FREE_DISK_GB`
   * (issue #50), which a long-running CI box can trip over after many
   * other tests' own real Storage writes — these tests only need a row
   * to flag/finalize, not an actual dispatched run.
   */
  async function insertGeneration(
    modelId: string,
    modeId: string,
    userId: string,
    state: typeof generations.$inferInsert.state,
    uploadIds: string[] = [],
  ): Promise<string> {
    const { db } = await testDb;
    const [revision] = await db
      .select({ id: modelRevisions.id })
      .from(modelRevisions)
      .where(eq(modelRevisions.modelId, modelId))
      .orderBy(desc(modelRevisions.revisionNumber))
      .limit(1);
    if (!revision) throw new Error("no revision for this Model");
    const [row] = await db
      .insert(generations)
      .values({
        id: crypto.randomUUID(),
        modelId,
        revisionId: revision.id,
        modeId,
        userId,
        submissionId: crypto.randomUUID(),
        state,
        builtPrompt: {},
        nodeTypes: [],
        uploadIds,
        queuedAt: clock.now(),
        submittedAt: clock.now(),
      })
      .returning({ id: generations.id });
    if (!row) throw new Error("insert returned no row");
    return row.id;
  }

  test("refuses a wrong email, with no change to the account", async () => {
    const { app } = await build();
    const user = await insertUser({});
    const headers = await headersFor(user.id);

    const res = await app.request("/api/auth/account", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ email: "not-this-user@example.com" }),
    });
    expect(res.status).toBe(400);

    const { db } = await testDb;
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.email).toBe(user.email);
  });

  test("refuses an Admin's own account", async () => {
    const { app } = await build();
    const admin = await insertUser({ role: "admin" });
    const headers = await headersFor(admin.id);

    const res = await app.request("/api/auth/account", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ email: admin.email }),
    });
    expect(res.status).toBe(403);

    const { db } = await testDb;
    const [row] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(row?.status).toBe("active");
  });

  test("scrubs the row, drops every session and records a name/email-free Audit entry", async () => {
    const { app } = await build();
    const user = await insertUser({});
    const otherSession = await (async () => {
      const { db } = await testDb;
      return createSession(db, clock, user.id);
    })();
    const headers = await headersFor(user.id);

    const res = await app.request("/api/auth/account", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ email: user.email }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain(
      `${SESSION_COOKIE_NAME}=;`,
    );

    const { db } = await testDb;
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.name).toBe("Deleted user");
    expect(row?.email).toBe("");
    expect(row?.status).toBe("disabled");
    expect(row?.googleSub).not.toBe(user.googleSub);

    const remainingSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id));
    expect(remainingSessions).toEqual([]);
    expect(otherSession.cookieValue).toBeTruthy();

    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetId, user.id));
    expect(entry?.actorType).toBe("user");
    expect(entry?.actorUserId).toBe(user.id);
    expect(entry?.actorEmail).toBeNull();
    expect(entry?.actorIp).toBeNull();
    expect(entry?.actorUserAgent).toBeNull();
    expect(JSON.stringify(entry?.before)).not.toContain(user.email);
    expect(JSON.stringify(entry?.after)).not.toContain(user.email);
  });

  test("cancels work under way and Tombstones every ended Generation, removing its Assets", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const admin = await insertUser({ role: "admin", status: "active" });
      const adminHeaders = await headersFor(admin.id);
      const model = await buildEnabledModel(app, adminHeaders, fake.url);

      const user = await insertUser({});
      const userHeaders = await headersFor(user.id);

      const endedId = await submit(app, userHeaders, model.slug, model.modeId);
      await db
        .update(generations)
        .set({ state: "succeeded", endedAt: clock.now() })
        .where(eq(generations.id, endedId));
      await db.insert(assets).values({
        generationId: endedId,
        nodeId: "3",
        sortOrder: 0,
        kind: "image",
        comfyuiFilename: "out.png",
        contentType: "image/png",
        size: 10,
        storageKey: "generations/test/out.png",
      });

      const queuedId = await submit(app, userHeaders, model.slug, model.modeId);

      const res = await app.request("/api/auth/account", {
        method: "DELETE",
        headers: userHeaders,
        body: JSON.stringify({ email: user.email }),
      });
      expect(res.status).toBe(200);

      const [endedRow] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, endedId));
      expect(endedRow?.deletedAt).not.toBeNull();
      expect(endedRow?.builtPrompt).toEqual({});
      const remainingAssets = await db
        .select()
        .from(assets)
        .where(eq(assets.generationId, endedId));
      expect(remainingAssets).toEqual([]);

      const [queuedRow] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, queuedId));
      expect(queuedRow?.state).toBe("cancelled");
      expect(queuedRow?.deletedAt).not.toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("flags a `running` Generation for deletion, and the runner's own terminal write Tombstones it once it ends (round 4)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const storage = createLocalStorage(testEnv().DATA_DIR);
      const generationsRepository = new GenerationsRepository(db);
      const admin = await insertUser({ role: "admin", status: "active" });
      const adminHeaders = await headersFor(admin.id);
      const model = await buildEnabledModel(app, adminHeaders, fake.url);

      const user = await insertUser({});
      const userHeaders = await headersFor(user.id);

      const runningId = await insertGeneration(
        model.modelId,
        model.modeId,
        user.id,
        "running",
      );

      const res = await app.request("/api/auth/account", {
        method: "DELETE",
        headers: userHeaders,
        body: JSON.stringify({ email: user.email }),
      });
      expect(res.status).toBe(200);

      // Cancelling a `running` Generation (issue #54) only moves it to
      // `cancelling`, for the runner's own poll loop to confirm later —
      // not ended yet, just flagged for deletion in the meantime.
      const [flagged] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, runningId));
      expect(flagged?.state).toBe("cancelling");
      expect(flagged?.deletedAt).not.toBeNull();

      // The runner's own terminal write lands later, independent of this
      // request: simulate it reaching `succeeded` with a saved Asset.
      await db
        .update(generations)
        .set({ state: "succeeded", endedAt: clock.now() })
        .where(eq(generations.id, runningId));
      await storage.write(
        "generations/round4/out.png",
        new Uint8Array([1, 2, 3]),
      );
      await db.insert(assets).values({
        generationId: runningId,
        nodeId: "3",
        sortOrder: 0,
        kind: "image",
        comfyuiFilename: "out.png",
        contentType: "image/png",
        size: 3,
        storageKey: "generations/round4/out.png",
      });

      const keys = await generationsRepository.finalizeIfPendingDeletion(
        runningId,
        clock.now(),
      );
      expect(keys).not.toBeNull();
      if (keys) await deleteStorageFor(storage, keys);

      const [tombstoned] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, runningId));
      expect(tombstoned?.builtPrompt).toEqual({});
      const remainingAssets = await db
        .select()
        .from(assets)
        .where(eq(assets.generationId, runningId));
      expect(remainingAssets).toEqual([]);
      expect(await storage.stat("generations/round4/out.png")).toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("a `saving` Generation (uncancellable) ends with no Assets left in storage once it's flagged (round 4)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const storage = createLocalStorage(testEnv().DATA_DIR);
      const generationsRepository = new GenerationsRepository(db);
      const admin = await insertUser({ role: "admin", status: "active" });
      const adminHeaders = await headersFor(admin.id);
      const model = await buildEnabledModel(app, adminHeaders, fake.url);

      const user = await insertUser({});
      const userHeaders = await headersFor(user.id);

      const savingId = await insertGeneration(
        model.modelId,
        model.modeId,
        user.id,
        "saving",
      );

      const res = await app.request("/api/auth/account", {
        method: "DELETE",
        headers: userHeaders,
        body: JSON.stringify({ email: user.email }),
      });
      expect(res.status).toBe(200);

      // Cancelling can't reach a `saving` Generation at all (issue #54):
      // left exactly as it was, just flagged for deletion.
      const [flagged] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, savingId));
      expect(flagged?.state).toBe("saving");
      expect(flagged?.deletedAt).not.toBeNull();

      await db
        .update(generations)
        .set({ state: "succeeded", endedAt: clock.now() })
        .where(eq(generations.id, savingId));
      await storage.write(
        "generations/round4-saving/out.png",
        new Uint8Array([1, 2, 3]),
      );
      await db.insert(assets).values({
        generationId: savingId,
        nodeId: "3",
        sortOrder: 0,
        kind: "image",
        comfyuiFilename: "out.png",
        contentType: "image/png",
        size: 3,
        storageKey: "generations/round4-saving/out.png",
      });

      const keys = await generationsRepository.finalizeIfPendingDeletion(
        savingId,
        clock.now(),
      );
      expect(keys).not.toBeNull();
      if (keys) await deleteStorageFor(storage, keys);

      const remainingAssets = await db
        .select()
        .from(assets)
        .where(eq(assets.generationId, savingId));
      expect(remainingAssets).toEqual([]);
      expect(
        await storage.stat("generations/round4-saving/out.png"),
      ).toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("deletes every unused Upload outright, but keeps one still feeding a run that hasn't ended (round 4)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const storage = createLocalStorage(testEnv().DATA_DIR);
      const admin = await insertUser({ role: "admin", status: "active" });
      const adminHeaders = await headersFor(admin.id);
      const model = await buildEnabledModel(app, adminHeaders, fake.url);

      const user = await insertUser({});
      const userHeaders = await headersFor(user.id);

      const unusedUploadId = crypto.randomUUID();
      const inUseUploadId = crypto.randomUUID();
      await storage.write("uploads/unused.bin", new Uint8Array([1]));
      await storage.write("uploads/in-use.bin", new Uint8Array([2]));
      await db.insert(uploads).values([
        {
          id: unusedUploadId,
          userId: user.id,
          status: "complete",
          originalName: "unused.png",
          declaredType: "image/png",
          size: 1,
          storageKey: "uploads/unused.bin",
          createdAt: clock.now(),
          completedAt: clock.now(),
        },
        {
          id: inUseUploadId,
          userId: user.id,
          status: "complete",
          originalName: "in-use.png",
          declaredType: "image/png",
          size: 1,
          storageKey: "uploads/in-use.bin",
          createdAt: clock.now(),
          completedAt: clock.now(),
        },
      ]);

      await insertGeneration(model.modelId, model.modeId, user.id, "running", [
        inUseUploadId,
      ]);

      const res = await app.request("/api/auth/account", {
        method: "DELETE",
        headers: userHeaders,
        body: JSON.stringify({ email: user.email }),
      });
      expect(res.status).toBe(200);

      const remainingUploads = await db
        .select()
        .from(uploads)
        .where(eq(uploads.userId, user.id));
      expect(remainingUploads.map((row) => row.id)).toEqual([inUseUploadId]);
      expect(await storage.stat("uploads/unused.bin")).toBeNull();
      expect(await storage.stat("uploads/in-use.bin")).not.toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("signing in again with the same Google account makes a fresh user", async () => {
    const { app } = await build();
    const user = await insertUser({});
    const headers = await headersFor(user.id);

    const res = await app.request("/api/auth/account", {
      method: "DELETE",
      headers,
      body: JSON.stringify({ email: user.email }),
    });
    expect(res.status).toBe(200);

    const { upsertUserFromGoogle } = await import("../auth/users.js");
    const { db } = await testDb;
    const fresh = await upsertUserFromGoogle(
      db,
      clock,
      {
        sub: user.googleSub,
        email: user.email || "reused@example.com",
        name: "Reused",
        picture: null,
        emailVerified: true,
      },
      [],
      "open",
    );
    expect(fresh.id).not.toBe(user.id);
  });
});
