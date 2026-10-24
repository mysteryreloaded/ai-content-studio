// check-storage (issue #77): reports missing/orphaned files, and
// `--fix` deletes orphans and tombstones Generations with missing
// Assets.

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  siteSettings,
  uploads,
  users,
  workflows,
} from "../db/schema.js";
import type { Env } from "../env.js";
import type { Logger } from "../logger.js";
import { createTestDatabase } from "../test/database.js";
import { checkStorage } from "./check-storage.js";
import { createLocalStorage } from "./storage.js";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "2": { class_type: "KSampler", inputs: { seed: 0, model: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("checkStorage (issue #77)", () => {
  const testDb = createTestDatabase("check_storage_test");
  const clock = new FakeClock();
  let dataDir: string;

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
    await db
      .update(siteSettings)
      .set({ logoKey: null, backgroundKey: null })
      .where(eq(siteSettings.singleton, true));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "check-storage-test-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

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
      DATA_DIR: dataDir,
      SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
      BACKENDS_ENABLED: true,
      STATUS_TOKEN: undefined,
      MIN_FREE_DISK_GB: 10,
      FFMPEG_CONCURRENCY: 2,
      MAX_UPLOAD_MB: 500,
    };
  }

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
  ): Promise<{ generationId: string }> {
    const res = await app.request(`/api/models/${slug}/generations`, {
      method: "POST",
      headers: { ...userHeaders, "content-type": "application/json" },
      body: JSON.stringify({ modeId, revision: 2 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      generations: Array<{ id: string }>;
    };
    const first = body.generations[0];
    if (!first) throw new Error("submit created no Generation");
    return { generationId: first.id };
  }

  async function writeDiskFile(relativeKey: string) {
    const full = path.join(dataDir, relativeKey);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, "bytes");
  }

  test("reports a missing Asset file and an orphaned file, touching nothing without --fix", async () => {
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
        storageKey: "generations/missing/out.png",
      });
      // Not written to disk: this is the missing file.

      await writeDiskFile("generations/orphan/leftover.png");

      const storage = createLocalStorage(dataDir);
      const report = await checkStorage(db, storage, dataDir, clock.now(), {
        fix: false,
      });

      expect(report.missing).toHaveLength(1);
      expect(report.missing[0]?.key).toBe("generations/missing/out.png");
      expect(report.missing[0]?.generationId).toBe(generationId);
      expect(report.orphaned).toEqual(["generations/orphan/leftover.png"]);
      expect(report.deletedOrphans).toEqual([]);
      expect(report.tombstonedGenerationIds).toEqual([]);

      // Nothing changed: the orphan is still there, the Generation isn't a Tombstone.
      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generationId));
      expect(row?.deletedAt).toBeNull();
      const stat = await storage.stat("generations/orphan/leftover.png");
      expect(stat).not.toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("--fix deletes the orphan and tombstones the Generation with a missing Asset", async () => {
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
        storageKey: "generations/missing/out.png",
      });
      await writeDiskFile("generations/orphan/leftover.png");

      const storage = createLocalStorage(dataDir);
      const report = await checkStorage(db, storage, dataDir, clock.now(), {
        fix: true,
      });

      expect(report.deletedOrphans).toEqual([
        "generations/orphan/leftover.png",
      ]);
      expect(report.tombstonedGenerationIds).toEqual([generationId]);

      const stat = await storage.stat("generations/orphan/leftover.png");
      expect(stat).toBeNull();

      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generationId));
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.builtPrompt).toEqual({});

      const remainingAssets = await db
        .select()
        .from(assets)
        .where(eq(assets.generationId, generationId));
      expect(remainingAssets).toHaveLength(0);

      // A second run finds nothing left to fix.
      const second = await checkStorage(db, storage, dataDir, clock.now(), {
        fix: true,
      });
      expect(second.missing).toEqual([]);
      expect(second.orphaned).toEqual([]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("reports a missing Upload file, which --fix never touches", async () => {
    const { db } = await testDb;
    const { userId } = await headersFor("user");
    const uploadId = crypto.randomUUID();
    await db.insert(uploads).values({
      id: uploadId,
      userId,
      status: "complete",
      originalName: "clip.mp4",
      declaredType: "video/mp4",
      size: 10,
      storageKey: "uploads/missing/clip.mp4",
      createdAt: clock.now(),
    });

    const storage = createLocalStorage(dataDir);
    const report = await checkStorage(db, storage, dataDir, clock.now(), {
      fix: true,
    });

    expect(report.missing).toHaveLength(1);
    expect(report.missing[0]).toMatchObject({
      key: "uploads/missing/clip.mp4",
      source: "upload",
    });
    expect(report.tombstonedGenerationIds).toEqual([]);

    const [row] = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    expect(row).toBeDefined();
  });

  test("checks the Site settings' logo and background keys too", async () => {
    const { db } = await testDb;
    await db
      .update(siteSettings)
      .set({
        logoKey: "branding/logo.png",
        backgroundKey: "branding/background.png",
      })
      .where(eq(siteSettings.singleton, true));
    await writeDiskFile("branding/logo.png");
    // backgroundKey left missing on purpose.

    const storage = createLocalStorage(dataDir);
    const report = await checkStorage(db, storage, dataDir, clock.now(), {
      fix: false,
    });

    expect(report.missing).toHaveLength(1);
    expect(report.missing[0]).toMatchObject({
      key: "branding/background.png",
      source: "branding",
    });
  });
});
