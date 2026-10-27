import {
  STANDARD_PAUSE_NOTICE,
  applyModeFixedValues,
  isSeedInput,
  modeMenuGroup,
  relevantInputs,
  resolveModeInputs,
  toInputIssues,
  toWorkbenchInput,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { validate } from "../auth/validate.js";
import {
  type GenerationsRepository,
  promptBindingFor,
} from "../generations/repository.js";
import {
  BlockedWordSubmitted,
  ConcurrentCapExceeded,
  DailyCapExceeded,
  InvalidCount,
  InvalidInputValues,
  InvalidSeed,
  InvalidUploads,
  ModeNotFound,
  ModelChanged,
  ModelDisabled,
  ModelNotFound,
  ModelTermsRequired,
  NoBackend,
  Paused,
  type SubmissionDeps,
  SubmissionStorageFull,
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
    modes: detail.modes.map((mode) => {
      // issue #48: a switch steered by a field one of this Mode's
      // visible Inputs binds keeps both branches on the Path, since
      // the Admin can't know ahead of time which way a user will set
      // it — their Input must reach the Workbench either way.
      const unresolvable = visibleModeBoundFields(
        mode.inputSettings,
        detail.inputs,
      );
      // issue #48 CEO review: a fixed Input's value is known before
      // sending (ADR 0001), so it must pick its switch's side here too.
      const workflowForMode = applyModeFixedValues(
        detail.workflow,
        detail.inputs,
        mode.inputSettings,
      );
      const relevant = relevantInputs(
        detail.inputs,
        workflowForMode,
        mode.outputNodes.map((node) => node.nodeId),
        unresolvable,
      );
      const { formInputs, requiredIds } = resolveModeInputs(
        relevant,
        mode.inputSettings,
      );
      return {
        id: mode.id,
        name: mode.name,
        inputs: formInputs.map((input) =>
          toWorkbenchInput(
            input,
            workflowForMode,
            requiredIds.has(input.id),
            formInputs,
          ),
        ),
        description: mode.description,
        // issue #48: the Mode menu's "From a prompt / images / audio / video" group.
        menuGroup: modeMenuGroup(relevant, mode.inputSettings),
        // issue #48 CEO review: a Seed on the Path turns on the 1-4
        // count even when this Mode hides the Seed Input itself, so
        // this can't be read off `inputs` (formInputs excludes hidden).
        hasSeed: relevant.some(isSeedInput),
      };
    }),
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

/**
 * The "invalid" branch of the submit body validation: the body parsed as
 * JSON but failed `submitSchema`, so re-derive the zod issues to answer the
 * same `{ error: "invalid input", issues }` the old inline `safeParse` did.
 * The body is re-readable (Hono/Bun buffer it), so `c.req.json()` returns it
 * again even after `validate` already consumed it.
 */
async function invalidSubmitBody(c: Context<AppEnv>) {
  const body = await c.req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  const issues = parsed.success ? [] : parsed.error.issues;
  return c.json({ error: "invalid input", issues }, 400);
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
) {
  const basePath = "/api/models";

  return (
    new Hono<AppEnv>()
      // Public (issue #65): the signed-out landing page shows the enabled
      // Models too, each one a sign-in link that returns to it.
      .get("/", guard(routes, basePath, "get", "/", "public"), async (c) =>
        c.json({ models: await modelRepository.listEnabledSummaries() }),
      )

      .get(
        "/:slug",
        guard(routes, basePath, "get", "/:slug", "active"),
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
          return c.json({
            model: toWorkbenchDetail(detail, acceptedTermsVersion),
          });
        },
      )

      .post(
        "/:slug/terms/accept",
        guard(routes, basePath, "post", "/:slug/terms/accept", "active"),
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
      )

      .get(
        "/:slug/generations",
        guard(routes, basePath, "get", "/:slug/generations", "active"),
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
              promptBindingFor(detail.inputs, detail.workflow),
            );
          return c.json({ submissions });
        },
      )

      .post(
        "/:slug/generations",
        guard(routes, basePath, "post", "/:slug/generations", "active"),
        validate("json", submitSchema, (c, reason) => {
          if (reason === "malformed") {
            return c.json({ error: "invalid JSON body" }, 400);
          }
          return invalidSubmitBody(c);
        }),
        async (c) => {
          const { modeId, revision, values, count } = c.req.valid("json");
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);

          try {
            const { generations, prompt } = await submitGeneration(
              {
                slug: slugParam(c),
                modeId,
                revision,
                userId: session.user.id,
                values,
                count,
              },
              submissionDeps,
            );
            return c.json({ generations, prompt }, 201);
          } catch (err) {
            if (err instanceof Paused) {
              return c.json(
                { error: "paused", message: STANDARD_PAUSE_NOTICE },
                503,
              );
            }
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
            if (err instanceof InvalidUploads) {
              return c.json({ error: "invalid", issues: err.issues }, 400);
            }
            if (err instanceof SubmissionStorageFull) {
              return c.json(
                { error: "storage_full", message: err.message },
                507,
              );
            }
            if (err instanceof InvalidInputValues) {
              return c.json(
                { error: "invalid", issues: toInputIssues(err.zodError) },
                400,
              );
            }
            if (err instanceof InvalidCount) {
              return c.json(
                { error: "invalid_count", message: err.message },
                400,
              );
            }
            if (err instanceof InvalidSeed) {
              return c.json(
                { error: "invalid_seed", message: err.message },
                400,
              );
            }
            if (err instanceof DailyCapExceeded) {
              return c.json(
                {
                  error: "daily_cap_exceeded",
                  cap: err.cap,
                  remaining: err.remaining,
                },
                409,
              );
            }
            if (err instanceof ConcurrentCapExceeded) {
              return c.json(
                {
                  error: "concurrent_cap_exceeded",
                  cap: err.cap,
                  remaining: err.remaining,
                },
                409,
              );
            }
            if (err instanceof BlockedWordSubmitted) {
              return c.json(
                {
                  error: "invalid",
                  issues: [
                    {
                      path: err.inputId,
                      code: "blocked_word",
                      message: "Your prompt contains a blocked word",
                    },
                  ],
                },
                400,
              );
            }
            throw err;
          }
        },
      )
  );
}
