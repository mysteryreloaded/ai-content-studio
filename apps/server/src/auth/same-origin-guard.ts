import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * ADR 0003: every non-GET/HEAD request must carry `Sec-Fetch-Site:
 * same-origin`, or, when a browser doesn't send that header, a matching
 * `Origin`. Rejects everything else as cross-site.
 */
export function sameOriginGuard(publicUrl: string): MiddlewareHandler {
  const expectedOrigin = new URL(publicUrl).origin;

  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    const secFetchSite = c.req.header("sec-fetch-site");
    if (secFetchSite === "same-origin" || secFetchSite === "none") {
      return next();
    }

    const origin = c.req.header("origin");
    if (origin && origin === expectedOrigin) {
      return next();
    }

    return c.json({ error: "cross_origin_request_blocked" }, 403);
  };
}
