// `/api/admin/models`: create a Model from a Workflow, list/edit/reorder/
// soft-delete and History (issue #40).

import { modelTermsFieldsSchema } from "@ai-content-studio/shared";
import type {
  ComfyFieldSpec,
  InputDefinition,
} from "@ai-content-studio/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { adminActorFrom } from "../audit/actor.js";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { BackendsService } from "../backends/service.js";
import type { Database } from "../db/client.js";
import { auditEntries } from "../db/schema.js";
import type { GenerationsRepository } from "../generations/repository.js";
import { checkEnableReadiness } from "../models/enablement.js";
import { NotFound as BackendNotFound } from "../models/model-backends.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import {
  NameTaken,
  NotFound,
  SlugTaken,
  StaleVersion,
} from "../models/repository.js";
import type { ModeInput, ModelRepository } from "../models/repository.js";
import { ValidationFailed } from "../models/validation.js";

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

const modesSchema = z.object({
  version: z.number().int().min(1),
  modes: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      outputNodeIds: z.array(z.string()),
    }),
  ),
});

const bindingSchema = z.object({
  nodeId: z.string(),
  field: z.string(),
  classType: z.string(),
  title: z.string().nullable(),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
]);

const inputsSchema = z.object({
  version: z.number().int().min(1),
  inputs: z.array(inputDefinitionSchema),
});

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
  modelBackends: ModelBackendsRepository,
  backendsService: BackendsService,
  generationsRepository: GenerationsRepository,
  routes: RouteEntry[],
  /** Issue #50: the ceiling on an Image Upload Input's max size. */
  maxUploadMb?: number,
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

  guardedRoute(
    app,
    routes,
    basePath,
    "put",
    "/:id/terms",
    "admin",
    async (c) => {
      const id = idParam(c);
      if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

      const body = await readJsonBody(c);
      if (body === null) return c.json({ error: "invalid JSON body" }, 400);

      const revisionResult = versionSchema.safeParse(body.revision);
      if (!revisionResult.success)
        return c.json({ error: "revision is required" }, 400);

      const fieldsResult = modelTermsFieldsSchema.safeParse(body);
      if (!fieldsResult.success)
        return c.json(
          { error: "invalid input", issues: fieldsResult.error.issues },
          400,
        );

      try {
        const record = await repository.updateTerms(
          id,
          fieldsResult.data,
          revisionResult.data,
          adminActorFrom(c),
        );
        return c.json(record);
      } catch (err) {
        return handleError(c, err);
      }
    },
  );

  guardedRoute(app, routes, basePath, "delete", "/:id", "admin", async (c) => {
    const id = idParam(c);
    if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

    const versionResult = versionSchema.safeParse(c.req.query("version"));
    if (!versionResult.success)
      return c.json({ error: "version is required" }, 400);

    if (await generationsRepository.hasUnfinishedForModel(id)) {
      return c.json({ error: "has unfinished Generations" }, 409);
    }

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
    "/:id/backends",
    "admin",
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
  );

  guardedRoute(
    app,
    routes,
    basePath,
    "post",
    "/:id/backends",
    "admin",
    async (c) => {
      const id = idParam(c);
      if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

      const body = await readJsonBody(c);
      if (body === null) return c.json({ error: "invalid JSON body" }, 400);

      const parsed = attachBackendSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: "invalid input" }, 400);
      if (!UUID_RE.test(parsed.data.backendId))
        return c.json({ error: "not found" }, 404);

      try {
        await modelBackends.attach(
          id,
          parsed.data.backendId,
          adminActorFrom(c),
        );
      } catch (err) {
        return handleError(c, err);
      }
      return c.body(null, 204);
    },
  );

  guardedRoute(
    app,
    routes,
    basePath,
    "delete",
    "/:id/backends/:backendId",
    "admin",
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
  );

  guardedRoute(
    app,
    routes,
    basePath,
    "put",
    "/:id/modes",
    "admin",
    async (c) => {
      const id = idParam(c);
      if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

      const body = await readJsonBody(c);
      if (body === null) return c.json({ error: "invalid JSON body" }, 400);

      const parsed = modesSchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { error: "invalid input", issues: parsed.error.issues },
          400,
        );

      try {
        const result = await repository.updateModes(
          id,
          parsed.data.modes as ModeInput[],
          parsed.data.version,
          adminActorFrom(c),
        );
        return c.json(result);
      } catch (err) {
        return handleError(c, err);
      }
    },
  );

  guardedRoute(
    app,
    routes,
    basePath,
    "put",
    "/:id/inputs",
    "admin",
    async (c) => {
      const id = idParam(c);
      if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

      const body = await readJsonBody(c);
      if (body === null) return c.json({ error: "invalid JSON body" }, 400);

      const parsed = inputsSchema.safeParse(body);
      if (!parsed.success)
        return c.json(
          { error: "invalid input", issues: parsed.error.issues },
          400,
        );

      try {
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

        const result = await repository.updateInputs(
          id,
          parsed.data.inputs as InputDefinition[],
          parsed.data.version,
          adminActorFrom(c),
          fieldSpecs,
          maxUploadMb,
        );
        return c.json(result);
      } catch (err) {
        return handleError(c, err);
      }
    },
  );

  guardedRoute(
    app,
    routes,
    basePath,
    "post",
    "/:id/enable",
    "admin",
    async (c) => {
      const id = idParam(c);
      if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

      const body = await readJsonBody(c);
      if (body === null) return c.json({ error: "invalid JSON body" }, 400);
      const versionResult = versionSchema.safeParse(body.version);
      if (!versionResult.success)
        return c.json({ error: "version is required" }, 400);

      const detail = await repository.get(id);
      if (!detail) return c.json({ error: "not found" }, 404);

      const attached = await modelBackends.listForModel(id);
      const readiness = await checkEnableReadiness(
        detail,
        attached,
        backendsService,
      );
      if (!readiness.ok) {
        return c.json({ error: "not ready", reasons: readiness.reasons }, 400);
      }

      try {
        const record = await repository.setState(
          id,
          "enabled",
          versionResult.data,
          adminActorFrom(c),
        );
        return c.json(record);
      } catch (err) {
        return handleError(c, err);
      }
    },
  );

  guardedRoute(
    app,
    routes,
    basePath,
    "post",
    "/:id/disable",
    "admin",
    async (c) => {
      const id = idParam(c);
      if (!UUID_RE.test(id)) return c.json({ error: "not found" }, 404);

      const body = await readJsonBody(c);
      if (body === null) return c.json({ error: "invalid JSON body" }, 400);
      const versionResult = versionSchema.safeParse(body.version);
      if (!versionResult.success)
        return c.json({ error: "version is required" }, 400);

      try {
        const record = await repository.setState(
          id,
          "disabled",
          versionResult.data,
          adminActorFrom(c),
        );
        return c.json(record);
      } catch (err) {
        return handleError(c, err);
      }
    },
  );

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
  if (err instanceof BackendNotFound)
    return c.json({ error: err.message }, 404);
  throw err;
}
