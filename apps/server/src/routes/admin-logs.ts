// `/api/admin/logs`: the Logs page's filters and the 24h error badge (issue #67).

import type { Clock } from "@ai-content-studio/shared";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { Database } from "../db/client.js";
import { backends, logEntries, users } from "../db/schema.js";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

const LEVELS = ["error", "warning", "info"] as const;
const SOURCES = ["backend", "app"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

/** Builds the `where` clause shared by the list and 24h-count queries. */
function filtersFrom(query: Record<string, string | undefined>) {
  const clauses = [];

  if (query.level && (LEVELS as readonly string[]).includes(query.level)) {
    clauses.push(eq(logEntries.level, query.level as (typeof LEVELS)[number]));
  }
  if (query.source && (SOURCES as readonly string[]).includes(query.source)) {
    clauses.push(
      eq(logEntries.source, query.source as (typeof SOURCES)[number]),
    );
  }
  if (isUuid(query.backendId)) {
    clauses.push(eq(logEntries.backendId, query.backendId));
  }
  if (isUuid(query.userId)) {
    clauses.push(eq(logEntries.userId, query.userId));
  }
  if (isUuid(query.modelId)) {
    clauses.push(eq(logEntries.modelId, query.modelId));
  }
  if (isUuid(query.generationId)) {
    clauses.push(eq(logEntries.generationId, query.generationId));
  }
  if (query.from) {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime()))
      clauses.push(gte(logEntries.createdAt, from));
  }
  if (query.to) {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime()))
      clauses.push(lte(logEntries.createdAt, to));
  }
  if (query.q) {
    const text = `%${query.q}%`;
    clauses.push(
      or(ilike(logEntries.message, text), ilike(logEntries.details, text)),
    );
  }

  return clauses;
}

/** `/api/admin/logs`: text/filterable Log entries and the 24h error badge. */
export function adminLogsRoute(
  db: Database,
  clock: Clock,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/admin/logs";

  guardedRoute(app, routes, basePath, "get", "/", "admin", async (c) => {
    const query = c.req.query();
    const clauses = filtersFrom(query);

    const limitParam = Number.parseInt(query.limit ?? "", 10);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const rows = await db
      .select({
        id: logEntries.id,
        level: logEntries.level,
        source: logEntries.source,
        message: logEntries.message,
        details: logEntries.details,
        backendId: logEntries.backendId,
        backendName: backends.name,
        userId: logEntries.userId,
        userEmail: users.email,
        modelId: logEntries.modelId,
        generationId: logEntries.generationId,
        createdAt: logEntries.createdAt,
      })
      .from(logEntries)
      .leftJoin(backends, eq(logEntries.backendId, backends.id))
      .leftJoin(users, eq(logEntries.userId, users.id))
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(desc(logEntries.createdAt))
      .limit(limit);

    return c.json({ entries: rows });
  });

  guardedRoute(
    app,
    routes,
    basePath,
    "get",
    "/error-count-24h",
    "admin",
    async (c) => {
      const since = new Date(clock.now().getTime() - 24 * 60 * 60 * 1000);
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(logEntries)
        .where(
          and(eq(logEntries.level, "error"), gte(logEntries.createdAt, since)),
        );
      return c.json({ count: Number(row?.count ?? 0) });
    },
  );

  return app;
}
