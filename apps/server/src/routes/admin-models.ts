// `/api/admin/models`: create a Model from a Workflow, list/edit/reorder/
// soft-delete and History (issue #40).

import {
  type CheckModelMode,
  MODEL_ATTRIBUTION_MAX_LENGTH,
  MODEL_TERMS_MAX_LENGTH,
  checkModel,
  hasBlockingErrors,
  isValidModelLicenseUrl,
  modelTermsFieldsSchema,
  parseApiFormatWorkflow,
  reviseModeInputSettings,
  toInputIssues,
} from "@ai-content-studio/shared";
import type {
  AssetKind,
  Clock,
  ComfyFieldSpec,
  InputDefinition,
} from "@ai-content-studio/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import { type ValidateReason, validate } from "../auth/validate.js";
import type { BackendRepository } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import type { Database } from "../db/client.js";
import { auditEntries } from "../db/schema.js";
import type { GenerationEvents } from "../generations/events.js";
import type { GenerationsRepository } from "../generations/repository.js";
import {
  InvalidInputValues,
  InvalidSeed,
  InvalidUploads,
} from "../generations/submission.js";
import {
  TestBackendNotAttached,
  TestModeHasErrors,
  TestModelNotFound,
  TestNoBackend,
  TestSubmissionStorageFull,
  submitTestGeneration,
} from "../generations/test-submission.js";
import { checkEnableReadiness } from "../models/enablement.js";
import { modelFiguresFor } from "../models/list-figures.js";
import { NotFound as BackendNotFound } from "../models/model-backends.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import {
  buildObjectInfo,
  toCheckModelBackends,
} from "../models/object-info.js";
import {
  IdTaken,
  NameTaken,
  NotFound,
  SlugTaken,
  StaleVersion,
  applyRebind,
  remapInputBindings,
} from "../models/repository.js";
import type {
  ModeInput,
  ModeRecord,
  ModelDraftInput,
  ModelExport,
  ModelRepository,
} from "../models/repository.js";
import { ValidationFailed } from "../models/validation.js";
import type { UploadsRepository } from "../uploads/repository.js";

/**
 * `outputNodeIds` plus each output node's saved classType, keyed by node
 * id (issue #71's rebind check): `checkModel` flags an output node whose
 * class changed since it was last resolved and saved.
 */
function checkModelOutputNodes(mode: ModeRecord) {
  return {
    outputNodeIds: mode.outputNodes.map((node) => node.nodeId),
    outputNodeClassTypes: Object.fromEntries(
      mode.outputNodes.map((node) => [node.nodeId, node.classType]),
    ),
  };
}

const createSchema = z.object({
  name: z.string(),
  workflow: z.unknown(),
});

const attachBackendSchema = z.object({
  backendId: z.string(),
});

const detailsSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  maxRunTimeMinutes: z.number(),
});

const versionSchema = z.coerce.number().int().min(1);

/** A revision number from the path: a positive integer. */
const revisionNumberSchema = z.coerce.number().int().min(1);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /:id's wire body is `version` plus the shared Details fields
 * (issue #168); built from `detailsSchema`'s shape so the field
 * semantics stay in one place and the typed `hc` client (see
 * `app-type.admin-models.test.ts`) matches the real body.
 */
const detailsUpdateSchema = z.object({
  version: versionSchema,
  ...detailsSchema.shape,
});

/** Same for PUT /:id/terms: `revision` plus the shared terms fields. */
const modelTermsUpdateSchema = z.object({
  revision: versionSchema,
  ...modelTermsFieldsSchema.shape,
});

/**
 * The wire body of enable/disable/restore is `version`; restore's
 * `disable` is not schema-validated (the handler only checks `=== true`),
 * so the gate leaves it out and the handler re-reads it.
 */
const versionOnlySchema = z.object({ version: versionSchema });

/** One Mode's setting for one Input (issue #48): hidden, optional, required, or fixed to a value. */
const modeInputSettingSchema = z.object({
  inputId: z.string().regex(UUID_RE, "inputId must be a UUID"),
  state: z.enum(["hidden", "optional", "required", "fixed"]),
  fixedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  label: z.string(),
});

const modesSchema = z.object({
  version: z.number().int().min(1),
  modes: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      outputNodeIds: z.array(z.string()),
      inputSettings: z.array(modeInputSettingSchema).default([]),
    }),
  ),
  /** Issue #49: an enabled Model with errors can only be saved by disabling it. */
  disable: z.boolean().optional(),
});

const bindingSchema = z.object({
  nodeId: z.string(),
  field: z.string(),
  classType: z.string(),
  title: z.string().nullable(),
});

const inputBaseSchema = {
  id: z.string().regex(UUID_RE, "id must be a UUID"),
  group: z.enum(["describe", "settings"]),
  label: z.string(),
  help: z.string(),
  bindings: z.array(bindingSchema),
};

const inputDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...inputBaseSchema,
    kind: z.literal("text"),
    multiline: z.boolean(),
    maxLength: z.number(),
    default: z.string(),
  }),
  z.object({
    ...inputBaseSchema,
    kind: z.literal("number"),
    numberMode: z.enum(["integer", "decimal"]),
    min: z.number(),
    max: z.number(),
    step: z.number(),
    default: z.number().nullable(),
  }),
  z.object({
    ...inputBaseSchema,
    kind: z.literal("image_upload"),
    maxSizeMb: z.number(),
    maxLongSide: z.number().nullable(),
  }),
  z.object({
    ...inputBaseSchema,
    kind: z.literal("video_upload"),
    maxSizeMb: z.number(),
    maxLongSide: z.number().nullable(),
    minDurationMs: z.number(),
    maxDurationMs: z.number(),
    trimmable: z.boolean(),
  }),
  z.object({
    ...inputBaseSchema,
    kind: z.literal("audio_upload"),
    maxSizeMb: z.number(),
    minDurationMs: z.number(),
    maxDurationMs: z.number(),
    trimmable: z.boolean(),
  }),
  z.object({
    ...inputBaseSchema,
    kind: z.literal("select"),
    options: z.array(
      z.object({
        id: z.string().regex(UUID_RE, "option id must be a UUID"),
        label: z.string(),
        values: z.array(
          z.union([z.string(), z.number(), z.boolean(), z.null()]),
        ),
      }),
    ),
    default: z.string().nullable(),
  }),
  z.object({
    ...inputBaseSchema,
    kind: z.literal("seed"),
    max: z.number().nullable(),
  }),
  z.object({
    ...inputBaseSchema,
    kind: z.literal("points"),
    videoInputId: z.string().regex(UUID_RE, "videoInputId must be a UUID"),
    widthField: z.object({ nodeId: z.string(), field: z.string() }),
    heightField: z.object({ nodeId: z.string(), field: z.string() }),
  }),
]);

const inputsSchema = z.object({
  version: z.number().int().min(1),
  inputs: z.array(inputDefinitionSchema),
  /** Issue #49: an enabled Model with errors can only be saved by disabling it. */
  disable: z.boolean().optional(),
});

/** One node-id repoint, in the same PUT as a Workflow replace (issue #71's rebind picker). */
const rebindEntrySchema = z.object({
  nodeId: z.string(),
  newNodeId: z.string(),
});

/**
 * The header Save's one PUT (issue #218): the whole editor draft —
 * Details, Terms, an optional re-uploaded Workflow, Inputs and Modes —
 * reusing each section's own schema shape so the wire body matches
 * what each section's own route already validates.
 */
const draftSchema = z.object({
  version: versionSchema,
  details: detailsSchema,
  terms: modelTermsFieldsSchema,
  workflow: z
    .object({
      json: z.unknown(),
      rebind: z.array(rebindEntrySchema).optional(),
    })
    .optional(),
  inputs: z.array(inputDefinitionSchema),
  modes: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      outputNodeIds: z.array(z.string()),
      inputSettings: z.array(modeInputSettingSchema).default([]),
    }),
  ),
  disable: z.boolean(),
});

/** Issue #74: a Test runs the editor's own unsaved draft Mode and Inputs, so the body carries them whole rather than a saved revision's id. */
const testSchema = z.object({
  mode: z.object({
    name: z.string(),
    description: z.string(),
    outputNodeIds: z.array(z.string()),
    inputSettings: z.array(modeInputSettingSchema).default([]),
  }),
  inputs: z.array(inputDefinitionSchema),
  values: z.record(z.string(), z.unknown()),
  /** A specific attached Backend's id, or null for Any. */
  backendId: z.string().regex(UUID_RE).nullable(),
});

const resolvedOutputNodeSchema = z.object({
  nodeId: z.string(),
  classType: z.string(),
  title: z.string().nullable(),
  kind: z
    .enum(["video", "image", "audio"])
    .nullable() satisfies z.ZodType<AssetKind | null>,
});

const exportModeSchema = z.object({
  id: z.string().regex(UUID_RE),
  sortOrder: z.number().int(),
  name: z.string(),
  description: z.string(),
  outputNodes: z.array(resolvedOutputNodeSchema),
  inputSettings: z.array(modeInputSettingSchema),
});

/** A Model export file (issue #73): accepted back on import. */
const modelExportSchema = z.object({
  exportVersion: z.literal(1),
  id: z.string().regex(UUID_RE),
  name: z.string().min(1).max(80),
  slug: z.string(),
  description: z.string(),
  maxRunTimeMinutes: z.number(),
  termsBody: z.string().max(MODEL_TERMS_MAX_LENGTH),
  licenseUrl: z
    .string()
    .max(2000)
    .refine(isValidModelLicenseUrl, { message: "must be an http(s) URL" }),
  attribution: z.string().max(MODEL_ATTRIBUTION_MAX_LENGTH),
  revisionNumber: z.number().int(),
  workflow: z.unknown(),
  inputs: z.array(inputDefinitionSchema),
  modes: z.array(exportModeSchema),
});

function exportResponse(file: ModelExport): Response {
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${file.slug}-rev${file.revisionNumber}.json"`,
    },
  });
}

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

/**
 * The shared `onInvalid` of the gated routes (issue #168): it re-runs
 * the exact checks the routes used before the conversion, in the exact
 * same order — unreadable or `null` body, then (where the route has
 * one) `version`/`revision`, then the shared body schema — so every 400
 * body stays byte-for-byte what it answered before the conversion.
 */
async function onInvalidModelBody(
  c: Context<AppEnv>,
  reason: ValidateReason,
  versionGate: { field: "version" | "revision"; error: string } | null,
  fieldsSchema: z.ZodType | null,
  includeIssues: boolean,
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

  if (versionGate) {
    const versionResult = versionSchema.safeParse(body[versionGate.field]);
    if (!versionResult.success) {
      return c.json({ error: versionGate.error }, 400);
    }
  }

  if (fieldsSchema) {
    const parsed = fieldsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        includeIssues
          ? { error: "invalid input", issues: parsed.error.issues }
          : { error: "invalid input" },
        400,
      );
    }
  }

  // The gate only rejects a body one of the checks above rejects.
  if (fieldsSchema) {
    return c.json(
      includeIssues
        ? { error: "invalid input", issues: [] }
        : { error: "invalid input" },
      400,
    );
  }
  // A version-only body: its only stage is the version check, so the
  // fallback mirrors that stage's 400.
  return c.json({ error: versionGate?.error }, 400);
}

export function adminModelsRoute(
  db: Database,
  clock: Clock,
  repository: ModelRepository,
  modelBackends: ModelBackendsRepository,
  backendRepository: BackendRepository,
  backendsService: BackendsService,
  generationsRepository: GenerationsRepository,
  routes: RouteEntry[],
  /** Issue #50: the ceiling on an Image Upload Input's max size. */
  maxUploadMb?: number,
  /** Issue #74: wired only when the caller wants `/:id/test` enabled (every production caller does). */
  testDeps?: {
    generationEvents: GenerationEvents;
    clock: Clock;
    uploadsRepository: UploadsRepository;
    hasFreeDisk: () => Promise<boolean>;
    wakeDispatcher: () => void;
  },
) {
  const basePath = "/api/admin/models";

  return (
    new Hono<AppEnv>()
      .get("/", guard(routes, basePath, "get", "/", "admin"), async (c) => {
        const [list, backendList] = await Promise.all([
          repository.list(),
          backendRepository.list(),
        ]);
        const figures = await modelFiguresFor(
          db,
          clock,
          list,
          backendList,
          backendsService,
        );
        const models = list.map((model) => {
          const stats = figures.get(model.id);
          return {
            ...model,
            modeCount: stats?.modeCount ?? 0,
            backends: {
              usable: stats?.usableBackends ?? 0,
              attached: stats?.attachedBackends ?? 0,
            },
            modesWithoutBackend: stats?.modesWithoutBackend ?? [],
            queued: stats?.queued ?? 0,
            running: stats?.running ?? 0,
          };
        });
        return c.json({ models });
      })
      .post(
        "/",
        guard(routes, basePath, "post", "/", "admin"),
        validate("json", createSchema, (c, reason) =>
          onInvalidModelBody(c, reason, null, createSchema, true),
        ),
        async (c) => {
          const { name, workflow } = c.req.valid("json");

          try {
            const { record, outsideServiceNotes } =
              await repository.createFromWorkflow(
                name,
                workflow,
                adminActorFrom(c),
              );
            return c.json({ model: record, outsideServiceNotes }, 201);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )

      // Issue #73: imports a Model moved from another studio as one exported
      // JSON file, always landing as a fresh, disabled Model at revision 1.
      .post(
        "/import",
        guard(routes, basePath, "post", "/import", "admin"),
        async (c) => {
          const body = await readJsonBody(c);
          if (body === null) return c.json({ error: "invalid JSON body" }, 400);

          const parsed = modelExportSchema.safeParse(body);
          if (!parsed.success)
            return c.json(
              { error: "invalid input", issues: parsed.error.issues },
              400,
            );

          try {
            const { record, outsideServiceNotes } =
              await repository.importModel(
                parsed.data as ModelExport,
                adminActorFrom(c),
              );
            return c.json({ model: record, outsideServiceNotes }, 201);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .get(
        "/:id",
        guard(routes, basePath, "get", "/:id", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const detail = await repository.get(id);
          if (!detail) return c.json({ error: "not found" }, 404);
          return c.json(detail);
        },
      )
      .put(
        "/:id",
        guard(routes, basePath, "put", "/:id", "admin"),
        requireUuidId,
        validate("json", detailsUpdateSchema, (c, reason) =>
          onInvalidModelBody(
            c,
            reason,
            { field: "version", error: "version is required" },
            detailsSchema,
            true,
          ),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const { version, name, slug, description, maxRunTimeMinutes } =
            c.req.valid("json");

          try {
            const record = await repository.updateDetails(
              id,
              { name, slug, description, maxRunTimeMinutes },
              version,
              adminActorFrom(c),
            );
            return c.json(record);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .put(
        "/:id/terms",
        guard(routes, basePath, "put", "/:id/terms", "admin"),
        requireUuidId,
        validate("json", modelTermsUpdateSchema, (c, reason) =>
          onInvalidModelBody(
            c,
            reason,
            { field: "revision", error: "revision is required" },
            modelTermsFieldsSchema,
            true,
          ),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const { revision, termsBody, licenseUrl, attribution, askAgain } =
            c.req.valid("json");

          try {
            const record = await repository.updateTerms(
              id,
              { termsBody, licenseUrl, attribution, askAgain },
              revision,
              adminActorFrom(c),
            );
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

          if (await generationsRepository.hasUnfinishedForModel(id)) {
            return c.json({ error: "has unfinished Generations" }, 409);
          }

          try {
            await repository.softDelete(
              id,
              versionResult.data,
              adminActorFrom(c),
            );
            return c.body(null, 204);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .post(
        "/:id/move-up",
        guard(routes, basePath, "post", "/:id/move-up", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          try {
            await repository.reorder(id, "up", adminActorFrom(c));
          } catch (err) {
            return handleError(c, err);
          }
          return c.json({ models: await repository.list() });
        },
      )
      .post(
        "/:id/move-down",
        guard(routes, basePath, "post", "/:id/move-down", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          try {
            await repository.reorder(id, "down", adminActorFrom(c));
          } catch (err) {
            return handleError(c, err);
          }
          return c.json({ models: await repository.list() });
        },
      )
      .get(
        "/:id/backends",
        guard(routes, basePath, "get", "/:id/backends", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const detail = await repository.get(id);
          if (!detail) return c.json({ error: "not found" }, 404);

          const classTypes = [
            ...new Set(detail.nodes.map((node) => node.classType)),
          ];
          const attached = await modelBackends.listForModel(id);

          const backends = await Promise.all(
            attached.map(async (backend) => {
              const nodeTypes = await backendsService.nodeTypesFor(backend);
              if (nodeTypes === null) {
                return {
                  backend,
                  reachable: false,
                  missingNodeTypes: null,
                  note: "unreachable; can't check for missing node types",
                };
              }
              return {
                backend,
                reachable: true,
                missingNodeTypes: classTypes.filter((ct) => !nodeTypes.has(ct)),
                note: null,
              };
            }),
          );

          return c.json({ backends });
        },
      )
      .get(
        "/:id/object-info",
        guard(routes, basePath, "get", "/:id/object-info", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const attached = await modelBackends.listForModel(id);
          const backends = await buildObjectInfo(attached, backendsService);
          return c.json({ backends });
        },
      )
      .post(
        "/:id/backends",
        guard(routes, basePath, "post", "/:id/backends", "admin"),
        requireUuidId,
        validate("json", attachBackendSchema, (c, reason) =>
          onInvalidModelBody(c, reason, null, attachBackendSchema, false),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const { backendId } = c.req.valid("json");
          if (!UUID_RE.test(backendId))
            return c.json({ error: "not found" }, 404);

          try {
            await modelBackends.attach(id, backendId, adminActorFrom(c));
          } catch (err) {
            return handleError(c, err);
          }
          return c.body(null, 204);
        },
      )
      .delete(
        "/:id/backends/:backendId",
        guard(routes, basePath, "delete", "/:id/backends/:backendId", "admin"),
        async (c) => {
          const id = idParam(c);
          const backendId = c.req.param("backendId");
          if (!backendId) throw new Error("backendId param missing");
          if (!UUID_RE.test(id) || !UUID_RE.test(backendId))
            return c.json({ error: "not found" }, 404);

          try {
            await modelBackends.detach(id, backendId, adminActorFrom(c));
          } catch (err) {
            return handleError(c, err);
          }
          return c.body(null, 204);
        },
      )
      .put(
        "/:id/modes",
        guard(routes, basePath, "put", "/:id/modes", "admin"),
        requireUuidId,
        validate("json", modesSchema, (c, reason) =>
          onInvalidModelBody(c, reason, null, modesSchema, true),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const { version, modes, disable } = c.req.valid("json");

          const detail = await repository.get(id);
          if (!detail) return c.json({ error: "not found" }, 404);

          // Issue #49: an enabled Model with errors can only be saved by
          // disabling it in the same request.
          if (detail.model.state === "enabled" && !disable) {
            const attached = await modelBackends.listForModel(id);
            const objectInfo = toCheckModelBackends(
              await buildObjectInfo(attached, backendsService),
            );
            const issues = checkModel(
              {
                workflow: detail.workflow,
                inputs: detail.inputs,
                modes: modes.map((mode, index) => ({
                  id: String(index),
                  name: mode.name,
                  outputNodeIds: mode.outputNodeIds,
                  inputSettings: mode.inputSettings,
                })) satisfies CheckModelMode[],
              },
              objectInfo,
            );
            if (hasBlockingErrors(issues)) {
              return c.json(
                {
                  error: "has errors; disable this Model to save it anyway",
                  reasons: issues
                    .filter((issue) => issue.severity === "error")
                    .map((issue) => issue.message),
                },
                400,
              );
            }
          }

          try {
            const result = await repository.updateModes(
              id,
              modes as ModeInput[],
              version,
              adminActorFrom(c),
            );
            if (disable) {
              const record = await repository.setState(
                id,
                "disabled",
                result.record.version,
                adminActorFrom(c),
              );
              return c.json({ ...result, record });
            }
            return c.json(result);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .put(
        "/:id/inputs",
        guard(routes, basePath, "put", "/:id/inputs", "admin"),
        requireUuidId,
        validate("json", inputsSchema, (c, reason) =>
          onInvalidModelBody(c, reason, null, inputsSchema, true),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const { version, inputs, disable } = c.req.valid("json");

          const detail = await repository.get(id);
          if (!detail) return c.json({ error: "not found" }, 404);

          try {
            const attached = await modelBackends.listForModel(id);
            const specsByBackend = await Promise.all(
              attached.map((backend) => backendsService.fieldSpecsFor(backend)),
            );
            const fieldSpecs = new Map<
              string,
              Record<string, ComfyFieldSpec>
            >();
            for (const specs of specsByBackend) {
              if (!specs) continue;
              for (const [classType, fields] of specs) {
                fieldSpecs.set(classType, {
                  ...fieldSpecs.get(classType),
                  ...fields,
                });
              }
            }

            // Issue #49: an enabled Model with errors can only be saved by
            // disabling it in the same request. Carries each Mode's Input
            // settings forward the same way `updateInputs` itself does, so
            // this precheck matches what actually gets saved.
            if (detail.model.state === "enabled" && !disable) {
              const objectInfo = toCheckModelBackends(
                await buildObjectInfo(attached, backendsService),
              );
              const issues = checkModel(
                {
                  workflow: detail.workflow,
                  inputs: inputs as InputDefinition[],
                  modes: detail.modes.map((mode) => ({
                    id: mode.id,
                    name: mode.name,
                    ...checkModelOutputNodes(mode),
                    inputSettings: reviseModeInputSettings(
                      mode.inputSettings,
                      inputs as InputDefinition[],
                    ),
                  })) satisfies CheckModelMode[],
                },
                objectInfo,
              );
              if (hasBlockingErrors(issues)) {
                return c.json(
                  {
                    error: "has errors; disable this Model to save it anyway",
                    reasons: issues
                      .filter((issue) => issue.severity === "error")
                      .map((issue) => issue.message),
                  },
                  400,
                );
              }
            }

            const result = await repository.updateInputs(
              id,
              inputs as InputDefinition[],
              version,
              adminActorFrom(c),
              fieldSpecs,
              maxUploadMb,
            );
            if (disable) {
              const record = await repository.setState(
                id,
                "disabled",
                result.record.version,
                adminActorFrom(c),
              );
              return c.json({ ...result, record });
            }
            return c.json(result);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .post(
        "/:id/enable",
        guard(routes, basePath, "post", "/:id/enable", "admin"),
        requireUuidId,
        validate("json", versionOnlySchema, (c, reason) =>
          onInvalidModelBody(
            c,
            reason,
            { field: "version", error: "version is required" },
            null,
            false,
          ),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const { version } = c.req.valid("json");

          const detail = await repository.get(id);
          if (!detail) return c.json({ error: "not found" }, 404);

          const attached = await modelBackends.listForModel(id);
          const readiness = await checkEnableReadiness(
            detail,
            attached,
            backendsService,
          );

          // Issue #49: checkModel's errors block enabling too, not just
          // saving an already-enabled Model — otherwise the API (or a stale
          // tab) could enable a Model checkModel itself calls broken.
          const objectInfo = toCheckModelBackends(
            await buildObjectInfo(attached, backendsService),
          );
          const issues = checkModel(
            {
              workflow: detail.workflow,
              inputs: detail.inputs,
              modes: detail.modes.map((mode) => ({
                id: mode.id,
                name: mode.name,
                ...checkModelOutputNodes(mode),
                inputSettings: mode.inputSettings,
              })) satisfies CheckModelMode[],
            },
            objectInfo,
          );
          const checkModelReasons = issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.message);

          const reasons = [...readiness.reasons, ...checkModelReasons];
          if (reasons.length > 0) {
            return c.json({ error: "not ready", reasons }, 400);
          }

          try {
            const record = await repository.setState(
              id,
              "enabled",
              version,
              adminActorFrom(c),
            );
            return c.json(record);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .post(
        "/:id/disable",
        guard(routes, basePath, "post", "/:id/disable", "admin"),
        requireUuidId,
        validate("json", versionOnlySchema, (c, reason) =>
          onInvalidModelBody(
            c,
            reason,
            { field: "version", error: "version is required" },
            null,
            false,
          ),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const { version } = c.req.valid("json");

          try {
            const record = await repository.setState(
              id,
              "disabled",
              version,
              adminActorFrom(c),
            );
            return c.json(record);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .put(
        "/:id/workflow",
        guard(routes, basePath, "put", "/:id/workflow", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const body = await readJsonBody(c);
          if (body === null) return c.json({ error: "invalid JSON body" }, 400);

          const versionResult = versionSchema.safeParse(body.version);
          if (!versionResult.success)
            return c.json({ error: "version is required" }, 400);

          const rebindResult = z
            .array(rebindEntrySchema)
            .optional()
            .safeParse(body.rebind);
          if (!rebindResult.success)
            return c.json({ error: "invalid input" }, 400);
          const rebind = rebindResult.data;

          const disable = body.disable === true;

          const detail = await repository.get(id);
          if (!detail) return c.json({ error: "not found" }, 404);

          const attached = await modelBackends.listForModel(id);
          const specsByBackend = await Promise.all(
            attached.map((backend) => backendsService.fieldSpecsFor(backend)),
          );
          const fieldSpecs = new Map<string, Record<string, ComfyFieldSpec>>();
          for (const specs of specsByBackend) {
            if (!specs) continue;
            for (const [classType, fields] of specs) {
              fieldSpecs.set(classType, {
                ...fieldSpecs.get(classType),
                ...fields,
              });
            }
          }

          // Issue #71: re-uploading the Workflow keeps every Mode's output
          // nodes and every Input's bindings exactly as they were, by node
          // id; this is the same "errors block saving an enabled Model"
          // gate the Modes/Inputs routes run, checked against the proposed
          // new Workflow before it's persisted. A `rebind` (CEO review) is
          // previewed here with the exact same `applyRebind` the repository
          // uses for the real save, so a rebind that fixes everything
          // doesn't need "disable" too, and the two can't disagree on what
          // a rebind actually touched (round-3 CEO review).
          if (detail.model.state === "enabled" && !disable) {
            const parsed = parseApiFormatWorkflow(body.workflow);
            if (parsed.ok) {
              const objectInfo = toCheckModelBackends(
                await buildObjectInfo(attached, backendsService),
              );
              const rebound =
                rebind && rebind.length > 0
                  ? applyRebind(
                      parsed.workflow,
                      detail.modes,
                      detail.inputs,
                      rebind,
                      fieldSpecs,
                      maxUploadMb,
                    )
                  : { modes: detail.modes, inputs: detail.inputs, errors: [] };
              if (rebound.errors.length > 0) {
                return c.json(
                  {
                    error: "has errors; disable this Model to save it anyway",
                    reasons: rebound.errors.map((e) => e.message),
                  },
                  400,
                );
              }
              const issues = checkModel(
                {
                  workflow: parsed.workflow,
                  inputs: rebound.inputs,
                  modes: rebound.modes.map((mode) => ({
                    id: mode.id,
                    name: mode.name,
                    ...checkModelOutputNodes(mode),
                    inputSettings: mode.inputSettings,
                  })) satisfies CheckModelMode[],
                },
                objectInfo,
              );
              if (hasBlockingErrors(issues)) {
                return c.json(
                  {
                    error: "has errors; disable this Model to save it anyway",
                    reasons: issues
                      .filter((issue) => issue.severity === "error")
                      .map((issue) => issue.message),
                  },
                  400,
                );
              }
            }
            // An invalid Workflow falls through to `uploadWorkflow` below,
            // which reports the real parse/validation error.
          }

          try {
            const result = await repository.uploadWorkflow(
              id,
              body.workflow,
              versionResult.data,
              adminActorFrom(c),
              rebind,
              fieldSpecs,
              maxUploadMb,
            );
            if (disable) {
              const record = await repository.setState(
                id,
                "disabled",
                result.record.version,
                adminActorFrom(c),
              );
              return c.json({ ...result, record });
            }
            return c.json(result);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      // Issue #218: the editor header's one Save, replacing the separate
      // per-section PUTs it used to chain (#213) with one PUT that saves
      // the whole draft as one revision and one audit entry.
      .put(
        "/:id/draft",
        guard(routes, basePath, "put", "/:id/draft", "admin"),
        requireUuidId,
        validate("json", draftSchema, (c, reason) =>
          onInvalidModelBody(
            c,
            reason,
            { field: "version", error: "version is required" },
            draftSchema,
            true,
          ),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const { version, details, terms, workflow, inputs, modes, disable } =
            c.req.valid("json");

          const detail = await repository.get(id);
          if (!detail) return c.json({ error: "not found" }, 404);

          try {
            const attached = await modelBackends.listForModel(id);
            const specsByBackend = await Promise.all(
              attached.map((backend) => backendsService.fieldSpecsFor(backend)),
            );
            const fieldSpecs = new Map<
              string,
              Record<string, ComfyFieldSpec>
            >();
            for (const specs of specsByBackend) {
              if (!specs) continue;
              for (const [classType, fields] of specs) {
                fieldSpecs.set(classType, {
                  ...fieldSpecs.get(classType),
                  ...fields,
                });
              }
            }

            // Issue #49: an enabled Model with errors can only be saved
            // by disabling it, checked against the whole proposed draft
            // (a re-uploaded Workflow included) the same way the
            // Modes/Inputs/Workflow routes each check their own section.
            if (detail.model.state === "enabled" && !disable) {
              let proposedWorkflow = detail.workflow;
              if (workflow) {
                const parsed = parseApiFormatWorkflow(workflow.json);
                if (parsed.ok) proposedWorkflow = parsed.workflow;
              }
              const rebindMap = new Map(
                (workflow?.rebind ?? []).map((r) => [r.nodeId, r.newNodeId]),
              );
              const proposedModes = modes.map((mode, index) => ({
                id: String(index),
                name: mode.name,
                outputNodeIds: mode.outputNodeIds.map(
                  (nodeId) => rebindMap.get(nodeId) ?? nodeId,
                ),
                inputSettings: mode.inputSettings,
              })) satisfies CheckModelMode[];
              const proposedInputs = remapInputBindings(
                inputs as InputDefinition[],
                rebindMap,
                proposedWorkflow,
              );

              const objectInfo = toCheckModelBackends(
                await buildObjectInfo(attached, backendsService),
              );
              const issues = checkModel(
                {
                  workflow: proposedWorkflow,
                  inputs: proposedInputs,
                  modes: proposedModes,
                },
                objectInfo,
              );
              if (hasBlockingErrors(issues)) {
                return c.json(
                  {
                    error: "has errors; disable this Model to save it anyway",
                    reasons: issues
                      .filter((issue) => issue.severity === "error")
                      .map((issue) => issue.message),
                  },
                  400,
                );
              }
            }

            const draft: ModelDraftInput = {
              details,
              terms,
              ...(workflow ? { workflow } : {}),
              inputs: inputs as InputDefinition[],
              modes: modes as ModeInput[],
              disable: disable === true,
            };
            const result = await repository.saveDraft(
              id,
              draft,
              version,
              adminActorFrom(c),
              fieldSpecs,
              maxUploadMb,
            );
            return c.json(result);
          } catch (err) {
            return handleError(c, err);
          }
        },
      )
      .get(
        "/:id/revisions",
        guard(routes, basePath, "get", "/:id/revisions", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const revisions = await repository.listRevisions(id);
          return c.json({ revisions });
        },
      )

      // Issue #73: from the editor header, exporting the current revision.
      .get(
        "/:id/export",
        guard(routes, basePath, "get", "/:id/export", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const file = await repository.exportRevision(id);
          if (!file) return c.json({ error: "not found" }, 404);
          return exportResponse(file);
        },
      )

      // Issue #73: from the Revisions section, exporting one specific revision.
      .get(
        "/:id/revisions/:number/export",
        guard(
          routes,
          basePath,
          "get",
          "/:id/revisions/:number/export",
          "admin",
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const numberResult = revisionNumberSchema.safeParse(
            c.req.param("number"),
          );
          if (!numberResult.success) return c.json({ error: "not found" }, 404);

          const file = await repository.exportRevision(id, numberResult.data);
          if (!file) return c.json({ error: "not found" }, 404);
          return exportResponse(file);
        },
      )
      .post(
        "/:id/revisions/:number/restore",
        guard(
          routes,
          basePath,
          "post",
          "/:id/revisions/:number/restore",
          "admin",
        ),
        // The id and revision-number checks run before the body gate: the
        // pre-conversion route checked them first (issue #168).
        async (c, next) => {
          const id = c.req.param("id");
          if (!id || !UUID_RE.test(id)) {
            return c.json({ error: "not found" }, 404);
          }
          const numberResult = revisionNumberSchema.safeParse(
            c.req.param("number"),
          );
          if (!numberResult.success) {
            return c.json({ error: "not found" }, 404);
          }
          return next();
        },
        validate("json", versionOnlySchema, (c, reason) =>
          onInvalidModelBody(
            c,
            reason,
            { field: "version", error: "version is required" },
            null,
            false,
          ),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

          const numberResult = revisionNumberSchema.safeParse(
            c.req.param("number"),
          );
          if (!numberResult.success) return c.json({ error: "not found" }, 404);

          const { version } = c.req.valid("json");

          // `disable` is not part of the gate: the pre-conversion route only
          // checked `body.disable === true`, never a schema.
          const body = await readJsonBody(c);
          const disable = body?.disable === true;

          const detail = await repository.get(id);
          if (!detail) return c.json({ error: "not found" }, 404);

          const target = await repository.getRevisionDetail(
            id,
            numberResult.data,
          );
          if (!target) return c.json({ error: "not found" }, 404);

          // Issue #71: "Restore inserts a copy through the same checks" —
          // the restored state is run through the same enabled-Model gate a
          // normal Modes/Inputs save is, offering "Restore and disable"
          // when it still has errors (e.g. a Backend attached since that
          // old revision was current no longer covers it). A restored Seed
          // Input with no max is refused the same way `updateInputs` refuses
          // one (ADR 0007): checkModel itself doesn't carry that rule.
          if (detail.model.state === "enabled" && !disable) {
            const seedReasons = target.inputs
              .filter((def) => def.kind === "seed" && def.max === null)
              .map(
                (def) =>
                  `Seed Input "${def.label}" needs a max while the Model is enabled`,
              );

            const attached = await modelBackends.listForModel(id);
            const objectInfo = toCheckModelBackends(
              await buildObjectInfo(attached, backendsService),
            );
            const issues = checkModel(
              {
                workflow: target.workflow,
                inputs: target.inputs,
                modes: target.modes.map((mode) => ({
                  id: mode.id,
                  name: mode.name,
                  ...checkModelOutputNodes(mode),
                  inputSettings: mode.inputSettings,
                })) satisfies CheckModelMode[],
              },
              objectInfo,
            );
            const reasons = [
              ...seedReasons,
              ...issues
                .filter((issue) => issue.severity === "error")
                .map((issue) => issue.message),
            ];
            if (reasons.length > 0) {
              return c.json(
                {
                  error:
                    "has errors; restore and disable this Model to save it anyway",
                  reasons,
                },
                400,
              );
            }
          }

          try {
            const result = await repository.restoreRevision(
              id,
              numberResult.data,
              version,
              adminActorFrom(c),
            );
            if (disable) {
              const record = await repository.setState(
                id,
                "disabled",
                result.record.version,
                adminActorFrom(c),
              );
              return c.json({ ...result, record });
            }
            return c.json(result);
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
                eq(auditEntries.targetType, "model"),
                eq(auditEntries.targetId, id),
              ),
            )
            .orderBy(desc(auditEntries.createdAt));
          return c.json({ entries });
        },
      )

      // Issue #74: runs one Generation of the editor's own unsaved draft
      // Mode and Inputs, on an unnumbered revision that never becomes
      // current. Bypasses Pause, a disabled Model, Caps and Model terms;
      // still blocked while the Mode has a `checkModel` error.
      .post(
        "/:id/test",
        guard(routes, basePath, "post", "/:id/test", "admin"),
        // The id, test-deps and session checks run before the body gate:
        // the pre-conversion route checked them first (issue #168).
        async (c, next) => {
          const id = c.req.param("id");
          if (!id || !UUID_RE.test(id)) {
            return c.json({ error: "not found" }, 404);
          }
          if (!testDeps) {
            return c.json({ error: "not available" }, 501);
          }
          const session = c.get("session");
          if (!session) {
            return c.json({ error: "unauthorized" }, 401);
          }
          return next();
        },
        validate("json", testSchema, (c, reason) =>
          onInvalidModelBody(c, reason, null, testSchema, true),
        ),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);
          if (!testDeps) return c.json({ error: "not available" }, 501);

          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);

          const { mode, inputs, values, backendId } = c.req.valid("json");

          try {
            const { generation, prompt } = await submitTestGeneration(
              {
                modelId: id,
                userId: session.user.id,
                mode,
                inputs: inputs as InputDefinition[],
                values,
                backendId,
              },
              {
                modelRepository: repository,
                modelBackendsRepository: modelBackends,
                backendsService,
                generationsRepository,
                generationEvents: testDeps.generationEvents,
                clock: testDeps.clock,
                uploadsRepository: testDeps.uploadsRepository,
                hasFreeDisk: testDeps.hasFreeDisk,
                onGenerationQueued: testDeps.wakeDispatcher,
              },
            );
            return c.json({ generation, prompt }, 201);
          } catch (err) {
            if (err instanceof TestModelNotFound) {
              return c.json({ error: "not found" }, 404);
            }
            if (err instanceof TestModeHasErrors) {
              return c.json(
                { error: "mode_has_errors", reasons: err.reasons },
                400,
              );
            }
            if (err instanceof TestBackendNotAttached) {
              return c.json({ error: err.message }, 400);
            }
            if (err instanceof TestNoBackend) {
              return c.json({ error: "no_backend", message: err.message }, 400);
            }
            if (err instanceof TestSubmissionStorageFull) {
              return c.json(
                { error: "storage_full", message: err.message },
                507,
              );
            }
            if (err instanceof InvalidUploads) {
              return c.json({ error: "invalid", issues: err.issues }, 400);
            }
            if (err instanceof InvalidInputValues) {
              return c.json(
                { error: "invalid", issues: toInputIssues(err.zodError) },
                400,
              );
            }
            if (err instanceof InvalidSeed) {
              return c.json(
                { error: "invalid_seed", message: err.message },
                400,
              );
            }
            return handleError(c, err);
          }
        },
      )

      // Issue #74's AC: "the last 5 tests are listed".
      .get(
        "/:id/tests",
        guard(routes, basePath, "get", "/:id/tests", "admin"),
        async (c) => {
          const id = idParam(c);
          if (!UUID_RE.test(id)) return c.json({ tests: [] });

          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);

          const tests = await generationsRepository.listRecentTestsForModel(
            id,
            session.user.id,
            5,
          );
          return c.json({ tests });
        },
      )
  );
}

function handleError(c: Context<AppEnv>, err: unknown) {
  if (err instanceof ValidationFailed)
    return c.json({ errors: err.errors }, 400);
  if (err instanceof NameTaken) return c.json({ error: err.message }, 409);
  if (err instanceof SlugTaken) return c.json({ error: err.message }, 409);
  if (err instanceof IdTaken) return c.json({ error: err.message }, 409);
  if (err instanceof StaleVersion) return c.json({ error: err.message }, 409);
  if (err instanceof NotFound) return c.json({ error: err.message }, 404);
  if (err instanceof BackendNotFound)
    return c.json({ error: err.message }, 404);
  throw err;
}
