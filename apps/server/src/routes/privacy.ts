import { Hono } from "hono";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { buildGeneratedPrivacySection } from "../branding/privacy-generated.js";
import { getSiteSettings } from "../branding/site-settings-store.js";
import type { Database } from "../db/client.js";

/** `/privacy` always exists (issue #65): the Operator's own Markdown, then a studio-generated section no Admin can edit. */
export function privacyRoute(
  db: Database,
  appVersion: string,
  assetRetentionDays: number | null,
  routes: RouteEntry[],
) {
  return new Hono<AppEnv>().get(
    "/",
    guard(routes, "/api/privacy", "get", "/", "public"),
    async (c) => {
      const settings = await getSiteSettings(db);
      return c.json({
        operatorBody: settings.privacyBody,
        operatorUpdatedAt: settings.privacyUpdatedAt?.toISOString() ?? null,
        generatedBody: buildGeneratedPrivacySection({
          signUpMode: settings.signUpMode,
          contact: settings.contact,
          appVersion,
          assetRetentionDays,
        }),
      });
    },
  );
}
