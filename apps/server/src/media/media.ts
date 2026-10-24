// Runs ffmpeg and ffprobe for Asset finishing (issue #45): probing a
// video's facts, stripping metadata and tagging a video on save, pulling
// its first-frame poster, and probing an audio Asset's duration. Every
// call goes through `Bun.spawn` with argv (never a shell string), a
// timeout, and a `FFMPEG_CONCURRENCY`-bounded number of threads/processes
// so a burst of saves can't starve the box. Also runs `c2patool` for
// C2PA signing (issue #75), sharing the same bound.

import { cpus } from "node:os";
import {
  type ProbeResult,
  WRONG_AUDIO_KIND,
  WRONG_KIND,
  WRONG_VIDEO_KIND,
  parseAudioProbeOutput,
  parseProbeOutput,
  parseVideoProbeOutput,
} from "../uploads/probe.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export class MediaTimeoutError extends Error {
  constructor(cmd: string) {
    super(`${cmd} timed out`);
  }
}

export class MediaCommandError extends Error {
  constructor(cmd: string, exitCode: number, stderr: string) {
    super(`${cmd} exited ${exitCode}: ${stderr.slice(0, 2000)}`);
  }
}

/** Bounds how many ffmpeg/ffprobe processes run at once; callers past the bound wait their turn. */
class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

async function spawnBounded(
  cmd: readonly string[],
  timeoutMs: number,
): Promise<string> {
  const proc = Bun.spawn([...cmd], { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) throw new MediaTimeoutError(cmd[0] ?? "ffmpeg");
    if (exitCode !== 0) {
      throw new MediaCommandError(cmd[0] ?? "ffmpeg", exitCode, stderr);
    }
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

export interface VideoProbe {
  width: number;
  height: number;
  durationMs: number;
  fps: number;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split("/").map(Number);
  if (!num || !den) return 0;
  return num / den;
}

/** Runs ffmpeg/ffprobe for Asset finishing, bounded by `FFMPEG_CONCURRENCY` (issue #45). */
export class MediaRunner {
  private readonly semaphore: Semaphore;
  private readonly threads: number;

  constructor(
    concurrency: number,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    const bounded = Math.max(1, concurrency);
    this.semaphore = new Semaphore(bounded);
    this.threads = Math.max(1, Math.floor(cpus().length / bounded));
  }

  private async run(
    cmd: readonly string[],
    timeoutMs = this.timeoutMs,
  ): Promise<string> {
    const release = await this.semaphore.acquire();
    try {
      return await spawnBounded(cmd, timeoutMs);
    } finally {
      release();
    }
  }

  /** Resolution, duration and fps of a video file, from its first video stream and its container's duration. */
  async probeVideo(path: string): Promise<VideoProbe> {
    const stdout = await this.run([
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ]);
    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const stream = parsed.streams?.find((s) => s.codec_type === "video");
    if (!stream) throw new Error(`no video stream in ${path}`);
    const durationSeconds = Number(parsed.format?.duration ?? "0");
    return {
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      durationMs: Math.round(durationSeconds * 1000),
      fps: parseFrameRate(stream.r_frame_rate),
    };
  }

  /** An audio file's duration, in milliseconds. */
  async probeAudioDurationMs(path: string): Promise<number> {
    const stdout = await this.run([
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-print_format",
      "json",
      path,
    ]);
    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const durationSeconds = Number(parsed.format?.duration ?? "0");
    return Math.round(durationSeconds * 1000);
  }

  /**
   * Remuxes `input` to `output`: same video/audio bytes (`-c copy`),
   * `+faststart` so it plays before it's fully downloaded, every existing
   * metadata tag dropped (`-map_metadata -1`), and one `comment` tag set
   * to say it's AI-generated (issue #45's AC).
   */
  async finishVideo(
    input: string,
    output: string,
    comment: string,
  ): Promise<void> {
    await this.run([
      "ffmpeg",
      "-y",
      "-threads",
      String(this.threads),
      "-i",
      input,
      "-map",
      "0",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-map_metadata",
      "-1",
      "-metadata",
      `comment=${comment}`,
      output,
    ]);
  }

  /** The video's first frame, as a JPEG, for the poster image (issue #45). */
  async extractPosterFrame(input: string, output: string): Promise<void> {
    await this.run([
      "ffmpeg",
      "-y",
      "-threads",
      String(this.threads),
      "-i",
      input,
      "-frames:v",
      "1",
      "-update",
      "1",
      "-q:v",
      "3",
      output,
    ]);
  }

  /**
   * Probes an Upload still (issue #50), bounded the same as every other
   * call here. Never throws: a non-image file, a timeout or any other
   * ffprobe failure all come back as `{ ok: false }` so a caller can
   * refuse the Upload (422) without a try/catch of its own.
   */
  async probeImage(filePath: string): Promise<ProbeResult> {
    let stdout: string;
    try {
      stdout = await this.run([
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        filePath,
      ]);
    } catch {
      return { ok: false, reason: WRONG_KIND };
    }
    try {
      return parseProbeOutput(stdout);
    } catch {
      return { ok: false, reason: WRONG_KIND };
    }
  }

  /**
   * Writes a WebP thumbnail of `inputPath`, its long side at most 160 px,
   * to `outputPath` (issue #50). Bounded the same as every other call
   * here, so a hung or oversized decode can't hang the caller forever;
   * a timeout or ffmpeg error throws (`MediaTimeoutError`/
   * `MediaCommandError`), for the caller to turn into a refusal.
   */
  async makeThumbnail(inputPath: string, outputPath: string): Promise<void> {
    await this.run([
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-threads",
      String(this.threads),
      "-i",
      inputPath,
      "-vf",
      "scale=160:160:force_original_aspect_ratio=decrease",
      "-frames:v",
      "1",
      "-c:v",
      "libwebp",
      "-f",
      "webp",
      outputPath,
    ]);
  }

  /**
   * Probes an Upload video (issue #51), never throwing: a wrong codec, a
   * misnamed container, a timeout, or any other ffprobe failure all come
   * back as `{ ok: false }`, the same as {@link probeImage}.
   */
  async probeVideoUpload(
    filePath: string,
    extension: string,
  ): Promise<ProbeResult> {
    let stdout: string;
    try {
      stdout = await this.run([
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        filePath,
      ]);
    } catch {
      return { ok: false, reason: WRONG_VIDEO_KIND };
    }
    try {
      return parseVideoProbeOutput(stdout, extension);
    } catch {
      return { ok: false, reason: WRONG_VIDEO_KIND };
    }
  }

  /** Probes an Upload audio clip (issue #51); never throws, like {@link probeVideoUpload}. */
  async probeAudioUpload(
    filePath: string,
    extension: string,
  ): Promise<ProbeResult> {
    let stdout: string;
    try {
      stdout = await this.run([
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        filePath,
      ]);
    } catch {
      return { ok: false, reason: WRONG_AUDIO_KIND };
    }
    try {
      return parseAudioProbeOutput(stdout, extension);
    } catch {
      return { ok: false, reason: WRONG_AUDIO_KIND };
    }
  }

  /**
   * A video icon: the frame at `atMs` (default 0), scaled the same as
   * {@link makeThumbnail} (issue #51).
   */
  async makeVideoThumbnail(
    inputPath: string,
    outputPath: string,
    atMs = 0,
  ): Promise<void> {
    await this.run([
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-ss",
      (atMs / 1000).toString(),
      "-i",
      inputPath,
      "-threads",
      String(this.threads),
      "-vf",
      "scale=160:160:force_original_aspect_ratio=decrease",
      "-frames:v",
      "1",
      "-c:v",
      "libwebp",
      "-f",
      "webp",
      outputPath,
    ]);
  }

  /**
   * A frame-accurate trim of `[startMs, endMs)`, re-encoded to H.264/AAC
   * MP4 at the source's own size and fps (issue #51's AC). `-ss` before
   * `-i` seeks fast but to the nearest keyframe; re-encoding (not `-c
   * copy`) after it, with `-ss` placed again right after `-i`, makes the
   * cut land exactly on `startMs`. Bounded by `timeoutMs` (default this
   * runner's own), covering the Workbench's ~90s cap on one trim request.
   */
  async trimVideo(
    input: string,
    output: string,
    startMs: number,
    endMs: number,
    fps: number,
    timeoutMs?: number,
  ): Promise<void> {
    await this.run(
      [
        "ffmpeg",
        "-y",
        "-ss",
        (startMs / 1000).toString(),
        "-i",
        input,
        "-t",
        ((endMs - startMs) / 1000).toString(),
        "-threads",
        String(this.threads),
        "-r",
        String(fps),
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        output,
      ],
      timeoutMs,
    );
  }

  /**
   * A frame-accurate trim of `[startMs, endMs)` of an audio clip,
   * re-encoded to AAC (issue #51's AC: the kept range, re-encoded).
   */
  async trimAudio(
    input: string,
    output: string,
    startMs: number,
    endMs: number,
    timeoutMs?: number,
  ): Promise<void> {
    await this.run(
      [
        "ffmpeg",
        "-y",
        "-ss",
        (startMs / 1000).toString(),
        "-i",
        input,
        "-t",
        ((endMs - startMs) / 1000).toString(),
        "-threads",
        String(this.threads),
        "-c:a",
        "aac",
        "-f",
        "ipod",
        output,
      ],
      timeoutMs,
    );
  }

  /** Runs `c2patool` to sign `assetPath` per `manifestPath`, writing to `outputPath` (issue #75). Shares this runner's semaphore and timeout with ffmpeg/ffprobe. */
  async signC2pa(
    assetPath: string,
    manifestPath: string,
    outputPath: string,
  ): Promise<void> {
    await this.run([
      "c2patool",
      assetPath,
      "-m",
      manifestPath,
      "-o",
      outputPath,
      "-f",
    ]);
  }
}
