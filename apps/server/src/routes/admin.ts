import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";

/** `/api/admin`: the admin panel shell. Grows as admin features land. */
export function adminRoute(routes: RouteEntry[]): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(app, routes, "/api/admin", "get", "/", "admin", (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "unauthorized" }, 401);
    return c.json({ admin: session.user.email });
  });

  return app;
}
