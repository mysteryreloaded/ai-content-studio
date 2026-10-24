// `/api/admin/users`: the Users page's list, search and filters, a
// user's own page, and approve/promote/demote (issue #62).

import type { Clock } from "@ai-content-studio/shared";
import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  type UserActionResult,
  approveUser,
  demoteUser,
  promoteUser,
} from "../auth/users.js";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

const ROLES = ["user", "admin"] as const;
const STATUSES = ["pending", "active", "disabled"] as const;

function userJson(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    status: user.status,
    pinned: user.pinned,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function respondForAction(c: Context<AppEnv>, result: UserActionResult) {
  if (result.ok) return c.json(result.user);
  if (result.reason === "not_found") return c.json({ error: "not found" }, 404);
  if (result.reason === "pinned") {
    return c.json({ error: "pinned Admins can't be changed here" }, 403);
  }
  return c.json({ error: "not in the right state for this action" }, 400);
}

/** `/api/admin/users`: list/search/filter, one user's page, approve/promote/demote. */
export function adminUsersRoute(
  db: Database,
  clock: Clock,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/admin/users";

  guardedRoute(app, routes, basePath, "get", "/", "admin", async (c) => {
    const query = c.req.query();
    const clauses = [];

    if (query.q) {
      const text = `%${query.q}%`;
      clauses.push(or(ilike(users.email, text), ilike(users.name, text)));
    }
    if (query.role && (ROLES as readonly string[]).includes(query.role)) {
      clauses.push(eq(users.role, query.role as (typeof ROLES)[number]));
    }
    if (
      query.status &&
      (STATUSES as readonly string[]).includes(query.status)
    ) {
      clauses.push(eq(users.status, query.status as (typeof STATUSES)[number]));
    }

    // Keyset cursor for "Load older": strictly older than the last row's
    // (createdAt, id) in the desc(createdAt), desc(id) ordering below.
    if (query.beforeCreatedAt && isUuid(query.beforeId)) {
      const beforeCreatedAt = new Date(query.beforeCreatedAt);
      if (!Number.isNaN(beforeCreatedAt.getTime())) {
        clauses.push(
          or(
            lt(users.createdAt, beforeCreatedAt),
            and(
              eq(users.createdAt, beforeCreatedAt),
              lt(users.id, query.beforeId),
            ),
          ),
        );
      }
    }

    const limitParam = Number.parseInt(query.limit ?? "", 10);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, MAX_LIMIT)
        : DEFAULT_LIMIT;

    // Fetch one extra row to tell whether there's an older page, without
    // a separate count query; the extra row is trimmed off below.
    const fetched = await db
      .select()
      .from(users)
      .where(clauses.length > 0 ? and(...clauses) : undefined)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit + 1);

    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;

    return c.json({ users: rows.map(userJson), hasMore });
  });

  guardedRoute(
    app,
    routes,
    basePath,
    "get",
    "/pending-count",
    "admin",
    async (c) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.status, "pending"));
      return c.json({ count: Number(row?.count ?? 0) });
    },
  );

  guardedRoute(app, routes, basePath, "get", "/:id", "admin", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "not found" }, 404);

    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) return c.json({ error: "not found" }, 404);

    return c.json(userJson(user));
  });

  function actionRoute(
    path: string,
    action: (
      db: Database,
      clock: Clock,
      actor: ReturnType<typeof adminActorFrom>,
      userId: string,
    ) => Promise<UserActionResult>,
  ) {
    guardedRoute(app, routes, basePath, "post", path, "admin", async (c) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "not found" }, 404);

      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);
      // AC: nobody changes their own role or status.
      if (id === session.user.id) {
        return c.json({ error: "can't change your own role or status" }, 403);
      }

      const result = await action(db, clock, adminActorFrom(c), id);
      return respondForAction(c, result);
    });
  }

  actionRoute("/:id/approve", approveUser);
  actionRoute("/:id/promote", promoteUser);
  actionRoute("/:id/demote", demoteUser);

  return app;
}
