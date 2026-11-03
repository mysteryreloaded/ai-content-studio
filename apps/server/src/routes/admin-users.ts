// `/api/admin/users`: the Users page's list, search and filters, a
// user's own page, approve/promote/demote (issue #62, ADR 0008), and
// disable/enable/delete and Cap overrides (issue #64).

import { userCapOverrideSchema } from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import { and, desc, eq, ilike, lt, or, sql } from "drizzle-orm";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { recordAuditEntry } from "../audit/audit.js";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AccountDeletionDeps } from "../auth/account-deletion.js";
import { adminDeleteUser } from "../auth/admin-deletion.js";
import type { AppEnv } from "../auth/app-env.js";
import {
  DISABLE_REASON_MAX_LENGTH,
  type UserActionResult,
  type UserDisableDeps,
  approveUser,
  demoteUser,
  disableUser,
  enableUser,
  isPinned,
  promoteUser,
} from "../auth/users.js";
import { validate } from "../auth/validate.js";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

/**
 * A non-UUID `:id` answers 404 before the body gate runs: the
 * pre-conversion routes checked the id first (issue #168).
 */
const requireUuidId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.param("id");
  if (!id || !UUID_RE.test(id)) {
    return c.json({ error: "not found" }, 404);
  }
  return next();
};

const ROLES = ["user", "admin"] as const;
const STATUSES = ["pending", "active", "disabled"] as const;

/** `pinned` is read live against `adminEmails`, never stored (ADR 0008). */
function userJson(
  user: typeof users.$inferSelect,
  adminEmails: readonly string[],
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    status: user.status,
    pinned: isPinned(user.email, adminEmails),
    dailyCapOverride: user.dailyCapOverride,
    concurrentCapOverride: user.concurrentCapOverride,
    disabledReason: user.disabledReason,
    disabledAt: user.disabledAt,
    deletedAt: user.deletedAt,
    lastSignInAt: user.lastSignInAt,
    lastSeenAt: user.lastSeenAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function respondForAction(c: Context<AppEnv>, result: UserActionResult) {
  if (result.ok) return c.json(result.user);
  if (result.reason === "not_found") {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ error: "not in the right state for this action" }, 400);
}

const disableBodySchema = z.object({
  reason: z.string().max(DISABLE_REASON_MAX_LENGTH).optional(),
});

const deleteBodySchema = z.object({
  reason: z.string().max(DISABLE_REASON_MAX_LENGTH).optional(),
});

const capsBodySchema = z.object({
  dailyCapOverride: userCapOverrideSchema,
  concurrentCapOverride: userCapOverrideSchema,
});

/** `/api/admin/users`: list/search/filter, a user's own page, approve/promote/demote/disable/enable/delete and Cap overrides. */
export function adminUsersRoute(
  db: Database,
  clock: Clock,
  adminEmails: readonly string[],
  userDisableDeps: UserDisableDeps,
  accountDeletionDeps: AccountDeletionDeps,
  routes: RouteEntry[],
) {
  const basePath = "/api/admin/users";

  /** The no-body actions: one shared uuid/session check, then the action. */
  const runAction =
    (
      action: (
        db: Database,
        clock: Clock,
        actor: ReturnType<typeof adminActorFrom>,
        actingUserId: string,
        targetId: string,
        adminEmails: readonly string[],
      ) => Promise<UserActionResult>,
    ) =>
    async (c: Context<AppEnv>) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "not found" }, 404);

      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      const result = await action(
        db,
        clock,
        adminActorFrom(c),
        session.user.id,
        id,
        adminEmails,
      );
      return respondForAction(c, result);
    };

  /** Runs disable with a given reason; a malformed body means no reason today. */
  const runDisable = async (c: Context<AppEnv>, reason: string | null) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "not found" }, 404);

    const session = c.get("session");
    if (!session) return c.json({ error: "unauthorized" }, 401);

    const result = await disableUser(
      userDisableDeps,
      clock,
      adminActorFrom(c),
      session.user.id,
      id,
      adminEmails,
      reason,
    );
    return respondForAction(c, result);
  };

  /** Runs delete with a given reason; a malformed body means no reason today. */
  const runDelete = async (c: Context<AppEnv>, reason: string | null) => {
    const id = c.req.param("id");
    if (!isUuid(id)) return c.json({ error: "not found" }, 404);

    const session = c.get("session");
    if (!session) return c.json({ error: "unauthorized" }, 401);

    const result = await adminDeleteUser(
      accountDeletionDeps,
      clock,
      adminActorFrom(c),
      session.user.id,
      id,
      adminEmails,
      reason,
    );
    if (!result.ok) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  };

  return new Hono<AppEnv>()
    .get("/", guard(routes, basePath, "get", "/", "admin"), async (c) => {
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
        clauses.push(
          eq(users.status, query.status as (typeof STATUSES)[number]),
        );
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

      return c.json({
        users: rows.map((row) => userJson(row, adminEmails)),
        hasMore,
      });
    })
    .get(
      "/pending-count",
      guard(routes, basePath, "get", "/pending-count", "admin"),
      async (c) => {
        const [row] = await db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(eq(users.status, "pending"));
        return c.json({ count: Number(row?.count ?? 0) });
      },
    )
    .get("/:id", guard(routes, basePath, "get", "/:id", "admin"), async (c) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return c.json({ error: "not found" }, 404);

      const [user] = await db.select().from(users).where(eq(users.id, id));
      if (!user) return c.json({ error: "not found" }, 404);

      return c.json(userJson(user, adminEmails));
    })
    .post(
      "/:id/approve",
      guard(routes, basePath, "post", "/:id/approve", "admin"),
      runAction(approveUser),
    )
    .post(
      "/:id/promote",
      guard(routes, basePath, "post", "/:id/promote", "admin"),
      runAction(promoteUser),
    )
    .post(
      "/:id/demote",
      guard(routes, basePath, "post", "/:id/demote", "admin"),
      runAction(demoteUser),
    )
    .post(
      "/:id/enable",
      guard(routes, basePath, "post", "/:id/enable", "admin"),
      runAction(enableUser),
    )
    .post(
      "/:id/disable",
      guard(routes, basePath, "post", "/:id/disable", "admin"),
      requireUuidId,
      validate("json", disableBodySchema, (c, reason) =>
        reason === "invalid"
          ? c.json({ error: "invalid" }, 400)
          : runDisable(c, null),
      ),
      (c) => runDisable(c, c.req.valid("json").reason?.trim() || null),
    )
    .put(
      "/:id/caps",
      guard(routes, basePath, "put", "/:id/caps", "admin"),
      requireUuidId,
      validate("json", capsBodySchema, (c) =>
        c.json({ error: "invalid" }, 400),
      ),
      async (c) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return c.json({ error: "not found" }, 404);

        const session = c.get("session");
        if (!session) return c.json({ error: "unauthorized" }, 401);

        const { dailyCapOverride, concurrentCapOverride } = c.req.valid("json");

        const result = await db.transaction(async (tx) => {
          const [user] = await tx.select().from(users).where(eq(users.id, id));
          // Issue #64: a deleted ("Deleted user") row is refused 404 like
          // a missing row, the same as every other action here.
          if (!user || user.deletedAt !== null) {
            return { ok: false as const, reason: "not_found" as const };
          }

          const [updated] = await tx
            .update(users)
            .set({
              dailyCapOverride,
              concurrentCapOverride,
              updatedAt: clock.now(),
            })
            .where(eq(users.id, id))
            .returning();
          if (!updated) throw new Error("user update affected no row");

          await recordAuditEntry(tx, clock, {
            actor: adminActorFrom(c),
            targetType: "user",
            targetId: id,
            action: "caps",
            before: {
              dailyCapOverride: user.dailyCapOverride,
              concurrentCapOverride: user.concurrentCapOverride,
            },
            after: {
              dailyCapOverride: updated.dailyCapOverride,
              concurrentCapOverride: updated.concurrentCapOverride,
            },
          });

          return { ok: true as const, user: updated };
        });

        if (!result.ok) return c.json({ error: "not found" }, 404);
        return c.json(userJson(result.user, adminEmails));
      },
    )
    .delete(
      "/:id",
      guard(routes, basePath, "delete", "/:id", "admin"),
      requireUuidId,
      validate("json", deleteBodySchema, (c, reason) =>
        reason === "invalid"
          ? c.json({ error: "invalid" }, 400)
          : runDelete(c, null),
      ),
      (c) => runDelete(c, c.req.valid("json").reason?.trim() || null),
    );
}
