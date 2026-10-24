// Submitting a Generation from the Workbench (issue #43): validates that
// the Model is enabled, the caller's revision is current, and a usable
// Backend exists for the Mode, then freezes the built prompt.

import {
  buildPrompt,
  computeModePath,
  parseInputValues,
  relevantInputs,
} from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import type { z } from "zod";
import type { BackendsService } from "../backends/service.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import {
  type ModelDetail,
  type ModelRepository,
  activeModelTermsVersion,
} from "../models/repository.js";
import type { GenerationEvents } from "./events.js";
import type { GenerationRecord, GenerationsRepository } from "./repository.js";

export class ModelNotFound extends Error {
  constructor() {
    super("Model not found");
  }
}

/** The Model changed revision since the caller loaded it (409 `model_changed`). */
export class ModelChanged extends Error {
  constructor(public readonly detail: ModelDetail) {
    super("model_changed");
  }
}

export class ModelDisabled extends Error {
  constructor() {
    super("model_disabled");
  }
}

/** The caller hasn't accepted this Model's current terms version (issue #61). */
export class ModelTermsRequired extends Error {
  constructor() {
    super("model_terms_required");
  }
}

export class ModeNotFound extends Error {
  constructor() {
    super("Mode not found");
  }
}

export class NoBackend extends Error {
  constructor() {
    super("no server available for this Model");
  }
}

/** The submitted Input values failed `parseInputValues` (400 `invalid`, issue #46). */
export class InvalidInputValues extends Error {
  constructor(public readonly zodError: z.ZodError) {
    super("invalid");
  }
}

export interface SubmitGenerationParams {
  slug: string;
  modeId: string;
  /** The Model revision the caller's form was built from (issue #43: staleness check). */
  revision: number;
  userId: string;
  /** Raw submitted Input values, keyed by Input id (issue #46). */
  values: Record<string, unknown>;
}

export interface SubmissionDeps {
  modelRepository: ModelRepository;
  modelBackendsRepository: ModelBackendsRepository;
  backendsService: BackendsService;
  generationsRepository: GenerationsRepository;
  generationEvents: GenerationEvents;
  clock: Clock;
}

/** Whether at least one attached, reachable Backend has every node type a Mode's Path needs. */
async function hasUsableBackend(
  detail: ModelDetail,
  modeOutputNodeIds: readonly string[],
  deps: SubmissionDeps,
): Promise<boolean> {
  const path = computeModePath(detail.workflow, modeOutputNodeIds);
  const pathClassTypes = [...path.nodeIds]
    .map((nodeId) => detail.workflow[nodeId]?.class_type)
    .filter((classType): classType is string => Boolean(classType));

  const attached = await deps.modelBackendsRepository.listForModel(
    detail.model.id,
  );
  const nodeTypesByBackend = await Promise.all(
    attached.map((backend) => deps.backendsService.nodeTypesFor(backend)),
  );
  return nodeTypesByBackend.some(
    (nodeTypes): nodeTypes is Set<string> =>
      nodeTypes !== null &&
      pathClassTypes.every((classType) => nodeTypes.has(classType)),
  );
}

export async function submitGeneration(
  params: SubmitGenerationParams,
  deps: SubmissionDeps,
): Promise<GenerationRecord> {
  const detail = await deps.modelRepository.getBySlug(params.slug);
  if (!detail) throw new ModelNotFound();

  if (detail.model.state !== "enabled") throw new ModelDisabled();
  if (detail.model.currentRevision !== params.revision) {
    throw new ModelChanged(detail);
  }

  const requiredTermsVersion = activeModelTermsVersion(detail.model);
  if (requiredTermsVersion !== null) {
    const accepted = await deps.modelRepository.getAcceptedTermsVersion(
      detail.model.id,
      params.userId,
    );
    if (accepted !== requiredTermsVersion) throw new ModelTermsRequired();
  }

  const mode = detail.modes.find((m) => m.id === params.modeId);
  if (!mode) throw new ModeNotFound();

  const outputNodeIds = mode.outputNodes.map((node) => node.nodeId);
  const usable = await hasUsableBackend(detail, outputNodeIds, deps);
  if (!usable) throw new NoBackend();

  const relevant = relevantInputs(
    detail.inputs,
    detail.workflow,
    outputNodeIds,
  );
  const schema = parseInputValues(detail.revisionId, mode.id, relevant);
  const parsedValues = schema.safeParse(params.values);
  if (!parsedValues.success) throw new InvalidInputValues(parsedValues.error);

  const generationId = crypto.randomUUID();
  const { prompt, nodeTypes } = buildPrompt(
    detail.workflow,
    relevant,
    parsedValues.data as Record<string, string | number | undefined>,
    outputNodeIds,
    generationId,
  );

  const record = await deps.generationsRepository.create({
    id: generationId,
    modelId: detail.model.id,
    revisionId: detail.revisionId,
    modeId: mode.id,
    modeName: mode.name,
    userId: params.userId,
    submissionId: crypto.randomUUID(),
    builtPrompt: prompt,
    nodeTypes,
    submittedAt: deps.clock.now(),
  });

  deps.generationEvents.publish(params.userId, {
    type: "change",
    generation: {
      ...record,
      modelSlug: detail.model.slug,
      modelName: detail.model.name,
    },
  });

  return record;
}
