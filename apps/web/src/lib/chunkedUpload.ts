// The browser half of the chunked Upload protocol (issue #50): create,
// PUT chunks at the server's offset, complete. A failed chunk is retried
// after asking the server how far it got, so a flaky connection resumes
// instead of starting over. Nothing survives a reload: a reload starts a
// new Upload.

import {
  BYTES_PER_MB,
  IMAGE_UPLOAD_TYPES,
  type ImageUploadInputDefinition,
  imageUploadLimitIssue,
} from "@ai-content-studio/shared";

/** The part of a `File` the upload reads. */
export interface UploadSource {
  name: string;
  size: number;
  type: string;
  slice(start: number, end: number): Blob;
}

export interface CompletedUpload {
  id: string;
  width: number | null;
  height: number | null;
}

/**
 * An upload step's failure. `fatal` ones (refused, too large, storage
 * full) are never retried; `serverOffset` is set when the server said
 * where it actually is.
 */
export class UploadError extends Error {
  constructor(
    message: string,
    public readonly fatal: boolean,
    public readonly serverOffset?: number,
  ) {
    super(message);
  }
}

export interface UploadHint {
  modelId: string;
  inputId: string;
}

/** The protocol's four calls, injectable so the retry logic is testable without a network. */
export interface UploadApi {
  create(
    source: UploadSource,
    hint: UploadHint | null,
  ): Promise<{ id: string; chunkSize: number }>;
  putChunk(id: string, offset: number, chunk: Blob): Promise<number>;
  offset(id: string): Promise<number>;
  complete(id: string): Promise<CompletedUpload>;
}

export interface UploadOptions {
  hint?: UploadHint | null;
  /** Called with 0-1 as bytes are confirmed by the server. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Consecutive failures allowed before giving up (default 5). */
  maxRetries?: number;
  /** Waits between retries; injectable for tests. */
  delay?: (ms: number) => Promise<void>;
}

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function asUploadError(err: unknown): UploadError {
  if (err instanceof UploadError) return err;
  // A network failure (fetch rejects) is always worth retrying.
  return new UploadError(
    err instanceof Error ? err.message : "network error",
    false,
  );
}

/** Uploads `source` in chunks, resuming from the server's offset after each failure. */
export async function uploadResumable(
  source: UploadSource,
  api: UploadApi,
  options: UploadOptions = {},
): Promise<CompletedUpload> {
  const maxRetries = options.maxRetries ?? 5;
  const delay = options.delay ?? defaultDelay;
  let failures = 0;

  async function withRetries<T>(
    step: () => Promise<T>,
    onFailure?: (err: UploadError) => Promise<void>,
  ): Promise<T> {
    while (true) {
      if (options.signal?.aborted) throw new UploadError("cancelled", true);
      try {
        const result = await step();
        failures = 0;
        return result;
      } catch (err) {
        const error = asUploadError(err);
        if (error.fatal) throw error;
        failures += 1;
        if (failures > maxRetries) throw error;
        await delay(Math.min(1000 * 2 ** (failures - 1), 15_000));
        await onFailure?.(error);
      }
    }
  }

  const { id, chunkSize } = await withRetries(() =>
    api.create(source, options.hint ?? null),
  );

  let offset = 0;
  options.onProgress?.(0);
  while (offset < source.size) {
    offset = await withRetries(
      async () => {
        // The server may already hold everything (a lost response).
        if (offset >= source.size) return offset;
        const end = Math.min(source.size, offset + chunkSize);
        const next = await api.putChunk(id, offset, source.slice(offset, end));
        if (next <= offset) {
          throw new UploadError("the server didn't take the chunk", false);
        }
        return next;
      },
      async (error) => {
        // Resume from where the server actually is, not where we hoped.
        offset =
          error.serverOffset ?? (await api.offset(id).catch(() => offset));
      },
    );
    options.onProgress?.(offset / source.size);
  }

  return withRetries(() => api.complete(id));
}

async function errorFrom(res: Response): Promise<UploadError> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    offset?: number;
  };
  const message = body.message ?? body.error ?? `upload failed (${res.status})`;
  if (res.status === 409 && typeof body.offset === "number") {
    return new UploadError(message, false, body.offset);
  }
  // 5xx (other than storage full) and 408/429 are transient; every other
  // refusal (too large, wrong kind, not found) won't change on a retry.
  const transient =
    (res.status >= 500 && res.status !== 507) ||
    res.status === 408 ||
    res.status === 429;
  return new UploadError(message, !transient);
}

/** The real `/api/uploads` calls. */
export function httpUploadApi(fetchImpl: typeof fetch = fetch): UploadApi {
  return {
    async create(source, hint) {
      const res = await fetchImpl("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: source.name,
          size: source.size,
          type: source.type,
          modelId: hint?.modelId ?? null,
          inputId: hint?.inputId ?? null,
        }),
      });
      if (!res.ok) throw await errorFrom(res);
      const { upload } = (await res.json()) as {
        upload: { id: string; chunkSize: number };
      };
      return { id: upload.id, chunkSize: upload.chunkSize };
    },
    async putChunk(id, offset, chunk) {
      const res = await fetchImpl(`/api/uploads/${id}/chunk?offset=${offset}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: chunk,
      });
      if (!res.ok) throw await errorFrom(res);
      return ((await res.json()) as { offset: number }).offset;
    },
    async offset(id) {
      const res = await fetchImpl(`/api/uploads/${id}/status`);
      if (!res.ok) throw await errorFrom(res);
      return ((await res.json()) as { upload: { offset: number } }).upload
        .offset;
    },
    async complete(id) {
      const res = await fetchImpl(`/api/uploads/${id}/complete`, {
        method: "POST",
      });
      if (!res.ok) throw await errorFrom(res);
      const { upload } = (await res.json()) as {
        upload: { id: string; width: number | null; height: number | null };
      };
      return { id: upload.id, width: upload.width, height: upload.height };
    },
  };
}

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Why a picked file is refused before any byte is sent (issue #50): the
 * wrong kind, larger than MAX_UPLOAD_MB or the Input's own limits.
 * Dimensions are checked only when the browser could read them.
 */
export function pickIssue(
  file: { name: string; size: number; type: string },
  limits: Pick<ImageUploadInputDefinition, "maxSizeMb" | "maxLongSide">,
  maxUploadMb: number | null,
  dimensions: { width: number; height: number } | null = null,
): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = file.type || EXTENSION_TYPES[extension] || "";
  if (!(type in IMAGE_UPLOAD_TYPES)) {
    return "isn't a PNG, JPEG or WebP image";
  }
  if (maxUploadMb !== null && file.size > maxUploadMb * BYTES_PER_MB) {
    return `is larger than ${maxUploadMb} MB`;
  }
  return imageUploadLimitIssue(
    { size: file.size, width: dimensions?.width, height: dimensions?.height },
    limits,
  );
}
