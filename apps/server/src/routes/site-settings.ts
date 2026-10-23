import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { Database } from "../db/client.js";
import { siteSettings } from "../db/schema.js";

/** `/api/site-settings`: the public branding the landing page reads. */
export function siteSettingsRoute(
  db: Database,
  routes: RouteEntry[] = [],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(
    app,
    routes,
    "/api/site-settings",
    "get",
    "/",
    "public",
    async (c) => {
      const [row] = await db
        .select({ title: siteSettings.title })
        .from(siteSettings)
        .limit(1);
      return c.json({ title: row?.title ?? "AI Content Studio" });
    },
  );

  return app;
}
