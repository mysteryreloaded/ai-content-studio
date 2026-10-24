import type { InputDefinition, Workflow } from "@ai-content-studio/shared";
import {
  isNodeLink,
  relevantInputs,
  toInputIssues,
} from "@ai-content-studio/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { GenerationsRepository } from "../generations/repository.js";
import {
  InvalidCount,
  InvalidInputValues,
  InvalidSeed,
  ModeNotFound,
  ModelChanged,
  ModelDisabled,
  ModelNotFound,
  ModelTermsRequired,
  NoBackend,
  type SubmissionDeps,
  submitGeneration,
} from "../generations/submission.js";
import {
  type ModelRepository,
  activeModelTermsVersion,
} from "../models/repository.js";

const submitSchema = z.object({
  modeId: z.string(),
  revision: z.number().int().min(1),
  values: z.record(z.string(), z.unknown()).default({}),
  /** 1-4 (issue #47); ignored when the Mode's Path holds no bound Seed Input. */
  count: z.number().int().min(1).max(4).optional(),
});

/** The Model's "prompt" field (issue #47): its first text Input's first binding, and the value it has when a user leaves it blank. */
function promptBindingFor(
  detail: NonNullable<Awaited<ReturnType<ModelRepository["getBySlug"]>>>,
): { nodeId: string; field: string; unsetValue: string } | null {
  const promptInput = detail.inputs.find((input) => input.kind === "text");
  const binding = promptInput?.bindings[0];
  if (!promptInput || promptInput.kind !== "text" || !binding) return null;
  const workflowValue = detail.workflow[binding.nodeId]?.inputs[binding.field];
  const placeholder = typeof workflowValue === "string" ? workflowValue : "";
  return {
    nodeId: binding.nodeId,
    field: binding.field,
    unsetValue: promptInput.default || placeholder,
  };
}

/** The Workflow's own value for an Input's first binding, shown as its placeholder when blank. */
function placeholderFor(
  input: InputDefinition,
  workflow: Workflow,
): string | number | boolean | null {
  const binding = input.bindings[0];
  const value = binding
    ? workflow[binding.nodeId]?.inputs[binding.field]
    : undefined;
  return value === undefined || isNodeLink(value) ? null : value;
}

/** Trims an Input down to what the Workbench needs to render and validate its field: never the bindings or an option's per-field values. */
function toWorkbenchInput(input: InputDefinition, workflow: Workflow) {
  const base = {
    id: input.id,
    group: input.group,
    label: input.label,
    help: input.help,
    placeholder: placeholderFor(input, workflow),
  };
  if (input.kind === "text") {
    return {
      ...base,
      kind: "text" as const,
      multiline: input.multiline,
      maxLength: input.maxLength,
      default: input.default,
    };
  }
  if (input.kind === "number") {
    return {
      ...base,
      kind: "number" as const,
      numberMode: input.numberMode,
      min: input.min,
      max: input.max,
      step: input.step,
      default: input.default,
    };
  }
  if (input.kind === "seed") {
    return {
      ...base,
      kind: "seed" as const,
      max: input.max,
    };
  }
  return {
    ...base,
    kind: "select" as const,
    options: input.options.map((option) => ({
      id: option.id,
      label: option.label,
    })),
    default: input.default,
  };
}

/** Trims a Model's admin detail down to what a signed-in user's Workbench may see. */
function toWorkbenchDetail(
  detail: Awaited<ReturnType<ModelRepository["getBySlug"]>>,
  acceptedTermsVersion: number | null,
) {
  if (!detail) return null;
  const termsVersion = activeModelTermsVersion(detail.model);
  return {
    id: detail.model.id,
    slug: detail.model.slug,
    name: detail.model.name,
    description: detail.model.description,
    revision: detail.model.currentRevision,
    attribution: detail.model.attribution,
    modes: detail.modes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      inputs: relevantInputs(
        detail.inputs,
        detail.workflow,
        mode.outputNodes.map((node) => node.nodeId),
      ).map((input) => toWorkbenchInput(input, detail.workflow)),
      description: mode.description,
    })),
    terms:
      termsVersion === null
        ? null
        : {
            version: termsVersion,
            body: detail.model.termsBody,
            licenseUrl: detail.model.licenseUrl,
            accepted: acceptedTermsVersion === termsVersion,
          },
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

  // Public (issue #65): the signed-out landing page shows the enabled
  // Models too, each one a sign-in link that returns to it.
  guardedRoute(app, routes, "/api/models", "get", "/", "public", async (c) =>
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
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);
      const acceptedTermsVersion =
        await modelRepository.getAcceptedTermsVersion(
          detail.model.id,
          session.user.id,
        );
      return c.json({ model: toWorkbenchDetail(detail, acceptedTermsVersion) });
    },
  );

  guardedRoute(
    app,
    routes,
    "/api/models",
    "post",
    "/:slug/terms/accept",
    "active",
    async (c) => {
      const detail = await modelRepository.getBySlug(slugParam(c));
      if (!detail || detail.model.state !== "enabled") {
        return c.json({ error: "not found" }, 404);
      }
      const session = c.get("session");
      if (!session) return c.json({ error: "unauthorized" }, 401);

      const version = activeModelTermsVersion(detail.model);
      if (version === null) return c.json({ error: "no_terms" }, 400);

      await modelRepository.acceptTerms(
        detail.model.id,
        session.user.id,
        version,
      );
      return c.json({ ok: true, version });
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
          promptBindingFor(detail),
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
        const generations = await submitGeneration(
          {
            slug: slugParam(c),
            modeId: parsed.data.modeId,
            revision: parsed.data.revision,
            userId: session.user.id,
            values: parsed.data.values,
            count: parsed.data.count,
          },
          submissionDeps,
        );
        return c.json({ generations }, 201);
      } catch (err) {
        if (err instanceof ModelNotFound) {
          return c.json({ error: "not found" }, 404);
        }
        if (err instanceof ModelChanged) {
          const acceptedTermsVersion =
            await modelRepository.getAcceptedTermsVersion(
              err.detail.model.id,
              session.user.id,
            );
          return c.json(
            {
              error: "model_changed",
              model: toWorkbenchDetail(err.detail, acceptedTermsVersion),
            },
            409,
          );
        }
        if (err instanceof ModelDisabled) {
          return c.json({ error: "model_disabled" }, 409);
        }
        if (err instanceof ModelTermsRequired) {
          return c.json({ error: "model_terms_required" }, 409);
        }
        if (err instanceof ModeNotFound) {
          return c.json({ error: "mode not found" }, 400);
        }
        if (err instanceof NoBackend) {
          return c.json({ error: "no_backend", message: err.message }, 400);
        }
        if (err instanceof InvalidInputValues) {
          return c.json(
            { error: "invalid", issues: toInputIssues(err.zodError) },
            400,
          );
        }
        if (err instanceof InvalidCount) {
          return c.json({ error: "invalid_count", message: err.message }, 400);
        }
        if (err instanceof InvalidSeed) {
          return c.json({ error: "invalid_seed", message: err.message }, 400);
        }
        throw err;
      }
    },
  );

  return app;
}
