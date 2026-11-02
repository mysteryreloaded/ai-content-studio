// `/api/admin/uploads`: a user's own Uploads, read-only (issue #68's AC:
// "A user's page links to their Generations, Uploads and Assets"), and
// Remove.

import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { validate } from "../auth/validate.js";
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

/**
 * A non-UUID `:id` answers 404 before the body gate runs: the
 * pre-conversion routes checked the id first (issue #168).
 */
const requireUuidId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) {
    return c.json({ error: "not found" }, 404);
  }
  return next();
};

/** `/api/admin/uploads`: issue #68. */
export function adminUploadsRoute(
  uploadsRepository: UploadsRepository,
  removalDeps: UploadRemovalDeps,
  routes: RouteEntry[],
) {
  const basePath = "/api/admin/uploads";

  return new Hono<AppEnv>()
    .get("/", guard(routes, basePath, "get", "/", "admin"), async (c) => {
      const userId = c.req.query("user");
      if (!isUuid(userId)) return c.json({ uploads: [] });

      const uploads = await uploadsRepository.listForUser(userId);
      return c.json({ uploads });
    })
    .post(
      "/:id/remove",
      guard(routes, basePath, "post", "/:id/remove", "admin"),
      requireUuidId,
      // The gate's `onInvalid` re-runs the same re-parse the route did
      // pre-conversion, so a 400's `issues` stay byte-for-byte: an
      // unparseable body parses to `null` again here, as it did before.
      validate("json", removeSchema, async (c) => {
        const body = await c.req.json().catch(() => null);
        const parsed = removeSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            { error: "invalid input", issues: parsed.error.issues },
            400,
          );
        }
        // The gate only rejects a body the schema above rejects.
        return c.json({ error: "invalid input", issues: [] }, 400);
      }),
      async (c) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return c.json({ error: "not found" }, 404);

        const reason = c.req.valid("json").reason;

        try {
          await removeUpload(id, reason, adminActorFrom(c), removalDeps);
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
}
