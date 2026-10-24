// The chunked Upload protocol (issue #50): create (name, size, type, and
// a Model/Input hint), PUT 16 MB chunks at the server's offset, then
// complete, which probes the file, sets its extension and makes its
// thumbnail. MAX_UPLOAD_MB is checked at all three steps;
// MIN_FREE_DISK_GB before every chunk.

import {
  BYTES_PER_MB,
  type Clock,
  type ImageUploadInputDefinition,
  imageUploadLimitIssue,
} from "@ai-content-studio/shared";
import type { MediaRunner } from "../media/media.js";
import type { Storage } from "../storage/storage.js";
import { MAX_IMAGE_MEGAPIXELS } from "./probe.js";
import type { UploadRecord, UploadsRepository } from "./repository.js";

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
  /** The hinted Image Upload Input's limits, when the hint names one. */
  hintLimits: (
    modelId: string,
    inputId: string,
  ) => Promise<Pick<
    ImageUploadInputDefinition,
    "maxSizeMb" | "maxLongSide"
  > | null>;
  /**
   * ffprobe/ffmpeg for Upload completion (issue #50), bounded by
   * `FFMPEG_CONCURRENCY` and a timeout: never the raw `uploads/probe.js`
   * functions directly, so a flaky user's many `/complete` calls, or one
   * huge-dimension still, can't OOM the box Postgres shares or hang this
   * route forever.
   */
  media: Pick<MediaRunner, "probeImage" | "makeThumbnail">;
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
    const advanced = await this.deps.repository.advance(id, offset, end);
    if (!advanced) {
      const current = await this.ownUpload(userId, id);
      throw new OffsetMismatch(current.receivedBytes);
    }
    return end;
  }

  /** Probes the received file and, when accepted, records its facts and thumbnail. Idempotent once complete. */
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
    const probe = await this.deps.media.probeImage(filePath);
    if (!probe.ok) await this.refuse(upload, probe.reason);
    const accepted = probe as Extract<typeof probe, { ok: true }>;

    if (accepted.facts.width * accepted.facts.height > MAX_IMAGE_MEGAPIXELS) {
      await this.refuse(upload, "has too many pixels to process");
    }

    if (upload.modelId && upload.inputId) {
      const limits = await this.deps.hintLimits(upload.modelId, upload.inputId);
      const issue = limits
        ? imageUploadLimitIssue(
            {
              size: upload.size,
              width: accepted.facts.width,
              height: accepted.facts.height,
            },
            limits,
          )
        : null;
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
      probe: accepted.facts,
      thumbnailKey,
      completedAt: this.deps.clock.now(),
    });
  }

  /** Marks the Upload failed, drops its bytes, and throws {@link UploadRefused}. */
  private async refuse(upload: UploadRecord, reason: string): Promise<never> {
    await this.deps.repository.markFailed(upload.id, reason);
    await this.deps.storage.delete(upload.storageKey);
    throw new UploadRefused(reason);
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
    error: upload.error,
  };
}
