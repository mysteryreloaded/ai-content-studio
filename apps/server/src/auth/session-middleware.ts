import type { Clock } from "@ai-content-studio/shared";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { activeTermsVersion } from "../branding/site-settings-store.js";
import type { Database } from "../db/client.js";
import { siteSettings } from "../db/schema.js";
import type { AppEnv } from "./app-env.js";
import { SESSION_COOKIE_NAME, readSession } from "./session.js";

/**
 * Reads `__Host-session` on every request and attaches the session (or
 * `null`) to the context, so role and status are current for every
 * route's access check — see ADR 0003. Also attaches the Site terms'
 * current version (issue #60), looked up only when there's a session to
 * check it against, for `requireAccess`'s terms gate.
 */
export function sessionMiddleware(
  db: Database,
  clock: Clock,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const cookieValue = getCookie(c, SESSION_COOKIE_NAME);
    const session = await readSession(db, clock, cookieValue);
    c.set("session", session);

    if (session) {
      const [row] = await db
        .select({
          termsBody: siteSettings.termsBody,
          termsVersion: siteSettings.termsVersion,
        })
        .from(siteSettings)
        .limit(1);
      c.set("termsVersion", row ? activeTermsVersion(row) : null);
    } else {
      c.set("termsVersion", null);
    }

    await next();
  };
}
