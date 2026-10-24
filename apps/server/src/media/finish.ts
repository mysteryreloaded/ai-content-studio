// Finishes a just-saved Asset (issue #45): video gets stripped metadata,
// an "AI-generated" comment tag, probed facts and a poster + thumbnail;
// images get a thumbnail; audio gets its duration. Best-effort — a
// Backend's output is never guaranteed to be bytes ffmpeg/`Bun.Image` can
// read (the fake Backend used in tests isn't), so a decode failure just
// skips the extra facts rather than failing the Generation; `onWarning`
// is how the caller surfaces that to a Log entry.
//
// When the Operator configures a certificate (issue #75), every kind
// also gets a C2PA manifest signed in after its own processing above,
// unless the box is arm64 or the file's format is one c2patool doesn't
// support — then the Asset keeps only its existing "AI-generated" tag.

import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { AssetKind } from "@ai-content-studio/shared";
import {
  type C2paManifestInfo,
  type C2paSignerConfig,
  c2paSupportsArch,
  c2paSupportsFormat,
  signAssetWithC2pa,
} from "./c2pa.js";
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
  /** Issue #75: set only when the Operator configured a certificate and key. */
  c2pa?: C2paSignerConfig | null;
}

/**
 * Signs `storageKey` with C2PA when `deps.c2pa` is configured, `info` is
 * given and the arch/format allow it (issue #75's AC: otherwise the
 * Asset keeps only its existing "AI-generated" tag). Returns the file's
 * resulting size, so a caller that just finished writing it (and so
 * already knows its size) only re-stats when signing actually ran.
 */
async function maybeSignC2pa(
  deps: FinishAssetDeps,
  storageKey: string,
  info: C2paManifestInfo | undefined,
  currentSize: number,
): Promise<number> {
  if (!deps.c2pa || !info) return currentSize;
  if (!c2paSupportsArch() || !c2paSupportsFormat(storageKey))
    return currentSize;
  const absPath = deps.absolutePath(storageKey);
  await signAssetWithC2pa(deps.media, absPath, deps.c2pa, info, deps.onWarning);
  return (await stat(absPath)).size;
}

async function finishVideo(
  deps: FinishAssetDeps,
  storageKey: string,
  comment: string,
  c2pa: C2paManifestInfo | undefined,
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

    currentSize = await maybeSignC2pa(deps, storageKey, c2pa, currentSize);

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
  c2pa: C2paManifestInfo | undefined,
): Promise<FinishedAssetFacts> {
  const absPath = deps.absolutePath(storageKey);
  const originalSize = (await stat(absPath)).size;

  try {
    const dimensions = await imageDimensions(absPath);
    const thumbnail = await makeWebpThumbnail(absPath);
    const thumbnailKey = `${storageKey}.thumb.webp`;
    await deps.write(thumbnailKey, thumbnail);
    const size = await maybeSignC2pa(deps, storageKey, c2pa, originalSize);
    return {
      ...emptyFacts(size),
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
  c2pa: C2paManifestInfo | undefined,
): Promise<FinishedAssetFacts> {
  const absPath = deps.absolutePath(storageKey);
  const originalSize = (await stat(absPath)).size;

  try {
    const durationMs = await deps.media.probeAudioDurationMs(absPath);
    const size = await maybeSignC2pa(deps, storageKey, c2pa, originalSize);
    return { ...emptyFacts(size), durationMs };
  } catch (err) {
    deps.onWarning(`audio probe failed: ${describeError(err)}`);
    return emptyFacts(originalSize);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Finishes one just-saved Asset's file at `storageKey`, by its `kind`
 * (issue #45). `c2pa` names the Model, site title and Generation id for
 * the C2PA manifest (issue #75); omit it where `deps.c2pa` isn't set.
 */
export async function finishAsset(
  deps: FinishAssetDeps,
  kind: AssetKind,
  storageKey: string,
  comment: string,
  c2pa?: C2paManifestInfo,
): Promise<FinishedAssetFacts> {
  if (kind === "video") return finishVideo(deps, storageKey, comment, c2pa);
  if (kind === "image") return finishImage(deps, storageKey, c2pa);
  return finishAudio(deps, storageKey, c2pa);
}
