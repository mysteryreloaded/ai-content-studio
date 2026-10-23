import path from "node:path";
import type { Clock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type postgres from "postgres";
import type { Database } from "./db/client.js";
import type { Logger } from "./logger.js";
import { healthRoute } from "./routes/health.js";
import { siteSettingsRoute } from "./routes/site-settings.js";

export interface AppDeps {
  db: Database;
  sql: postgres.Sql;
  clock: Clock;
  logger: Logger;
  /** Directory holding the built SPA (`apps/web`'s Vite `dist`). */
  webDistDir: string;
}

/** One Hono app answering the API and serving the built SPA from one origin. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use(async (c, next) => {
    const requestId = crypto.randomUUID();
    const start = deps.clock.now().getTime();
    await next();
    deps.logger.info("request", {
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: deps.clock.now().getTime() - start,
    });
  });

  app.route("/healthz", healthRoute(deps.sql, deps.clock));
  app.route("/api/site-settings", siteSettingsRoute(deps.db));

  app.use("*", serveStatic({ root: deps.webDistDir }));
  app.use("*", serveStatic({ path: path.join(deps.webDistDir, "index.html") }));

  return app;
}
