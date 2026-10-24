// `/api/admin/models`: create a Model from a Workflow, list/edit/reorder/
// soft-delete and History (issue #40).

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { Database } from "../db/client.js";
import { auditEntries } from "../db/schema.js";
import {
  NameTaken,
  NotFound,
  SlugTaken,
  StaleVersion,
} from "../models/repository.js";
import type { ModelRepository } from "../models/repository.js";
import { ValidationFailed } from "../models/validation.js";

const createSchema = z.object({
  name: z.string(),
  workflow: z.unknown(),
});

const detailsSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  maxRunTimeMinutes: z.number(),
});

const versionSchema = z.coerce.number().int().min(1);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export function adminModelsRoute(
  db: Database,
  repository: ModelRepository,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/admin/models";

  guardedRoute(app, routes, basePath, "get", "/", "admin", async (c) => {
    const list = await repository.list();
    return c.json({ models: list });
  });

  guardedRoute(app, routes, basePath, "post", "/", "admin", async (c) => {
    const body = await readJsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);

    const parsed = createSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { error: "invalid input", issues: parsed.error.issues },
        400,
      );

    try {
      const { record, outsideServiceNotes } =
        await repository.createFromWorkflow(
          parsed.data.name,
          parsed.data.workflow,
          adminActorFrom(c),
        );
      return c.json({ model: record, outsideServiceNotes }, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  guardedRoute(app, routes, basePath, "get", "/:id", "admin", async (c) => {
    const id = idParam(c);
    if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

    const detail = await repository.get(id);
    if (!detail) return c.json({ error: "not found" }, 404);
    return c.json(detail);
  });

  guardedRoute(app, routes, basePath, "put", "/:id", "admin", async (c) => {
    const id = idParam(c);
    if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

    const body = await readJsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);

    const versionResult = versionSchema.safeParse(body.version);
    if (!versionResult.success)
      return c.json({ error: "version is required" }, 400);

    const parsed = detailsSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        { error: "invalid input", issues: parsed.error.issues },
        400,
      );

    try {
      const record = await repository.updateDetails(
        id,
        parsed.data,
        versionResult.data,
        adminActorFrom(c),
      );
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
      return c.body(null, 204);
    } catch (err) {
      return handleError(c, err);
    }
  });

  for (const direction of ["up", "down"] as const) {
    guardedRoute(
      app,
      routes,
      basePath,
      "post",
      `/:id/move-${direction}`,
      "admin",
      async (c) => {
        const id = idParam(c);
        if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

        try {
          await repository.reorder(id, direction, adminActorFrom(c));
        } catch (err) {
          return handleError(c, err);
        }
        return c.json({ models: await repository.list() });
      },
    );
  }

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
            eq(auditEntries.targetType, "model"),
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
  if (err instanceof SlugTaken) return c.json({ error: err.message }, 409);
  if (err instanceof StaleVersion) return c.json({ error: err.message }, 409);
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  throw err;
}
