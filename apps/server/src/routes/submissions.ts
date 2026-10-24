// `/api/submissions/:submissionId/cancel` (issue #54): the only cancel
// surface — a whole Submission block, the caller's own. There's no Admin
// cancel.

import type { Clock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  type CancellationDeps,
  cancelSubmission,
} from "../generations/cancellation.js";
import { deleteStorageFor } from "../generations/deletion.js";
import type { GenerationsRepository } from "../generations/repository.js";
import type { Storage } from "../storage/storage.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function submissionsRoute(
  cancellationDeps: CancellationDeps,
  generationsRepository: GenerationsRepository,
  storage: Storage,
  clock: Clock,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(
    app,
    routes,
    "/api/submissions",
    "post",
    "/:submissionId/cancel",
    "active",
    async (c) => {
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      const submissionId = c.req.param("submissionId");
      if (!submissionId || !UUID_RE.test(submissionId)) {
        return c.json({ error: "not found" }, 404);
      }

      await cancelSubmission(submissionId, session.user.id, cancellationDeps);
      return c.json({ ok: true });
    },
  );

  // `/api/submissions/:submissionId` DELETE (issue #57's AC): the whole
  // Submission, each of its Generations into a Tombstone. 404 unless
  // every one of them is this user's own, ended and not yet deleted —
  // same as deleting one Generation, applied to the whole block.
  guardedRoute(
    app,
    routes,
    "/api/submissions",
    "delete",
    "/:submissionId",
    "active",
    async (c) => {
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      const submissionId = c.req.param("submissionId");
      if (!submissionId || !UUID_RE.test(submissionId)) {
        return c.json({ error: "not found" }, 404);
      }

      const keys = await generationsRepository.deleteSubmission(
        submissionId,
        session.user.id,
        clock.now(),
      );
      if (!keys) return c.json({ error: "not found" }, 404);
      await deleteStorageFor(storage, keys);
      return c.json({ ok: true });
    },
  );

  return app;
}
