// Submitting a Generation from the Workbench (issue #43): validates that
// the Model is enabled, the caller's revision is current, and a usable
// Backend exists for the Mode, then freezes the built prompt.

import { buildFrozenPrompt, computeModePath } from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import type { BackendsService } from "../backends/service.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import type { ModelDetail, ModelRepository } from "../models/repository.js";
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

export interface SubmitGenerationParams {
  slug: string;
  modeId: string;
  /** The Model revision the caller's form was built from (issue #43: staleness check). */
  revision: number;
  userId: string;
}

export interface SubmissionDeps {
  modelRepository: ModelRepository;
  modelBackendsRepository: ModelBackendsRepository;
  backendsService: BackendsService;
  generationsRepository: GenerationsRepository;
  generationEvents: GenerationEvents;
  clock: Clock;
  /** Wakes the dispatcher (issue #44): a fresh queued Generation may be dispatchable right away. */
  onGenerationQueued?: () => void;
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

  const mode = detail.modes.find((m) => m.id === params.modeId);
  if (!mode) throw new ModeNotFound();

  const outputNodeIds = mode.outputNodes.map((node) => node.nodeId);
  const usable = await hasUsableBackend(detail, outputNodeIds, deps);
  if (!usable) throw new NoBackend();

  const generationId = crypto.randomUUID();
  const { prompt, nodeTypes } = buildFrozenPrompt(
    detail.workflow,
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
  deps.onGenerationQueued?.();

  return record;
}
