// `/api/models/:slug` (the Workbench) and `/:slug/generations` (submit,
// live stream via SSE) — issue #43.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
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
  };
}

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
};

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("/api/models/:slug and :slug/generations", () => {
  const testDb = createTestDatabase("models_workbench_route_test");
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

  async function headersFor(role: "admin" | "user") {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({
        googleSub: `sub-${role}`,
        email: `${role}@example.com`,
        name: role,
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
  ) {
    const createRes = await app.request("/api/admin/models", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "LTX", workflow: WORKFLOW }),
    });
    const { model } = (await createRes.json()) as {
      model: { id: string; slug: string; version: number };
    };

    const backendRes = await app.request("/api/admin/backends", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "Fake", baseUrl: fakeUrl, auth: "none" }),
    });
    const backend = (await backendRes.json()) as { id: string };

    await app.request(`/api/admin/models/${model.id}/backends`, {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ backendId: backend.id }),
    });

    // Let the health monitor see the fake Backend as reachable.
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
      modelId: model.id,
      slug: model.slug as string,
      modeId: modes[0]?.id as string,
      backendId: backend.id,
    };
  }

  test("404s a Model that doesn't exist or isn't enabled", async () => {
    const { app, backendsService } = await build();
    const { headers } = await headersFor("user");

    const res = await app.request("/api/models/ghost", { headers });
    expect(res.status).toBe(404);

    backendsService.stop();
  });

  test("serves the Workbench's name, description and Modes for an enabled Model", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}`, {
        headers: userHeaders,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        model: {
          name: string;
          modes: Array<{ id: string; name: string; description: string }>;
        };
      };
      expect(body.model.name).toBe("LTX");
      expect(body.model.modes).toEqual([
        { id: modeId, name: "Default", description: "" },
      ]);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("submits a Generation, freezing its prompt with the filename_prefix stamped", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { db } = await testDb;
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders, userId } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        generation: { id: string; state: string; userId: string };
      };
      expect(body.generation.state).toBe("queued");
      expect(body.generation.userId).toBe(userId);

      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, body.generation.id));
      expect(row?.nodeTypes.sort()).toEqual([
        "KSampler",
        "LoadImage",
        "SaveImage",
      ]);
      const prompt = row?.builtPrompt as Record<
        string,
        { inputs: Record<string, unknown> }
      >;
      expect(prompt["3"]?.inputs.filename_prefix).toBe(
        `studio/${body.generation.id}/`,
      );

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("refuses a submit with 409 model_changed when the revision is stale", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 1 }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("model_changed");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("refuses a submit with 400 no_backend once its only Backend is detached", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { modelId, slug, modeId, backendId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      // Enabling doesn't require staying attached: detach the Backend
      // without disabling the Model, so a submit now finds none usable.
      await app.request(`/api/admin/models/${modelId}/backends/${backendId}`, {
        method: "DELETE",
        headers: adminHeaders,
      });

      const { headers: userHeaders } = await headersFor("user");
      const res = await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("no_backend");

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("lists this Model's latest Submissions for the signed-in user", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });

      const listRes = await app.request(`/api/models/${slug}/generations`, {
        headers: userHeaders,
      });
      const body = (await listRes.json()) as {
        submissions: Array<{ modeName: string; generations: unknown[] }>;
      };
      expect(body.submissions.length).toBe(1);
      expect(body.submissions[0]?.modeName).toBe("Default");
      expect(body.submissions[0]?.generations.length).toBe(1);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("streams a snapshot, then a change event on submit, over SSE", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      const streamRes = await app.request("/api/generations/stream", {
        headers: userHeaders,
      });
      expect(streamRes.status).toBe(200);
      expect(streamRes.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(streamRes.headers.get("x-accel-buffering")).toBe("no");

      const reader = streamRes.body?.getReader();
      if (!reader) throw new Error("no stream body");
      const decoder = new TextDecoder();

      const firstChunk = await reader.read();
      const firstText = decoder.decode(firstChunk.value);
      expect(firstText).toContain("event: snapshot");
      expect(firstText).toContain('"generations":[]');

      await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });

      const secondChunk = await reader.read();
      const secondText = decoder.decode(secondChunk.value);
      expect(secondText).toContain("event: change");
      expect(secondText).toContain('"state":"queued"');

      await reader.cancel();
      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  test("sends a heartbeat every few seconds so the stream stays open", async () => {
    const { app, backendsService } = await build();
    const { headers: userHeaders } = await headersFor("user");

    const streamRes = await app.request("/api/generations/stream", {
      headers: userHeaders,
    });
    const reader = streamRes.body?.getReader();
    if (!reader) throw new Error("no stream body");
    const decoder = new TextDecoder();

    const snapshotChunk = await reader.read();
    expect(decoder.decode(snapshotChunk.value)).toContain("event: snapshot");

    clock.advance(5_000);
    await flushMicrotasks();

    const heartbeatChunk = await reader.read();
    expect(decoder.decode(heartbeatChunk.value)).toContain(": heartbeat");

    await reader.cancel();
    backendsService.stop();
  });

  test("refuses to delete a Model with an unfinished Generation", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app, backendsService } = await build();
      const { headers: adminHeaders } = await headersFor("admin");
      const { modelId, slug, modeId } = await buildEnabledModel(
        app,
        adminHeaders,
        fake.url,
      );

      const { headers: userHeaders } = await headersFor("user");
      await app.request(`/api/models/${slug}/generations`, {
        method: "POST",
        headers: { ...userHeaders, "content-type": "application/json" },
        body: JSON.stringify({ modeId, revision: 2 }),
      });

      const deleteRes = await app.request(
        `/api/admin/models/${modelId}?version=3`,
        { method: "DELETE", headers: adminHeaders },
      );
      expect(deleteRes.status).toBe(409);

      backendsService.stop();
    } finally {
      fake.stop();
    }
  });

  describe("Model terms and Attribution (issue #61)", () => {
    async function setTerms(
      app: Awaited<ReturnType<typeof build>>["app"],
      adminHeaders: Record<string, string>,
      modelId: string,
      overrides: Partial<{
        termsBody: string;
        licenseUrl: string;
        attribution: string;
        askAgain: boolean;
      }> = {},
    ) {
      const getRes = await app.request(`/api/admin/models/${modelId}`, {
        headers: adminHeaders,
      });
      const { model } = (await getRes.json()) as {
        model: { termsRevision: number };
      };
      const res = await app.request(`/api/admin/models/${modelId}/terms`, {
        method: "PUT",
        headers: { ...adminHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          revision: model.termsRevision,
          termsBody: "Be nice.",
          licenseUrl: "https://example.com/license",
          attribution: "Model by Example Corp",
          askAgain: false,
          ...overrides,
        }),
      });
      return (await res.json()) as { termsVersion: number | null };
    }

    test("the Workbench detail carries terms and Attribution, unaccepted at first", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { modelId, slug } = await buildEnabledModel(
          app,
          adminHeaders,
          fake.url,
        );
        await setTerms(app, adminHeaders, modelId);

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}`, {
          headers: userHeaders,
        });
        const body = (await res.json()) as {
          model: {
            attribution: string;
            terms: {
              version: number;
              body: string;
              licenseUrl: string;
              accepted: boolean;
            } | null;
          };
        };
        expect(body.model.attribution).toBe("Model by Example Corp");
        expect(body.model.terms?.version).toBe(1);
        expect(body.model.terms?.body).toBe("Be nice.");
        expect(body.model.terms?.accepted).toBe(false);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("submitting without accepting gets model_terms_required; queued work stays untouched", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { db } = await testDb;
        const { headers: adminHeaders } = await headersFor("admin");
        const { modelId, slug, modeId } = await buildEnabledModel(
          app,
          adminHeaders,
          fake.url,
        );
        await setTerms(app, adminHeaders, modelId);

        const { headers: userHeaders } = await headersFor("user");
        const res = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision: 2 }),
        });
        expect(res.status).toBe(409);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("model_terms_required");

        const rows = await db.select().from(generations);
        expect(rows).toEqual([]);

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });

    test("accepting the current version lets the Generation through; a re-ask gates it again", async () => {
      const fake = startFakeComfyUi({ port: 0 });
      try {
        const { app, backendsService } = await build();
        const { headers: adminHeaders } = await headersFor("admin");
        const { modelId, slug, modeId } = await buildEnabledModel(
          app,
          adminHeaders,
          fake.url,
        );
        await setTerms(app, adminHeaders, modelId);

        const { headers: userHeaders } = await headersFor("user");
        const acceptRes = await app.request(
          `/api/models/${slug}/terms/accept`,
          { method: "POST", headers: userHeaders },
        );
        expect(acceptRes.status).toBe(200);

        const submitRes = await app.request(`/api/models/${slug}/generations`, {
          method: "POST",
          headers: { ...userHeaders, "content-type": "application/json" },
          body: JSON.stringify({ modeId, revision: 2 }),
        });
        expect(submitRes.status).toBe(201);

        // "Ask everyone to accept again" invalidates that acceptance.
        await setTerms(app, adminHeaders, modelId, { askAgain: true });

        const secondSubmitRes = await app.request(
          `/api/models/${slug}/generations`,
          {
            method: "POST",
            headers: { ...userHeaders, "content-type": "application/json" },
            body: JSON.stringify({ modeId, revision: 2 }),
          },
        );
        expect(secondSubmitRes.status).toBe(409);
        const body = (await secondSubmitRes.json()) as { error: string };
        expect(body.error).toBe("model_terms_required");

        backendsService.stop();
      } finally {
        fake.stop();
      }
    });
  });
});
