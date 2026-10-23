import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ProblemsTracker } from "./tracker";

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface StatusHandlerOptions {
  tracker: ProblemsTracker;
  /** `STATUS_TOKEN`; a Bearer token matching it authorizes the request. Omit to disable. */
  statusToken?: string;
  /** Whether the request carries an Admin session. No session infra exists yet (#36) — the caller supplies this check. */
  isAdminSession(c: Context): boolean | Promise<boolean>;
  /** Whether generating is currently Paused, used to suppress `db_unreachable` and `model_without_backend`. */
  isPaused(): boolean | Promise<boolean>;
}

function isAuthorized(c: Context, statusToken: string | undefined): boolean {
  if (!statusToken) return false;
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return tokensMatch(header.slice("Bearer ".length), statusToken);
}

/** `GET /api/status`: 200 when healthy, 503 listing each Problem otherwise. */
export function createStatusApp(options: StatusHandlerOptions): Hono {
  const app = new Hono();

  app.get("/api/status", async (c) => {
    if (!isAuthorized(c, options.statusToken) && !(await options.isAdminSession(c))) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const paused = await options.isPaused();
    const problems = options.tracker.list({ paused }).map((p) => ({
      code: p.code,
      message: p.message,
      target: p.target,
      since: p.since.toISOString(),
    }));

    return c.json({ problems }, problems.length === 0 ? 200 : 503);
  });

  return app;
}
