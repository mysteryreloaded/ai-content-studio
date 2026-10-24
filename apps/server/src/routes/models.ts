import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { GenerationsRepository } from "../generations/repository.js";
import {
  ModeNotFound,
  ModelChanged,
  ModelDisabled,
  ModelNotFound,
  NoBackend,
  type SubmissionDeps,
  submitGeneration,
} from "../generations/submission.js";
import type { ModelRepository } from "../models/repository.js";

const submitSchema = z.object({
  modeId: z.string(),
  revision: z.number().int().min(1),
});

/** Trims a Model's admin detail down to what a signed-in user's Workbench may see. */
function toWorkbenchDetail(
  detail: Awaited<ReturnType<ModelRepository["getBySlug"]>>,
) {
  if (!detail) return null;
  return {
    id: detail.model.id,
    slug: detail.model.slug,
    name: detail.model.name,
    description: detail.model.description,
    revision: detail.model.currentRevision,
    modes: detail.modes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description,
    })),
  };
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

/** Hono's `:slug` param is always present for a route registered with that pattern. */
function slugParam(c: Context<AppEnv>): string {
  const slug = c.req.param("slug");
  if (!slug) throw new Error("slug param missing");
  return slug;
}

/** `/api/models`: the signed-in Models home and each Model's Workbench (issue #42, #43). */
export function modelsRoute(
  modelRepository: ModelRepository,
  generationsRepository: GenerationsRepository,
  submissionDeps: SubmissionDeps,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(app, routes, "/api/models", "get", "/", "active", async (c) =>
    c.json({ models: await modelRepository.listEnabledSummaries() }),
  );

  guardedRoute(
    app,
    routes,
    "/api/models",
    "get",
    "/:slug",
    "active",
    async (c) => {
      const detail = await modelRepository.getBySlug(slugParam(c));
      if (!detail || detail.model.state !== "enabled") {
        return c.json({ error: "not found" }, 404);
      }
      return c.json({ model: toWorkbenchDetail(detail) });
    },
  );

  guardedRoute(
    app,
    routes,
    "/api/models",
    "get",
    "/:slug/generations",
    "active",
    async (c) => {
      const detail = await modelRepository.getBySlug(slugParam(c));
      if (!detail || detail.model.state !== "enabled") {
        return c.json({ error: "not found" }, 404);
      }
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      const submissions =
        await generationsRepository.listRecentSubmissionsForModel(
          detail.model.id,
          session.user.id,
          8,
        );
      return c.json({ submissions });
    },
  );

  guardedRoute(
    app,
    routes,
    "/api/models",
    "post",
    "/:slug/generations",
    "active",
    async (c) => {
      const body = await readJsonBody(c);
      if (body === null) return c.json({ error: "invalid JSON body" }, 400);

      const parsed = submitSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: "invalid input", issues: parsed.error.issues },
          400,
        );
      }

      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      try {
        const generation = await submitGeneration(
          {
            slug: slugParam(c),
            modeId: parsed.data.modeId,
            revision: parsed.data.revision,
            userId: session.user.id,
          },
          submissionDeps,
        );
        return c.json({ generation }, 201);
      } catch (err) {
        if (err instanceof ModelNotFound) {
          return c.json({ error: "not found" }, 404);
        }
        if (err instanceof ModelChanged) {
          return c.json(
            { error: "model_changed", model: toWorkbenchDetail(err.detail) },
            409,
          );
        }
        if (err instanceof ModelDisabled) {
          return c.json({ error: "model_disabled" }, 409);
        }
        if (err instanceof ModeNotFound) {
          return c.json({ error: "mode not found" }, 400);
        }
        if (err instanceof NoBackend) {
          return c.json({ error: "no_backend", message: err.message }, 400);
        }
        throw err;
      }
    },
  );

  return app;
}
