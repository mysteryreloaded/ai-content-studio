// `/api/admin/backends`: Backend register/edit/soft-delete + health (issue #39).

import type { Clock } from "@ai-content-studio/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { NameTaken, NotFound, StaleVersion } from "../backends/repository.js";
import type { BackendRepository } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import { ValidationFailed } from "../backends/validation.js";
import type { BackendInput } from "../backends/validation.js";
import type { Database } from "../db/client.js";
import { auditEntries } from "../db/schema.js";

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

export function adminBackendsRoute(
  db: Database,
  clock: Clock,
  repository: BackendRepository,
  service: BackendsService,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/admin/backends";

  guardedRoute(app, routes, basePath, "get", "/", "admin", async (c) => {
    const list = await repository.list();
    return c.json({
      backends: list.map((backend) => ({
        ...backend,
        health: service.healthFor(backend.id),
      })),
      disabledBanner: service.disabledBanner,
    });
  });

  guardedRoute(app, routes, basePath, "post", "/", "admin", async (c) => {
    const body = await readJsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);

    const parsed = backendInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { error: "invalid input", issues: parsed.error.issues },
        400,
      );

    try {
      const record = await repository.create(parsed.data, adminActorFrom(c));
      service.watch(record);
      return c.json(record, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  guardedRoute(app, routes, basePath, "get", "/:id", "admin", async (c) => {
    const id = idParam(c);
    if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

    const record = await repository.get(id);
    if (!record) return c.json({ error: "not found" }, 404);
    return c.json({ ...record, health: service.healthFor(record.id) });
  });

  guardedRoute(app, routes, basePath, "put", "/:id", "admin", async (c) => {
    const id = idParam(c);
    if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

    const body = await readJsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);

    const versionResult = versionSchema.safeParse(body.version);
    if (!versionResult.success)
      return c.json({ error: "version is required" }, 400);

    const parsed = backendInputSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { error: "invalid input", issues: parsed.error.issues },
        400,
      );

    try {
      const record = await repository.update(
        id,
        parsed.data,
        versionResult.data,
        adminActorFrom(c),
      );
      service.unwatch(record.id);
      service.watch(record);
      return c.json(record);
    } catch (err) {
      return handleError(c, err);
    }
  });

  guardedRoute(app, routes, basePath, "delete", "/:id", "admin", async (c) => {
    const id = idParam(c);
    if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

    const versionResult = versionSchema.safeParse(c.req.query("version"));
    if (!versionResult.success)
      return c.json({ error: "version is required" }, 400);

    try {
      await repository.softDelete(id, versionResult.data, adminActorFrom(c));
      service.unwatch(id);
      return c.body(null, 204);
    } catch (err) {
      return handleError(c, err);
    }
  });

  guardedRoute(
    app,
    routes,
    basePath,
    "get",
    "/:id/history",
    "admin",
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

  return app;
}

function handleError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof ValidationFailed)
    return c.json({ errors: err.errors }, 400);
  if (err instanceof NameTaken) return c.json({ error: err.message }, 409);
  if (err instanceof StaleVersion) return c.json({ error: err.message }, 409);
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  throw err;
}
