// `/api/assets/:id`: serves one saved Asset's bytes to its owner (or an
// Admin), with Range/206 so the card can play it in place (issue #44).

import { Hono } from "hono";
import type { Context } from "hono";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type {
  AssetWithOwner,
  AssetsRepository,
} from "../generations/assets-repository.js";
import { downloadFileName } from "../generations/download-name.js";
import { parseRange } from "../http/range.js";
import type { Storage } from "../storage/storage.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(c: Context<AppEnv>): string {
  const id = c.req.param("id");
  if (!id) throw new Error("id param missing");
  return id;
}

/** `/api/assets/:id`'s owner check, shared by the Asset itself and its `/poster` and `/thumb` (issue #45). */
async function loadOwnedAsset(
  c: Context<AppEnv>,
  assetsRepository: AssetsRepository,
): Promise<AssetWithOwner | null> {
  const id = idParam(c);
  if (!UUID_RE.test(id)) return null;

  const asset = await assetsRepository.getWithOwner(id);
  const session = c.get("session");
  if (
    !session ||
    !asset ||
    (asset.ownerId !== session.user.id && session.user.role !== "admin") ||
    // Issue #68's AC: a removed Generation's Assets 404 for anyone but
    // an Admin, even in the window before the runner's own cleanup
    // (or the removal itself, for an already-ended Generation) lands.
    (asset.generationRemovedAt !== null && session.user.role !== "admin")
  ) {
    return null;
  }
  return asset;
}

/** Serves one file in full, with the usual private/immutable caching (issue #44, #45). */
function serveFile(
  c: Context<AppEnv>,
  storage: Storage,
  storageKey: string,
  contentType: string,
  size: number,
): Response {
  const file = Bun.file(storage.absolutePath(storageKey));
  c.header("Cache-Control", "private, max-age=31536000, immutable");
  c.header("Content-Type", contentType);
  c.header("Content-Length", String(size));
  return c.body(file.stream(), 200);
}

export function assetsRoute(
  assetsRepository: AssetsRepository,
  storage: Storage,
  routes: RouteEntry[],
) {
  const basePath = "/api/assets";

  return new Hono<AppEnv>()
    .get(
      "/:id",
      guard(routes, basePath, "get", "/:id", "active"),
      async (c) => {
        const asset = await loadOwnedAsset(c, assetsRepository);
        if (!asset) {
          return c.json(
            { error: c.get("session") ? "not found" : "unauthorized" },
            c.get("session") ? 404 : 401,
          );
        }

        const size = asset.size;

        if (c.req.query("download") === "1") {
          const name = downloadFileName(
            asset.modelSlug,
            asset.modeName,
            asset.generationId,
            asset,
            await assetsRepository.listForGeneration(asset.generationId),
          );
          c.header("Content-Disposition", `attachment; filename="${name}"`);
        }

        c.header("Accept-Ranges", "bytes");
        c.header("Cache-Control", "private, max-age=31536000, immutable");
        c.header("Content-Type", asset.contentType);

        const range = parseRange(c.req.header("range"), size);
        const file = Bun.file(storage.absolutePath(asset.storageKey));
        if (!range) {
          c.header("Content-Length", String(size));
          return c.body(file.stream(), 200);
        }

        c.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
        c.header("Content-Length", String(range.end - range.start + 1));
        return c.body(file.slice(range.start, range.end + 1).stream(), 206);
      },
    )
    .get(
      "/:id/poster",
      guard(routes, basePath, "get", "/:id/poster", "active"),
      async (c) => {
        const asset = await loadOwnedAsset(c, assetsRepository);
        if (!asset?.posterKey) {
          return c.json(
            { error: c.get("session") ? "not found" : "unauthorized" },
            c.get("session") ? 404 : 401,
          );
        }
        const stat = await storage.stat(asset.posterKey);
        if (!stat) return c.json({ error: "not found" }, 404);
        return serveFile(c, storage, asset.posterKey, "image/jpeg", stat.size);
      },
    )
    .get(
      "/:id/thumb",
      guard(routes, basePath, "get", "/:id/thumb", "active"),
      async (c) => {
        const asset = await loadOwnedAsset(c, assetsRepository);
        if (!asset?.thumbnailKey) {
          return c.json(
            { error: c.get("session") ? "not found" : "unauthorized" },
            c.get("session") ? 404 : 401,
          );
        }
        const stat = await storage.stat(asset.thumbnailKey);
        if (!stat) return c.json({ error: "not found" }, 404);
        return serveFile(
          c,
          storage,
          asset.thumbnailKey,
          "image/webp",
          stat.size,
        );
      },
    );
}
