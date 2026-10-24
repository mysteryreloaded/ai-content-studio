import type { Clock } from "@ai-content-studio/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  activeTermsVersion,
  getSiteSettings,
} from "../branding/site-settings-store.js";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";

/** `/api/terms`: the `/terms` page's data, and accepting the current version. */
export function termsRoute(
  db: Database,
  clock: Clock,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/terms";

  guardedRoute(app, routes, basePath, "get", "/", "public", async (c) => {
    const settings = await getSiteSettings(db);
    const version = activeTermsVersion(settings);
    return c.json({
      version,
      body: settings.termsBody,
      versionDate:
        version === null
          ? null
          : (settings.termsVersionCreatedAt?.toISOString() ?? null),
    });
  });

  guardedRoute(
    app,
    routes,
    basePath,
    "post",
    "/accept",
    "signed-in",
    async (c) => {
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      const settings = await getSiteSettings(db);
      const version = activeTermsVersion(settings);
      if (version === null) {
        return c.json({ error: "no_terms" }, 400);
      }

      const now = clock.now();
      await db
        .update(users)
        .set({
          termsAcceptedVersion: version,
          termsAcceptedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, session.user.id));

      return c.json({ ok: true, version });
    },
  );

  return app;
}
