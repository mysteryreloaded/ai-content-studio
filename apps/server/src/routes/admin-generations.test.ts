// `/api/admin/generations` (issue #68): the Admin Generations page's
// list, filters, jump-to, read-only detail, and Remove.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
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
    DATA_DIR: "/tmp/ai-content-studio-test-data-admin-generations",
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

describe("/api/admin/generations (issue #68)", () => {
  const testDb = createTestDatabase("admin_generations_route_test");
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

  test("lists across users, filterable by status, with a jump-to for a Generation or Asset id", async () => {
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
      const [asset] = await db
        .insert(assets)
        .values({
          generationId,
          nodeId: "3",
          sortOrder: 0,
          kind: "image",
          comfyuiFilename: "out.png",
          contentType: "image/png",
          size: 10,
          storageKey: "generations/test/out.png",
        })
        .returning();
      if (!asset) throw new Error("insert returned no asset");

      const list = await app.request(
        "/api/admin/generations?status=succeeded",
        {
          headers: adminHeaders,
        },
      );
      expect(list.status).toBe(200);
      const listBody = (await list.json()) as {
        generations: Array<{ id: string; userEmail: string }>;
      };
      expect(listBody.generations.map((g) => g.id)).toContain(generationId);
      expect(listBody.generations[0]?.userEmail).toBe("user@example.com");

      const byGenerationId = await app.request(
        `/api/admin/generations/resolve/${generationId}`,
        { headers: adminHeaders },
      );
      expect(byGenerationId.status).toBe(200);
      expect(
        ((await byGenerationId.json()) as { generationId: string })
          .generationId,
      ).toBe(generationId);

      const byAssetId = await app.request(
        `/api/admin/generations/resolve/${asset.id}`,
        { headers: adminHeaders },
      );
      expect(byAssetId.status).toBe(200);
      expect(
        ((await byAssetId.json()) as { generationId: string }).generationId,
      ).toBe(generationId);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("removing an active Generation cancels it, requires a reason, and records an Audit entry with only id/owner/Model/Mode/reason", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders, userId } = await headersFor("user");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );

      const noReason = await app.request(
        `/api/admin/generations/${generationId}/remove`,
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ reason: "" }),
        },
      );
      expect(noReason.status).toBe(400);

      const remove = await app.request(
        `/api/admin/generations/${generationId}/remove`,
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ reason: "Breaks the content rules" }),
        },
      );
      expect(remove.status).toBe(200);

      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generationId));
      expect(row?.state).toBe("cancelled");
      expect(row?.removedAt).not.toBeNull();
      expect(row?.removedReason).toBe("Breaks the content rules");

      const [entry] = await db
        .select()
        .from(auditEntries)
        .where(eq(auditEntries.targetId, generationId));
      expect(entry?.targetType).toBe("generation");
      expect(entry?.action).toBe("remove");
      expect(entry?.after).toEqual({
        ownerId: userId,
        modelId: model.modelId,
        modeId: model.modeId,
        reason: "Breaks the content rules",
      });

      // The owner's own view (issue #68's AC): a dismissable card, no
      // reason, no Reuse.
      const ownerView = await app.request(`/api/generations/${generationId}`, {
        headers: userHeaders,
      });
      const ownerBody = (await ownerView.json()) as {
        removedAt: string | null;
      };
      expect(ownerBody.removedAt).not.toBeNull();
      expect(Object.keys(ownerBody)).not.toContain("removedReason");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("removing an ended Generation deletes its Assets, but keeps its prompt and Upload links visible to Admins", async () => {
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

      const remove = await app.request(
        `/api/admin/generations/${generationId}/remove`,
        {
          method: "POST",
          headers: { ...adminHeaders, "content-type": "application/json" },
          body: JSON.stringify({ reason: "Reported content" }),
        },
      );
      expect(remove.status).toBe(200);

      const remainingAssets = await db
        .select()
        .from(assets)
        .where(eq(assets.generationId, generationId));
      expect(remainingAssets).toEqual([]);

      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generationId));
      // Unlike a Tombstone, a Removal keeps builtPrompt/uploadIds.
      expect(row?.builtPrompt).not.toEqual({});

      const detail = await app.request(
        `/api/admin/generations/${generationId}`,
        { headers: adminHeaders },
      );
      const detailBody = (await detail.json()) as {
        removedReason: string | null;
        settings: unknown[];
      };
      expect(detailBody.removedReason).toBe("Reported content");
      expect(Array.isArray(detailBody.settings)).toBe(true);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  // CEO review round 1, point 1: a save landing after the Admin's own
  // Removal (or any other window before its Assets are actually gone)
  // must never be downloadable by the owner.
  test("an Asset of a removed Generation 404s for its owner but still serves an Admin", async () => {
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
      const [asset] = await db
        .insert(assets)
        .values({
          generationId,
          nodeId: "3",
          sortOrder: 0,
          kind: "image",
          comfyuiFilename: "out.png",
          contentType: "image/png",
          size: 10,
          storageKey: "generations/test/out.png",
        })
        .returning();
      if (!asset) throw new Error("insert returned no asset");

      // Simulates the window between an Admin's own Removal landing and
      // its Assets actually being deleted (e.g. a save that raced it).
      await db
        .update(generations)
        .set({ removedAt: clock.now(), removedReason: "Reported content" })
        .where(eq(generations.id, generationId));

      expect(
        (await app.request(`/api/assets/${asset.id}`, { headers: userHeaders }))
          .status,
      ).toBe(404);
      expect(
        (
          await app.request(`/api/assets/${asset.id}`, {
            headers: adminHeaders,
          })
        ).status,
      ).toBe(200);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
