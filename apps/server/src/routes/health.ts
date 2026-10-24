import type { Clock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import type postgres from "postgres";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

/** `/healthz`: 200 when `SELECT 1` answers in time, else 503. */
export function healthRoute(
  sql: postgres.Sql,
  clock: Clock,
  routes: RouteEntry[] = [],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(app, routes, "/healthz", "get", "/", "public", async (c) => {
    const reachable = await isDatabaseReachable(sql, clock);
    if (!reachable) {
      return c.json({ status: "db_unreachable" }, 503);
    }
    return c.json({ status: "ok" }, 200);
  });

  return app;
}

async function isDatabaseReachable(
  sql: postgres.Sql,
  clock: Clock,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, HEALTH_CHECK_TIMEOUT_MS);

    sql`select 1`
      .then(() => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(true);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(false);
      });
  });
}
