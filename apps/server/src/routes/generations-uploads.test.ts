// Submitting with an Image Upload Input through the real app (issue #50):
// only the caller's own, complete image Upload within the Input's limits
// is accepted, and the prompt names it `studio/<upload-id>.<ext>`.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

const SAME_ORIGIN_HEADERS = { "Sec-Fetch-Site": "same-origin" };

const WORKFLOW = {
  "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
  "2": {
    class_type: "SaveImage",
    inputs: { images: ["1", 0], filename_prefix: "ComfyUI" },
  },
};

const UPLOAD_INPUT_ID = "66666666-6666-4666-8666-666666666666";

const INPUTS = [
  {
    id: UPLOAD_INPUT_ID,
    kind: "image_upload",
    group: "describe",
    label: "Photo",
    help: "",
    maxSizeMb: 5,
    maxLongSide: 300,
    bindings: [
      { nodeId: "1", field: "image", classType: "LoadImage", title: null },
    ],
  },
];

describe("POST /:slug/generations with an Image Upload Input", () => {
  const testDb = createTestDatabase("generations_uploads_test");
  const dataDirPromise = mkdtemp(path.join(tmpdir(), "generations-uploads-"));
  const clock = new FakeClock();

  afterAll(async () => {
    await (await testDb).close();
    await rm(await dataDirPromise, { recursive: true, force: true });
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

  async function build(minFreeDiskGb = 0.000001) {
    const { db, sql } = await testDb;
    const env: Env = {
      DATABASE_URL: "unused",
      PORT: 3000,
      LOG_LEVEL: "error",
      PUBLIC_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
      ADMIN_EMAILS: ["admin@example.com"],
      OIDC_ISSUER: undefined,
      DATA_DIR: await dataDirPromise,
      SECRET_KEY: "4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=",
      BACKENDS_ENABLED: true,
      STATUS_TOKEN: undefined,
      MIN_FREE_DISK_GB: minFreeDiskGb,
      MAX_UPLOAD_MB: 500,
      FFMPEG_CONCURRENCY: 2,
    };
    return createApp({
      db,
      sql,
      clock,
      logger: silentLogger,
      env,
      webDistDir: new URL("../../../web", import.meta.url).pathname,
    });
  }

  async function headersFor(email: string, role: "admin" | "user") {
    const { db } = await testDb;
    const [user] = await db
      .insert(users)
      .values({ googleSub: `sub-${email}`, email, name: email, role })
      .returning();
    if (!user) throw new Error("failed to insert user");
    const session = await createSession(db, clock, user.id);
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `${SESSION_COOKIE_NAME}=${session.cookieValue}`,
    };
  }

  async function makePng(size: string) {
    const out = path.join(await dataDirPromise, `src-${size}.png`);
    await Bun.$`ffmpeg -v error -y -f lavfi -i color=blue:s=${size} -frames:v 1 ${out}`.quiet();
    return new Uint8Array(await Bun.file(out).arrayBuffer());
  }

  test("only the caller's own, complete image Upload within the Input's limits is accepted", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const json = { "content-type": "application/json" };
      const admin = await headersFor("admin@example.com", "admin");

      const createRes = await app.request("/api/admin/models", {
        method: "POST",
        headers: { ...admin, ...json },
        body: JSON.stringify({ name: "Img", workflow: WORKFLOW }),
      });
      const { model } = (await createRes.json()) as {
        model: { id: string; slug: string; version: number };
      };
      const backendRes = await app.request("/api/admin/backends", {
        method: "POST",
        headers: { ...admin, ...json },
        body: JSON.stringify({ name: "Fake", baseUrl: fake.url, auth: "none" }),
      });
      const backend = (await backendRes.json()) as { id: string };
      await app.request(`/api/admin/models/${model.id}/backends`, {
        method: "POST",
        headers: { ...admin, ...json },
        body: JSON.stringify({ backendId: backend.id }),
      });
      clock.advance(30_000);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const modesRes = await app.request(
        `/api/admin/models/${model.id}/modes`,
        {
          method: "PUT",
          headers: { ...admin, ...json },
          body: JSON.stringify({
            version: model.version,
            modes: [{ name: "Default", description: "", outputNodeIds: ["2"] }],
          }),
        },
      );
      const afterModes = (await modesRes.json()) as {
        record: { version: number };
        modes: Array<{ id: string }>;
      };

      // MAX_UPLOAD_MB caps an Image Upload Input's own max size.
      const tooBigInput = await app.request(
        `/api/admin/models/${model.id}/inputs`,
        {
          method: "PUT",
          headers: { ...admin, ...json },
          body: JSON.stringify({
            version: afterModes.record.version,
            inputs: [{ ...INPUTS[0], maxSizeMb: 501 }],
          }),
        },
      );
      expect(tooBigInput.status).toBe(400);

      const inputsRes = await app.request(
        `/api/admin/models/${model.id}/inputs`,
        {
          method: "PUT",
          headers: { ...admin, ...json },
          body: JSON.stringify({
            version: afterModes.record.version,
            inputs: INPUTS,
          }),
        },
      );
      expect(inputsRes.status).toBe(200);
      const afterInputs = (await inputsRes.json()) as {
        record: { version: number; currentRevision: number };
      };
      const enableRes = await app.request(
        `/api/admin/models/${model.id}/enable`,
        {
          method: "POST",
          headers: { ...admin, ...json },
          body: JSON.stringify({ version: afterInputs.record.version }),
        },
      );
      expect(enableRes.status).toBe(200);

      const user = await headersFor("user@example.com", "user");
      const other = await headersFor("other@example.com", "user");

      const me = await app.request("/api/auth/me", { headers: user });
      expect(((await me.json()) as { maxUploadMb: number }).maxUploadMb).toBe(
        500,
      );

      const workbench = await app.request(`/api/models/${model.slug}`, {
        headers: user,
      });
      const { model: shown } = (await workbench.json()) as {
        model: { modes: Array<{ id: string; inputs: unknown[] }> };
      };
      expect(shown.modes[0]?.inputs[0]).toMatchObject({
        id: UPLOAD_INPUT_ID,
        kind: "image_upload",
        maxSizeMb: 5,
        maxLongSide: 300,
      });
      const modeId = shown.modes[0]?.id as string;

      async function upload(
        headers: Record<string, string>,
        bytes: Uint8Array,
        complete = true,
      ) {
        const res = await app.request("/api/uploads", {
          method: "POST",
          headers: { ...headers, ...json },
          body: JSON.stringify({
            name: "photo.png",
            size: bytes.length,
            type: "image/png",
          }),
        });
        const { upload } = (await res.json()) as { upload: { id: string } };
        await app.request(`/api/uploads/${upload.id}/chunk?offset=0`, {
          method: "PUT",
          headers,
          body: bytes,
        });
        if (complete) {
          const done = await app.request(`/api/uploads/${upload.id}/complete`, {
            method: "POST",
            headers,
          });
          expect(done.status).toBe(200);
        }
        return upload.id;
      }

      async function submit(values: Record<string, unknown>) {
        return app.request(`/api/models/${model.slug}/generations`, {
          method: "POST",
          headers: { ...user, ...json },
          body: JSON.stringify({
            modeId,
            revision: afterInputs.record.currentRevision,
            values,
          }),
        });
      }

      const small = await makePng("200x100");
      const own = await upload(user, small);
      const unfinished = await upload(user, small, false);
      const someoneElses = await upload(other, small);
      const tooWide = await upload(user, await makePng("400x100"));

      expect((await submit({})).status).toBe(400);
      for (const [id, message] of [
        [someoneElses, "that Upload wasn't found"],
        [unfinished, "that Upload hasn't finished"],
        [tooWide, "that file is larger than 300 px on its long side"],
      ] as const) {
        const res = await submit({ [UPLOAD_INPUT_ID]: id });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: "invalid",
          issues: [{ path: UPLOAD_INPUT_ID, code: "upload", message }],
        });
      }

      const ok = await submit({ [UPLOAD_INPUT_ID]: own });
      expect(ok.status).toBe(201);
      const { generations: created } = (await ok.json()) as {
        generations: Array<{ id: string }>;
      };
      const generation = created[0];
      if (!generation) throw new Error("no generation created");
      const { db } = await testDb;
      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generation.id));
      const prompt = row?.builtPrompt as Record<
        string,
        { inputs: Record<string, unknown> }
      >;
      expect(prompt["1"]?.inputs.image).toBe(`studio/${own}.png`);
      expect(row?.uploadIds).toEqual([own]);

      // Below MIN_FREE_DISK_GB, a Submission is refused.
      const { app: fullApp } = await build(1_000_000_000);
      const full = await fullApp.request(
        `/api/models/${model.slug}/generations`,
        {
          method: "POST",
          headers: { ...user, ...json },
          body: JSON.stringify({
            modeId,
            revision: afterInputs.record.currentRevision,
            values: { [UPLOAD_INPUT_ID]: own },
          }),
        },
      );
      expect(full.status).toBe(507);
      expect(await full.json()).toEqual({
        error: "storage_full",
        message: "storage is full, try later",
      });
    } finally {
      fake.stop();
    }
  });

  test("a hidden Image Upload Input doesn't 400 every Submit (issue #48 CEO review)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const { app } = await build();
      const json = { "content-type": "application/json" };
      const admin = await headersFor("admin@example.com", "admin");

      const createRes = await app.request("/api/admin/models", {
        method: "POST",
        headers: { ...admin, ...json },
        body: JSON.stringify({ name: "Img", workflow: WORKFLOW }),
      });
      const { model } = (await createRes.json()) as {
        model: { id: string; slug: string; version: number };
      };
      const backendRes = await app.request("/api/admin/backends", {
        method: "POST",
        headers: { ...admin, ...json },
        body: JSON.stringify({ name: "Fake", baseUrl: fake.url, auth: "none" }),
      });
      const backend = (await backendRes.json()) as { id: string };
      await app.request(`/api/admin/models/${model.id}/backends`, {
        method: "POST",
        headers: { ...admin, ...json },
        body: JSON.stringify({ backendId: backend.id }),
      });
      clock.advance(30_000);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const inputsRes = await app.request(
        `/api/admin/models/${model.id}/inputs`,
        {
          method: "PUT",
          headers: { ...admin, ...json },
          body: JSON.stringify({ version: model.version, inputs: INPUTS }),
        },
      );
      const afterInputs = (await inputsRes.json()) as {
        record: { version: number; currentRevision: number };
      };

      const modesRes = await app.request(
        `/api/admin/models/${model.id}/modes`,
        {
          method: "PUT",
          headers: { ...admin, ...json },
          body: JSON.stringify({
            version: afterInputs.record.version,
            modes: [
              {
                name: "Default",
                description: "",
                outputNodeIds: ["2"],
                inputSettings: [
                  {
                    inputId: UPLOAD_INPUT_ID,
                    state: "hidden",
                    fixedValue: null,
                    label: "",
                  },
                ],
              },
            ],
          }),
        },
      );
      const afterModes = (await modesRes.json()) as {
        record: { version: number };
        modes: Array<{ id: string }>;
      };

      const enableRes = await app.request(
        `/api/admin/models/${model.id}/enable`,
        {
          method: "POST",
          headers: { ...admin, ...json },
          body: JSON.stringify({ version: afterModes.record.version }),
        },
      );
      expect(enableRes.status).toBe(200);
      const enabled = (await enableRes.json()) as { currentRevision: number };

      const user = await headersFor("user@example.com", "user");
      const workbench = await app.request(`/api/models/${model.slug}`, {
        headers: user,
      });
      const { model: shown } = (await workbench.json()) as {
        model: { modes: Array<{ id: string; inputs: unknown[] }> };
      };
      // Hidden, so it never reaches the Workbench form.
      expect(shown.modes[0]?.inputs).toEqual([]);
      const modeId = shown.modes[0]?.id as string;

      const res = await app.request(`/api/models/${model.slug}/generations`, {
        method: "POST",
        headers: { ...user, ...json },
        body: JSON.stringify({
          modeId,
          revision: enabled.currentRevision,
          values: {},
        }),
      });
      expect(res.status).toBe(201);

      const { generations: created } = (await res.json()) as {
        generations: Array<{ id: string }>;
      };
      const generation = created[0];
      if (!generation) throw new Error("no generation created");
      const { db } = await testDb;
      const [row] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, generation.id));
      const prompt = row?.builtPrompt as Record<
        string,
        { inputs: Record<string, unknown> }
      >;
      // The hidden Input isn't resolved against an Upload; the Workflow's
      // own literal stands, same as any other hidden Input.
      expect(prompt["1"]?.inputs.image).toBe("example.png");
    } finally {
      fake.stop();
    }
  });
});
