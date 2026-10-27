// `/api/admin/backends`: Backend register/edit/soft-delete + health (issue #39).

import type { Clock } from "@ai-content-studio/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { type ValidateReason, validate } from "../auth/validate.js";
import { NameTaken, NotFound, StaleVersion } from "../backends/repository.js";
import type { BackendRepository } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import { ValidationFailed } from "../backends/validation.js";
import type { BackendInput } from "../backends/validation.js";
import type { Database } from "../db/client.js";
import { auditEntries } from "../db/schema.js";
import type { GenerationsRepository } from "../generations/repository.js";

const backendInputSchema = z.object({
  name: z.string(),
  baseUrl: z.string(),
  auth: z.enum(["none", "basic", "header"]),
  basicUser: z.string().optional(),
  basicPass: z.string().optional(),
  headerName: z.string().optional(),
  headerValue: z.string().optional(),
}) satisfies z.ZodType<BackendInput>;

const versionSchema = z.coerce.number().int().min(1);

/**
 * PUT /:id's wire body is `version` plus the input fields (issue #169);
 * built from `backendInputSchema`'s shape so the field semantics stay in
 * one place. No `satisfies` here: the coerced `version` field gives the
 * schema an `unknown` input type, not `BackendInput`'s.
 */
const backendEditSchema = z.object({
  version: versionSchema,
  ...backendInputSchema.shape,
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hono's `:id` param is always present for a route registered with that pattern. */
function idParam(c: Context<AppEnv>): string {
  const id = c.req.param("id");
  if (!id) throw new Error("id param missing");
  return id;
}

async function readJsonBody(
  c: Context<AppEnv>,
): Promise<Record<string, unknown> | null> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The shared `onInvalid` of POST / and PUT /:id (issue #169): it re-runs
 * the exact checks the routes used before the conversion — unreadable or
 * `null` body, then (PUT only) `version`, then the shared input schema — so
 * every 400 body stays byte-for-byte what it answered before the conversion.
 */
async function onInvalidBackendBody(
  c: Context<AppEnv>,
  reason: ValidateReason,
  checkVersion: boolean,
): Promise<Response> {
  // `null` stands in for a "malformed" body (the validator's parse threw,
  // so there is nothing to re-read), a JSON `null` body, and a body the
  // gate never read: Hono's validator only reads for a JSON
  // Content-Type, so a no or non-JSON Content-Type reaches here with the
  // body still unread, and the re-read throws a SyntaxError the gate's
  // catch does not convert (500 "internal error" on the way out). The
  // pre-conversion readJsonBody's catch answered all of these the same
  // way — 400 "invalid JSON body".
  let body: Record<string, unknown> | null;
  if (reason === "malformed") {
    body = null;
  } else {
    try {
      body = (await c.req.json()) as Record<string, unknown> | null;
    } catch {
      body = null;
    }
  }
  if (body === null) {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (checkVersion) {
    const versionResult = versionSchema.safeParse(body.version);
    if (!versionResult.success) {
      return c.json({ error: "version is required" }, 400);
    }
  }

  const parsed = backendInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid input", issues: parsed.error.issues }, 400);
  }

  // The gate only rejects a body one of the checks above rejects.
  return c.json({ error: "invalid input", issues: [] }, 400);
}

export function adminBackendsRoute(
  db: Database,
  clock: Clock,
  repository: BackendRepository,
  service: BackendsService,
  generationsRepository: GenerationsRepository,
  routes: RouteEntry[],
  onBackendEnabled?: () => void,
) {
  const basePath = "/api/admin/backends";

  return new Hono<AppEnv>()
    .get("/", guard(routes, basePath, "get", "/", "admin"), async (c) => {
      const list = await repository.list();
      return c.json({
        backends: list.map((backend) => ({
          ...backend,
          health: service.healthFor(backend.id),
        })),
        disabledBanner: service.disabledBanner,
      });
    })
    .post(
      "/",
      guard(routes, basePath, "post", "/", "admin"),
      validate("json", backendInputSchema, (c, reason) =>
        onInvalidBackendBody(c, reason, false),
      ),
      async (c) => {
        const input = c.req.valid("json");

        try {
          const record = await repository.create(input, adminActorFrom(c));
          service.watch(record);
          return c.json(record, 201);
        } catch (err) {
          return handleError(c, err);
        }
      },
    )
    .get("/:id", guard(routes, basePath, "get", "/:id", "admin"), async (c) => {
      const id = idParam(c);
      if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

      const record = await repository.get(id);
      if (!record) return c.json({ error: "not found" }, 404);
      return c.json({ ...record, health: service.healthFor(record.id) });
    })
    .put(
      "/:id",
      guard(routes, basePath, "put", "/:id", "admin"),
      // A non-UUID id answers 404 before the body gate runs: the
      // pre-conversion route checked the id first (issue #169).
      async (c, next) => {
        const id = c.req.param("id");
        if (!id || !UUID_RE.test(id)) {
          return c.json({ error: "not found" }, 404);
        }
        return next();
      },
      validate("json", backendEditSchema, (c, reason) =>
        onInvalidBackendBody(c, reason, true),
      ),
      async (c) => {
        const id = idParam(c);
        if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

        const input = c.req.valid("json");

        try {
          const record = await repository.update(
            id,
            input,
            input.version,
            adminActorFrom(c),
          );
          service.unwatch(record.id);
          service.watch(record);
          return c.json(record);
        } catch (err) {
          return handleError(c, err);
        }
      },
    )
    .delete(
      "/:id",
      guard(routes, basePath, "delete", "/:id", "admin"),
      async (c) => {
        const id = idParam(c);
        if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

        const versionResult = versionSchema.safeParse(c.req.query("version"));
        if (!versionResult.success)
          return c.json({ error: "version is required" }, 400);

        if (await generationsRepository.hasUnfinishedForBackend(id)) {
          return c.json({ error: "has unfinished Generations" }, 409);
        }

        try {
          await repository.softDelete(
            id,
            versionResult.data,
            adminActorFrom(c),
          );
          service.unwatch(id);
          return c.body(null, 204);
        } catch (err) {
          return handleError(c, err);
        }
      },
    )
    .patch(
      "/:id/enabled",
      guard(routes, basePath, "patch", "/:id/enabled", "admin"),
      async (c) => {
        const id = idParam(c);
        if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

        const body = await readJsonBody(c);
        if (body === null) return c.json({ error: "invalid JSON body" }, 400);

        const versionResult = versionSchema.safeParse(body.version);
        if (!versionResult.success)
          return c.json({ error: "version is required" }, 400);
        const enabled = Boolean(body.enabled);

        try {
          const record = await repository.setEnabled(
            id,
            enabled,
            versionResult.data,
            adminActorFrom(c),
          );
          if (enabled) onBackendEnabled?.();
          return c.json(record);
        } catch (err) {
          return handleError(c, err);
        }
      },
    )
    .patch(
      "/:id/draining",
      guard(routes, basePath, "patch", "/:id/draining", "admin"),
      async (c) => {
        const id = idParam(c);
        if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

        const body = await readJsonBody(c);
        if (body === null) return c.json({ error: "invalid JSON body" }, 400);

        const versionResult = versionSchema.safeParse(body.version);
        if (!versionResult.success)
          return c.json({ error: "version is required" }, 400);
        const draining = Boolean(body.draining);

        try {
          const record = await repository.setDraining(
            id,
            draining,
            versionResult.data,
            adminActorFrom(c),
          );
          if (!draining) onBackendEnabled?.();
          return c.json(record);
        } catch (err) {
          return handleError(c, err);
        }
      },
    )
    .get(
      "/:id/history",
      guard(routes, basePath, "get", "/:id/history", "admin"),
      async (c) => {
        const id = idParam(c);
        if (!UUID_RE.test(id)) return c.json({ entries: [] });

        const entries = await db
          .select()
          .from(auditEntries)
          .where(
            and(
              eq(auditEntries.targetType, "backend"),
              eq(auditEntries.targetId, id),
            ),
          )
          .orderBy(desc(auditEntries.createdAt));
        return c.json({ entries });
      },
    );
}

function handleError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof ValidationFailed)
    return c.json({ errors: err.errors }, 400);
  if (err instanceof NameTaken) return c.json({ error: err.message }, 409);
  if (err instanceof StaleVersion) return c.json({ error: err.message }, 409);
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  throw err;
}
