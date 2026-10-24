import path from "node:path";
import type { Clock } from "@ai-content-studio/shared";
import { type Context, Hono } from "hono";
import { serveStatic } from "hono/bun";
import type postgres from "postgres";
import type { RouteEntry } from "./auth/access.js";
import type { AppEnv } from "./auth/app-env.js";
import { createMockOidcIssuer } from "./auth/mock-issuer.js";
import { sameOriginGuard } from "./auth/same-origin-guard.js";
import { sessionMiddleware } from "./auth/session-middleware.js";
import { injectBrandingIntoHtml } from "./branding/accent-html.js";
import { getSiteSettings } from "./branding/site-settings-store.js";
import type { Database } from "./db/client.js";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";
import { adminSiteSettingsRoute } from "./routes/admin-site-settings.js";
import { adminRoute } from "./routes/admin.js";
import { authRoute } from "./routes/auth.js";
import { healthRoute } from "./routes/health.js";
import { modelsRoute } from "./routes/models.js";
import { siteSettingsRoute } from "./routes/site-settings.js";
import { createLocalStorage } from "./storage/storage.js";

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
    c.set("requestId", requestId);
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

  const storage = createLocalStorage(deps.env.DATA_DIR);

  app.route("/healthz", healthRoute(deps.sql, deps.clock, routes));
  app.route("/api/site-settings", siteSettingsRoute(deps.db, storage, routes));
  app.route(
    "/api/auth",
    authRoute({ db: deps.db, clock: deps.clock, env: deps.env }, routes),
  );
  app.route("/api/models", modelsRoute(routes));
  app.route("/api/admin", adminRoute(routes));
  app.route(
    "/api/admin/site-settings",
    adminSiteSettingsRoute(deps.db, deps.clock, storage, routes),
  );

  if (deps.env.OIDC_ISSUER) {
    const issuerUrl = new URL(deps.env.OIDC_ISSUER);
    app.route(
      issuerUrl.pathname,
      await createMockOidcIssuer(deps.env.OIDC_ISSUER),
    );
  }

  const serveBrandedIndex = async (c: Context<AppEnv>) => {
    const html = await Bun.file(
      path.join(deps.webDistDir, "index.html"),
    ).text();
    const settings = await getSiteSettings(deps.db);
    const logoHref = settings.logo ? "/api/site-settings/logo" : null;
    return c.html(injectBrandingIntoHtml(html, settings.accent, logoHref));
  };

  // `index.html` itself always needs the accent/favicon injected, so it
  // must never be served as a plain static file (hono/bun's serveStatic
  // resolves a directory path like "/" to it automatically).
  app.use("*", async (c, next) => {
    if (c.req.path === "/" || c.req.path === "/index.html") {
      return serveBrandedIndex(c);
    }
    return next();
  });

  // React Router's own pages (e.g. /account) aren't files on disk: the
  // SPA fallback must join `root` and `path` itself, not take a
  // pre-joined absolute path (hono/bun's serveStatic re-joins `path`
  // against `root`, which breaks for an absolute `path`).
  app.use("*", serveStatic({ root: deps.webDistDir }));
  app.use("*", serveBrandedIndex);

  return { app, routes };
}
