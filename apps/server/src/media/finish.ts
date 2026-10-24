// Finishes a just-saved Asset (issue #45): video gets stripped metadata,
// an "AI-generated" comment tag, probed facts and a poster + thumbnail;
// images get a thumbnail; audio gets its duration. Best-effort — a
// Backend's output is never guaranteed to be bytes ffmpeg/`Bun.Image` can
// read (the fake Backend used in tests isn't), so a decode failure just
// skips the extra facts rather than failing the Generation; `onWarning`
// is how the caller surfaces that to a Log entry.

import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AssetKind } from "@ai-content-studio/shared";
import type { MediaRunner } from "./media.js";
import { imageDimensions, makeWebpThumbnail } from "./thumbnail.js";

export interface FinishedAssetFacts {
  size: number;
  posterKey: string | null;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
}

function emptyFacts(size: number): FinishedAssetFacts {
  return {
    size,
    posterKey: null,
    thumbnailKey: null,
    width: null,
    height: null,
    durationMs: null,
    fps: null,
  };
}

export interface FinishAssetDeps {
  media: MediaRunner;
  /** Resolves a storage key to the absolute path backing it, mirroring `Storage.absolutePath`. */
  absolutePath: (key: string) => string;
  /** Writes bytes at a storage key, creating its parent directory, mirroring `Storage.write`. */
  write: (key: string, data: Uint8Array) => Promise<void>;
  onWarning: (message: string) => void;
}

async function finishVideo(
  deps: FinishAssetDeps,
  storageKey: string,
  comment: string,
): Promise<FinishedAssetFacts> {
  const absPath = deps.absolutePath(storageKey);
  const originalSize = (await stat(absPath)).size;
  // Tracks the file's real on-disk size as finishing progresses, so a
  // failure after the remux has replaced the original bytes (e.g. the
  // poster/thumbnail step) still reports the remuxed size rather than
  // the pre-remux one — otherwise a saved Content-Length/Range would
  // disagree with the actual file.
  let currentSize = originalSize;

  try {
    const probe = await deps.media.probeVideo(absPath);
    // ffmpeg picks the output container from the extension, so the temp
    // name must keep the original one (e.g. ".mp4"), not just append a
    // random suffix after it.
    const finishedPath = `${absPath.slice(0, -path.extname(absPath).length)}.finishing-${crypto.randomUUID()}${path.extname(absPath)}`;
    try {
      await deps.media.finishVideo(absPath, finishedPath, comment);
    } catch (err) {
      await rm(finishedPath, { force: true });
      throw err;
    }
    await rename(finishedPath, absPath);
    currentSize = (await stat(absPath)).size;

    const posterKey = `${storageKey}.poster.jpg`;
    const posterPath = deps.absolutePath(posterKey);
    await mkdir(path.dirname(posterPath), { recursive: true });
    await deps.media.extractPosterFrame(absPath, posterPath);

    let thumbnailKey: string | null = null;
    try {
      const thumbnail = await makeWebpThumbnail(posterPath);
      thumbnailKey = `${storageKey}.thumb.webp`;
      await deps.write(thumbnailKey, thumbnail);
    } catch (err) {
      deps.onWarning(`video thumbnail failed: ${describeError(err)}`);
    }

    return {
      size: currentSize,
      posterKey,
      thumbnailKey,
      width: probe.width,
      height: probe.height,
      durationMs: probe.durationMs,
      fps: probe.fps,
    };
  } catch (err) {
    deps.onWarning(`video finishing failed: ${describeError(err)}`);
    return emptyFacts(currentSize);
  }
}

async function finishImage(
  deps: FinishAssetDeps,
  storageKey: string,
): Promise<FinishedAssetFacts> {
  const absPath = deps.absolutePath(storageKey);
  const originalSize = (await stat(absPath)).size;

  try {
    const dimensions = await imageDimensions(absPath);
    const thumbnail = await makeWebpThumbnail(absPath);
    const thumbnailKey = `${storageKey}.thumb.webp`;
    await deps.write(thumbnailKey, thumbnail);
    return {
      ...emptyFacts(originalSize),
      thumbnailKey,
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (err) {
    deps.onWarning(`image thumbnail failed: ${describeError(err)}`);
    return emptyFacts(originalSize);
  }
}

async function finishAudio(
  deps: FinishAssetDeps,
  storageKey: string,
): Promise<FinishedAssetFacts> {
  const absPath = deps.absolutePath(storageKey);
  const originalSize = (await stat(absPath)).size;

  try {
    const durationMs = await deps.media.probeAudioDurationMs(absPath);
    return { ...emptyFacts(originalSize), durationMs };
  } catch (err) {
    deps.onWarning(`audio probe failed: ${describeError(err)}`);
    return emptyFacts(originalSize);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Finishes one just-saved Asset's file at `storageKey`, by its `kind` (issue #45). */
export async function finishAsset(
  deps: FinishAssetDeps,
  kind: AssetKind,
  storageKey: string,
  comment: string,
): Promise<FinishedAssetFacts> {
  if (kind === "video") return finishVideo(deps, storageKey, comment);
  if (kind === "image") return finishImage(deps, storageKey);
  return finishAudio(deps, storageKey);
}
