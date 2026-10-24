// The chunked Upload protocol against a real Postgres, real disk and the
// real ffprobe/ffmpeg (issue #50).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeClock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { users } from "../db/schema.js";
import { createLocalStorage } from "../storage/storage.js";
import { createTestDatabase } from "../test/database.js";
import { UploadsRepository } from "../uploads/repository.js";
import { UploadsService } from "../uploads/service.js";
import { uploadsRoute } from "./uploads.js";

type FakeSession = {
  user: {
    id: string;
    role: "user" | "admin";
    status: "active";
    termsAcceptedVersion: null;
  };
};

/** Only `request` is used, so any test app's own Variables fit. */
type TestApp = Pick<Hono, "request">;

async function makeImage(dir: string, name: string, size: string) {
  const out = path.join(dir, name);
  await Bun.$`ffmpeg -v error -y -f lavfi -i color=red:s=${size} -frames:v 1 ${out}`.quiet();
  return new Uint8Array(await Bun.file(out).arrayBuffer());
}

describe("/api/uploads", () => {
  const testDb = createTestDatabase("uploads_route_test");
  const dirPromise = mkdtemp(path.join(tmpdir(), "uploads-test-"));
  let diskFull = false;
  let hint: { maxSizeMb: number; maxLongSide: number | null } | null = null;

  afterAll(async () => {
    await (await testDb).close();
    await rm(await dirPromise, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const { db } = await testDb;
    await db.delete(users);
    diskFull = false;
    hint = null;
  });

  async function setup() {
    const { db } = await testDb;
    const dir = await dirPromise;
    const storage = createLocalStorage(path.join(dir, "data"));
    const repository = new UploadsRepository(db);
    const service = new UploadsService({
      repository,
      storage,
      clock: new FakeClock(),
      maxUploadMb: 1,
      hasFreeDisk: async () => !diskFull,
      hintLimits: async () => hint,
    });
    const insertUser = async (email: string) => {
      const [row] = await db
        .insert(users)
        .values({ googleSub: crypto.randomUUID(), email, name: email })
        .returning();
      if (!row) throw new Error("no user");
      return row.id;
    };
    const as = (userId: string, role: "user" | "admin" = "user") => {
      const session: FakeSession = {
        user: {
          id: userId,
          role,
          status: "active",
          termsAcceptedVersion: null,
        },
      };
      const app = new Hono<{
        Variables: { session: FakeSession; termsVersion: number | null };
      }>();
      app.use(async (c, next) => {
        c.set("session", session);
        c.set("termsVersion", null);
        return next();
      });
      app.route(
        "/api/uploads",
        uploadsRoute(service, repository, storage, []) as unknown as Hono<{
          Variables: { session: FakeSession };
        }>,
      );
      return app;
    };
    return { insertUser, as, repository, storage, dir };
  }

  async function createUpload(app: TestApp, body: Record<string, unknown>) {
    return app.request("/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function putChunk(
    app: TestApp,
    id: string,
    offset: number,
    bytes: Uint8Array,
  ) {
    return app.request(`/api/uploads/${id}/chunk?offset=${offset}`, {
      method: "PUT",
      body: bytes,
    });
  }

  test("create, chunks at the server's offset, complete: probes, sets the extension and makes a thumbnail", async () => {
    const { insertUser, as, dir } = await setup();
    const ownerId = await insertUser("owner@example.com");
    const app = as(ownerId);
    const png = await makeImage(dir, "a.png", "400x200");

    const created = await createUpload(app, {
      name: "My photo.png",
      size: png.length,
      type: "image/png",
    });
    expect(created.status).toBe(201);
    const { upload } = (await created.json()) as {
      upload: { id: string; offset: number };
    };
    expect(upload.offset).toBe(0);

    const half = Math.floor(png.length / 2);
    const first = await putChunk(app, upload.id, 0, png.slice(0, half));
    expect(await first.json()).toEqual({ offset: half });

    // A replayed chunk at a stale offset is told where the server is.
    const stale = await putChunk(app, upload.id, 0, png.slice(0, half));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: "offset_mismatch",
      offset: half,
    });

    const status = await app.request(`/api/uploads/${upload.id}/status`);
    expect(
      ((await status.json()) as { upload: { offset: number } }).upload.offset,
    ).toBe(half);

    const early = await app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });
    expect(early.status).toBe(409);

    await putChunk(app, upload.id, half, png.slice(half));
    const done = await app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });
    expect(done.status).toBe(200);
    const completed = (await done.json()) as {
      upload: { status: string; kind: string; width: number; height: number };
    };
    expect(completed.upload).toMatchObject({
      status: "complete",
      kind: "image",
      width: 400,
      height: 200,
    });

    const download = await app.request(`/api/uploads/${upload.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(download.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''My%20photo.png",
    );
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(png);

    const thumb = await app.request(`/api/uploads/${upload.id}/thumb`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    const thumbPath = path.join(dir, "thumb-check.webp");
    await Bun.write(thumbPath, await thumb.arrayBuffer());
    const dims =
      await Bun.$`ffprobe -v error -show_entries stream=width,height -of csv=p=0 ${thumbPath}`.text();
    expect(dims.trim()).toBe("160,80");
  });

  test("an Upload is served to its owner or an Admin, 404 for anyone else", async () => {
    const { insertUser, as, dir } = await setup();
    const ownerId = await insertUser("owner2@example.com");
    const strangerId = await insertUser("stranger@example.com");
    const adminId = await insertUser("admin@example.com");
    const owner = as(ownerId);
    const jpeg = await makeImage(dir, "b.jpg", "64x64");

    const created = await createUpload(owner, {
      name: "b.jpg",
      size: jpeg.length,
      type: "image/jpeg",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(owner, upload.id, 0, jpeg);
    await owner.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });

    const stranger = as(strangerId);
    expect((await stranger.request(`/api/uploads/${upload.id}`)).status).toBe(
      404,
    );
    expect(
      (await stranger.request(`/api/uploads/${upload.id}/thumb`)).status,
    ).toBe(404);
    expect((await putChunk(stranger, upload.id, 0, jpeg)).status).toBe(404);
    expect(
      (await as(adminId, "admin").request(`/api/uploads/${upload.id}`)).status,
    ).toBe(200);
  });

  test("MAX_UPLOAD_MB is checked at create and per chunk; HEIC/SVG are refused at create", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("big@example.com"));

    const tooBig = await createUpload(app, {
      name: "big.png",
      size: 1024 * 1024 + 1,
      type: "image/png",
    });
    expect(tooBig.status).toBe(413);

    const heic = await createUpload(app, {
      name: "phone.HEIC",
      size: 100,
      type: "image/heic",
    });
    expect(heic.status).toBe(400);
    const svg = await createUpload(app, {
      name: "logo.svg",
      size: 100,
      type: "image/svg+xml",
    });
    expect(svg.status).toBe(400);

    const created = await createUpload(app, {
      name: "small.png",
      size: 10,
      type: "image/png",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    const overrun = await putChunk(app, upload.id, 0, new Uint8Array(11));
    expect(overrun.status).toBe(400);
  });

  test("a chunk is refused with 'storage is full, try later' under MIN_FREE_DISK_GB", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("full@example.com"));
    const created = await createUpload(app, {
      name: "a.png",
      size: 10,
      type: "image/png",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };

    diskFull = true;
    const res = await putChunk(app, upload.id, 0, new Uint8Array(10));
    expect(res.status).toBe(507);
    expect(await res.json()).toEqual({
      error: "storage_full",
      message: "storage is full, try later",
    });
  });

  test("complete refuses a file that isn't a PNG, JPEG or WebP still, whatever its name", async () => {
    const { insertUser, as, dir, repository } = await setup();
    const app = as(await insertUser("misnamed@example.com"));

    for (const bytes of [
      new TextEncoder().encode("not an image at all"),
      await makeImage(dir, "c.gif", "32x32"),
    ]) {
      const created = await createUpload(app, {
        name: "looks-fine.png",
        size: bytes.length,
        type: "image/png",
      });
      const { upload } = (await created.json()) as { upload: { id: string } };
      await putChunk(app, upload.id, 0, bytes);
      const res = await app.request(`/api/uploads/${upload.id}/complete`, {
        method: "POST",
      });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { message: string }).message).toBe(
        "isn't a PNG, JPEG or WebP image",
      );
      expect((await repository.get(upload.id))?.status).toBe("failed");
    }
  });

  test("complete checks the hinted Input's limits", async () => {
    const { insertUser, as, dir } = await setup();
    const app = as(await insertUser("hinted@example.com"));
    const webp = await makeImage(dir, "d.webp", "300x200");
    hint = { maxSizeMb: 1, maxLongSide: 200 };

    const created = await createUpload(app, {
      name: "d.webp",
      size: webp.length,
      type: "image/webp",
      modelId: crypto.randomUUID(),
      inputId: "start-frame",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(app, upload.id, 0, webp);
    const res = await app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toBe(
      "is larger than 200 px on its long side",
    );
  });
});
