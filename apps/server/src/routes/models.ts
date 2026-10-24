import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";

/** `/api/models`: the signed-in Models home. Empty until Models exist. */
export function modelsRoute(routes: RouteEntry[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(app, routes, "/api/models", "get", "/", "active", (c) =>
    c.json({ models: [] }),
  );

  return app;
}
