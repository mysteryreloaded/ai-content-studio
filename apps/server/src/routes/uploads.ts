// `/api/uploads`: the chunked Upload protocol (issue #50) and serving a
// complete Upload (and its thumbnail) to its owner or an Admin, 404 for
// anyone else. Uploads carry on during a Pause, so these are `active`.

import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { validate } from "../auth/validate.js";
import { parseRange } from "../http/range.js";
import type { Storage } from "../storage/storage.js";
import type { UploadsRepository } from "../uploads/repository.js";
import {
  CHUNK_BYTES,
  InvalidUpload,
  OffsetMismatch,
  StorageFull,
  UploadIncomplete,
  UploadNotFound,
  UploadNotUploading,
  UploadRefused,
  UploadTooLarge,
  type UploadsService,
  toUploadSummary,
} from "../uploads/service.js";

const trimSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  name: z.string().min(1).max(1000),
  size: z.number(),
  type: z.string().max(255),
  /** Only a hint (issue #50): which Input's limits to check at complete. */
  modelId: z.string().regex(UUID_RE).nullish(),
  inputId: z.string().max(100).nullish(),
});

/**
 * The `validate` middleware has already consumed the body (hono caches its
 * raw text in `c.req.bodyCache`), so re-parse that cached text exactly the
 * way the previous `c.req.json().catch(() => null)` + `safeParse` did —
 * `null` when it doesn't parse — keeping the 400 body byte-for-byte the
 * same for both the "malformed" and the "invalid" reason.
 */
async function invalidJsonBody(
  c: Context<AppEnv>,
  schema: typeof createSchema | typeof trimSchema,
): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    body = null;
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    // Unreachable: `validate` only calls this after the same schema already
    // failed on the same body — keep the 400's shape regardless.
    return c.json({ error: "invalid input", issues: [] }, 400);
  }
  return c.json({ error: "invalid input", issues: parsed.error.issues }, 400);
}

function idParam(c: Context<AppEnv>): string {
  const id = c.req.param("id");
  if (!id) throw new Error("id param missing");
  return id;
}

/**
 * `/:id/trim`'s id check as a middleware, because it must run before the
 * JSON validation: a non-UUID id is a 404, never the 400 a bodyless or
 * malformed body would otherwise produce — the same order the converted
 * handler had, where the id was checked before the body was parsed.
 */
function checkIdParam(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = c.req.param("id");
    if (!id || !UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
    await next();
  };
}

/** `attachment; filename=...` with an RFC 5987 UTF-8 fallback, so the original name survives any characters. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function uploadsRoute(
  service: UploadsService,
  repository: UploadsRepository,
  storage: Storage,
  routes: RouteEntry[],
) {
  const basePath = "/api/uploads";

  function handleError(c: Context<AppEnv>, err: unknown) {
    if (err instanceof UploadNotFound)
      return c.json({ error: "not found" }, 404);
    if (err instanceof UploadTooLarge) {
      return c.json({ error: "too_large", message: err.message }, 413);
    }
    if (err instanceof StorageFull) {
      return c.json({ error: "storage_full", message: err.message }, 507);
    }
    if (err instanceof InvalidUpload) {
      return c.json({ error: "invalid", message: err.message }, 400);
    }
    if (err instanceof OffsetMismatch) {
      return c.json({ error: "offset_mismatch", offset: err.offset }, 409);
    }
    if (err instanceof UploadNotUploading) {
      return c.json({ error: "not_uploading", status: err.status }, 409);
    }
    if (err instanceof UploadIncomplete) {
      return c.json({ error: "incomplete", offset: err.offset }, 409);
    }
    if (err instanceof UploadRefused) {
      return c.json({ error: "refused", message: err.message }, 422);
    }
    throw err;
  }

  /** A complete Upload the caller owns, or any one for an Admin; null (404) otherwise. A removed Upload 404s for anyone but an Admin (issue #68's AC). */
  async function viewable(c: Context<AppEnv>) {
    const session = c.get("session");
    const id = idParam(c);
    if (!session || !UUID_RE.test(id)) return null;
    const upload = await repository.get(id);
    if (
      !upload ||
      upload.status !== "complete" ||
      (upload.userId !== session.user.id && session.user.role !== "admin") ||
      (upload.removedAt !== null && session.user.role !== "admin")
    ) {
      return null;
    }
    return upload;
  }

  return (
    new Hono<AppEnv>()
      .post(
        "/",
        guard(routes, basePath, "post", "/", "active"),
        validate("json", createSchema, (c) => invalidJsonBody(c, createSchema)),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);

          const body = c.req.valid("json");
          try {
            const upload = await service.create(session.user.id, {
              name: body.name,
              size: body.size,
              type: body.type,
              modelId: body.modelId ?? null,
              inputId: body.inputId ?? null,
            });
            return c.json({ upload: toUploadSummary(upload) }, 201);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .get(
        "/:id/status",
        guard(routes, basePath, "get", "/:id/status", "active"),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
          try {
            const upload = await service.ownUpload(session.user.id, id);
            return c.json({ upload: toUploadSummary(upload) });
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .put(
        "/:id/chunk",
        guard(routes, basePath, "put", "/:id/chunk", "active"),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const offset = Number(c.req.query("offset"));
          if (!Number.isSafeInteger(offset) || offset < 0) {
            return c.json(
              { error: "invalid", message: "offset is required" },
              400,
            );
          }
          const declaredLength = Number(c.req.header("content-length"));
          if (Number.isFinite(declaredLength) && declaredLength > CHUNK_BYTES) {
            return c.json(
              {
                error: "invalid",
                message: `a chunk is at most ${CHUNK_BYTES} bytes`,
              },
              413,
            );
          }

          try {
            const bytes = new Uint8Array(await c.req.arrayBuffer());
            const next = await service.putChunk(
              session.user.id,
              id,
              offset,
              bytes,
            );
            return c.json({ offset: next });
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .post(
        "/:id/complete",
        guard(routes, basePath, "post", "/:id/complete", "active"),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
          try {
            const upload = await service.complete(session.user.id, id);
            return c.json({ upload: toUploadSummary(upload) });
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      /** Trims a complete video or audio Upload to a new one, "trimmed from" it (issue #51's AC). */
      .post(
        "/:id/trim",
        guard(routes, basePath, "post", "/:id/trim", "active"),
        checkIdParam(),
        validate("json", trimSchema, (c) => invalidJsonBody(c, trimSchema)),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const body = c.req.valid("json");
          try {
            const upload = await service.trim(
              session.user.id,
              id,
              body.startMs,
              body.endMs,
            );
            return c.json({ upload: toUploadSummary(upload) }, 201);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .get(
        "/:id",
        guard(routes, basePath, "get", "/:id", "active"),
        async (c) => {
          const upload = await viewable(c);
          if (!upload) return c.json({ error: "not found" }, 404);

          const size = upload.size;
          c.header("Accept-Ranges", "bytes");
          c.header(
            "Content-Type",
            upload.contentType ?? "application/octet-stream",
          );
          c.header(
            "Content-Disposition",
            contentDisposition(upload.originalName),
          );
          c.header("Cache-Control", "private, max-age=31536000, immutable");

          const file = Bun.file(storage.absolutePath(upload.storageKey));
          const range = parseRange(c.req.header("range"), size);
          if (!range) {
            c.header("Content-Length", String(size));
            return c.body(file.stream(), 200);
          }

          c.header(
            "Content-Range",
            `bytes ${range.start}-${range.end}/${size}`,
          );
          c.header("Content-Length", String(range.end - range.start + 1));
          return c.body(file.slice(range.start, range.end + 1).stream(), 206);
        },
      )
      .get(
        "/:id/thumb",
        guard(routes, basePath, "get", "/:id/thumb", "active"),
        async (c) => {
          const upload = await viewable(c);
          if (!upload?.thumbnailKey) return c.json({ error: "not found" }, 404);

          c.header("Content-Type", "image/webp");
          c.header("Cache-Control", "private, max-age=31536000, immutable");
          return c.body(
            Bun.file(storage.absolutePath(upload.thumbnailKey)).stream(),
          );
        },
      )
  );
}
