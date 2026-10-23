import type { Handler, Hono } from "hono";
import type { AppEnv } from "./app-env.js";

/**
 * Every route must declare one of these. `active` additionally requires
 * the Site terms to be accepted once Site settings grow a terms field;
 * today it is equivalent to "signed in and not disabled".
 */
export type AccessLevel =
  | "public"
  | "signed-in"
  | "active"
  | "admin"
  | "status-token";

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
      const expected = process.env.STATUS_TOKEN;
      const header = c.req.header("authorization");
      if (!expected || header !== `Bearer ${expected}`) {
        return c.json({ error: "forbidden" }, 403);
      }
      return next();
    }

    const session = c.get("session");
    if (!session) {
      return c.json({ error: "unauthorized" }, 401);
    }

    if (access === "signed-in") return next();

    if (access === "active") {
      if (session.user.status !== "active") {
        return c.json({ error: "forbidden" }, 403);
      }
      return next();
    }

    if (access === "admin") {
      if (session.user.status !== "active" || session.user.role !== "admin") {
        return c.json({ error: "forbidden" }, 403);
      }
      return next();
    }

    return c.json({ error: "forbidden" }, 403);
  };
}
