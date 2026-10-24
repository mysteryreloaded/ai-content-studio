import type { InputDefinition, Workflow } from "@ai-content-studio/shared";
import {
  STANDARD_PAUSE_NOTICE,
  applyModeFixedValues,
  isNodeLink,
  isSeedInput,
  modeMenuGroup,
  relevantInputs,
  resolveModeInputs,
  toInputIssues,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
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

/** The shown Input, if any, bound to `ref`'s field (issue #52: a Points Input's Width/Height may itself be a live Number or Select Input). */
function boundInputFor(
  ref: { nodeId: string; field: string },
  formInputs: readonly InputDefinition[],
): InputDefinition | null {
  return (
    formInputs.find((other) =>
      other.bindings.some(
        (binding) =>
          binding.nodeId === ref.nodeId && binding.field === ref.field,
      ),
    ) ?? null
  );
}

/**
 * A Select Input bound to `ref`'s field resolves to a different value
 * per option, not a number the client can just parse (issue #52 CEO
 * review round 2 point 4): this is that option id -> value map, so the
 * Workbench can look up whichever option is currently chosen (or
 * defaulted).
 */
function selectOptionValuesFor(
  ref: { nodeId: string; field: string },
  input: InputDefinition | null,
): Record<string, number> | null {
  if (!input || input.kind !== "select") return null;
  const bindingIndex = input.bindings.findIndex(
    (binding) => binding.nodeId === ref.nodeId && binding.field === ref.field,
  );
  if (bindingIndex === -1) return null;
  const values: Record<string, number> = {};
  for (const option of input.options) {
    const value = option.values[bindingIndex];
    if (typeof value === "number") values[option.id] = value;
  }
  return values;
}

/** Trims an Input down to what the Workbench needs to render and validate its field: never the bindings or an option's per-field values. */
function toWorkbenchInput(
  input: InputDefinition,
  workflow: Workflow,
  required: boolean,
  formInputs: readonly InputDefinition[] = [],
) {
  const base = {
    id: input.id,
    group: input.group,
    label: input.label,
    help: input.help,
    required,
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
  if (input.kind === "image_upload") {
    return {
      ...base,
      placeholder: null,
      kind: "image_upload" as const,
      maxSizeMb: input.maxSizeMb,
      maxLongSide: input.maxLongSide,
    };
  }
  if (input.kind === "video_upload") {
    return {
      ...base,
      placeholder: null,
      kind: "video_upload" as const,
      maxSizeMb: input.maxSizeMb,
      maxLongSide: input.maxLongSide,
      minDurationMs: input.minDurationMs,
      maxDurationMs: input.maxDurationMs,
      trimmable: input.trimmable,
    };
  }
  if (input.kind === "audio_upload") {
    return {
      ...base,
      placeholder: null,
      kind: "audio_upload" as const,
      maxSizeMb: input.maxSizeMb,
      minDurationMs: input.minDurationMs,
      maxDurationMs: input.maxDurationMs,
      trimmable: input.trimmable,
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
  if (input.kind === "points") {
    const widthValue =
      workflow[input.widthField.nodeId]?.inputs[input.widthField.field];
    const heightValue =
      workflow[input.heightField.nodeId]?.inputs[input.heightField.field];
    const widthInput = boundInputFor(input.widthField, formInputs);
    const heightInput = boundInputFor(input.heightField, formInputs);
    return {
      ...base,
      placeholder: null,
      kind: "points" as const,
      videoInputId: input.videoInputId,
      // issue #52: when the Mode shows a Number or Select Input bound
      // to the same field, the Workbench watches its live value
      // instead of this literal (an Admin's `widthField` is often one
      // these Inputs own).
      widthInputId: widthInput?.id ?? null,
      heightInputId: heightInput?.id ?? null,
      // issue #52 CEO review round 2: a Select Input's own value is an
      // option id, not the field's number — this is that option id's
      // -> value map, so the Workbench can resolve whichever's chosen.
      widthOptionValues: selectOptionValuesFor(input.widthField, widthInput),
      heightOptionValues: selectOptionValuesFor(input.heightField, heightInput),
      defaultWidth: typeof widthValue === "number" ? widthValue : null,
      defaultHeight: typeof heightValue === "number" ? heightValue : null,
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
          promptBindingFor(detail.inputs, detail.workflow),
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
        const { generations, prompt } = await submitGeneration(
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
          return c.json({ error: "storage_full", message: err.message }, 507);
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
  );

  return app;
}
