import type { Clock } from "@ai-content-studio/shared";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Database } from "../db/client.js";
import type { AppEnv } from "./app-env.js";
import { SESSION_COOKIE_NAME, readSession } from "./session.js";

/**
 * Reads `__Host-session` on every request and attaches the session (or
 * `null`) to the context, so role and status are current for every
 * route's access check — see ADR 0003.
 */
export function sessionMiddleware(
  db: Database,
  clock: Clock,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const cookieValue = getCookie(c, SESSION_COOKIE_NAME);
    const session = await readSession(db, clock, cookieValue);
    c.set("session", session);
    await next();
  };
}
