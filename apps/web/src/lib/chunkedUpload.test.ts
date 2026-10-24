import { describe, expect, test } from "bun:test";
import {
  type UploadApi,
  UploadError,
  pickAudioIssue,
  pickIssue,
  pickVideoIssue,
  uploadResumable,
} from "./chunkedUpload.js";

const MB = 1024 * 1024;

/**
 * An in-memory server: keeps the bytes it accepted and an offset, and can
 * be scripted to fail chunk calls, optionally after keeping part of them
 * (the flaky-connection case the client must resume from).
 */
function fakeServer(chunkSize: number) {
  let received = new Uint8Array();
  const calls: string[] = [];
  const script: Array<"ok" | "fail" | { keep: number }> = [];

  const api: UploadApi = {
    async create() {
      calls.push("create");
      return { id: "u1", chunkSize };
    },
    async putChunk(_id, offset, chunk) {
      calls.push(`put@${offset}`);
      if (offset !== received.length) {
        throw new UploadError("offset_mismatch", false, received.length);
      }
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      const step = script.shift() ?? "ok";
      if (step === "fail") throw new TypeError("network down");
      const kept = step === "ok" ? bytes : bytes.slice(0, step.keep);
      const next = new Uint8Array(received.length + kept.length);
      next.set(received);
      next.set(kept, received.length);
      received = next;
      if (step !== "ok") throw new TypeError("connection reset");
      return received.length;
    },
    async offset() {
      calls.push(`status=${received.length}`);
      return received.length;
    },
    async complete(id) {
      calls.push("complete");
      return {
        id,
        width: 10,
        height: 10,
        durationMs: null,
        browserPlayable: null,
      };
    },
  };
  return { api, calls, script, received: () => received };
}

function source(size: number) {
  const bytes = new Uint8Array(size).map((_, i) => i % 251);
  return { blob: new Blob([bytes]), bytes };
}

const noDelay = async () => {};

describe("uploadResumable", () => {
  test("sends every chunk at the server's offset, then completes", async () => {
    const server = fakeServer(4);
    const { blob, bytes } = source(10);
    const progress: number[] = [];

    const result = await uploadResumable(
      {
        name: "a.png",
        size: 10,
        type: "image/png",
        slice: (s, e) => blob.slice(s, e),
      },
      server.api,
      { onProgress: (f) => progress.push(f), delay: noDelay },
    );

    expect(result.id).toBe("u1");
    expect(server.calls).toEqual([
      "create",
      "put@0",
      "put@4",
      "put@8",
      "complete",
    ]);
    expect(server.received()).toEqual(bytes);
    expect(progress).toEqual([0, 0.4, 0.8, 1]);
  });

  test("a failed chunk resumes from the offset the server reports, not from the start", async () => {
    const server = fakeServer(4);
    const { blob, bytes } = source(10);
    // Chunk 2 drops after the server kept 3 of its 4 bytes.
    server.script.push("ok", { keep: 3 });

    await uploadResumable(
      {
        name: "a.png",
        size: 10,
        type: "image/png",
        slice: (s, e) => blob.slice(s, e),
      },
      server.api,
      { delay: noDelay },
    );

    expect(server.calls).toEqual([
      "create",
      "put@0",
      "put@4",
      "status=7",
      "put@7",
      "complete",
    ]);
    expect(server.received()).toEqual(bytes);
  });

  test("a lost response resumes past the chunk the server already kept, even when the offset query fails too", async () => {
    const server = fakeServer(4);
    const { blob } = source(8);
    let first = true;
    const api: UploadApi = {
      ...server.api,
      async putChunk(id, offset, chunk) {
        // The first try reached the server but its answer was lost.
        if (first) {
          first = false;
          await server.api.putChunk(id, offset, chunk);
          throw new TypeError("response lost");
        }
        return server.api.putChunk(id, offset, chunk);
      },
      async offset() {
        throw new TypeError("still offline");
      },
    };

    await uploadResumable(
      {
        name: "a.png",
        size: 8,
        type: "image/png",
        slice: (s, e) => blob.slice(s, e),
      },
      api,
      { delay: noDelay },
    );
    // The retry at the stale offset 0 is told the server's offset (4).
    expect(server.calls).toEqual([
      "create",
      "put@0",
      "put@0",
      "put@4",
      "complete",
    ]);
  });

  test("gives up after maxRetries consecutive failures, waiting longer each time", async () => {
    const server = fakeServer(4);
    const { blob } = source(8);
    server.script.push("fail", "fail", "fail");
    const waits: number[] = [];

    await expect(
      uploadResumable(
        {
          name: "a.png",
          size: 8,
          type: "image/png",
          slice: (s, e) => blob.slice(s, e),
        },
        server.api,
        {
          maxRetries: 2,
          delay: async (ms) => {
            waits.push(ms);
          },
        },
      ),
    ).rejects.toThrow("network down");
    expect(waits).toEqual([1000, 2000]);
  });

  test("never retries a fatal refusal", async () => {
    const server = fakeServer(4);
    const { blob } = source(8);
    let puts = 0;
    const api: UploadApi = {
      ...server.api,
      async putChunk() {
        puts += 1;
        throw new UploadError("storage is full, try later", true);
      },
    };

    await expect(
      uploadResumable(
        {
          name: "a.png",
          size: 8,
          type: "image/png",
          slice: (s, e) => blob.slice(s, e),
        },
        api,
        { delay: noDelay },
      ),
    ).rejects.toThrow("storage is full, try later");
    expect(puts).toBe(1);
  });

  test("a chunk the server answers without moving its offset counts as a failure", async () => {
    const server = fakeServer(4);
    const { blob } = source(8);
    const api: UploadApi = { ...server.api, putChunk: async () => 0 };
    await expect(
      uploadResumable(
        {
          name: "a.png",
          size: 8,
          type: "image/png",
          slice: (s, e) => blob.slice(s, e),
        },
        api,
        { maxRetries: 1, delay: noDelay },
      ),
    ).rejects.toThrow("the server didn't take the chunk");
  });

  test("stops when cancelled", async () => {
    const server = fakeServer(4);
    const { blob } = source(8);
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadResumable(
        {
          name: "a.png",
          size: 8,
          type: "image/png",
          slice: (s, e) => blob.slice(s, e),
        },
        server.api,
        { signal: controller.signal, delay: noDelay },
      ),
    ).rejects.toThrow("cancelled");
  });
});

describe("pickIssue", () => {
  const limits = { maxSizeMb: 10, maxLongSide: 2048 };

  test("refuses the wrong kind, judging by type or else by extension", () => {
    expect(
      pickIssue({ name: "a.gif", size: 10, type: "image/gif" }, limits, 500),
    ).toBe("isn't a PNG, JPEG or WebP image");
    expect(pickIssue({ name: "a.heic", size: 10, type: "" }, limits, 500)).toBe(
      "isn't a PNG, JPEG or WebP image",
    );
    expect(
      pickIssue({ name: "a.JPG", size: 10, type: "" }, limits, 500),
    ).toBeNull();
  });

  test("refuses a file over MAX_UPLOAD_MB or the Input's own limits", () => {
    const png = { name: "a.png", type: "image/png" };
    expect(pickIssue({ ...png, size: 6 * MB }, limits, 5)).toBe(
      "is larger than 5 MB",
    );
    expect(pickIssue({ ...png, size: 11 * MB }, limits, 500)).toBe(
      "is larger than 10 MB",
    );
    expect(
      pickIssue({ ...png, size: MB }, limits, 500, { width: 3000, height: 10 }),
    ).toBe("is larger than 2048 px on its long side");
    expect(
      pickIssue({ ...png, size: MB }, limits, 500, { width: 2048, height: 10 }),
    ).toBeNull();
  });
});

describe("pickVideoIssue", () => {
  const mp4 = { name: "clip.mp4", type: "video/mp4" };

  test("a too-long clip is refused against a non-trimmable Input", () => {
    const limits = {
      maxSizeMb: 50,
      maxLongSide: null,
      minDurationMs: 0,
      maxDurationMs: 10_000,
      trimmable: false,
    };
    expect(
      pickVideoIssue({ ...mp4, size: MB }, limits, 500, { durationMs: 30_000 }),
    ).toBe("is longer than 10.0s");
  });

  test("a too-long clip for a trimmable Input isn't refused client-side (it's trimmed before Generate)", () => {
    const limits = {
      maxSizeMb: 50,
      maxLongSide: null,
      minDurationMs: 0,
      maxDurationMs: 10_000,
      trimmable: true,
    };
    expect(
      pickVideoIssue({ ...mp4, size: MB }, limits, 500, { durationMs: 30_000 }),
    ).toBeNull();
  });

  test("a trimmable Input still refuses a too-short clip, and still refuses size/dimension issues", () => {
    const limits = {
      maxSizeMb: 50,
      maxLongSide: 1920,
      minDurationMs: 2_000,
      maxDurationMs: 10_000,
      trimmable: true,
    };
    expect(
      pickVideoIssue({ ...mp4, size: MB }, limits, 500, { durationMs: 500 }),
    ).toBe("is shorter than 2.0s");
    expect(
      pickVideoIssue({ ...mp4, size: 51 * MB }, limits, 500, {
        durationMs: 5000,
      }),
    ).toBe("is larger than 50 MB");
  });
});

describe("pickAudioIssue", () => {
  const mp3 = { name: "clip.mp3", type: "audio/mpeg" };

  test("a too-long clip is refused against a non-trimmable Input", () => {
    const limits = {
      maxSizeMb: 20,
      minDurationMs: 0,
      maxDurationMs: 10_000,
      trimmable: false,
    };
    expect(pickAudioIssue({ ...mp3, size: MB }, limits, 500, 30_000)).toBe(
      "is longer than 10.0s",
    );
  });

  test("a too-long clip for a trimmable Input isn't refused client-side", () => {
    const limits = {
      maxSizeMb: 20,
      minDurationMs: 0,
      maxDurationMs: 10_000,
      trimmable: true,
    };
    expect(
      pickAudioIssue({ ...mp3, size: MB }, limits, 500, 30_000),
    ).toBeNull();
  });

  test("a trimmable Input still refuses a too-short clip or one over its own size limit", () => {
    const limits = {
      maxSizeMb: 20,
      minDurationMs: 2_000,
      maxDurationMs: 10_000,
      trimmable: true,
    };
    expect(pickAudioIssue({ ...mp3, size: MB }, limits, 500, 500)).toBe(
      "is shorter than 2.0s",
    );
    expect(pickAudioIssue({ ...mp3, size: 21 * MB }, limits, 500, 5000)).toBe(
      "is larger than 20 MB",
    );
  });
});
