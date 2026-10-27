// `GET /api/status`: the Operator's outside monitor, or an Admin session
// (issue #70). 200 while nothing is wrong, 503 listing every Problem.

import { Hono } from "hono";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { ProblemsRegistry } from "../problems/problems.js";

export function statusRoute(registry: ProblemsRegistry, routes: RouteEntry[]) {
  return new Hono<AppEnv>().get(
    "/",
    guard(routes, "/api/status", "get", "/", "admin-or-status-token"),
    (c) => {
      const problems = registry.list().map((problem) => ({
        code: problem.code,
        message: problem.message,
        target: problem.target,
        since: problem.since.toISOString(),
      }));

      if (problems.length === 0) return c.json({ status: "ok" }, 200);
      return c.json({ status: "problems", problems }, 503);
    },
  );
}
