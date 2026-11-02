// `/api/admin/generations`: the Admin Generations page (issue #68) —
// across every user, filterable by Model, Mode, user, state (including
// Deleted and Removed) and date, a jump-to box for a Generation or Asset
// id, a read-only detail, and Remove.

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { validate } from "../auth/validate.js";
import type { Database } from "../db/client.js";
import { auditEntries } from "../db/schema.js";
import {
  GenerationAlreadyGone,
  GenerationNotFound,
  type RemovalDeps,
  removeGeneration,
} from "../generations/removal.js";
import type {
  AdminGenerationStatusFilter,
  GenerationState,
  GenerationsRepository,
} from "../generations/repository.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return value !== undefined && UUID_RE.test(value);
}

const REAL_STATES: readonly GenerationState[] = [
  "queued",
  "starting",
  "running",
  "saving",
  "succeeded",
  "failed",
  "cancelling",
  "cancelled",
];
const STATUS_FILTERS: readonly AdminGenerationStatusFilter[] = [
  ...REAL_STATES,
  "deleted",
  "removed",
];

function isStatusFilter(
  value: string | undefined,
): value is AdminGenerationStatusFilter {
  return (
    value !== undefined && (STATUS_FILTERS as readonly string[]).includes(value)
  );
}

const removeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

/**
 * The 400 `validate` answers for a bad `/:id/remove` body (issue #171): it
 * re-runs the route's pre-conversion `c.req.json().catch(() => null)` +
 * `safeParse` over hono's cached body text — `null` when it doesn't parse —
 * so both the "malformed" and the "invalid" reason answer the same
 * `{ error: "invalid input", issues }` the route answered before.
 */
async function invalidRemoveBody(c: Context<AppEnv>): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await c.req.text());
  } catch {
    body = null;
  }
  const parsed = removeSchema.safeParse(body);
  if (parsed.success) {
    // Unreachable: `validate` only calls this after the same schema already
    // failed on the same body — keep the 400's shape regardless.
    return c.json({ error: "invalid input", issues: [] }, 400);
  }
  return c.json({ error: "invalid input", issues: parsed.error.issues }, 400);
}

/** `/api/admin/generations`: issue #68. */
export function adminGenerationsRoute(
  db: Database,
  generationsRepository: GenerationsRepository,
  removalDeps: RemovalDeps,
  routes: RouteEntry[],
) {
  const basePath = "/api/admin/generations";

  return (
    new Hono<AppEnv>()
      .get("/", guard(routes, basePath, "get", "/", "admin"), async (c) => {
        const query = c.req.query();

        const limitParam = Number.parseInt(query.limit ?? "", 10);
        const limit =
          Number.isFinite(limitParam) && limitParam > 0
            ? Math.min(limitParam, MAX_LIMIT)
            : DEFAULT_LIMIT;

        let cursor: { submittedAt: Date; id: string } | undefined;
        if (query.beforeSubmittedAt && isUuid(query.beforeId)) {
          const submittedAt = new Date(query.beforeSubmittedAt);
          if (!Number.isNaN(submittedAt.getTime())) {
            cursor = { submittedAt, id: query.beforeId };
          }
        }

        let from: Date | undefined;
        if (query.from) {
          const parsed = new Date(query.from);
          if (!Number.isNaN(parsed.getTime())) from = parsed;
        }
        let to: Date | undefined;
        if (query.to) {
          const parsed = new Date(query.to);
          if (!Number.isNaN(parsed.getTime())) to = parsed;
        }

        const page = await generationsRepository.listForAdmin({
          modelId: isUuid(query.model) ? query.model : undefined,
          modeId: isUuid(query.mode) ? query.mode : undefined,
          userId: isUuid(query.user) ? query.user : undefined,
          status: isStatusFilter(query.status) ? query.status : undefined,
          isTest:
            query.isTest === "true"
              ? true
              : query.isTest === "false"
                ? false
                : undefined,
          from,
          to,
          cursor,
          limit,
        });

        return c.json(page);
      })
      // The jump-to box (issue #68's AC): a Generation id matches directly,
      // an Asset id resolves to its own Generation.
      .get(
        "/resolve/:id",
        guard(routes, basePath, "get", "/resolve/:id", "admin"),
        async (c) => {
          const id = c.req.param("id");
          if (!isUuid(id)) return c.json({ error: "not found" }, 404);

          const generationId =
            await generationsRepository.resolveJumpTarget(id);
          if (!generationId) return c.json({ error: "not found" }, 404);
          return c.json({ generationId });
        },
      )
      .get(
        "/:id",
        guard(routes, basePath, "get", "/:id", "admin"),
        async (c) => {
          const id = c.req.param("id");
          if (!isUuid(id)) return c.json({ error: "not found" }, 404);

          const detail = await generationsRepository.getAdminDetail(id);
          if (!detail) return c.json({ error: "not found" }, 404);
          return c.json(detail);
        },
      )
      .get(
        "/:id/history",
        guard(routes, basePath, "get", "/:id/history", "admin"),
        async (c) => {
          const id = c.req.param("id");
          if (!isUuid(id)) return c.json({ entries: [] });

          const entries = await db
            .select()
            .from(auditEntries)
            .where(
              and(
                eq(auditEntries.targetType, "generation"),
                eq(auditEntries.targetId, id),
              ),
            )
            .orderBy(desc(auditEntries.createdAt));
          return c.json({ entries });
        },
      )
      .post(
        "/:id/remove",
        guard(routes, basePath, "post", "/:id/remove", "admin"),
        // A non-UUID id answers 404 before the body gate runs: the
        // pre-conversion route checked the id first.
        async (c, next) => {
          const id = c.req.param("id");
          if (!isUuid(id)) return c.json({ error: "not found" }, 404);
          return next();
        },
        validate("json", removeSchema, (c) => invalidRemoveBody(c)),
        async (c) => {
          const id = c.req.param("id");
          if (!isUuid(id)) return c.json({ error: "not found" }, 404);

          try {
            await removeGeneration(
              id,
              c.req.valid("json").reason,
              adminActorFrom(c),
              removalDeps,
            );
            const detail = await generationsRepository.getAdminDetail(id);
            return c.json(detail);
          } catch (err) {
            if (err instanceof GenerationNotFound) {
              return c.json({ error: "not found" }, 404);
            }
            if (err instanceof GenerationAlreadyGone) {
              return c.json({ error: "already deleted or removed" }, 409);
            }
            throw err;
          }
        },
      )
  );
}
