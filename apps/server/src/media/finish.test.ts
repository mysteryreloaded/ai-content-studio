// finishAsset per kind (issue #45), against real fixtures copied into a
// scratch dir (finishing writes/renames in place) and against bytes
// ffmpeg/Bun.Image can't read — the fake Backend used elsewhere returns
// exactly that, so finishing must degrade to "no extra facts" rather
// than throw.

import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { finishAsset } from "./finish.js";
import { MediaRunner } from "./media.js";

async function listFinishingTempFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.includes(".finishing-"));
}

const FIXTURES = path.join(import.meta.dir, "fixtures");

function harness(root: string) {
  const warnings: string[] = [];
  return {
    warnings,
    deps: {
      media: new MediaRunner(2),
      absolutePath: (key: string) => path.join(root, key),
      write: async (key: string, data: Uint8Array) => {
        const filePath = path.join(root, key);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, data);
      },
      onWarning: (message: string) => warnings.push(message),
    },
  };
}

describe("finishAsset", () => {
  test("video: strips metadata, tags it, and writes a poster + thumbnail", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "finish-test-"));
    try {
      const storageKey = "assets/gen-1/2/tiny.mp4";
      await mkdir(path.dirname(path.join(root, storageKey)), {
        recursive: true,
      });
      await writeFile(
        path.join(root, storageKey),
        await readFile(path.join(FIXTURES, "tiny.mp4")),
      );

      const { deps, warnings } = harness(root);
      const facts = await finishAsset(
        deps,
        "video",
        storageKey,
        "AI-generated with Test on localhost, Generation gen-1",
      );

      expect(warnings).toEqual([]);
      expect(facts.width).toBe(64);
      expect(facts.height).toBe(48);
      expect(facts.fps).toBe(5);
      expect(facts.posterKey).toBe(`${storageKey}.poster.jpg`);
      expect(facts.thumbnailKey).toBe(`${storageKey}.thumb.webp`);

      const posterStat = await stat(path.join(root, facts.posterKey as string));
      expect(posterStat.size).toBeGreaterThan(0);
      const thumbStat = await stat(
        path.join(root, facts.thumbnailKey as string),
      );
      expect(thumbStat.size).toBeGreaterThan(0);

      const finishedSize = (await stat(path.join(root, storageKey))).size;
      expect(facts.size).toBe(finishedSize);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("video: a failed poster extraction after a successful remux still reports the remuxed size", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "finish-test-"));
    try {
      const storageKey = "assets/gen-1b/2/tiny.mp4";
      const absPath = path.join(root, storageKey);
      await mkdir(path.dirname(absPath), { recursive: true });
      await writeFile(absPath, await readFile(path.join(FIXTURES, "tiny.mp4")));
      const originalSize = (await stat(absPath)).size;

      const { deps, warnings } = harness(root);
      const media = deps.media;
      media.extractPosterFrame = async () => {
        throw new Error("boom");
      };

      const facts = await finishAsset(
        deps,
        "video",
        storageKey,
        "AI-generated with Test on localhost, Generation gen-1b",
      );

      expect(warnings.length).toBe(1);
      expect(facts.posterKey).toBeNull();
      expect(facts.thumbnailKey).toBeNull();

      const actualSize = (await stat(absPath)).size;
      expect(facts.size).toBe(actualSize);
      // The remux (-map_metadata -1, no re-encode) changes the file's
      // size, so a stale pre-remux size would have been wrong here too.
      expect(actualSize).not.toBe(originalSize);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("video: a failing ffmpeg remux leaves no .finishing- temp file behind", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "finish-test-"));
    try {
      const storageKey = "assets/gen-1c/2/tiny.mp4";
      const absPath = path.join(root, storageKey);
      const dir = path.dirname(absPath);
      await mkdir(dir, { recursive: true });
      await writeFile(absPath, await readFile(path.join(FIXTURES, "tiny.mp4")));

      const { deps, warnings } = harness(root);
      const media = deps.media;
      media.finishVideo = async (_input: string, output: string) => {
        // Simulate a partially-written temp file before ffmpeg fails/times out.
        await writeFile(output, new Uint8Array([1, 2, 3]));
        throw new Error("ffmpeg exploded");
      };

      const facts = await finishAsset(
        deps,
        "video",
        storageKey,
        "AI-generated with Test on localhost, Generation gen-1c",
      );

      expect(warnings.length).toBe(1);
      expect(facts.posterKey).toBeNull();
      expect(await listFinishingTempFiles(dir)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("image: makes a thumbnail and reads dimensions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "finish-test-"));
    try {
      const storageKey = "assets/gen-2/2/tiny.png";
      await mkdir(path.dirname(path.join(root, storageKey)), {
        recursive: true,
      });
      await writeFile(
        path.join(root, storageKey),
        await readFile(path.join(FIXTURES, "tiny.png")),
      );

      const { deps, warnings } = harness(root);
      const facts = await finishAsset(deps, "image", storageKey, "unused");

      expect(warnings).toEqual([]);
      expect(facts.width).toBe(32);
      expect(facts.height).toBe(32);
      expect(facts.posterKey).toBeNull();
      expect(facts.thumbnailKey).toBe(`${storageKey}.thumb.webp`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("audio: reads duration only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "finish-test-"));
    try {
      const storageKey = "assets/gen-3/2/tiny.wav";
      await mkdir(path.dirname(path.join(root, storageKey)), {
        recursive: true,
      });
      await writeFile(
        path.join(root, storageKey),
        await readFile(path.join(FIXTURES, "tiny.wav")),
      );

      const { deps, warnings } = harness(root);
      const facts = await finishAsset(deps, "audio", storageKey, "unused");

      expect(warnings).toEqual([]);
      expect(facts.durationMs).toBeGreaterThanOrEqual(950);
      expect(facts.posterKey).toBeNull();
      expect(facts.thumbnailKey).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("undecodable bytes (the fake Backend's placeholder content) degrade to no extra facts, not a throw", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "finish-test-"));
    try {
      const storageKey = "assets/gen-4/2/studio_00001_.png";
      await mkdir(path.dirname(path.join(root, storageKey)), {
        recursive: true,
      });
      const original = new TextEncoder().encode(
        "fake-comfyui:studio_00001_.png",
      );
      await writeFile(path.join(root, storageKey), original);

      const { deps, warnings } = harness(root);
      const facts = await finishAsset(deps, "image", storageKey, "unused");

      expect(warnings.length).toBe(1);
      expect(facts.thumbnailKey).toBeNull();
      expect(facts.width).toBeNull();
      expect(facts.size).toBe(original.length);

      const bytes = await readFile(path.join(root, storageKey));
      expect(bytes).toEqual(Buffer.from(original));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
