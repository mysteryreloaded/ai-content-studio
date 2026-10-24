// Submitting a Generation from the Workbench (issue #43): validates that
// the Model is enabled, the caller's revision is current, and a usable
// Backend exists for the Mode, then freezes the built prompt.

import {
  type AudioUploadInputDefinition,
  type ImageUploadInputDefinition,
  type InputDefinition,
  type InputIssue,
  type PointsInputDefinition,
  type VideoUploadInputDefinition,
  applyInputValues,
  applyModeFixedValues,
  audioUploadLimitIssue,
  buildPrompt,
  computeModePath,
  decodePointsValue,
  findBlockedWord,
  imageUploadLimitIssue,
  isSeedInput,
  modeInputSetting,
  parseInputValues,
  pointsValidationIssue,
  randomSeedBase,
  relevantInputs,
  resolveModeInputs,
  seedBoundFor,
  uploadFileName,
  validateSeedRange,
  videoUploadLimitIssue,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import type { Clock, Workflow } from "@ai-content-studio/shared";
import type { z } from "zod";
import type { LogEntryWriter } from "../backends/log-entries.js";
import type { BackendsService } from "../backends/service.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import {
  type ModelDetail,
  type ModelRepository,
  activeModelTermsVersion,
} from "../models/repository.js";
import type { UploadsRepository } from "../uploads/repository.js";
import { STORAGE_FULL_MESSAGE } from "../uploads/service.js";
import { ConcurrentCapExceeded, DailyCapExceeded } from "./caps.js";
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

/** An Upload Input's value isn't the caller's own, complete image Upload, or breaks the Input's limits (400 `invalid`, issue #50). */
export class InvalidUploads extends Error {
  constructor(public readonly issues: InputIssue[]) {
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

/** This Submission would put the user over their daily or concurrent Cap (409, issue #53): refused whole. */
export { ConcurrentCapExceeded, DailyCapExceeded };

/** `DATA_DIR`'s disk is under MIN_FREE_DISK_GB (507 `storage_full`, issue #50). */
export class SubmissionStorageFull extends Error {
  constructor() {
    super(STORAGE_FULL_MESSAGE);
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
  /** The Site's default Caps, current as of this call (issue #53); a user's own override, read inside the locked transaction, may still win. */
  getSiteCaps: () => Promise<{ dailyCap: number; concurrentCap: number }>;
  /** Wakes the dispatcher (issue #44): a fresh queued Generation may be dispatchable right away. */
  onGenerationQueued?: () => void;
  uploadsRepository: UploadsRepository;
  /** False while `DATA_DIR`'s disk is under MIN_FREE_DISK_GB (issue #50). */
  hasFreeDisk: () => Promise<boolean>;
}

/**
 * Resolves each Image Upload Input's value (an Upload id) to that
 * Upload's Backend file name (issue #50), refusing one that isn't the
 * caller's own, complete image, or that breaks the Input's limits.
 */
type UploadInput =
  | ImageUploadInputDefinition
  | VideoUploadInputDefinition
  | AudioUploadInputDefinition;

const UPLOAD_KIND_LABEL: Record<"image" | "video" | "audio", string> = {
  image: "an image",
  video: "a video",
  audio: "an audio clip",
};

/**
 * The duration to check a video/audio Upload's limits against (issue
 * #51): for a trimmed Upload, the range the user actually asked for
 * (`trimEndMs - trimStartMs`), not the re-encode's own probed
 * `durationMs`, which can overshoot it by a few milliseconds (a 29.97fps
 * encode of a 10s `-t` lands a hair over 10000ms; AAC pads further) and
 * would otherwise refuse a trim to exactly the Input's own max.
 */
export function effectiveUploadDurationMs(upload: {
  durationMs: number | null;
  trimStartMs: number | null;
  trimEndMs: number | null;
}): number | null {
  if (upload.trimStartMs !== null && upload.trimEndMs !== null) {
    return upload.trimEndMs - upload.trimStartMs;
  }
  return upload.durationMs;
}

/** The expected Upload `kind` and its own limit-issue check, by Input kind (issue #51). */
function expectedKindAndIssue(input: UploadInput): [
  "image" | "video" | "audio",
  (upload: {
    size: number;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  }) => string | null,
] {
  if (input.kind === "image_upload") {
    return ["image", (upload) => imageUploadLimitIssue(upload, input)];
  }
  if (input.kind === "video_upload") {
    return ["video", (upload) => videoUploadLimitIssue(upload, input)];
  }
  return ["audio", (upload) => audioUploadLimitIssue(upload, input)];
}

export async function resolveUploadValues(
  inputs: readonly InputDefinition[],
  values: Record<string, string | number | undefined>,
  userId: string,
  deps: SubmissionDeps,
): Promise<{
  values: Record<string, string | number | undefined>;
  uploadIds: string[];
}> {
  const uploadInputs = inputs.filter(
    (input): input is UploadInput =>
      input.kind === "image_upload" ||
      input.kind === "video_upload" ||
      input.kind === "audio_upload",
  );
  if (uploadInputs.length === 0) return { values, uploadIds: [] };

  const ids = uploadInputs
    .map((input) => values[input.id])
    .filter((id): id is string => typeof id === "string");
  const byId = new Map(
    (await deps.uploadsRepository.listByIds(ids)).map((u) => [u.id, u]),
  );

  const resolved = { ...values };
  const issues: InputIssue[] = [];
  for (const input of uploadInputs) {
    const upload = byId.get(String(values[input.id]));
    const refuse = (message: string) =>
      issues.push({ path: input.id, code: "upload", message });
    const [expectedKind, limitIssue] = expectedKindAndIssue(input);
    if (!upload || upload.userId !== userId) {
      refuse("that Upload wasn't found");
    } else if (upload.status !== "complete" || !upload.extension) {
      refuse("that Upload hasn't finished");
    } else if (upload.kind !== expectedKind) {
      refuse(`that Upload isn't ${UPLOAD_KIND_LABEL[expectedKind]}`);
    } else {
      const issue = limitIssue({
        ...upload,
        durationMs: effectiveUploadDurationMs(upload),
      });
      if (issue) refuse(`that file ${issue}`);
      else resolved[input.id] = uploadFileName(upload.id, upload.extension);
    }
  }
  if (issues.length > 0) throw new InvalidUploads(issues);
  return { values: resolved, uploadIds: [...new Set(ids)] };
}

/**
 * A Points Input's referenced video's first-frame pixel size (its
 * Upload's own probed width/height), with its submitted points checked
 * against the crop `widthField`/`heightField` resolve to, right now,
 * from `values` (issue #52). Throws `InvalidUploads` the same way
 * `resolveUploadValues` does, reusing its `{ error: "invalid", issues }`
 * shape, since both are "this submitted value can't be used" issues.
 */
export async function resolvePointsFrameSizes(
  inputs: readonly InputDefinition[],
  workflowForMode: Workflow,
  values: Record<string, string | number | undefined>,
  userId: string,
  deps: SubmissionDeps,
): Promise<Record<string, { width: number; height: number }>> {
  const pointsInputs = inputs.filter(
    (input): input is PointsInputDefinition => input.kind === "points",
  );
  if (pointsInputs.length === 0) return {};

  const videoInputsById = new Map(
    inputs
      .filter(
        (input): input is VideoUploadInputDefinition =>
          input.kind === "video_upload",
      )
      .map((input) => [input.id, input] as const),
  );

  // The Width/Height fields read the Workflow's own literal, or
  // whatever a bound Number Input just submitted; neither is a Points
  // Input's own concern, so every other Input is applied first, the
  // same way `applyInputValues` itself resolves them for the real
  // prompt.
  const dimsWorkflow = applyInputValues(
    workflowForMode,
    inputs.filter((input) => input.kind !== "points"),
    values,
  );

  const videoUploadIds = pointsInputs
    .map((input) => {
      const videoInput = videoInputsById.get(input.videoInputId);
      return videoInput ? values[videoInput.id] : undefined;
    })
    .filter((id): id is string => typeof id === "string");
  const uploadsById = new Map(
    (await deps.uploadsRepository.listByIds(videoUploadIds)).map((u) => [
      u.id,
      u,
    ]),
  );

  const frameSizes: Record<string, { width: number; height: number }> = {};
  const issues: InputIssue[] = [];
  for (const input of pointsInputs) {
    const refuse = (message: string) =>
      issues.push({ path: input.id, code: "points", message });

    const raw = values[input.id];
    const points = typeof raw === "string" ? decodePointsValue(raw) : null;
    const videoInput = videoInputsById.get(input.videoInputId);
    const upload = videoInput
      ? uploadsById.get(String(values[videoInput.id]))
      : undefined;
    const width =
      dimsWorkflow[input.widthField.nodeId]?.inputs[input.widthField.field];
    const height =
      dimsWorkflow[input.heightField.nodeId]?.inputs[input.heightField.field];

    if (!points) {
      refuse("needs 1-10 points");
      continue;
    }
    if (
      !upload ||
      upload.userId !== userId ||
      !upload.width ||
      !upload.height
    ) {
      refuse("that video's frame size couldn't be resolved");
      continue;
    }
    if (typeof width !== "number" || typeof height !== "number") {
      refuse("the crop size couldn't be resolved");
      continue;
    }
    const issue = pointsValidationIssue(
      points,
      upload.width,
      upload.height,
      width,
      height,
    );
    if (issue) {
      refuse(issue);
      continue;
    }
    frameSizes[input.id] = { width: upload.width, height: upload.height };
  }

  if (issues.length > 0) throw new InvalidUploads(issues);
  return frameSizes;
}

/** Whether at least one attached, reachable Backend has every node type a Mode's Path needs. */
async function hasUsableBackend(
  detail: ModelDetail,
  workflowForMode: Workflow,
  modeOutputNodeIds: readonly string[],
  unresolvableFields: ReadonlySet<string>,
  deps: SubmissionDeps,
): Promise<boolean> {
  const path = computeModePath(
    workflowForMode,
    modeOutputNodeIds,
    unresolvableFields,
  );
  const pathClassTypes = [...path.nodeIds]
    .map((nodeId) => workflowForMode[nodeId]?.class_type)
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

  if (!(await deps.hasFreeDisk())) throw new SubmissionStorageFull();

  const outputNodeIds = mode.outputNodes.map((node) => node.nodeId);
  // issue #48: a switch steered by a field one of this Mode's visible
  // Inputs binds keeps both branches on the Path everywhere the Path
  // is computed, since the Admin can't know ahead of time which way a
  // user will set it.
  const unresolvable = visibleModeBoundFields(
    mode.inputSettings,
    detail.inputs,
  );
  // issue #48 CEO review: a fixed Input's value is known before sending
  // (ADR 0001), so it must pick its switch's side here too, the same
  // way buildPrompt's own applyInputValues does for the real prompt.
  const workflowForMode = applyModeFixedValues(
    detail.workflow,
    detail.inputs,
    mode.inputSettings,
  );
  const usable = await hasUsableBackend(
    detail,
    workflowForMode,
    outputNodeIds,
    unresolvable,
    deps,
  );
  if (!usable) throw new NoBackend();

  const relevant = relevantInputs(
    detail.inputs,
    workflowForMode,
    outputNodeIds,
    unresolvable,
  );
  const { formInputs, requiredIds, fixedValues } = resolveModeInputs(
    relevant,
    mode.inputSettings,
  );
  const schema = parseInputValues(
    detail.revisionId,
    mode.id,
    formInputs,
    requiredIds,
  );

  // A hidden Input isn't submitted and has no fixed value either: it
  // must leave its bound fields as the Workflow has them, not fall
  // back to the Input's own default (applyInputValues does that for
  // any Input it's handed with no value), so it's left out here.
  const nonHiddenRelevant = relevant.filter(
    (input) =>
      modeInputSetting(mode.inputSettings, input.id).state !== "hidden",
  );
  // issue #48 CEO review (reverses round 5's ask): a Seed on the Path
  // still turns on the count and still draws+writes a seed per
  // Generation even when this Mode hides the Seed Input itself — only
  // its own form field is hidden, not the drawing. `promptInputs` adds
  // it back for buildPrompt when `nonHiddenRelevant` left it out.
  const seedInput = relevant.find(isSeedInput);
  const promptInputs =
    seedInput && !nonHiddenRelevant.includes(seedInput)
      ? [...nonHiddenRelevant, seedInput]
      : nonHiddenRelevant;

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

  // issue #52: resolved from the still-raw submitted values (a video
  // Upload's bare id, needed to look up its probed frame size), before
  // `resolveUploadValues` below rewrites it to a Backend file name.
  // `fixedValues` is merged in too: a fixed Width/Height Input isn't in
  // `formInputs` (so never in `parsedValues.data`), and without its own
  // fixed value here, `applyInputValues` would resolve that field from
  // the bound Number Input's own default (or the Workflow's literal)
  // instead of the value this Mode actually fixes it to.
  const frameSizes = await resolvePointsFrameSizes(
    nonHiddenRelevant,
    workflowForMode,
    {
      ...(parsedValues.data as Record<string, string | number | undefined>),
      ...(fixedValues as Record<string, string | number | undefined>),
    },
    params.userId,
    deps,
  );

  // A hidden Upload Input (fixed is refused for this kind) isn't
  // submitted, so it must stay out of resolution too, or it 400s every
  // Submit looking for an Upload id that was never asked for.
  const { values: resolvedValues, uploadIds } = await resolveUploadValues(
    formInputs,
    parsedValues.data as Record<string, string | number | undefined>,
    params.userId,
    deps,
  );

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
      ...resolvedValues,
      ...(fixedValues as Record<string, string | number | undefined>),
    };
    if (seedInput && baseSeed !== null) {
      values[seedInput.id] = baseSeed + i;
    }
    const { prompt, nodeTypes } = buildPrompt(
      detail.workflow,
      promptInputs,
      values,
      outputNodeIds,
      generationId,
      frameSizes,
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
      uploadIds,
      submittedAt,
    });
  }

  const siteCaps = await deps.getSiteCaps();
  const records = await deps.generationsRepository.createSubmission(
    params.userId,
    creations,
    siteCaps,
    deps.clock,
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
