import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { ModelRepository } from "../models/repository.js";

/** `/api/models`: the signed-in Models home — enabled Models, Admin order. */
export function modelsRoute(
  repository: ModelRepository,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(app, routes, "/api/models", "get", "/", "active", async (c) =>
    c.json({ models: await repository.listEnabledSummaries() }),
  );

  return app;
}
