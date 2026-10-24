// `/api/admin/uploads`: a user's own Uploads, read-only (issue #68's AC:
// "A user's page links to their Generations, Uploads and Assets"), and
// Remove.

import { Hono } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  UploadAlreadyRemoved,
  type UploadRemovalDeps,
  removeUpload,
} from "../uploads/removal.js";
import type { UploadsRepository } from "../uploads/repository.js";
import { UploadNotFound } from "../uploads/service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

const removeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

/** `/api/admin/uploads`: issue #68. */
export function adminUploadsRoute(
  uploadsRepository: UploadsRepository,
  removalDeps: UploadRemovalDeps,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/admin/uploads";

  guardedRoute(app, routes, basePath, "get", "/", "admin", async (c) => {
    const userId = c.req.query("user");
    if (!isUuid(userId)) return c.json({ uploads: [] });

    const uploads = await uploadsRepository.listForUser(userId);
    return c.json({ uploads });
  });

  guardedRoute(
    app,
    routes,
    basePath,
    "post",
    "/:id/remove",
    "admin",
    async (c) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "not found" }, 404);

      const body = await c.req.json().catch(() => null);
      const parsed = removeSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: "invalid input", issues: parsed.error.issues },
          400,
        );
      }

      try {
        await removeUpload(
          id,
          parsed.data.reason,
          adminActorFrom(c),
          removalDeps,
        );
        const upload = await uploadsRepository.get(id);
        return c.json({ upload });
      } catch (err) {
        if (err instanceof UploadNotFound) {
          return c.json({ error: "not found" }, 404);
        }
        if (err instanceof UploadAlreadyRemoved) {
          return c.json({ error: "already removed" }, 409);
        }
        throw err;
      }
    },
  );

  return app;
}
