// Testing a Generation from the Model editor (issue #74): runs one
// Generation of whatever's unsaved in the editor right now — a draft
// Mode and the draft Inputs it's checked against — on an unnumbered
// Model revision that never becomes current and writes no Audit entry.
// Bypasses Pause, a disabled Model's own refusal, Caps, and Model terms
// entirely (the AC: tests run regardless), but is still blocked while
// the Mode has errors (checkModel), the same rail the editor itself
// shows live.

import {
  type CheckModelMode,
  type InputDefinition,
  type ModeInputSetting,
  applyModeFixedValues,
  buildInputValuesSchema,
  buildPrompt,
  checkModel,
  computeModePath,
  hasBlockingErrors,
  isSeedInput,
  modeInputSetting,
  randomSeedBase,
  relevantInputs,
  resolveModeInputs,
  resolveModeOutputNodes,
  seedBoundFor,
  validateModeInputSettings,
  validateSeedRange,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import type { BackendsService } from "../backends/service.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import {
  buildObjectInfo,
  toCheckModelBackends,
} from "../models/object-info.js";
import type { ModelRepository } from "../models/repository.js";
import type { UploadsRepository } from "../uploads/repository.js";
import { STORAGE_FULL_MESSAGE } from "../uploads/service.js";
import type { GenerationEvents } from "./events.js";
import {
  type GenerationSummary,
  type GenerationsRepository,
  promptBindingFor,
  promptFor,
} from "./repository.js";
import {
  InvalidInputValues,
  InvalidSeed,
  resolvePointsFrameSizes,
  resolveUploadValues,
} from "./submission.js";
import type { SubmissionDeps } from "./submission.js";

export class TestModelNotFound extends Error {
  constructor() {
    super("Model not found");
  }
}

/** The draft Mode under test has a blocking `checkModel` error, or its own output nodes don't resolve (400, issue #74's AC: "blocked while the Mode has errors"). */
export class TestModeHasErrors extends Error {
  constructor(public readonly reasons: string[]) {
    super("mode_has_errors");
  }
}

/** `backendId` names a Backend not attached to this Model (400). */
export class TestBackendNotAttached extends Error {
  constructor() {
    super("backend not attached to this Model");
  }
}

export class TestNoBackend extends Error {
  constructor() {
    super("no server available for this Mode");
  }
}

export class TestSubmissionStorageFull extends Error {
  constructor() {
    super(STORAGE_FULL_MESSAGE);
  }
}

export interface SubmitTestGenerationParams {
  modelId: string;
  userId: string;
  /** The draft Mode under test, exactly as the editor's own draft holds it right now. */
  mode: {
    name: string;
    description: string;
    outputNodeIds: string[];
    inputSettings: ModeInputSetting[];
  };
  /** The editor's full draft Inputs list (issue #74: unsaved Input edits are tested too). */
  inputs: InputDefinition[];
  values: Record<string, unknown>;
  /** A specific attached Backend's id, or null for Any (issue #74's AC). */
  backendId: string | null;
}

export interface TestSubmissionDeps {
  modelRepository: ModelRepository;
  modelBackendsRepository: ModelBackendsRepository;
  backendsService: BackendsService;
  generationsRepository: GenerationsRepository;
  generationEvents: GenerationEvents;
  clock: Clock;
  uploadsRepository: UploadsRepository;
  hasFreeDisk: () => Promise<boolean>;
  onGenerationQueued?: () => void;
}

export interface TestSubmissionResult {
  generation: GenerationSummary;
  prompt: string | null;
}

export async function submitTestGeneration(
  params: SubmitTestGenerationParams,
  deps: TestSubmissionDeps,
): Promise<TestSubmissionResult> {
  const detail = await deps.modelRepository.get(params.modelId);
  if (!detail) throw new TestModelNotFound();

  if (!(await deps.hasFreeDisk())) throw new TestSubmissionStorageFull();

  const outcome = resolveModeOutputNodes(
    detail.workflow,
    params.mode.outputNodeIds,
  );
  if (!outcome.ok) throw new TestModeHasErrors(outcome.errors);

  const settingsErrors = validateModeInputSettings(
    params.mode.inputSettings,
    params.inputs,
  );
  if (settingsErrors.length > 0) throw new TestModeHasErrors(settingsErrors);

  const attached = await deps.modelBackendsRepository.listForModel(
    params.modelId,
  );
  const objectInfo = toCheckModelBackends(
    await buildObjectInfo(attached, deps.backendsService),
  );
  const checkMode: CheckModelMode = {
    id: "test",
    name: params.mode.name,
    outputNodeIds: params.mode.outputNodeIds,
    inputSettings: params.mode.inputSettings,
  };
  const issues = checkModel(
    { workflow: detail.workflow, inputs: params.inputs, modes: [checkMode] },
    objectInfo,
  );
  if (hasBlockingErrors(issues)) {
    throw new TestModeHasErrors(
      issues
        .filter((issue) => issue.severity === "error")
        .map((i) => i.message),
    );
  }

  const candidates = params.backendId
    ? attached.filter((backend) => backend.id === params.backendId)
    : attached;
  if (params.backendId && candidates.length === 0) {
    throw new TestBackendNotAttached();
  }

  const outputNodeIds = outcome.outputNodes.map((node) => node.nodeId);
  const unresolvable = visibleModeBoundFields(
    params.mode.inputSettings,
    params.inputs,
  );
  const workflowForMode = applyModeFixedValues(
    detail.workflow,
    params.inputs,
    params.mode.inputSettings,
  );

  const path = computeModePath(workflowForMode, outputNodeIds, unresolvable);
  const pathClassTypes = [...path.nodeIds]
    .map((nodeId) => workflowForMode[nodeId]?.class_type)
    .filter((classType): classType is string => Boolean(classType));
  const nodeTypesByBackend = await Promise.all(
    candidates.map((backend) => deps.backendsService.nodeTypesFor(backend)),
  );
  const usable = nodeTypesByBackend.some(
    (nodeTypes): nodeTypes is Set<string> =>
      nodeTypes !== null &&
      pathClassTypes.every((classType) => nodeTypes.has(classType)),
  );
  if (!usable) throw new TestNoBackend();

  const relevant = relevantInputs(
    params.inputs,
    workflowForMode,
    outputNodeIds,
    unresolvable,
  );
  const { formInputs, requiredIds, fixedValues } = resolveModeInputs(
    relevant,
    params.mode.inputSettings,
  );
  const schema = buildInputValuesSchema(formInputs, requiredIds);

  const nonHiddenRelevant = relevant.filter(
    (input) =>
      modeInputSetting(params.mode.inputSettings, input.id).state !== "hidden",
  );
  const seedInput = relevant.find(isSeedInput);
  const promptInputs =
    seedInput && !nonHiddenRelevant.includes(seedInput)
      ? [...nonHiddenRelevant, seedInput]
      : nonHiddenRelevant;

  const valuesForSchema = { ...params.values };
  if (seedInput && valuesForSchema[seedInput.id] === "") {
    delete valuesForSchema[seedInput.id];
  }

  const parsedValues = schema.safeParse(valuesForSchema);
  if (!parsedValues.success) throw new InvalidInputValues(parsedValues.error);

  const uploadDeps = {
    uploadsRepository: deps.uploadsRepository,
  } as unknown as SubmissionDeps;

  // issue #74 CEO review: a Points Input (issue #52) needs the same
  // frame-size check submission.ts applies, resolved from the
  // still-raw submitted values the same way, before resolveUploadValues
  // below rewrites an Upload id to a Backend file name.
  const frameSizes = await resolvePointsFrameSizes(
    nonHiddenRelevant,
    workflowForMode,
    {
      ...(parsedValues.data as Record<string, string | number | undefined>),
      ...(fixedValues as Record<string, string | number | undefined>),
    },
    params.userId,
    uploadDeps,
  );

  const { values: resolvedValues, uploadIds } = await resolveUploadValues(
    formInputs,
    parsedValues.data as Record<string, string | number | undefined>,
    params.userId,
    uploadDeps,
  );

  let seedValue: number | undefined;
  if (seedInput) {
    const bound = seedBoundFor(seedInput);
    const raw = (parsedValues.data as Record<string, number | undefined>)[
      seedInput.id
    ];
    if (raw === undefined) {
      seedValue = randomSeedBase(1, bound);
    } else {
      const error = validateSeedRange(raw, 1, bound);
      if (error) throw new InvalidSeed(error);
      seedValue = raw;
    }
  }

  const generationId = crypto.randomUUID();
  const values = {
    ...resolvedValues,
    ...(fixedValues as Record<string, string | number | undefined>),
  };
  if (seedInput && seedValue !== undefined) values[seedInput.id] = seedValue;

  const { prompt, nodeTypes } = buildPrompt(
    detail.workflow,
    promptInputs,
    values,
    outputNodeIds,
    generationId,
    frameSizes,
  );

  const { revisionId, modeId } = await deps.modelRepository.createTestRevision(
    params.modelId,
    params.inputs,
    {
      name: params.mode.name,
      description: params.mode.description,
      outputNodes: outcome.outputNodes,
      inputSettings: params.mode.inputSettings,
    },
  );

  const submittedAt = deps.clock.now();
  const record = await deps.generationsRepository.create({
    id: generationId,
    modelId: params.modelId,
    revisionId,
    modeId,
    modeName: params.mode.name,
    userId: params.userId,
    submissionId: crypto.randomUUID(),
    builtPrompt: prompt,
    nodeTypes,
    uploadIds,
    submittedAt,
    isTest: true,
    pinnedBackendId: params.backendId,
  });

  const generation: GenerationSummary = {
    ...record,
    modelSlug: detail.model.slug,
    modelName: detail.model.name,
  };

  deps.generationEvents.publish(params.userId, {
    type: "change",
    generation,
  });
  deps.onGenerationQueued?.();

  const promptBinding = promptBindingFor(params.inputs, detail.workflow);
  return { generation, prompt: promptFor(prompt, promptBinding) };
}
