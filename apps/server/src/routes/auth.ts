import type { Clock } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  type OidcDeps,
  buildAuthorizationRequest,
  handleCallback,
  resolveIssuer,
} from "../auth/oidc.js";
import { sanitizeReturnTo } from "../auth/return-to.js";
import {
  SESSION_COOKIE_NAME,
  createSession,
  deleteSession,
} from "../auth/session.js";
import { isAccountBlocked, upsertUserFromGoogle } from "../auth/users.js";
import { getSiteSettings } from "../branding/site-settings-store.js";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";

const FLOW_STATE_COOKIE = "oauth_state";
const FLOW_NONCE_COOKIE = "oauth_nonce";
const FLOW_VERIFIER_COOKIE = "oauth_verifier";
const FLOW_RETURN_TO_COOKIE = "oauth_return_to";
const FLOW_COOKIE_MAX_AGE_SECONDS = 600;

const FLOW_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/api/auth",
  maxAge: FLOW_COOKIE_MAX_AGE_SECONDS,
};

export interface AuthRouteDeps {
  db: Database;
  clock: Clock;
  env: Env;
}

function oidcDeps(env: Env): OidcDeps {
  return {
    issuer: resolveIssuer(env.OIDC_ISSUER),
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${env.PUBLIC_URL}/api/auth/google/callback`,
  };
}

function clearFlowCookies(c: Parameters<typeof deleteCookie>[0]): void {
  for (const name of [
    FLOW_STATE_COOKIE,
    FLOW_NONCE_COOKIE,
    FLOW_VERIFIER_COOKIE,
    FLOW_RETURN_TO_COOKIE,
  ]) {
    deleteCookie(c, name, { path: "/api/auth" });
  }
}

/** `/api/auth/*`: Google sign-in, its callback, and sign-out. */
export function authRoute(
  deps: AuthRouteDeps,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/auth";

  guardedRoute(app, routes, basePath, "get", "/google", "public", async (c) => {
    const returnTo = sanitizeReturnTo(c.req.query("return_to"));
    const authRequest = await buildAuthorizationRequest(
      oidcDeps(deps.env),
      returnTo,
    );

    setCookie(c, FLOW_STATE_COOKIE, authRequest.state, FLOW_COOKIE_OPTIONS);
    setCookie(c, FLOW_NONCE_COOKIE, authRequest.nonce, FLOW_COOKIE_OPTIONS);
    setCookie(
      c,
      FLOW_VERIFIER_COOKIE,
      authRequest.codeVerifier,
      FLOW_COOKIE_OPTIONS,
    );
    setCookie(c, FLOW_RETURN_TO_COOKIE, returnTo, FLOW_COOKIE_OPTIONS);

    return c.redirect(authRequest.url);
  });

  guardedRoute(
    app,
    routes,
    basePath,
    "get",
    "/google/callback",
    "public",
    async (c) => {
      const state = getCookie(c, FLOW_STATE_COOKIE);
      const nonce = getCookie(c, FLOW_NONCE_COOKIE);
      const verifier = getCookie(c, FLOW_VERIFIER_COOKIE);
      const returnTo = sanitizeReturnTo(getCookie(c, FLOW_RETURN_TO_COOKIE));
      clearFlowCookies(c);

      if (!state || !nonce || !verifier) {
        return c.redirect("/?auth_error=failed");
      }

      const callbackUrl = new URL(c.req.url);
      const result = await handleCallback(
        oidcDeps(deps.env),
        callbackUrl,
        state,
        nonce,
        verifier,
      );

      if (!result.ok) {
        return c.redirect(`/?auth_error=${result.reason}`);
      }

      // Issue #64: a Google account an Admin deleted while disabled
      // can't come back, even as a brand-new user — checked before the
      // upsert below would otherwise create one.
      if (await isAccountBlocked(deps.db, result.identity.sub)) {
        return c.redirect("/?auth_error=blocked");
      }

      const settings = await getSiteSettings(deps.db);
      const user = await upsertUserFromGoogle(
        deps.db,
        deps.clock,
        result.identity,
        deps.env.ADMIN_EMAILS,
        settings.signUpMode,
      );

      // Issue #64: a disabled user keeps that status across sign-ins
      // (upsertUserFromGoogle never touches it for a non-Admin), so no
      // session is created for them — the landing page shows "account
      // disabled" with the contact instead.
      if (user.status === "disabled") {
        return c.redirect("/?auth_error=disabled");
      }

      const { cookieValue, expiresAt } = await createSession(
        deps.db,
        deps.clock,
        user.id,
      );
      const maxAge = Math.floor(
        (expiresAt.getTime() - deps.clock.now().getTime()) / 1000,
      );
      setCookie(c, SESSION_COOKIE_NAME, cookieValue, {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
        maxAge,
      });

      return c.redirect(returnTo);
    },
  );

  guardedRoute(
    app,
    routes,
    basePath,
    "post",
    "/signout",
    "signed-in",
    async (c) => {
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);
      await deleteSession(deps.db, session.id);
      deleteCookie(c, SESSION_COOKIE_NAME, { path: "/", secure: true });
      return c.json({ ok: true });
    },
  );

  guardedRoute(app, routes, basePath, "get", "/me", "signed-in", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "unauthorized" }, 401);
    // Issue #50: the browser refuses a too-large file on pick.
    return c.json({ ...session.user, maxUploadMb: deps.env.MAX_UPLOAD_MB });
  });

  return app;
}
