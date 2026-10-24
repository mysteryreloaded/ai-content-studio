// The chunked Upload protocol against a real Postgres, real disk and the
// real ffprobe/ffmpeg (issue #50).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeClock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { users } from "../db/schema.js";
import { MediaRunner, MediaTimeoutError } from "../media/media.js";
import { createLocalStorage } from "../storage/storage.js";
import { createTestDatabase } from "../test/database.js";
import { UploadsRepository } from "../uploads/repository.js";
import { type UploadInputLimits, UploadsService } from "../uploads/service.js";
import { uploadsRoute } from "./uploads.js";

type UploadsServiceMedia = Pick<
  MediaRunner,
  | "probeImage"
  | "makeThumbnail"
  | "probeVideoUpload"
  | "probeAudioUpload"
  | "makeVideoThumbnail"
  | "trimVideo"
  | "trimAudio"
>;

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

/** Video/audio methods a still-only test mock never calls; filling them in just satisfies the type. */
const NOT_NEEDED_FOR_STILLS: Pick<
  UploadsServiceMedia,
  | "probeVideoUpload"
  | "probeAudioUpload"
  | "makeVideoThumbnail"
  | "trimVideo"
  | "trimAudio"
> = {
  probeVideoUpload: () => {
    throw new Error("not needed for this test");
  },
  probeAudioUpload: () => {
    throw new Error("not needed for this test");
  },
  makeVideoThumbnail: () => {
    throw new Error("not needed for this test");
  },
  trimVideo: () => {
    throw new Error("not needed for this test");
  },
  trimAudio: () => {
    throw new Error("not needed for this test");
  },
};

describe("/api/uploads", () => {
  const testDb = createTestDatabase("uploads_route_test");
  const dirPromise = mkdtemp(path.join(tmpdir(), "uploads-test-"));
  let diskFull = false;
  let hint: UploadInputLimits | null = null;

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

  async function setup(
    media: UploadsServiceMedia = new MediaRunner(2),
    trimTimeoutMs?: number,
  ) {
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
      media,
      trimTimeoutMs,
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
    hint = { kind: "image_upload", maxSizeMb: 1, maxLongSide: 200 };

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

  test("complete refuses a still over ~100 megapixels before making its thumbnail", async () => {
    // A real 11000x10000 (110 MP) PNG would take real ffmpeg seconds to
    // encode and decode; probeImage is stubbed with the same facts
    // instead, so the test stays fast while still proving the cap is
    // checked before `makeThumbnail` ever runs (Dule's #140 review).
    let thumbnailCalled = false;
    const hugeStillMedia: UploadsServiceMedia = {
      probeImage: async () => ({
        ok: true,
        kind: "image",
        extension: "png",
        contentType: "image/png",
        facts: {
          formatName: "png_pipe",
          codecName: "png",
          width: 11000,
          height: 10000,
          pixFmt: null,
        },
      }),
      makeThumbnail: async () => {
        thumbnailCalled = true;
      },
      ...NOT_NEEDED_FOR_STILLS,
    };
    const { insertUser, as, dir } = await setup(hugeStillMedia);
    const app = as(await insertUser("huge@example.com"));
    const png = await makeImage(dir, "huge.png", "32x32");

    const created = await createUpload(app, {
      name: "huge.png",
      size: png.length,
      type: "image/png",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(app, upload.id, 0, png);
    const res = await app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toBe(
      "has too many pixels to process",
    );
    expect(thumbnailCalled).toBe(false);
  });

  test("a probe or thumbnail that times out refuses the Upload (422), not a 500 or a hang", async () => {
    // A 1ms timeout: real ffprobe/ffmpeg can't finish that fast, so
    // `MediaRunner` kills them, the same as it would a hung process on a
    // hostile or huge file (Dule's #140 review).
    const { insertUser, as, dir, repository } = await setup(
      new MediaRunner(2, 1),
    );
    const app = as(await insertUser("timeout@example.com"));
    const png = await makeImage(dir, "e.png", "32x32");

    const created = await createUpload(app, {
      name: "e.png",
      size: png.length,
      type: "image/png",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(app, upload.id, 0, png);

    const res = await Promise.race([
      app.request(`/api/uploads/${upload.id}/complete`, { method: "POST" }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("complete() never returned")), 5000),
      ),
    ]);
    expect(res.status).toBe(422);
    expect((await repository.get(upload.id))?.status).toBe("failed");
  });

  test("makeThumbnail timing out (not just probeImage) also refuses with 422, not a 500", async () => {
    const timesOutOnThumbnail: UploadsServiceMedia = {
      probeImage: (filePath) => new MediaRunner(2).probeImage(filePath),
      makeThumbnail: () => {
        throw new MediaTimeoutError("ffmpeg");
      },
      ...NOT_NEEDED_FOR_STILLS,
    };
    const { insertUser, as, dir, repository } =
      await setup(timesOutOnThumbnail);
    const app = as(await insertUser("thumb-timeout@example.com"));
    const png = await makeImage(dir, "f.png", "32x32");

    const created = await createUpload(app, {
      name: "f.png",
      size: png.length,
      type: "image/png",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(app, upload.id, 0, png);

    const res = await app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(422);
    expect((await repository.get(upload.id))?.status).toBe("failed");
  });

  const FIXTURES = path.join(import.meta.dir, "..", "uploads", "fixtures");
  async function fixtureBytes(name: string) {
    return new Uint8Array(
      await Bun.file(path.join(FIXTURES, name)).arrayBuffer(),
    );
  }

  /** Runs the full create/chunk/complete protocol for one fixture file (issue #51). */
  async function uploadFixture(
    app: TestApp,
    fixtureName: string,
    uploadName: string,
    type: string,
  ) {
    const bytes = await fixtureBytes(fixtureName);
    const created = await createUpload(app, {
      name: uploadName,
      size: bytes.length,
      type,
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(app, upload.id, 0, bytes);
    return app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });
  }

  test("a video Upload completes: probes H.264/AAC MP4, sets duration/fps and a thumbnail (issue #51)", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("video@example.com"));

    const res = await uploadFixture(
      app,
      "video-allowed.mp4",
      "clip.mp4",
      "video/mp4",
    );
    expect(res.status).toBe(200);
    const { upload } = (await res.json()) as {
      upload: {
        id: string;
        status: string;
        kind: string;
        width: number;
        height: number;
        durationMs: number;
        browserPlayable: boolean;
      };
    };
    expect(upload.status).toBe("complete");
    expect(upload.kind).toBe("video");
    expect(upload.width).toBe(64);
    expect(upload.height).toBe(48);
    expect(upload.durationMs).toBeGreaterThan(0);
    expect(upload.browserPlayable).toBe(true);

    const thumb = await app.request(`/api/uploads/${upload.id}/thumb`);
    expect(thumb.status).toBe(200);
  });

  test("an audio Upload completes: probes WAV, sets duration, no thumbnail (issue #51)", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("audio@example.com"));

    const res = await uploadFixture(
      app,
      "audio-allowed.wav",
      "clip.wav",
      "audio/wav",
    );
    expect(res.status).toBe(200);
    const { upload } = (await res.json()) as {
      upload: { status: string; kind: string; durationMs: number; id: string };
    };
    expect(upload.status).toBe("complete");
    expect(upload.kind).toBe("audio");
    expect(upload.durationMs).toBeGreaterThan(0);

    expect((await app.request(`/api/uploads/${upload.id}/thumb`)).status).toBe(
      404,
    );
  });

  test("an MP3 with embedded cover art completes (its attached_pic stream isn't treated as video)", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("coverart@example.com"));

    const res = await uploadFixture(
      app,
      "audio-cover-art.mp3",
      "clip.mp3",
      "audio/mpeg",
    );
    expect(res.status).toBe(200);
    const { upload } = (await res.json()) as {
      upload: { status: string; kind: string; durationMs: number };
    };
    expect(upload.status).toBe("complete");
    expect(upload.kind).toBe("audio");
    expect(upload.durationMs).toBeGreaterThan(0);
  });

  test("complete refuses a wrong video codec, a truncated file and a misnamed container (issue #51's AC)", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("wrongvideo@example.com"));

    for (const [fixture, name] of [
      ["video-refused.mp4", "a.mp4"],
      ["video-truncated.mp4", "b.mp4"],
      ["video-misnamed.mp4", "c.mp4"],
    ] as const) {
      const res = await uploadFixture(app, fixture, name, "video/mp4");
      expect(res.status).toBe(422);
    }
  });

  test("a variable frame rate video is accepted but marked not browser-playable (issue #51's AC)", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("vfr@example.com"));

    const res = await uploadFixture(
      app,
      "video-vfr.mp4",
      "vfr.mp4",
      "video/mp4",
    );
    expect(res.status).toBe(200);
    const { upload } = (await res.json()) as {
      upload: { browserPlayable: boolean };
    };
    expect(upload.browserPlayable).toBe(false);
  });

  test("a browser-unplayable video that fits its Input's limits passes through untrimmed; one that's too long is refused (ADR 0007)", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("unplayable@example.com"));
    hint = {
      kind: "video_upload",
      maxSizeMb: 1,
      maxLongSide: null,
      minDurationMs: 0,
      maxDurationMs: 5000,
      trimmable: true,
    };

    const fitsBytes = await fixtureBytes("video-unplayable-fits.mkv");
    const fitsCreated = await createUpload(app, {
      name: "fits.mkv",
      size: fitsBytes.length,
      type: "video/x-matroska",
      modelId: crypto.randomUUID(),
      inputId: "video-input",
    });
    const { upload: fitsUpload } = (await fitsCreated.json()) as {
      upload: { id: string };
    };
    await putChunk(app, fitsUpload.id, 0, fitsBytes);
    const fitsRes = await app.request(
      `/api/uploads/${fitsUpload.id}/complete`,
      { method: "POST" },
    );
    expect(fitsRes.status).toBe(200);
    const { upload: completedFits } = (await fitsRes.json()) as {
      upload: { status: string; browserPlayable: boolean };
    };
    expect(completedFits.status).toBe("complete");
    expect(completedFits.browserPlayable).toBe(false);

    const tooLongBytes = await fixtureBytes("video-unplayable-too-long.mkv");
    const tooLongCreated = await createUpload(app, {
      name: "toolong.mkv",
      size: tooLongBytes.length,
      type: "video/x-matroska",
      modelId: crypto.randomUUID(),
      inputId: "video-input",
    });
    const { upload: tooLongUpload } = (await tooLongCreated.json()) as {
      upload: { id: string };
    };
    await putChunk(app, tooLongUpload.id, 0, tooLongBytes);
    const tooLongRes = await app.request(
      `/api/uploads/${tooLongUpload.id}/complete`,
      { method: "POST" },
    );
    expect(tooLongRes.status).toBe(422);
  });

  test("a playable video too long for its Input, but trimmable, is accepted anyway (to be trimmed before submit)", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("tooLongPlayable@example.com"));
    hint = {
      kind: "video_upload",
      maxSizeMb: 1,
      maxLongSide: null,
      minDurationMs: 0,
      maxDurationMs: 500,
      trimmable: true,
    };

    const bytes = await fixtureBytes("video-allowed.mp4");
    const created = await createUpload(app, {
      name: "clip.mp4",
      size: bytes.length,
      type: "video/mp4",
      modelId: crypto.randomUUID(),
      inputId: "video-input",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(app, upload.id, 0, bytes);
    const res = await app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  test("a video too long and not trimmable is refused even though it's playable", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("notTrimmable@example.com"));
    hint = {
      kind: "video_upload",
      maxSizeMb: 1,
      maxLongSide: null,
      minDurationMs: 0,
      maxDurationMs: 500,
      trimmable: false,
    };

    const bytes = await fixtureBytes("video-allowed.mp4");
    const created = await createUpload(app, {
      name: "clip.mp4",
      size: bytes.length,
      type: "video/mp4",
      modelId: crypto.randomUUID(),
      inputId: "video-input",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(app, upload.id, 0, bytes);
    const res = await app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });
    expect(res.status).toBe(422);
  });

  test("trim makes a new Upload 'trimmed from' the original, re-encoded to H.264/AAC MP4 (issue #51's AC)", async () => {
    const { insertUser, as, repository } = await setup();
    const app = as(await insertUser("trim@example.com"));

    const completeRes = await uploadFixture(
      app,
      "video-allowed.mp4",
      "clip.mp4",
      "video/mp4",
    );
    const { upload: original } = (await completeRes.json()) as {
      upload: { id: string; durationMs: number };
    };

    const trimRes = await app.request(`/api/uploads/${original.id}/trim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startMs: 0, endMs: 500 }),
    });
    expect(trimRes.status).toBe(201);
    const { upload: trimmed } = (await trimRes.json()) as {
      upload: { id: string; status: string; kind: string; durationMs: number };
    };
    expect(trimmed.status).toBe("complete");
    expect(trimmed.kind).toBe("video");
    expect(trimmed.durationMs).toBeLessThan(original.durationMs);

    const stored = await repository.get(trimmed.id);
    expect(stored?.trimmedFromId).toBe(original.id);
    expect(stored?.trimStartMs).toBe(0);
    expect(stored?.trimEndMs).toBe(500);
    expect(stored?.extension).toBe("mp4");
    expect((stored?.probe as { codecName?: string } | null)?.codecName).toBe(
      "h264",
    );
  });

  test("trim: a post-trim thumbnail failure is caught, cleans up, and refuses (not a 500 or an orphan file)", async () => {
    const real = new MediaRunner(2);
    // The original Upload's own `complete` also makes a video thumbnail
    // (issue #51); only the trim's own thumbnail, the second call, fails.
    let thumbnailCalls = 0;
    const media: UploadsServiceMedia = {
      probeImage: (filePath) => real.probeImage(filePath),
      makeThumbnail: () => {
        throw new Error("not needed for this test");
      },
      probeVideoUpload: (filePath, extension, timeoutMs) =>
        real.probeVideoUpload(filePath, extension, timeoutMs),
      probeAudioUpload: () => {
        throw new Error("not needed for this test");
      },
      trimVideo: (input, output, startMs, endMs, fps, timeoutMs) =>
        real.trimVideo(input, output, startMs, endMs, fps, timeoutMs),
      trimAudio: () => {
        throw new Error("not needed for this test");
      },
      makeVideoThumbnail: (inputPath, outputPath, atMs, timeoutMs) => {
        thumbnailCalls += 1;
        if (thumbnailCalls > 1) throw new MediaTimeoutError("ffmpeg");
        return real.makeVideoThumbnail(inputPath, outputPath, atMs, timeoutMs);
      },
    };
    const { insertUser, as, dir } = await setup(media);
    const app = as(await insertUser("thumbfail@example.com"));

    const completeRes = await uploadFixture(
      app,
      "video-allowed.mp4",
      "clip.mp4",
      "video/mp4",
    );
    const { upload: original } = (await completeRes.json()) as {
      upload: { id: string };
    };

    const uploadsDir = path.join(dir, "data", "uploads");
    const files = async () =>
      (await readdir(uploadsDir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name))
        .sort();
    const before = await files();

    const trimRes = await app.request(`/api/uploads/${original.id}/trim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startMs: 0, endMs: 500 }),
    });
    expect(trimRes.status).toBe(422);

    // No orphan file (the new Upload's own "original"/thumbnail) lingers
    // after the refusal; an empty leftover directory doesn't count.
    expect(await files()).toEqual(before);
  });

  test("trim: time already spent (e.g. waiting for a busy ffmpeg) counts against the whole call's deadline, not a fresh one per stage", async () => {
    const real = new MediaRunner(2);
    const trimTimeoutMs = 5000;
    let probeTimeoutMs: number | undefined;
    const media: UploadsServiceMedia = {
      probeImage: (filePath) => real.probeImage(filePath),
      makeThumbnail: () => {
        throw new Error("not needed for this test");
      },
      probeVideoUpload: async (filePath, extension, timeoutMs) => {
        probeTimeoutMs = timeoutMs;
        return real.probeVideoUpload(filePath, extension, timeoutMs);
      },
      probeAudioUpload: () => {
        throw new Error("not needed for this test");
      },
      // Stands in for time spent waiting for a free ffmpeg slot: by the
      // time the re-encode is even done, a chunk of the deadline is gone.
      trimVideo: async (input, output, startMs, endMs, fps, timeoutMs) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await real.trimVideo(input, output, startMs, endMs, fps, timeoutMs);
      },
      trimAudio: () => {
        throw new Error("not needed for this test");
      },
      makeVideoThumbnail: (inputPath, outputPath, atMs, timeoutMs) =>
        real.makeVideoThumbnail(inputPath, outputPath, atMs, timeoutMs),
    };
    const { insertUser, as } = await setup(media, trimTimeoutMs);
    const app = as(await insertUser("deadline@example.com"));

    const completeRes = await uploadFixture(
      app,
      "video-allowed.mp4",
      "clip.mp4",
      "video/mp4",
    );
    const { upload: original } = (await completeRes.json()) as {
      upload: { id: string };
    };

    const trimRes = await app.request(`/api/uploads/${original.id}/trim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startMs: 0, endMs: 500 }),
    });
    expect(trimRes.status).toBe(201);
    expect(probeTimeoutMs).toBeLessThan(trimTimeoutMs - 150);
  });

  test("trim refuses a range outside the original's own duration", async () => {
    const { insertUser, as } = await setup();
    const app = as(await insertUser("badrange@example.com"));

    const completeRes = await uploadFixture(
      app,
      "video-allowed.mp4",
      "clip.mp4",
      "video/mp4",
    );
    const { upload } = (await completeRes.json()) as {
      upload: { id: string; durationMs: number };
    };

    const res = await app.request(`/api/uploads/${upload.id}/trim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startMs: 0, endMs: upload.durationMs + 10_000 }),
    });
    expect(res.status).toBe(400);
  });

  test("trim refuses an Upload that isn't a video or audio (e.g. an image)", async () => {
    const { insertUser, as, dir } = await setup();
    const app = as(await insertUser("notvideo@example.com"));
    const png = await makeImage(dir, "still.png", "32x32");

    const created = await createUpload(app, {
      name: "still.png",
      size: png.length,
      type: "image/png",
    });
    const { upload } = (await created.json()) as { upload: { id: string } };
    await putChunk(app, upload.id, 0, png);
    await app.request(`/api/uploads/${upload.id}/complete`, {
      method: "POST",
    });

    const res = await app.request(`/api/uploads/${upload.id}/trim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startMs: 0, endMs: 1 }),
    });
    expect(res.status).toBe(400);
  });
});
