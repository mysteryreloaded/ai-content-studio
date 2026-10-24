// Real ffprobe/ffmpeg against the tiny committed Upload fixtures (issue
// #51's AC): allowed, refused, VFR, truncated and misnamed video and
// audio, plus a browser-unplayable one that fits its limits and one that
// doesn't (ADR 0007). `generate-fixtures.sh` makes every file here.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MediaRunner } from "../media/media.js";

const FIXTURES = path.join(import.meta.dir, "fixtures");
const f = (name: string) => path.join(FIXTURES, name);

describe("MediaRunner.probeVideoUpload / probeAudioUpload", () => {
  test("accepts an allowed H.264/AAC MP4, browser-playable, not VFR", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeVideoUpload(f("video-allowed.mp4"), "mp4");
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video")
      throw new Error("expected a video");
    expect(probe.extension).toBe("mp4");
    expect(probe.facts.codecName).toBe("h264");
    expect(probe.facts.width).toBe(64);
    expect(probe.facts.height).toBe(48);
    expect(probe.facts.fps).toBe(5);
    expect(probe.facts.durationMs).toBeGreaterThan(0);
    expect(probe.facts.browserPlayable).toBe(true);
  });

  test("refuses a wrong codec (MPEG-4 Part 2 isn't accepted)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeVideoUpload(f("video-refused.mp4"), "mp4");
    expect(probe.ok).toBe(false);
  });

  test("a variable frame rate video is accepted but not browser-playable", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeVideoUpload(f("video-vfr.mp4"), "mp4");
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video")
      throw new Error("expected a video");
    expect(probe.facts.browserPlayable).toBe(false);
  });

  test("refuses a truncated file (ffprobe can't read a full duration)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeVideoUpload(f("video-truncated.mp4"), "mp4");
    expect(probe.ok).toBe(false);
  });

  test("refuses a misnamed file (a real WebM renamed .mp4: container mismatch)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeVideoUpload(f("video-misnamed.mp4"), "mp4");
    expect(probe.ok).toBe(false);
  });

  test("a browser-unplayable (HEVC/MKV) video that fits is accepted, untrimmed (ADR 0007)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeVideoUpload(
      f("video-unplayable-fits.mkv"),
      "mkv",
    );
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video")
      throw new Error("expected a video");
    expect(probe.facts.browserPlayable).toBe(false);
    expect(probe.facts.durationMs).toBeLessThan(2000);
  });

  test("a browser-unplayable (HEVC/MKV) video probes fine even when too long to fit (the service refuses it, not the probe)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeVideoUpload(
      f("video-unplayable-too-long.mkv"),
      "mkv",
    );
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "video")
      throw new Error("expected a video");
    expect(probe.facts.browserPlayable).toBe(false);
    expect(probe.facts.durationMs).toBeGreaterThan(5000);
  });

  test("accepts an allowed PCM WAV", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeAudioUpload(f("audio-allowed.wav"), "wav");
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "audio") throw new Error("expected audio");
    expect(probe.facts.codecName).toBe("pcm_s16le");
    expect(probe.facts.durationMs).toBeGreaterThan(0);
  });

  test("refuses a wrong codec (A-law PCM isn't an accepted WAV codec)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeAudioUpload(f("audio-refused.wav"), "wav");
    expect(probe.ok).toBe(false);
  });

  test("refuses a misnamed file (a real WAV renamed .mp3: container mismatch)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeAudioUpload(f("audio-misnamed.mp3"), "mp3");
    expect(probe.ok).toBe(false);
  });

  test("accepts an MP3 with embedded cover art (ffprobe's attached_pic video stream doesn't count against it)", async () => {
    const media = new MediaRunner(2);
    const probe = await media.probeAudioUpload(f("audio-cover-art.mp3"), "mp3");
    expect(probe.ok).toBe(true);
    if (!probe.ok || probe.kind !== "audio") throw new Error("expected audio");
    expect(probe.facts.codecName).toBe("mp3");
    expect(probe.facts.durationMs).toBeGreaterThan(0);
  });

  test("trimVideo re-encodes a frame-accurate range to H.264/AAC MP4, keeping size and fps", async () => {
    const media = new MediaRunner(2);
    const dir = await mkdtemp(path.join(tmpdir(), "trim-test-"));
    try {
      const output = path.join(dir, "trimmed.mp4");
      await media.trimVideo(f("video-allowed.mp4"), output, 0, 500, 5);
      const probe = await media.probeVideoUpload(output, "mp4");
      expect(probe.ok).toBe(true);
      if (!probe.ok || probe.kind !== "video")
        throw new Error("expected a video");
      expect(probe.facts.codecName).toBe("h264");
      expect(probe.facts.width).toBe(64);
      expect(probe.facts.height).toBe(48);
      expect(probe.facts.durationMs).toBeLessThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("trimAudio re-encodes a frame-accurate range to AAC", async () => {
    const media = new MediaRunner(2);
    const dir = await mkdtemp(path.join(tmpdir(), "trim-test-"));
    try {
      const output = path.join(dir, "trimmed.m4a");
      await media.trimAudio(f("audio-allowed.wav"), output, 0, 500);
      const probe = await media.probeAudioUpload(output, "m4a");
      expect(probe.ok).toBe(true);
      if (!probe.ok || probe.kind !== "audio")
        throw new Error("expected audio");
      expect(probe.facts.codecName).toBe("aac");
      expect(probe.facts.durationMs).toBeLessThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("trimAudio drops an embedded cover art stream (-vn), so the trimmed Upload stays audio-only", async () => {
    const media = new MediaRunner(2);
    const dir = await mkdtemp(path.join(tmpdir(), "trim-test-"));
    try {
      const output = path.join(dir, "trimmed.m4a");
      await media.trimAudio(f("audio-cover-art.mp3"), output, 0, 500);
      const probe = await media.probeAudioUpload(output, "m4a");
      expect(probe.ok).toBe(true);
      if (!probe.ok || probe.kind !== "audio")
        throw new Error("expected audio");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
