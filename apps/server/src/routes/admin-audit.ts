// `/api/admin/audit`: the Audit page's filters and live actor/target
// name lookups (issue #38).

import { and, desc, eq, gte, ilike, inArray, lte } from "drizzle-orm";
import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { Database } from "../db/client.js";
import { auditEntries, users } from "../db/schema.js";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

function filtersFrom(query: Record<string, string | undefined>) {
  const clauses = [];

  if (query.actor === "system") {
    clauses.push(eq(auditEntries.actorType, "system"));
  } else if (isUuid(query.actor)) {
    clauses.push(eq(auditEntries.actorUserId, query.actor));
  } else if (query.actor) {
    clauses.push(ilike(auditEntries.actorEmail, `%${query.actor}%`));
  }

  if (query.targetType) {
    clauses.push(eq(auditEntries.targetType, query.targetType));
  }
  if (query.targetId) {
    clauses.push(eq(auditEntries.targetId, query.targetId));
  }
  if (query.action) {
    clauses.push(eq(auditEntries.action, query.action));
  }
  if (query.from) {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime()))
      clauses.push(gte(auditEntries.createdAt, from));
  }
  if (query.to) {
    const to = new Date(query.to);
    if (!Number.isNaN(to.getTime()))
      clauses.push(lte(auditEntries.createdAt, to));
  }

  return clauses;
}

/**
 * `/api/admin/audit`: every Audit entry, newest first, filterable by
 * actor, target type, target, action and date (ADR 0005). Actor/target
 * names are looked up live against the users table, never stored, so a
 * deleted user shows as "Deleted user" instead of a stale name.
 */
export function adminAuditRoute(
  db: Database,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/admin/audit";

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
        id: auditEntries.id,
        createdAt: auditEntries.createdAt,
        actorType: auditEntries.actorType,
        actorUserId: auditEntries.actorUserId,
        actorEmail: auditEntries.actorEmail,
        targetType: auditEntries.targetType,
        targetId: auditEntries.targetId,
        action: auditEntries.action,
        before: auditEntries.before,
        after: auditEntries.after,
        images: auditEntries.images,
      })
      .from(auditEntries)
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(desc(auditEntries.createdAt))
      .limit(limit);

    // Admin actors keep their email denormalized (ADR 0005), so only a
    // non-Admin actor (none exist yet) and a "user" target need a live
    // lookup, which must never produce a stale name.
    const lookupIds = new Set<string>();
    for (const row of rows) {
      if (row.actorType !== "admin" && row.actorUserId)
        lookupIds.add(row.actorUserId);
      if (row.targetType === "user" && isUuid(row.targetId))
        lookupIds.add(row.targetId);
    }

    const names = new Map<string, string>();
    if (lookupIds.size > 0) {
      const found = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, Array.from(lookupIds)));
      for (const user of found) names.set(user.id, user.name);
    }

    const entries = rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      actorType: row.actorType,
      actorName:
        row.actorType === "admin"
          ? row.actorEmail
          : row.actorUserId
            ? (names.get(row.actorUserId) ?? "Deleted user")
            : null,
      targetType: row.targetType,
      targetId: row.targetId,
      targetName:
        row.targetType === "user"
          ? (names.get(row.targetId) ?? "Deleted user")
          : null,
      action: row.action,
      before: row.before,
      after: row.after,
      images: row.images,
    }));

    return c.json({ entries });
  });

  return app;
}
