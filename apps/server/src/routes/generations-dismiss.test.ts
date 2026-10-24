// `/api/generations/:id/dismiss-removed` (issue #68): the owner
// dismissing their "Removed by an administrator" card, and the Gallery
// dropping it afterward.

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
    DATA_DIR: "/tmp/ai-content-studio-test-data-generations-dismiss",
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

describe("/api/generations/:id/dismiss-removed and the Gallery (issue #68)", () => {
  const testDb = createTestDatabase("generations_dismiss_route_test");
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

  async function removeAsAdmin(
    app: Awaited<ReturnType<typeof build>>["app"],
    adminHeaders: Record<string, string>,
    generationId: string,
  ) {
    const remove = await app.request(
      `/api/admin/generations/${generationId}/remove`,
      {
        method: "POST",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({ reason: "Reported content" }),
      },
    );
    expect(remove.status).toBe(200);
  }

  test("404s for someone else's Generation, or one that isn't removed", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const model = await buildEnabledModel(app, adminHeaders, fake.url, "M");
      const { headers: userHeaders } = await headersFor("user");
      const { headers: otherHeaders } = await headersFor("user", "-2");

      const { generationId } = await submit(
        app,
        userHeaders,
        model.slug,
        model.modeId,
      );

      const notRemoved = await app.request(
        `/api/generations/${generationId}/dismiss-removed`,
        { method: "POST", headers: userHeaders },
      );
      expect(notRemoved.status).toBe(404);

      await removeAsAdmin(app, adminHeaders, generationId);

      const notOwner = await app.request(
        `/api/generations/${generationId}/dismiss-removed`,
        { method: "POST", headers: otherHeaders },
      );
      expect(notOwner.status).toBe(404);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("the owner dismissing a removed Generation drops it out of their Gallery for good", async () => {
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

      await removeAsAdmin(app, adminHeaders, generationId);

      // Still shown, as the dismissable "Removed" card (issue #68's AC).
      const beforeDismiss = await app.request("/api/gallery", {
        headers: userHeaders,
      });
      const beforeBody = (await beforeDismiss.json()) as {
        submissions: Array<{ generations: Array<{ id: string }> }>;
      };
      expect(
        beforeBody.submissions.flatMap((s) => s.generations.map((g) => g.id)),
      ).toContain(generationId);

      const dismiss = await app.request(
        `/api/generations/${generationId}/dismiss-removed`,
        { method: "POST", headers: userHeaders },
      );
      expect(dismiss.status).toBe(200);

      const afterDismiss = await app.request("/api/gallery", {
        headers: userHeaders,
      });
      const afterBody = (await afterDismiss.json()) as {
        submissions: Array<{ generations: Array<{ id: string }> }>;
      };
      expect(
        afterBody.submissions.flatMap((s) => s.generations.map((g) => g.id)),
      ).not.toContain(generationId);

      // The row, and its Audit entry, stay for Admins.
      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generationId));
      expect(row?.removedAt).not.toBeNull();
      expect(row?.removedDismissedAt).not.toBeNull();

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });
});
