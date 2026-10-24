import { type Context, Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  BACKGROUND_STORAGE_KEY,
  LOGO_STORAGE_KEY,
  activeTermsVersion,
  getSiteSettings,
} from "../branding/site-settings-store.js";
import type { Database } from "../db/client.js";
import type { ModelRepository } from "../models/repository.js";
import type { Storage } from "../storage/storage.js";

/** `/api/site-settings`: the public branding the landing page (and `index.html`) read. */
export function siteSettingsRoute(
  db: Database,
  storage: Storage,
  modelRepository: ModelRepository,
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
      const settings = await getSiteSettings(db);
      return c.json({
        title: settings.title,
        landingText: settings.landingText,
        accent: settings.accent,
        signUpMode: settings.signUpMode,
        contact: settings.contact,
        hasLogo: settings.logo !== null,
        hasBackground: settings.background !== null,
        hasTerms: activeTermsVersion(settings) !== null,
        footerLinks: settings.footerLinks,
        hasNonVideoEnabledModel:
          await modelRepository.hasEnabledNonVideoModel(),
      });
    },
  );

  guardedRoute(
    app,
    routes,
    "/api/site-settings",
    "get",
    "/logo",
    "public",
    async (c) => serveImage(c, db, storage, "logo"),
  );

  guardedRoute(
    app,
    routes,
    "/api/site-settings",
    "get",
    "/background",
    "public",
    async (c) => serveImage(c, db, storage, "background"),
  );

  return app;
}

async function serveImage(
  c: Context<AppEnv>,
  db: Database,
  storage: Storage,
  which: "logo" | "background",
) {
  const settings = await getSiteSettings(db);
  const image = settings[which];
  if (!image) return c.json({ error: "not found" }, 404);

  const key = which === "logo" ? LOGO_STORAGE_KEY : BACKGROUND_STORAGE_KEY;
  const bytes = await storage.read(key);
  return c.body(new Uint8Array(bytes), 200, {
    "Content-Type": image.contentType,
    "Cache-Control": "no-cache",
    ETag: `"${image.hash}"`,
  });
}
