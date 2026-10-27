// `/api/auth/account` DELETE (issue #63): a signed-in user's own
// self-delete, active or still pending (hence `signed-in`, same as
// sign-out and `/me` — never gated behind terms or `active`, see
// auth/access.ts).

import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { type RouteEntry, guard } from "../auth/access.js";
import {
  type AccountDeletionDeps,
  deleteOwnAccount,
} from "../auth/account-deletion.js";
import type { AppEnv } from "../auth/app-env.js";
import { SESSION_COOKIE_NAME } from "../auth/session.js";

export function accountRoute(deps: AccountDeletionDeps, routes: RouteEntry[]) {
  const basePath = "/api/auth";

  return new Hono<AppEnv>().delete(
    "/account",
    guard(routes, basePath, "delete", "/account", "signed-in"),
    async (c) => {
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      const body = await c.req.json().catch(() => null);
      const typedEmail =
        body && typeof body === "object" && typeof body.email === "string"
          ? body.email
          : "";

      const result = await deleteOwnAccount(deps, session.user.id, typedEmail);
      if (!result.ok) {
        if (result.reason === "forbidden") {
          return c.json({ error: "forbidden" }, 403);
        }
        return c.json({ error: "email_mismatch" }, 400);
      }

      deleteCookie(c, SESSION_COOKIE_NAME, { path: "/", secure: true });
      return c.json({ ok: true });
    },
  );
}
