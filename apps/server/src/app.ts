import type { Clock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type postgres from "postgres";
import type { RouteEntry } from "./auth/access.js";
import type { AppEnv } from "./auth/app-env.js";
import { createMockOidcIssuer } from "./auth/mock-issuer.js";
import { sameOriginGuard } from "./auth/same-origin-guard.js";
import { sessionMiddleware } from "./auth/session-middleware.js";
import type { Database } from "./db/client.js";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import { adminRoute } from "./routes/admin.js";
import { authRoute } from "./routes/auth.js";
import { healthRoute } from "./routes/health.js";
import { modelsRoute } from "./routes/models.js";
import { siteSettingsRoute } from "./routes/site-settings.js";

export interface AppDeps {
  db: Database;
  sql: postgres.Sql;
  clock: Clock;
  logger: Logger;
  env: Env;
  /** Directory holding the built SPA (`apps/web`'s Vite `dist`). */
  webDistDir: string;
}

export interface CreatedApp {
  app: Hono<AppEnv>;
  /** Every route registered, with its access level (ADR 0003)'s guard test. */
  routes: RouteEntry[];
}

/** One Hono app answering the API and serving the built SPA from one origin. */
export async function createApp(deps: AppDeps): Promise<CreatedApp> {
  const app = new Hono<AppEnv>();
  const routes: RouteEntry[] = [];

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

  // Scoped to the app's own API: the mock OIDC issuer below stands in for
  // an external IdP and must never be subject to these guards.
  app.use("/api/*", sameOriginGuard(deps.env.PUBLIC_URL));
  app.use("/api/*", sessionMiddleware(deps.db, deps.clock));

  app.route("/healthz", healthRoute(deps.sql, deps.clock, routes));
  app.route("/api/site-settings", siteSettingsRoute(deps.db, routes));
  app.route(
    "/api/auth",
    authRoute({ db: deps.db, clock: deps.clock, env: deps.env }, routes),
  );
  app.route("/api/models", modelsRoute(routes));
  app.route("/api/admin", adminRoute(routes));

  if (deps.env.OIDC_ISSUER) {
    const issuerUrl = new URL(deps.env.OIDC_ISSUER);
    app.route(
      issuerUrl.pathname,
      await createMockOidcIssuer(deps.env.OIDC_ISSUER),
    );
  }

  // React Router's own pages (e.g. /account) aren't files on disk: the
  // SPA fallback must join `root` and `path` itself, not take a
  // pre-joined absolute path (hono/bun's serveStatic re-joins `path`
  // against `root`, which breaks for an absolute `path`).
  app.use("*", serveStatic({ root: deps.webDistDir }));
  app.use("*", serveStatic({ root: deps.webDistDir, path: "index.html" }));

  return { app, routes };
}
