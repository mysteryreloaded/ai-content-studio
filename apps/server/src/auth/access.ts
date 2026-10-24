import { timingSafeEqual } from "node:crypto";
import type { Context, Handler, Hono } from "hono";
import type { AppEnv } from "./app-env.js";

/**
 * Every route must declare one of these. `active` (and `admin`, which
 * implies it) additionally requires the current Site terms to be
 * accepted (issue #60) when any are set, and then that the user is
 * `active`, not `pending` (issue #62, ADR 0008) — terms always gate
 * first, so a pending user who hasn't accepted yet sees `terms_required`,
 * not `pending`. A route that must stay usable before either gate —
 * reading/accepting the terms, the current user, account delete,
 * `/privacy`, `/terms` and the public landing data — is `signed-in`
 * instead, which skips both checks but still refuses a disabled user
 * (issue #64: a session that somehow outlives the disable must not be
 * able to self-delete and dodge the block, nor read `/me`). Sign-out
 * alone is `signed-in-or-disabled`: the one signed-in action a disabled
 * user keeps, so a lingering session can still be cleared.
 */
export type AccessLevel =
  | "public"
  | "signed-in"
  | "signed-in-or-disabled"
  | "active"
  | "admin"
  | "status-token"
  | "admin-or-status-token";

export interface RouteEntry {
  method: string;
  path: string;
  access: AccessLevel;
}

type HonoMethod = "get" | "post" | "put" | "delete" | "patch";

/**
 * Registers one route on `app` under `basePath` and records it in
 * `routes`, so a guard test (see access-matrix.test.ts) can assert every
 * route declares an access level and enforces it.
 */
export function guardedRoute(
  app: Hono<AppEnv>,
  routes: RouteEntry[],
  basePath: string,
  method: HonoMethod,
  path: string,
  access: AccessLevel,
  ...handlers: Handler<AppEnv>[]
): void {
  const fullPath = joinPaths(basePath, path);
  routes.push({ method: method.toUpperCase(), path: fullPath, access });
  app[method](path, requireAccess(access), ...handlers);
}

/** Constant-time comparison of a bearer header against `Bearer $expected`, so a wrong token can't be guessed byte-by-byte via timing. */
function bearerTokenMatches(
  header: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || !header) return false;
  const expectedHeader = Buffer.from(`Bearer ${expected}`);
  const actualHeader = Buffer.from(header);
  if (expectedHeader.length !== actualHeader.length) return false;
  return timingSafeEqual(expectedHeader, actualHeader);
}

function joinPaths(base: string, path: string): string {
  const joined = `${base}${path}`.replace(/\/+/g, "/");
  if (joined === "") return "/";
  return joined.length > 1 && joined.endsWith("/")
    ? joined.slice(0, -1)
    : joined;
}

/** Hono middleware enforcing `access` against `c.get("session")`. */
export function requireAccess(access: AccessLevel): Handler<AppEnv> {
  return async (c, next) => {
    if (access === "public") return next();

    if (access === "status-token") {
      const header = c.req.header("authorization");
      if (!bearerTokenMatches(header, process.env.STATUS_TOKEN)) {
        return c.json({ error: "forbidden" }, 403);
      }
      return next();
    }

    if (access === "admin-or-status-token") {
      const header = c.req.header("authorization");
      if (bearerTokenMatches(header, process.env.STATUS_TOKEN)) return next();

      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);
      if (termsRequired(c)) return c.json({ error: "terms_required" }, 403);
      if (session.user.status === "pending") {
        return c.json({ error: "pending" }, 403);
      }
      if (session.user.status === "disabled") {
        return c.json({ error: "disabled" }, 403);
      }
      if (session.user.status !== "active" || session.user.role !== "admin") {
        return c.json({ error: "forbidden" }, 403);
      }
      return next();
    }

    const session = c.get("session");
    if (!session) {
      return c.json({ error: "unauthorized" }, 401);
    }

    if (access === "signed-in-or-disabled") return next();

    if (access === "signed-in") {
      // Issue #64: in practice a disabled user's sessions are deleted
      // the moment they're disabled, so this never fires for a real
      // request — it's the matrix row's own guarantee, not just the
      // pending one's, in case a session outlives the disable somehow
      // (a self-delete must not be a way to dodge the block).
      if (session.user.status === "disabled") {
        return c.json({ error: "disabled" }, 403);
      }
      return next();
    }

    if (access === "active") {
      if (termsRequired(c)) return c.json({ error: "terms_required" }, 403);
      if (session.user.status === "pending") {
        return c.json({ error: "pending" }, 403);
      }
      // Issue #64: in practice a disabled user's sessions are deleted
      // the moment they're disabled, so this never fires for a real
      // request — it's the matrix row's own guarantee, not just the
      // pending one's, in case a session outlives the disable somehow.
      if (session.user.status === "disabled") {
        return c.json({ error: "disabled" }, 403);
      }
      if (session.user.status !== "active") {
        return c.json({ error: "forbidden" }, 403);
      }
      return next();
    }

    if (access === "admin") {
      if (termsRequired(c)) return c.json({ error: "terms_required" }, 403);
      if (session.user.status === "pending") {
        return c.json({ error: "pending" }, 403);
      }
      if (session.user.status === "disabled") {
        return c.json({ error: "disabled" }, 403);
      }
      if (session.user.status !== "active" || session.user.role !== "admin") {
        // A forbidden response must go out even if this Log entry can't
        // be written (e.g. the DB a non-Admin was just refused from is
        // itself down), so a logging failure is never let to turn a
        // clean 403 into an unhandled 500.
        try {
          await c.get("logWriter")?.log({
            level: "warning",
            source: "app",
            message: `non-Admin called an admin route: ${c.req.method} ${c.req.path}`,
            userId: session.user.id,
          });
        } catch {
          // best-effort: the 403 below still answers either way
        }
        return c.json({ error: "forbidden" }, 403);
      }
      return next();
    }

    return c.json({ error: "forbidden" }, 403);
  };
}

/**
 * The issue #60 terms gate: true when the Site terms are set and this
 * session's user hasn't accepted the current version. `termsVersion` is
 * set by `sessionMiddleware`. Checked before status (issue #62, ADR
 * 0008), so a pending user who hasn't accepted yet is asked for terms
 * first, not told they're pending.
 */
function termsRequired(c: Context<AppEnv>): boolean {
  const session = c.get("session");
  const termsVersion = c.get("termsVersion");
  return !!(
    session &&
    termsVersion !== null &&
    session.user.termsAcceptedVersion !== termsVersion
  );
}
