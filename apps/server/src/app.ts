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
import { createLogEntryWriter } from "./backends/log-entries.js";
import { BackendRepository } from "./backends/repository.js";
import { BackendsService } from "./backends/service.js";
import { injectBrandingIntoHtml } from "./branding/accent-html.js";
import { NoticeEvents } from "./branding/notice-events.js";
import {
  getBlockedWords,
  getPauseNotice,
  getSiteCaps,
  getSiteSettings,
} from "./branding/site-settings-store.js";
import type { Database } from "./db/client.js";
import { Dispatcher } from "./dispatch/dispatcher.js";
import { DispatchQueue } from "./dispatch/queue.js";
import { recoverInFlightGenerations } from "./dispatch/recovery.js";
import type { Env } from "./env.js";
import { logUnhandledError } from "./error-logging.js";
import { AssetsRepository } from "./generations/assets-repository.js";
import { GenerationEvents } from "./generations/events.js";
import { GenerationsRepository } from "./generations/repository.js";
import type { Logger } from "./logger.js";
import { loadC2paSignerConfig } from "./media/c2pa.js";
import { MediaRunner } from "./media/media.js";
import { ModelBackendsRepository } from "./models/model-backends.js";
import { ModelRepository } from "./models/repository.js";
import { hasFreeDisk } from "./problems/disk.js";
import { ProblemsMonitor } from "./problems/monitor.js";
import { ProblemsRegistry } from "./problems/problems.js";
import { RetentionScheduler } from "./retention/scheduler.js";
import { adminAuditRoute } from "./routes/admin-audit.js";
import { adminBackendsRoute } from "./routes/admin-backends.js";
import { adminLogsRoute } from "./routes/admin-logs.js";
import { adminModelsRoute } from "./routes/admin-models.js";
import { adminOverviewRoute } from "./routes/admin-overview.js";
import { adminSiteSettingsRoute } from "./routes/admin-site-settings.js";
import { adminUsersRoute } from "./routes/admin-users.js";
import { adminRoute } from "./routes/admin.js";
import { assetsRoute } from "./routes/assets.js";
import { authRoute } from "./routes/auth.js";
import { galleryRoute } from "./routes/gallery.js";
import { generationsRoute } from "./routes/generations.js";
import { healthRoute } from "./routes/health.js";
import { modelsRoute } from "./routes/models.js";
import { privacyRoute } from "./routes/privacy.js";
import { siteSettingsRoute } from "./routes/site-settings.js";
import { statusRoute } from "./routes/status.js";
import { submissionsRoute } from "./routes/submissions.js";
import { termsRoute } from "./routes/terms.js";
import { uploadsRoute } from "./routes/uploads.js";
import { createLocalStorage } from "./storage/storage.js";
import { UploadsRepository } from "./uploads/repository.js";
import { UploadsService } from "./uploads/service.js";

/** Tracks package.json's own version by hand; bump it alongside a release. */
const APP_VERSION = "0.0.0";

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
  /** Backend health monitoring (issue #39): call `start()` after boot, `stop()` on shutdown. */
  backendsService: BackendsService;
  /** Problems detection (issue #70): call `start()` after boot, `stop()` on shutdown. */
  problemsMonitor: ProblemsMonitor;
  /** Dispatches queued Generations to free Backends (issue #44): call `start()` after boot, `stop()` on shutdown. */
  dispatcher: Dispatcher;
  /** The retention sweep (issue #69): call `start()` after boot, `stop()` on shutdown. */
  retentionScheduler: RetentionScheduler;
  /** Boot recovery (issue #55): reattaches every Generation left `starting`/`running`/`saving` from a previous process. Call once, before `dispatcher.start()`. */
  recover: () => Promise<void>;
}

/** One Hono app answering the API and serving the built SPA from one origin. */
export async function createApp(deps: AppDeps): Promise<CreatedApp> {
  const app = new Hono<AppEnv>();
  const routes: RouteEntry[] = [];
  const bootTime = deps.clock.now();

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
  const diskHasRoom = () =>
    hasFreeDisk(deps.env.DATA_DIR, deps.env.MIN_FREE_DISK_GB);

  // The dispatcher is created after BackendsService (which needs a wake
  // callback as soon as a Backend becomes reachable), so this ref is set
  // once the dispatcher itself exists, just below.
  let wakeDispatcher = () => {};

  const backendRepository = new BackendRepository(
    deps.db,
    deps.clock,
    deps.env.SECRET_KEY,
  );
  const logWriter = createLogEntryWriter(deps.db, deps.clock, deps.logger);
  const backendsService = new BackendsService(
    backendRepository,
    deps.clock,
    logWriter,
    deps.env.BACKENDS_ENABLED,
    () => wakeDispatcher(),
  );

  const problemsRegistry = new ProblemsRegistry(() => deps.clock.now());
  const problemsMonitor = new ProblemsMonitor(
    problemsRegistry,
    deps.clock,
    deps.sql,
    backendRepository,
    backendsService,
    deps.env.DATA_DIR,
    deps.env.MIN_FREE_DISK_GB,
  );

  app.use(async (c, next) => {
    c.set("logWriter", logWriter);
    return next();
  });

  app.onError(async (err, c) => {
    const session = c.get("session");
    await logUnhandledError(logWriter, deps.logger, session?.user.id, err);
    return c.json({ error: "internal error" }, 500);
  });

  app.route("/healthz", healthRoute(deps.sql, deps.clock, routes));
  const modelRepository = new ModelRepository(deps.db, deps.clock);
  const noticeEvents = new NoticeEvents();
  const isPaused = async () => (await getPauseNotice(deps.db)).paused;
  app.route(
    "/api/site-settings",
    siteSettingsRoute(
      deps.db,
      storage,
      modelRepository,
      noticeEvents,
      deps.clock,
      routes,
    ),
  );
  app.route(
    "/api/auth",
    authRoute({ db: deps.db, clock: deps.clock, env: deps.env }, routes),
  );
  const modelBackendsRepository = new ModelBackendsRepository(
    deps.db,
    deps.clock,
  );
  const generationsRepository = new GenerationsRepository(deps.db);
  const generationEvents = new GenerationEvents();
  const assetsRepository = new AssetsRepository(deps.db);
  const uploadsRepository = new UploadsRepository(deps.db);
  const dispatchQueue = new DispatchQueue(deps.db);
  const media = new MediaRunner(deps.env.FFMPEG_CONCURRENCY);
  const c2pa =
    deps.env.C2PA_CERT_PATH && deps.env.C2PA_KEY_PATH
      ? loadC2paSignerConfig(
          deps.env.C2PA_CERT_PATH,
          deps.env.C2PA_KEY_PATH,
          deps.env.C2PA_TIMESTAMP_URL,
        )
      : null;
  const dispatcher = new Dispatcher({
    sql: deps.sql,
    clock: deps.clock,
    logWriter,
    logger: deps.logger,
    backendRepository,
    backendsService,
    modelBackendsRepository,
    queue: dispatchQueue,
    assetsRepository,
    storage,
    generationEvents,
    media,
    siteName: new URL(deps.env.PUBLIC_URL).hostname,
    c2pa,
    getSiteTitle: async () => (await getSiteSettings(deps.db)).title,
    isPaused,
  });
  wakeDispatcher = dispatcher.wake;

  const retentionScheduler = new RetentionScheduler({
    sql: deps.sql,
    db: deps.db,
    clock: deps.clock,
    storage,
    logWriter,
    logger: deps.logger,
    generationsRepository,
    uploadsRepository,
    assetRetentionDays: deps.env.ASSET_RETENTION_DAYS ?? null,
    logRetentionDays: deps.env.LOG_RETENTION_DAYS,
  });

  app.route(
    "/api/models",
    modelsRoute(
      modelRepository,
      generationsRepository,
      {
        modelRepository,
        modelBackendsRepository,
        backendsService,
        generationsRepository,
        generationEvents,
        clock: deps.clock,
        logWriter,
        getBlockedWords: () => getBlockedWords(deps.db),
        isPaused,
        getSiteCaps: () => getSiteCaps(deps.db),
        onGenerationQueued: dispatcher.wake,
        uploadsRepository,
        hasFreeDisk: diskHasRoom,
      },
      routes,
    ),
  );
  app.route(
    "/api/generations",
    generationsRoute(
      deps.db,
      generationsRepository,
      generationEvents,
      deps.clock,
      storage,
      routes,
    ),
  );
  app.route(
    "/api/submissions",
    submissionsRoute(
      {
        queue: dispatchQueue,
        generationsRepository,
        generationEvents,
        wakeDispatcher: dispatcher.wake,
        clock: deps.clock,
      },
      generationsRepository,
      storage,
      deps.clock,
      routes,
    ),
  );
  app.route("/api/assets", assetsRoute(assetsRepository, storage, routes));
  app.route("/api/gallery", galleryRoute(generationsRepository, routes));
  const uploadsService = new UploadsService({
    repository: uploadsRepository,
    storage,
    clock: deps.clock,
    maxUploadMb: deps.env.MAX_UPLOAD_MB,
    hasFreeDisk: diskHasRoom,
    hintLimits: async (modelId, inputId) => {
      const detail = await modelRepository.get(modelId);
      const input = detail?.inputs.find((i) => i.id === inputId);
      if (!input) return null;
      if (
        input.kind === "image_upload" ||
        input.kind === "video_upload" ||
        input.kind === "audio_upload"
      ) {
        return input;
      }
      return null;
    },
    media,
  });
  app.route(
    "/api/uploads",
    uploadsRoute(uploadsService, uploadsRepository, storage, routes),
  );
  app.route("/api/admin", adminRoute(routes));
  app.route(
    "/api/admin/site-settings",
    adminSiteSettingsRoute(
      deps.db,
      deps.clock,
      storage,
      noticeEvents,
      () => wakeDispatcher(),
      routes,
    ),
  );
  app.route(
    "/api/admin/backends",
    adminBackendsRoute(
      deps.db,
      deps.clock,
      backendRepository,
      backendsService,
      generationsRepository,
      routes,
      dispatcher.wake,
    ),
  );
  app.route("/api/admin/logs", adminLogsRoute(deps.db, deps.clock, routes));
  app.route("/api/terms", termsRoute(deps.db, deps.clock, routes));
  app.route(
    "/api/admin/models",
    adminModelsRoute(
      deps.db,
      modelRepository,
      modelBackendsRepository,
      backendsService,
      generationsRepository,
      routes,
      deps.env.MAX_UPLOAD_MB,
      {
        generationEvents,
        clock: deps.clock,
        uploadsRepository,
        hasFreeDisk: diskHasRoom,
        wakeDispatcher: dispatcher.wake,
      },
    ),
  );
  app.route("/api/admin/audit", adminAuditRoute(deps.db, routes));
  app.route(
    "/api/admin/users",
    adminUsersRoute(deps.db, deps.clock, deps.env.ADMIN_EMAILS, routes),
  );
  app.route(
    "/api/admin/overview",
    adminOverviewRoute(
      deps.db,
      deps.clock,
      problemsRegistry,
      backendRepository,
      backendsService,
      deps.env.DATA_DIR,
      deps.env.MIN_FREE_DISK_GB,
      APP_VERSION,
      bootTime,
      routes,
    ),
  );
  app.route("/api/status", statusRoute(problemsRegistry, routes));
  app.route(
    "/api/privacy",
    privacyRoute(
      deps.db,
      APP_VERSION,
      deps.env.ASSET_RETENTION_DAYS ?? null,
      routes,
    ),
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

  return {
    app,
    routes,
    backendsService,
    problemsMonitor,
    dispatcher,
    retentionScheduler,
    recover: () => dispatcher.recover(),
  };
}
