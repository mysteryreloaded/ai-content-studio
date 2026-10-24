// `/api/submissions/:submissionId/cancel` (issue #54): the only cancel
// surface — a whole Submission block, the caller's own. There's no Admin
// cancel.

import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  type CancellationDeps,
  cancelSubmission,
} from "../generations/cancellation.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function submissionsRoute(
  cancellationDeps: CancellationDeps,
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

  return app;
}
