// Real ffmpeg/ffprobe against tiny committed fixtures (issue #45's AC):
// a 1.4s 64x48 5fps video, a 32x32 still and a 1s silent clip. Also
// real c2patool, signing with the c2pa-rs test chain (issue #75's AC).

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MediaCommandError, MediaRunner } from "./media.js";

const FIXTURES = path.join(import.meta.dir, "fixtures");
const VIDEO = path.join(FIXTURES, "tiny.mp4");
const IMAGE = path.join(FIXTURES, "tiny.png");
const AUDIO = path.join(FIXTURES, "tiny.wav");
const CERT_PATH = path.join(FIXTURES, "c2pa", "es256_certs.pem");
const KEY_PATH = path.join(FIXTURES, "c2pa", "es256_private.key");

describe("MediaRunner", () => {
  test("probeVideo reads resolution, duration and fps", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeVideo(VIDEO);
    expect(probe.width).toBe(64);
    expect(probe.height).toBe(48);
    expect(probe.fps).toBe(5);
    expect(probe.durationMs).toBeGreaterThan(1000);
    expect(probe.durationMs).toBeLessThan(2000);
  });

  test("probeAudioDurationMs reads duration", async () => {
    const media = new MediaRunner(2);
    const durationMs = await media.probeAudioDurationMs(AUDIO);
    expect(durationMs).toBeGreaterThanOrEqual(950);
    expect(durationMs).toBeLessThanOrEqual(1050);
  });

  test("finishVideo strips metadata, keeps the video playable and sets the comment tag", async () => {
    const media = new MediaRunner(2);
    const dir = await mkdtemp(path.join(tmpdir(), "media-test-"));
    try {
      const output = path.join(dir, "finished.mp4");
      await media.finishVideo(
        VIDEO,
        output,
        "AI-generated with Test on localhost, Generation abc123",
      );

      const probe = await media.probeVideo(output);
      expect(probe.width).toBe(64);
      expect(probe.height).toBe(48);

      const stdout =
        await Bun.$`ffprobe -v error -print_format json -show_format -show_streams ${output}`.text();
      const parsed = JSON.parse(stdout) as {
        format: { tags?: Record<string, string> };
        streams: { tags?: Record<string, string> }[];
      };
      expect(parsed.format.tags?.comment).toBe(
        "AI-generated with Test on localhost, Generation abc123",
      );
      // The source's own encoder tag ("Lavc... libx264") is gone; only the
      // mp4 muxer's own default tags remain, which `-map_metadata -1`
      // doesn't (and can't) touch.
      expect(parsed.streams[0]?.tags?.encoder).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("extractPosterFrame pulls a readable first-frame JPEG", async () => {
    const media = new MediaRunner(2);
    const dir = await mkdtemp(path.join(tmpdir(), "media-test-"));
    try {
      const output = path.join(dir, "poster.jpg");
      await media.extractPosterFrame(VIDEO, output);
      const bytes = await readFile(output);
      expect(bytes.length).toBeGreaterThan(0);
      // JPEG magic bytes.
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a bad path rejects with MediaCommandError", async () => {
    const media = new MediaRunner(2);
    await expect(
      media.probeVideo(path.join(FIXTURES, "missing.mp4")),
    ).rejects.toBeInstanceOf(MediaCommandError);
  });

  test("probeImage accepts a still and makeThumbnail scales it down (issue #50)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeImage(IMAGE);
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "image")
      throw new Error("expected an image");
    expect(probe.facts.width).toBe(32);
    expect(probe.facts.height).toBe(32);

    const dir = await mkdtemp(path.join(tmpdir(), "media-test-"));
    try {
      const output = path.join(dir, "thumb.webp");
      await media.makeThumbnail(IMAGE, output);
      const bytes = await readFile(output);
      expect(bytes.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("probeImage never throws on a non-image path: a missing file comes back ok: false", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeImage(path.join(FIXTURES, "missing.png"));
    expect(probe).toEqual({
      ok: false,
      reason: "isn't a PNG, JPEG or WebP image",
    });
  });

  test("a 1ms timeout kills probeImage's ffprobe and comes back ok: false, never hangs or throws", async () => {
    // Real ffprobe can't finish in 1ms, so `MediaRunner` kills it; the
    // same bound protects `makeThumbnail` against a hostile or huge
    // file's decode (Dule's #140 review).
    const media = new MediaRunner(2, 1);
    const probe = await media.probeImage(IMAGE);
    expect(probe.ok).toBe(false);
  });

  test("signC2pa signs an image with the c2pa-rs test chain (issue #75's AC)", async () => {
    const media = new MediaRunner(2);
    const dir = await mkdtemp(path.join(tmpdir(), "media-test-"));
    try {
      const manifestPath = path.join(dir, "manifest.json");
      await Bun.write(
        manifestPath,
        JSON.stringify({
          title: "My Studio",
          sign_cert: CERT_PATH,
          private_key: KEY_PATH,
          assertions: [
            {
              label: "c2pa.actions",
              data: {
                actions: [
                  {
                    action: "c2pa.created",
                    digitalSourceType:
                      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
                  },
                ],
              },
            },
          ],
        }),
      );
      const output = path.join(dir, "signed.png");
      await media.signC2pa(IMAGE, manifestPath, output);

      const reportJson = await Bun.$`c2patool ${output}`.text();
      const report = JSON.parse(reportJson) as {
        manifests: Record<string, { title?: string }>;
        active_manifest?: string;
        validation_state: string;
      };
      expect(report.validation_state).toBe("Valid");
      const active = report.active_manifest
        ? report.manifests[report.active_manifest]
        : undefined;
      expect(active?.title).toBe("My Studio");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
