// Submitting a Generation from the Workbench (issue #43): validates that
// the Model is enabled, the caller's revision is current, and a usable
// Backend exists for the Mode, then freezes the built prompt.

import {
  buildPrompt,
  computeModePath,
  findBlockedWord,
  isSeedInput,
  parseInputValues,
  randomSeedBase,
  relevantInputs,
  seedBoundFor,
  validateSeedRange,
} from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import type { z } from "zod";
import type { LogEntryWriter } from "../backends/log-entries.js";
import type { BackendsService } from "../backends/service.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import {
  type ModelDetail,
  type ModelRepository,
  activeModelTermsVersion,
} from "../models/repository.js";
import type { GenerationEvents } from "./events.js";
import {
  type CreateGenerationInput,
  type GenerationSummary,
  type GenerationsRepository,
  promptBindingFor,
  promptFor,
} from "./repository.js";

/** Generating is paused for maintenance (issue #59: 503 `paused`). */
export class Paused extends Error {
  constructor() {
    super("paused");
  }
}

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

/** The submitted count isn't 1-4 (400 `invalid_count`, issue #47). */
export class InvalidCount extends Error {
  constructor() {
    super("count must be 1-4");
  }
}

/** The submitted seed would leave fewer than `count` seeds under the bound (400 `invalid_seed`, issue #47, ADR 0007). */
export class InvalidSeed extends Error {}

/** A text Input's value held a blocked word or phrase (400 `invalid`, issue #66). */
export class BlockedWordSubmitted extends Error {
  constructor(public readonly inputId: string) {
    super("invalid");
  }
}

export interface SubmitGenerationParams {
  slug: string;
  modeId: string;
  /** The Model revision the caller's form was built from (issue #43: staleness check). */
  revision: number;
  userId: string;
  /** Raw submitted Input values, keyed by Input id (issue #46), including a Seed Input's own value if set. */
  values: Record<string, unknown>;
  /** How many Generations to create, 1-4; forced to 1 when the Mode's Path holds no bound Seed Input (issue #47). */
  count?: number;
}

export interface SubmissionDeps {
  modelRepository: ModelRepository;
  modelBackendsRepository: ModelBackendsRepository;
  backendsService: BackendsService;
  generationsRepository: GenerationsRepository;
  generationEvents: GenerationEvents;
  clock: Clock;
  logWriter: LogEntryWriter;
  /** The Admin's blocked words list, current as of this call (issue #66). */
  getBlockedWords: () => Promise<string[]>;
  /** Whether generating is currently Paused (issue #59), current as of this call. */
  isPaused: () => Promise<boolean>;
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

/** A Submission, just made: its Generations (enriched like the SSE events) and its prompt (issue #47 AC: shown right away, no reload needed). */
export interface SubmissionResult {
  generations: GenerationSummary[];
  prompt: string | null;
}

export async function submitGeneration(
  params: SubmitGenerationParams,
  deps: SubmissionDeps,
): Promise<SubmissionResult> {
  // Checked before anything else (issue #59's AC): a Pause refuses every
  // submit outright, regardless of the Model/Mode it names.
  if (await deps.isPaused()) throw new Paused();

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
  const seedInput = relevant.find(isSeedInput);

  // The count picker only exists when the Path holds a bound Seed Input
  // (issue #47's AC); otherwise every Submission makes exactly 1.
  const requestedCount = seedInput ? (params.count ?? 1) : 1;
  if (
    !Number.isInteger(requestedCount) ||
    requestedCount < 1 ||
    requestedCount > 4
  ) {
    throw new InvalidCount();
  }
  const count = requestedCount;

  // The Seed Input's own value shares the generic schema check (int,
  // 0..bound), so a wrong-typed seed (null, a string, a bool) surfaces as
  // an `invalid` issue on its own path rather than being coerced by
  // `Number()`. A blank seed means "draw one" (ADR 0007), so it's dropped
  // before parsing rather than failing the (non-optional-looking) check.
  const valuesForSchema = { ...params.values };
  if (seedInput && valuesForSchema[seedInput.id] === "") {
    delete valuesForSchema[seedInput.id];
  }

  const schema = parseInputValues(detail.revisionId, mode.id, relevant);
  const parsedValues = schema.safeParse(valuesForSchema);
  if (!parsedValues.success) throw new InvalidInputValues(parsedValues.error);

  const blockedWords = await deps.getBlockedWords();
  if (blockedWords.length > 0) {
    for (const input of relevant) {
      if (input.kind !== "text") continue;
      const value = (parsedValues.data as Record<string, unknown>)[input.id];
      if (typeof value !== "string" || value === "") continue;
      const word = findBlockedWord(value, blockedWords);
      if (!word) continue;
      await deps.logWriter.log({
        level: "warning",
        source: "app",
        message: `Refused a submitted prompt holding a blocked word: "${word}"`,
        details: word,
        userId: params.userId,
        modelId: detail.model.id,
      });
      throw new BlockedWordSubmitted(input.id);
    }
  }

  let baseSeed: number | null = null;
  if (seedInput) {
    const bound = seedBoundFor(seedInput);
    const seedValue = (parsedValues.data as Record<string, number | undefined>)[
      seedInput.id
    ];
    if (seedValue === undefined) {
      baseSeed = randomSeedBase(count, bound);
    } else {
      const error = validateSeedRange(seedValue, count, bound);
      if (error) throw new InvalidSeed(error);
      baseSeed = seedValue;
    }
  }

  const submissionId = crypto.randomUUID();
  const submittedAt = deps.clock.now();
  const creations: CreateGenerationInput[] = [];
  for (let i = 0; i < count; i++) {
    const generationId = crypto.randomUUID();
    const values = {
      ...(parsedValues.data as Record<string, string | number | undefined>),
    };
    if (seedInput && baseSeed !== null) {
      values[seedInput.id] = baseSeed + i;
    }
    const { prompt, nodeTypes } = buildPrompt(
      detail.workflow,
      relevant,
      values,
      outputNodeIds,
      generationId,
    );
    creations.push({
      id: generationId,
      modelId: detail.model.id,
      revisionId: detail.revisionId,
      modeId: mode.id,
      modeName: mode.name,
      userId: params.userId,
      submissionId,
      builtPrompt: prompt,
      nodeTypes,
      submittedAt,
    });
  }

  const records = await deps.generationsRepository.createSubmission(
    params.userId,
    creations,
  );

  const generations: GenerationSummary[] = records.map((record) => ({
    ...record,
    modelSlug: detail.model.slug,
    modelName: detail.model.name,
  }));

  for (const generation of generations) {
    deps.generationEvents.publish(params.userId, {
      type: "change",
      generation,
    });
  }
  deps.onGenerationQueued?.();

  const promptBinding = promptBindingFor(detail.inputs, detail.workflow);
  const prompt = promptFor(creations[0]?.builtPrompt ?? {}, promptBinding);

  return { generations, prompt };
}
