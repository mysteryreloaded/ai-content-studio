// The chunked Upload protocol (issue #50): create (name, size, type, and
// a Model/Input hint), PUT 16 MB chunks at the server's offset, then
// complete, which probes the file, sets its extension and makes its
// thumbnail. MAX_UPLOAD_MB is checked at all three steps;
// MIN_FREE_DISK_GB before every chunk.

import {
  AUDIO_UPLOAD_EXTENSIONS,
  type AudioUploadInputDefinition,
  BYTES_PER_MB,
  type Clock,
  type ImageUploadInputDefinition,
  VIDEO_UPLOAD_EXTENSIONS,
  type VideoUploadInputDefinition,
  imageUploadLimitIssue,
} from "@ai-content-studio/shared";
import { type MediaRunner, MediaTimeoutError } from "../media/media.js";
import type { Storage } from "../storage/storage.js";
import { MAX_IMAGE_MEGAPIXELS, type VideoProbeFacts } from "./probe.js";
import type {
  UploadProbeFacts,
  UploadRecord,
  UploadsRepository,
} from "./repository.js";

/** The hinted Upload Input's limits, whatever its kind (issue #51). */
export type UploadInputLimits =
  | (Pick<ImageUploadInputDefinition, "maxSizeMb" | "maxLongSide"> & {
      kind: "image_upload";
    })
  | (Pick<
      VideoUploadInputDefinition,
      | "maxSizeMb"
      | "maxLongSide"
      | "minDurationMs"
      | "maxDurationMs"
      | "trimmable"
    > & { kind: "video_upload" })
  | (Pick<
      AudioUploadInputDefinition,
      "maxSizeMb" | "minDurationMs" | "maxDurationMs" | "trimmable"
    > & { kind: "audio_upload" });

export const CHUNK_BYTES = 16 * BYTES_PER_MB;

export const STORAGE_FULL_MESSAGE = "storage is full, try later";

/** HEIC and SVG are refused outright (CONTEXT.md, Upload), before any bytes are sent. */
const REFUSED_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "image/svg+xml",
]);
const REFUSED_EXTENSIONS = /\.(heic|heif|svg|svgz)$/i;

export class UploadNotFound extends Error {
  constructor() {
    super("not found");
  }
}

export class UploadTooLarge extends Error {
  constructor(maxUploadMb: number) {
    super(`larger than the ${maxUploadMb} MB limit`);
  }
}

export class StorageFull extends Error {
  constructor() {
    super(STORAGE_FULL_MESSAGE);
  }
}

export class InvalidUpload extends Error {}

/** The chunk wasn't sent at the server's offset; the client resumes from `offset`. */
export class OffsetMismatch extends Error {
  constructor(public readonly offset: number) {
    super("offset_mismatch");
  }
}

/** The Upload is no longer taking chunks (already complete, or refused). */
export class UploadNotUploading extends Error {
  constructor(public readonly status: UploadRecord["status"]) {
    super(`upload is ${status}`);
  }
}

export class UploadIncomplete extends Error {
  constructor(public readonly offset: number) {
    super("upload_incomplete");
  }
}

/** ffprobe or the hinted Input's limits refused the file at complete. */
export class UploadRefused extends Error {}

export interface CreateUploadParams {
  name: string;
  size: number;
  type: string;
  modelId: string | null;
  inputId: string | null;
}

export interface UploadsServiceDeps {
  repository: UploadsRepository;
  storage: Storage;
  clock: Clock;
  maxUploadMb: number;
  /** False while `DATA_DIR`'s disk is under MIN_FREE_DISK_GB. */
  hasFreeDisk: () => Promise<boolean>;
  /** The hinted Upload Input's limits, when the hint names one (issue #51). */
  hintLimits: (
    modelId: string,
    inputId: string,
  ) => Promise<UploadInputLimits | null>;
  /**
   * ffprobe/ffmpeg for Upload completion (issues #50, #51), bounded by
   * `FFMPEG_CONCURRENCY` and a timeout: never the raw `uploads/probe.js`
   * functions directly, so a flaky user's many `/complete` calls, or one
   * huge-dimension still, can't OOM the box Postgres shares or hang this
   * route forever.
   */
  media: Pick<
    MediaRunner,
    | "probeImage"
    | "makeThumbnail"
    | "probeVideoUpload"
    | "probeAudioUpload"
    | "makeVideoThumbnail"
    | "trimVideo"
    | "trimAudio"
  >;
  /** ~90s cap on one trim request, including the wait for ffmpeg (issue #51's AC). */
  trimTimeoutMs?: number;
}

export class UploadsService {
  constructor(private readonly deps: UploadsServiceDeps) {}

  private get maxBytes(): number {
    return this.deps.maxUploadMb * BYTES_PER_MB;
  }

  /** The caller's own Upload; anyone else's is reported as missing. */
  async ownUpload(userId: string, id: string): Promise<UploadRecord> {
    const upload = await this.deps.repository.get(id);
    if (!upload || upload.userId !== userId) throw new UploadNotFound();
    return upload;
  }

  async create(
    userId: string,
    params: CreateUploadParams,
  ): Promise<UploadRecord> {
    if (!Number.isInteger(params.size) || params.size < 1) {
      throw new InvalidUpload(
        "size must be a whole number of bytes, at least 1",
      );
    }
    if (params.size > this.maxBytes) {
      throw new UploadTooLarge(this.deps.maxUploadMb);
    }
    if (
      REFUSED_TYPES.has(params.type.toLowerCase()) ||
      REFUSED_EXTENSIONS.test(params.name)
    ) {
      throw new InvalidUpload("HEIC and SVG files aren't accepted");
    }

    const id = crypto.randomUUID();
    return this.deps.repository.create({
      id,
      userId,
      originalName: params.name.slice(0, 255),
      declaredType: params.type.slice(0, 255),
      size: params.size,
      modelId: params.modelId,
      inputId: params.inputId,
      storageKey: `uploads/${id}/original`,
      createdAt: this.deps.clock.now(),
    });
  }

  /** Writes one chunk at `offset`, which must be the server's own offset. Returns the new offset. */
  async putChunk(
    userId: string,
    id: string,
    offset: number,
    bytes: Uint8Array,
  ): Promise<number> {
    const upload = await this.ownUpload(userId, id);
    if (upload.status !== "uploading") {
      throw new UploadNotUploading(upload.status);
    }
    if (offset !== upload.receivedBytes) {
      throw new OffsetMismatch(upload.receivedBytes);
    }
    if (bytes.length === 0 || bytes.length > CHUNK_BYTES) {
      throw new InvalidUpload(`a chunk must be 1 byte to ${CHUNK_BYTES} bytes`);
    }
    const end = offset + bytes.length;
    if (end > this.maxBytes) throw new UploadTooLarge(this.deps.maxUploadMb);
    if (end > upload.size) {
      throw new InvalidUpload("chunk runs past the Upload's declared size");
    }
    if (!(await this.deps.hasFreeDisk())) throw new StorageFull();

    await this.deps.storage.writeAt(upload.storageKey, offset, bytes);
    const advanced = await this.deps.repository.advance(
      id,
      offset,
      end,
      this.deps.clock.now(),
    );
    if (!advanced) {
      const current = await this.ownUpload(userId, id);
      throw new OffsetMismatch(current.receivedBytes);
    }
    return end;
  }

  /** Probes the received file and, when accepted, records its facts and thumbnail/icon. Idempotent once complete. */
  async complete(userId: string, id: string): Promise<UploadRecord> {
    const upload = await this.ownUpload(userId, id);
    if (upload.status === "complete") return upload;
    if (upload.status !== "uploading") {
      throw new UploadNotUploading(upload.status);
    }
    if (upload.receivedBytes !== upload.size) {
      throw new UploadIncomplete(upload.receivedBytes);
    }

    const stat = await this.deps.storage.stat(upload.storageKey);
    if (!stat || stat.size !== upload.size) {
      throw new UploadIncomplete(stat?.size ?? 0);
    }
    if (stat.size > this.maxBytes) {
      await this.refuse(upload, `is larger than ${this.deps.maxUploadMb} MB`);
    }

    const filePath = this.deps.storage.absolutePath(upload.storageKey);
    const imageProbe = await this.deps.media.probeImage(filePath);
    const probe = imageProbe.ok
      ? imageProbe
      : await this.probeAsVideoOrAudio(
          filePath,
          upload.originalName,
          imageProbe.reason,
        );
    if (!probe.ok) await this.refuse(upload, probe.reason);
    const accepted = probe as Extract<typeof probe, { ok: true }>;

    const limits =
      upload.modelId && upload.inputId
        ? await this.deps.hintLimits(upload.modelId, upload.inputId)
        : null;

    if (accepted.kind === "image") {
      if (accepted.facts.width * accepted.facts.height > MAX_IMAGE_MEGAPIXELS) {
        await this.refuse(upload, "has too many pixels to process");
      }
      if (limits?.kind === "image_upload") {
        const issue = imageUploadLimitIssue(
          {
            size: upload.size,
            width: accepted.facts.width,
            height: accepted.facts.height,
          },
          limits,
        );
        if (issue) await this.refuse(upload, issue);
      }

      const thumbnailKey = `uploads/${id}/thumb.webp`;
      try {
        await this.deps.media.makeThumbnail(
          filePath,
          this.deps.storage.absolutePath(thumbnailKey),
        );
      } catch {
        await this.refuse(upload, "couldn't be read as an image");
      }

      return this.deps.repository.markComplete(id, {
        kind: accepted.kind,
        extension: accepted.extension,
        contentType: accepted.contentType,
        width: accepted.facts.width,
        height: accepted.facts.height,
        durationMs: null,
        fps: null,
        probe: accepted.facts,
        thumbnailKey,
        completedAt: this.deps.clock.now(),
      });
    }

    if (accepted.kind === "video") {
      if (limits?.kind === "video_upload") {
        await this.checkVideoLimits(upload, accepted.facts, limits);
      }

      const thumbnailKey = `uploads/${id}/thumb.webp`;
      try {
        await this.deps.media.makeVideoThumbnail(
          filePath,
          this.deps.storage.absolutePath(thumbnailKey),
        );
      } catch {
        await this.refuse(upload, "couldn't be read as a video");
      }

      return this.deps.repository.markComplete(id, {
        kind: accepted.kind,
        extension: accepted.extension,
        contentType: accepted.contentType,
        width: accepted.facts.width,
        height: accepted.facts.height,
        durationMs: accepted.facts.durationMs,
        fps: accepted.facts.fps,
        probe: accepted.facts,
        thumbnailKey,
        completedAt: this.deps.clock.now(),
      });
    }

    // Audio (issue #51's AC): no thumbnail is made; the browser shows an icon instead.
    if (limits?.kind === "audio_upload") {
      // Audio has no "browser can't play it" carve-out (ADR 0007 names video); the
      // duration check always runs, deferring only to its own `trimmable` flag.
      const issue = this.audioLimitIssue(accepted.facts, limits);
      if (issue) await this.refuse(upload, issue);
    }

    return this.deps.repository.markComplete(id, {
      kind: accepted.kind,
      extension: accepted.extension,
      contentType: accepted.contentType,
      width: null,
      height: null,
      durationMs: accepted.facts.durationMs,
      fps: null,
      probe: accepted.facts,
      thumbnailKey: null,
      completedAt: this.deps.clock.now(),
    });
  }

  /**
   * Tries the video, then the audio, probe; keeps the still's own
   * refusal reason if neither extension matches (issue #51). A probe
   * that times out (`MediaTimeoutError`) is reported as that, not
   * folded into "isn't an MP4/MOV/..." like a genuine codec mismatch.
   */
  private async probeAsVideoOrAudio(
    filePath: string,
    originalName: string,
    stillRefusalReason: string,
  ) {
    const extension = (originalName.split(".").pop() ?? "").toLowerCase();
    try {
      if (VIDEO_UPLOAD_EXTENSIONS.includes(extension)) {
        return await this.deps.media.probeVideoUpload(filePath, extension);
      }
      if (AUDIO_UPLOAD_EXTENSIONS.includes(extension)) {
        return await this.deps.media.probeAudioUpload(filePath, extension);
      }
    } catch (err) {
      if (err instanceof MediaTimeoutError) {
        return { ok: false as const, reason: "couldn't be probed in time" };
      }
      throw err;
    }
    return { ok: false as const, reason: stillRefusalReason };
  }

  /**
   * Refuses a video that breaks a fixed limit (size, long side or min
   * duration: trimming can't fix any of these) immediately; a too-long,
   * browser-playable, trimmable one is accepted anyway, to be trimmed
   * before submit (ADR 0007).
   */
  private async checkVideoLimits(
    upload: UploadRecord,
    facts: VideoProbeFacts,
    limits: Extract<UploadInputLimits, { kind: "video_upload" }>,
  ): Promise<void> {
    const fixedIssue = imageUploadLimitIssue(
      { size: upload.size, width: facts.width, height: facts.height },
      limits,
    );
    if (fixedIssue) await this.refuse(upload, fixedIssue);
    if (facts.durationMs < limits.minDurationMs) {
      await this.refuse(
        upload,
        `is shorter than ${(limits.minDurationMs / 1000).toFixed(1)}s`,
      );
    }
    if (facts.durationMs > limits.maxDurationMs) {
      if (limits.trimmable && facts.browserPlayable) return;
      await this.refuse(
        upload,
        `is longer than ${(limits.maxDurationMs / 1000).toFixed(1)}s`,
      );
    }
  }

  private audioLimitIssue(
    facts: { durationMs: number },
    limits: Extract<UploadInputLimits, { kind: "audio_upload" }>,
  ): string | null {
    if (facts.durationMs < limits.minDurationMs) {
      return `is shorter than ${(limits.minDurationMs / 1000).toFixed(1)}s`;
    }
    if (facts.durationMs > limits.maxDurationMs && !limits.trimmable) {
      return `is longer than ${(limits.maxDurationMs / 1000).toFixed(1)}s`;
    }
    return null;
  }

  /** Marks the Upload failed, drops its bytes, and throws {@link UploadRefused}. */
  private async refuse(upload: UploadRecord, reason: string): Promise<never> {
    await this.deps.repository.markFailed(upload.id, reason);
    await this.deps.storage.delete(upload.storageKey);
    throw new UploadRefused(reason);
  }

  /**
   * Trims a complete video or audio Upload to `[startMs, endMs)` on a
   * local player (issue #51's AC): a frame-accurate re-encode to
   * H.264/AAC, keeping the source's own size and fps, saved as a new
   * Upload "trimmed from" the original. Bounded by `trimTimeoutMs`
   * (default ~90s), covering the whole call: waiting for a free ffmpeg
   * slot, the re-encode, the probe of its own output, and (for video)
   * the thumbnail, all against one shared deadline, not 90s each.
   */
  async trim(
    userId: string,
    id: string,
    startMs: number,
    endMs: number,
  ): Promise<UploadRecord> {
    const original = await this.ownUpload(userId, id);
    if (original.status !== "complete") {
      throw new UploadNotUploading(original.status);
    }
    if (original.kind !== "video" && original.kind !== "audio") {
      throw new InvalidUpload("only a video or audio Upload can be trimmed");
    }
    const durationMs = original.durationMs ?? 0;
    if (
      !Number.isInteger(startMs) ||
      !Number.isInteger(endMs) ||
      startMs < 0 ||
      endMs <= startMs ||
      endMs > durationMs
    ) {
      throw new InvalidUpload(
        "the trim range must sit within the Upload's own duration",
      );
    }
    if (!(await this.deps.hasFreeDisk())) throw new StorageFull();

    const inputPath = this.deps.storage.absolutePath(original.storageKey);
    const newId = crypto.randomUUID();
    const isVideo = original.kind === "video";
    const extension = isVideo ? "mp4" : "m4a";
    const storageKey = `uploads/${newId}/original`;
    const outputPath = this.deps.storage.absolutePath(storageKey);
    const timeoutMs = this.deps.trimTimeoutMs ?? 90_000;
    const deadlineAt = Date.now() + timeoutMs;
    const remaining = () => Math.max(0, deadlineAt - Date.now());
    const refuseAfterCleanup = async (
      reason: string,
      ...keys: readonly string[]
    ): Promise<never> => {
      for (const key of keys) await this.deps.storage.delete(key);
      throw new UploadRefused(reason);
    };
    // Only a `MediaTimeoutError` (the shared deadline ran out) gets the
    // "in time" wording; any other ffmpeg/ffprobe failure (a corrupt
    // re-encode, a codec problem) is a distinct, genuine failure, not a
    // timeout, and shouldn't be misreported as one.
    const refuseFromError = (err: unknown, ...keys: readonly string[]) =>
      refuseAfterCleanup(
        err instanceof MediaTimeoutError
          ? "couldn't be trimmed in time; try a shorter range"
          : "couldn't be trimmed",
        ...keys,
      );

    // ffmpeg writes straight to `outputPath`; this just makes the new
    // Upload's own directory exist first (`write` is the only Storage
    // call that creates directories).
    await this.deps.storage.write(storageKey, new Uint8Array());

    try {
      if (isVideo) {
        const fps = (original.probe as VideoProbeFacts | null)?.fps || 30;
        await this.deps.media.trimVideo(
          inputPath,
          outputPath,
          startMs,
          endMs,
          fps,
          remaining(),
        );
      } else {
        await this.deps.media.trimAudio(
          inputPath,
          outputPath,
          startMs,
          endMs,
          remaining(),
        );
      }
    } catch (err) {
      return refuseFromError(err, storageKey);
    }

    const filePath = outputPath;
    let probe: Awaited<ReturnType<typeof this.deps.media.probeVideoUpload>>;
    try {
      probe = isVideo
        ? await this.deps.media.probeVideoUpload(
            filePath,
            extension,
            remaining(),
          )
        : await this.deps.media.probeAudioUpload(
            filePath,
            extension,
            remaining(),
          );
    } catch (err) {
      return refuseFromError(err, storageKey);
    }
    if (!probe.ok) {
      await this.deps.storage.delete(storageKey);
      throw new UploadRefused(probe.reason);
    }
    const accepted = probe as Extract<
      typeof probe,
      { ok: true; kind: "video" | "audio" }
    >;
    const stat = await this.deps.storage.stat(storageKey);

    let thumbnailKey: string | null = null;
    if (isVideo) {
      thumbnailKey = `uploads/${newId}/thumb.webp`;
      try {
        await this.deps.media.makeVideoThumbnail(
          filePath,
          this.deps.storage.absolutePath(thumbnailKey),
          0,
          remaining(),
        );
      } catch (err) {
        return refuseFromError(err, storageKey, thumbnailKey);
      }
    }

    return this.deps.repository.createTrimmed({
      id: newId,
      userId,
      originalName: original.originalName,
      declaredType: accepted.contentType,
      size: stat?.size ?? 0,
      modelId: original.modelId,
      inputId: original.inputId,
      storageKey,
      kind: accepted.kind,
      extension: accepted.extension,
      contentType: accepted.contentType,
      width: accepted.kind === "video" ? accepted.facts.width : null,
      height: accepted.kind === "video" ? accepted.facts.height : null,
      durationMs: accepted.facts.durationMs,
      fps: accepted.kind === "video" ? accepted.facts.fps : null,
      probe: accepted.facts,
      thumbnailKey,
      trimmedFromId: original.id,
      trimStartMs: startMs,
      trimEndMs: endMs,
      createdAt: this.deps.clock.now(),
    });
  }
}

/** What a browser sees of an Upload. */
export function toUploadSummary(upload: UploadRecord) {
  return {
    id: upload.id,
    status: upload.status,
    name: upload.originalName,
    size: upload.size,
    offset: upload.receivedBytes,
    chunkSize: CHUNK_BYTES,
    kind: upload.kind,
    width: upload.width,
    height: upload.height,
    durationMs: upload.durationMs,
    browserPlayable:
      upload.kind === "video"
        ? ((upload.probe as VideoProbeFacts | null)?.browserPlayable ?? null)
        : null,
    trimmedFromId: upload.trimmedFromId,
    error: upload.error,
  };
}
