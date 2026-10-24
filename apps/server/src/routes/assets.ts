// `/api/assets/:id`: serves one saved Asset's bytes to its owner (or an
// Admin), with Range/206 so the card can play it in place (issue #44).

import { Hono } from "hono";
import type { Context } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { AssetsRepository } from "../generations/assets-repository.js";
import type { Storage } from "../storage/storage.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(c: Context<AppEnv>): string {
  const id = c.req.param("id");
  if (!id) throw new Error("id param missing");
  return id;
}

/** Parses a single-range `Range: bytes=start-end` header; anything else (absent, multi-range, unsatisfiable) is ignored, falling back to the whole file. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;

  let start: number;
  let end: number;
  if (startStr === "") {
    const suffixLength = Number(endStr);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

export function assetsRoute(
  assetsRepository: AssetsRepository,
  storage: Storage,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(
    app,
    routes,
    "/api/assets",
    "get",
    "/:id",
    "active",
    async (c) => {
      const id = idParam(c);
      if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

      const asset = await assetsRepository.getWithOwner(id);
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);
      if (
        !asset ||
        (asset.ownerId !== session.user.id && session.user.role !== "admin")
      ) {
        return c.json({ error: "not found" }, 404);
      }

      const file = Bun.file(storage.absolutePath(asset.storageKey));
      const size = asset.size;

      c.header("Accept-Ranges", "bytes");
      c.header("Cache-Control", "private, max-age=31536000, immutable");
      c.header("Content-Type", asset.contentType);

      const range = parseRange(c.req.header("range"), size);
      if (!range) {
        c.header("Content-Length", String(size));
        return c.body(file.stream(), 200);
      }

      c.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      c.header("Content-Length", String(range.end - range.start + 1));
      return c.body(file.slice(range.start, range.end + 1).stream(), 206);
    },
  );

  return app;
}
