import {
  capsFooterText,
  effectiveNoticeText,
  parseInputValues,
  renderMarkdown,
  toInputIssues,
} from "@ai-content-studio/shared";
import type { CapsStatus, InputDefinition } from "@ai-content-studio/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Footer } from "../Footer.js";
import {
  httpUploadApi,
  pickAudioIssue,
  pickIssue,
  pickVideoIssue,
  readMediaDuration,
  trimUpload,
  uploadResumable,
} from "../lib/chunkedUpload.js";
import { usePauseNotice } from "../usePauseNotice.js";
import { useSession } from "../useSession.js";

interface WorkbenchInputOption {
  id: string;
  label: string;
}

type WorkbenchInput = {
  id: string;
  group: "describe" | "settings";
  label: string;
  help: string;
  required: boolean;
  placeholder: string | number | boolean | null;
} & (
  | {
      kind: "text";
      multiline: boolean;
      maxLength: number;
      default: string;
    }
  | {
      kind: "number";
      numberMode: "integer" | "decimal";
      min: number;
      max: number;
      step: number;
      default: number | null;
    }
  | {
      kind: "select";
      options: WorkbenchInputOption[];
      default: string | null;
    }
  | {
      kind: "image_upload";
      maxSizeMb: number;
      maxLongSide: number | null;
    }
  | {
      kind: "video_upload";
      maxSizeMb: number;
      maxLongSide: number | null;
      minDurationMs: number;
      maxDurationMs: number;
      trimmable: boolean;
    }
  | {
      kind: "audio_upload";
      maxSizeMb: number;
      minDurationMs: number;
      maxDurationMs: number;
      trimmable: boolean;
    }
  | {
      kind: "seed";
      max: number | null;
    }
);

type ModeMenuGroup = "prompt" | "images" | "audio" | "video";

type ImageUploadInput = Extract<WorkbenchInput, { kind: "image_upload" }>;
type VideoUploadInput = Extract<WorkbenchInput, { kind: "video_upload" }>;
type AudioUploadInput = Extract<WorkbenchInput, { kind: "audio_upload" }>;
type MediaUploadInput = VideoUploadInput | AudioUploadInput;

const UPLOAD_KINDS = new Set<WorkbenchInput["kind"]>([
  "image_upload",
  "video_upload",
  "audio_upload",
]);

/** One Upload Input's file (issues #50, #51): uploading, uploaded, or refused. A video/audio one also carries its playable/trim facts. */
type UploadState =
  | { status: "uploading"; name: string; progress: number }
  | {
      status: "complete";
      name: string;
      uploadId: string;
      durationMs: number | null;
      browserPlayable: boolean | null;
    }
  | { status: "error"; name: string; message: string };

interface WorkbenchMode {
  id: string;
  name: string;
  description: string;
  inputs: WorkbenchInput[];
  menuGroup: ModeMenuGroup;
  /** Issue #48 CEO review: true whenever the Mode's Path holds a bound Seed Input, even one this Mode hides. */
  hasSeed: boolean;
}

/** The Workbench Mode menu's group headings (issue #48), by what a Mode's Uploads ask the user to start from. */
const MODE_MENU_GROUP_LABELS: Record<ModeMenuGroup, string> = {
  prompt: "From a prompt",
  images: "From images",
  audio: "With your audio",
  video: "From a video",
};
const MODE_MENU_GROUP_ORDER: ModeMenuGroup[] = [
  "prompt",
  "images",
  "audio",
  "video",
];

/** Groups `modes` under their Mode menu heading, in a fixed order, dropping empty groups. */
function groupModesForMenu(
  modes: WorkbenchMode[],
): Array<{ group: ModeMenuGroup; modes: WorkbenchMode[] }> {
  return MODE_MENU_GROUP_ORDER.map((group) => ({
    group,
    modes: modes.filter((mode) => mode.menuGroup === group),
  })).filter((entry) => entry.modes.length > 0);
}

interface InputIssue {
  path: string;
  code: string;
  message: string;
}

/** The form's starting values for `mode`'s Inputs: each Input's own default, or blank. */
function initialValuesFor(mode: WorkbenchMode): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of mode.inputs) {
    if (input.kind === "seed") {
      values[input.id] = "";
      continue;
    }
    values[input.id] =
      input.kind === "image_upload" ||
      input.kind === "video_upload" ||
      input.kind === "audio_upload" ||
      input.default === null ||
      input.default === undefined
        ? ""
        : String(input.default);
  }
  return values;
}

/** Whether `raw` parses for `input`'s own kind and constraints (mirrors `buildInputValuesSchema`'s per-field checks), blank always passing. */
function valueParsesForInput(input: WorkbenchInput, raw: string): boolean {
  if (raw === "") return true;
  if (input.kind === "text") return raw.length <= input.maxLength;
  if (input.kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return false;
    if (n < input.min || n > input.max) return false;
    if (input.numberMode === "integer" && !Number.isInteger(n)) return false;
    const steps = (n - input.min) / input.step;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  }
  if (input.kind === "seed") {
    const n = Number(raw);
    return (
      Number.isInteger(n) &&
      n >= 0 &&
      n <= (input.max ?? Number.POSITIVE_INFINITY)
    );
  }
  if (
    input.kind === "image_upload" ||
    input.kind === "video_upload" ||
    input.kind === "audio_upload"
  ) {
    // An Upload id's own completeness/ownership can only be checked
    // server-side; carrying it across a reload is best-effort here.
    return true;
  }
  return input.options.some((option) => option.id === raw);
}

/**
 * Carries `basis`'s values onto `mode`'s own Inputs (issue #48 AC6):
 * an Input `mode` also shows keeps its value, the rest default. With
 * `validate` (the 409 `model_changed` reload, where the Model's Inputs
 * may have changed underneath the form), a carried value that no
 * longer parses for that Input is dropped rather than kept to fail on
 * the next submit.
 */
function carryValuesFor(
  mode: WorkbenchMode,
  basis: Record<string, string>,
  validate = false,
): Record<string, string> {
  const next = initialValuesFor(mode);
  for (const input of mode.inputs) {
    const raw = basis[input.id];
    if (raw === undefined) continue;
    if (validate && !valueParsesForInput(input, raw)) continue;
    next[input.id] = raw;
  }
  return next;
}

/** The submitted payload for `mode`'s Inputs: blank values are left out, a number is parsed. */
function valuesPayload(
  mode: WorkbenchMode,
  values: Record<string, string>,
): Record<string, string | number> {
  const payload: Record<string, string | number> = {};
  for (const input of mode.inputs) {
    const raw = values[input.id];
    if (raw === undefined || raw === "") continue;
    payload[input.id] =
      input.kind === "number" || input.kind === "seed" ? Number(raw) : raw;
  }
  return payload;
}

/** `WorkbenchInput` carries everything `buildInputValuesSchema` needs; `bindings`/`group`/`help` are unused filler (the Workbench never sees them). */
function toInputDefinition(input: WorkbenchInput): InputDefinition {
  const base = {
    id: input.id,
    group: "describe" as const,
    label: input.label,
    help: input.help,
    bindings: [],
  };
  if (input.kind === "text") {
    return {
      ...base,
      kind: "text",
      multiline: input.multiline,
      maxLength: input.maxLength,
      default: input.default,
    };
  }
  if (input.kind === "image_upload") {
    return {
      ...base,
      kind: "image_upload",
      maxSizeMb: input.maxSizeMb,
      maxLongSide: input.maxLongSide,
    };
  }
  if (input.kind === "video_upload") {
    return {
      ...base,
      kind: "video_upload",
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
      kind: "audio_upload",
      maxSizeMb: input.maxSizeMb,
      minDurationMs: input.minDurationMs,
      maxDurationMs: input.maxDurationMs,
      trimmable: input.trimmable,
    };
  }
  if (input.kind === "number") {
    return {
      ...base,
      kind: "number",
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
      kind: "seed",
      max: input.max,
    };
  }
  return {
    ...base,
    kind: "select",
    options: input.options.map((option) => ({
      id: option.id,
      label: option.label,
      values: [],
    })),
    default: input.default,
  };
}

/** `mode.inputs` ids marked `required` on the server (issue #48), for the client's own `parseInputValues` schema. */
function requiredIdsFor(mode: WorkbenchMode): Set<string> {
  return new Set(
    mode.inputs.filter((input) => input.required).map((input) => input.id),
  );
}

/** Live, client-side validation (issue #46): the same `parseInputValues` schema the server uses, so field issues show before submit. */
function liveIssuesFor(
  revision: number,
  mode: WorkbenchMode,
  values: Record<string, string>,
): Record<string, string> {
  const schema = parseInputValues(
    String(revision),
    mode.id,
    mode.inputs.map(toInputDefinition),
    requiredIdsFor(mode),
  );
  const result = schema.safeParse(valuesPayload(mode, values));
  if (result.success) return {};
  return Object.fromEntries(
    toInputIssues(result.error).map((issue) => [issue.path, issue.message]),
  );
}

/** A picked image's size, when this browser can decode it; null otherwise (the server checks again at complete). */
async function readDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return null;
  }
}

/** The browser's own issue with `file` for `input`'s kind, before any byte is sent (issues #50, #51). */
async function issueFor(
  input: ImageUploadInput | MediaUploadInput,
  file: File,
  maxUploadMb: number | null,
): Promise<string | null> {
  if (input.kind === "image_upload") {
    return pickIssue(file, input, maxUploadMb, await readDimensions(file));
  }
  if (input.kind === "video_upload") {
    const facts = await readMediaDuration(file, "video");
    return pickVideoIssue(file, input, maxUploadMb, facts ?? undefined);
  }
  const facts = await readMediaDuration(file, "audio");
  return pickAudioIssue(file, input, maxUploadMb, facts?.durationMs ?? null);
}

interface ModelTerms {
  version: number;
  body: string;
  licenseUrl: string;
  accepted: boolean;
}

interface WorkbenchModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  revision: number;
  attribution: string;
  terms: ModelTerms | null;
  modes: WorkbenchMode[];
}

type GenerationState =
  | "queued"
  | "starting"
  | "running"
  | "saving"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled";

const DONE_STATES = new Set<GenerationState>([
  "succeeded",
  "failed",
  "cancelled",
]);

interface AssetSummary {
  id: string;
  nodeId: string;
  sortOrder: number;
  kind: string;
  contentType: string;
}

interface GenerationSummary {
  id: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modeId: string;
  modeName: string;
  submissionId: string;
  state: GenerationState;
  /** Issue #55: tries made so far. A queued Generation with `tries > 0` is retrying, not waiting for its first try. */
  tries: number;
  error: string | null;
  submittedAt: string;
  assets: AssetSummary[];
}

interface GenerationProgress {
  generationId: string;
  elapsedMs: number;
  estimateMs: number | null;
  step: number | null;
  totalSteps: number | null;
}

interface SubmissionSummary {
  submissionId: string;
  modeId: string;
  modeName: string;
  submittedAt: string;
  prompt?: string | null;
  generations: GenerationSummary[];
}

/** Replaces or adds `generation` within its own Submission, creating that Submission if this is its first known Generation. */
function upsertGeneration(
  current: SubmissionSummary[],
  generation: GenerationSummary,
): SubmissionSummary[] {
  const index = current.findIndex(
    (s) => s.submissionId === generation.submissionId,
  );
  if (index === -1) {
    const submission: SubmissionSummary = {
      submissionId: generation.submissionId,
      modeId: generation.modeId,
      modeName: generation.modeName,
      submittedAt: generation.submittedAt,
      generations: [generation],
    };
    return [submission, ...current].slice(0, 8);
  }

  const submission = current[index] as SubmissionSummary;
  const genIndex = submission.generations.findIndex(
    (g) => g.id === generation.id,
  );
  const generations =
    genIndex === -1
      ? [...submission.generations, generation]
      : submission.generations.map((g, i) => (i === genIndex ? generation : g));
  const updated = [...current];
  updated[index] = { ...submission, generations };
  return updated;
}

type SubmitState =
  | { status: "idle" }
  /** Issue #50: Generate was pressed while Uploads were still running. */
  | { status: "waiting" }
  /** Issue #51: one trim, covering every Generation in the Submission, runs before it's built. */
  | { status: "trimming" }
  | { status: "submitting" }
  | { status: "error"; message: string };

/** Issue #55's AC: a queued card says it's waiting for a GPU or retrying, never a queue position. */
function stateLabel(
  state: GenerationState,
  tries: number,
  paused: boolean,
): string {
  switch (state) {
    case "queued":
      if (paused) return "Queued · paused";
      return tries > 0 ? "Retrying…" : "Waiting for a GPU…";
    case "starting":
      return "Starting…";
    case "running":
      return "Running…";
    case "saving":
      return "Saving…";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelling":
      return "Cancelling…";
    case "cancelled":
      return "Cancelled";
    default:
      return state;
  }
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Elapsed time against the median of its last 10 successes, capped at 99%; without that history, just the elapsed time, indeterminate. */
function ProgressLabel({
  progress,
}: { progress: GenerationProgress | undefined }) {
  if (!progress) return null;
  const parts: string[] = [];
  if (progress.estimateMs !== null && progress.estimateMs > 0) {
    const percent = Math.min(
      99,
      Math.round((progress.elapsedMs / progress.estimateMs) * 100),
    );
    parts.push(`${percent}%`);
  } else {
    parts.push(`${formatElapsed(progress.elapsedMs)} elapsed`);
  }
  if (progress.step !== null && progress.totalSteps !== null) {
    parts.push(`step ${progress.step} / ${progress.totalSteps}`);
  }
  return <span className="workbench-progress">{parts.join(" · ")}</span>;
}

function assetSrc(asset: AssetSummary): string {
  return `/api/assets/${asset.id}`;
}

/** Plays the main (first) Asset in place once the Generation has succeeded. */
function AssetPlayer({ asset }: { asset: AssetSummary }) {
  if (asset.kind === "video") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer.
      <video
        controls
        poster={`/api/assets/${asset.id}/poster`}
        src={assetSrc(asset)}
        className="workbench-asset"
      />
    );
  }
  if (asset.kind === "audio") {
    // biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer.
    return <audio controls src={assetSrc(asset)} className="workbench-asset" />;
  }
  return <img src={assetSrc(asset)} alt="" className="workbench-asset" />;
}

/** A Download link for `asset`, with the AI-generated reminder the AC asks for beside every Download (issue #45). */
function DownloadAsset({ asset }: { asset: AssetSummary }) {
  return (
    <p className="workbench-download">
      <a href={`/api/assets/${asset.id}?download=1`}>Download</a>{" "}
      <span className="workbench-ai-reminder">
        AI-generated: say so when you share it.
      </span>
    </p>
  );
}

function GenerationCard({
  generation,
  progress,
  paused,
}: {
  generation: GenerationSummary;
  progress: GenerationProgress | undefined;
  paused: boolean;
}) {
  const mainAsset = generation.assets?.[0];
  return (
    <li>
      <span>{stateLabel(generation.state, generation.tries, paused)}</span>{" "}
      {(generation.state === "starting" || generation.state === "running") && (
        <ProgressLabel progress={progress} />
      )}
      {generation.state === "failed" && (
        <>
          {generation.error && <span role="alert">{generation.error}</span>}
          {/* Issue #55's AC: the full Generation id, so it can be matched to a Log entry. */}
          <span className="workbench-generation-id">{generation.id}</span>
        </>
      )}
      {generation.state === "succeeded" && mainAsset && (
        <>
          <AssetPlayer asset={mainAsset} />
          <DownloadAsset asset={mainAsset} />
        </>
      )}
    </li>
  );
}

/**
 * The Model terms dialog (issue #61): blocking (no dismiss, no Escape)
 * the first time a user opens a Model with terms and again whenever
 * re-asked; otherwise dismissible, for viewing the terms any time via
 * the Workbench's own link.
 */
function ModelTermsDialog({
  modelName,
  terms,
  blocking,
  accepting,
  error,
  onAccept,
  onClose,
}: {
  modelName: string;
  terms: ModelTerms;
  blocking: boolean;
  accepting: boolean;
  error: string | null;
  onAccept: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        if (blocking) event.preventDefault();
      }}
      onClose={onClose}
    >
      <h2>{modelName}'s terms</h2>
      <div
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
        dangerouslySetInnerHTML={{ __html: renderMarkdown(terms.body) }}
      />
      {terms.licenseUrl && (
        <p>
          <a href={terms.licenseUrl} target="_blank" rel="noopener noreferrer">
            License
          </a>
        </p>
      )}

      {!terms.accepted && (
        <button type="button" disabled={accepting} onClick={onAccept}>
          Accept
        </button>
      )}
      {!blocking && (
        <button type="button" onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}

interface GenerationDetail {
  submission: SubmissionSummary;
  model: WorkbenchModel;
}

/** The Generation detail dialog (issue #61): a Submission's own state plus the Model's Attribution and terms link. */
function GenerationDetailDialog({
  detail,
  onClose,
}: {
  detail: GenerationDetail;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} onClose={onClose}>
      <h2>{detail.submission.modeName}</h2>
      <time dateTime={detail.submission.submittedAt}>
        {new Date(detail.submission.submittedAt).toLocaleString()}
      </time>
      <ul>
        {detail.submission.generations.map((generation) => (
          <li key={generation.id}>{generation.state}</li>
        ))}
      </ul>
      {detail.model.attribution && <p>{detail.model.attribution}</p>}
      <button type="button" onClick={() => dialogRef.current?.close()}>
        Close
      </button>
    </dialog>
  );
}

/** A Model's Workbench at its slug (issue #43, #44, #61): pick the Mode, press Generate, watch it dispatch, run and play its Asset live. */
export function WorkbenchPage() {
  const { slug = "" } = useParams();
  const { session } = useSession();
  const { paused, notice } = usePauseNotice();
  const pauseNoticeText = effectiveNoticeText(paused, notice);

  const [model, setModel] = useState<WorkbenchModel | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  /** 1-4 (issue #47); only meaningful when the Mode's Path holds a bound Seed Input. */
  const [count, setCount] = useState(1);
  const [issuesByInputId, setIssuesByInputId] = useState<
    Record<string, string>
  >({});
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
  });
  const [activeStates, setActiveStates] = useState<
    Map<string, GenerationState>
  >(new Map());
  const [progressById, setProgressById] = useState<
    Map<string, GenerationProgress>
  >(new Map());
  const activeCount = [...activeStates.values()].filter(
    (state) => !DONE_STATES.has(state),
  ).length;
  const [termsDialog, setTermsDialog] = useState<{
    blocking: boolean;
    error: string | null;
  } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [selectedSubmission, setSelectedSubmission] =
    useState<SubmissionSummary | null>(null);
  /** Issue #54: disables a Submission's own Cancel button while its request is in flight. */
  const [cancellingSubmissionIds, setCancellingSubmissionIds] = useState<
    Set<string>
  >(new Set());
  /** Issue #54: which Submission's Cancel request most recently failed, so the button's user sees why it's still enabled. */
  const [cancelErrorSubmissionId, setCancelErrorSubmissionId] = useState<
    string | null
  >(null);
  /** This user's Caps and usage (issue #53), for the Workbench foot. */
  const [capsStatus, setCapsStatus] = useState<CapsStatus | null>(null);

  const refreshCaps = useCallback(() => {
    fetch("/api/generations/caps")
      .then((res) => (res.ok ? (res.json() as Promise<CapsStatus>) : null))
      .then((status) => {
        if (status) setCapsStatus(status);
      })
      .catch(() => {});
  }, []);

  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  // Issue #50: each running Upload, by Input id, so Generate can wait for
  // them and a new pick can cancel the one it replaces.
  const runningUploadsRef = useRef(
    new Map<string, { promise: Promise<void>; controller: AbortController }>(),
  );
  const waitRef = useRef<{ cancelled: boolean } | null>(null);
  // Issue #51: the trim range picked on a Video/Audio Upload's local
  // player, by Input id; [0, durationMs] (the whole clip, no trim) until
  // the user drags it. One trim per Input covers every Generation in the
  // Submission, run once at Generate (not on every drag).
  const [trimRangeByInputId, setTrimRangeByInputId] = useState<
    Record<string, { startMs: number; endMs: number }>
  >({});
  const maxUploadMb =
    session.status === "signed-in" ? (session.user.maxUploadMb ?? null) : null;

  const selectedMode =
    model?.modes.find((m) => m.id === selectedModeId) ?? null;
  /** The count picker shows whenever the Mode's Path holds a bound Seed Input (issue #47's AC), even one this Mode hides (issue #48 CEO review), so it's read off `hasSeed` rather than `inputs`, which excludes hidden ones. */
  const hasSeedInput = selectedMode?.hasSeed ?? false;

  const selectMode = useCallback((mode: WorkbenchMode) => {
    setSelectedModeId(mode.id);
    setValues((current) => carryValuesFor(mode, current));
    setIssuesByInputId({});
    for (const running of runningUploadsRef.current.values()) {
      running.controller.abort();
    }
    runningUploadsRef.current.clear();
    setUploads({});
    setTrimRangeByInputId({});
    setCount(1);
  }, []);

  // Live validation (issue #46): the same parseInputValues schema the
  // server uses as the form resolver, so issues show before submit. A
  // not-yet-picked Upload isn't flagged until Generate is pressed.
  const liveIssuesByInputId = useMemo(() => {
    if (!model || !selectedMode) return {};
    const issues = liveIssuesFor(model.revision, selectedMode, values);
    for (const input of selectedMode.inputs) {
      if (UPLOAD_KINDS.has(input.kind)) delete issues[input.id];
    }
    return issues;
  }, [model, selectedMode, values]);

  const displayedIssuesByInputId = {
    ...liveIssuesByInputId,
    ...issuesByInputId,
  };

  const modelRef = useRef(model);
  modelRef.current = model;
  // Read after waiting for Uploads, so the submit sees their finished ids.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const startUpload = useCallback(
    async (input: ImageUploadInput | MediaUploadInput, file: File) => {
      const current = modelRef.current;
      if (!current) return;
      runningUploadsRef.current.get(input.id)?.controller.abort();
      runningUploadsRef.current.delete(input.id);
      setValues((v) => ({ ...v, [input.id]: "" }));
      setTrimRangeByInputId((ranges) => {
        const { [input.id]: _, ...rest } = ranges;
        return rest;
      });

      const issue = await issueFor(input, file, maxUploadMb);
      if (issue) {
        setUploads((u) => ({
          ...u,
          [input.id]: {
            status: "error",
            name: file.name,
            message: `${file.name} ${issue}.`,
          },
        }));
        return;
      }

      const controller = new AbortController();
      setUploads((u) => ({
        ...u,
        [input.id]: { status: "uploading", name: file.name, progress: 0 },
      }));
      const promise = uploadResumable(file, httpUploadApi(), {
        hint: { modelId: current.id, inputId: input.id },
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setUploads((u) => ({
            ...u,
            [input.id]: { status: "uploading", name: file.name, progress },
          }));
        },
      })
        .then((done) => {
          if (controller.signal.aborted) return;
          valuesRef.current = { ...valuesRef.current, [input.id]: done.id };
          setValues((v) => ({ ...v, [input.id]: done.id }));
          setIssuesByInputId((issues) => {
            const { [input.id]: _, ...rest } = issues;
            return rest;
          });
          setUploads((u) => ({
            ...u,
            [input.id]: {
              status: "complete",
              name: file.name,
              uploadId: done.id,
              durationMs: done.durationMs,
              browserPlayable: done.browserPlayable,
            },
          }));
          if (done.durationMs !== null) {
            setTrimRangeByInputId((ranges) => ({
              ...ranges,
              [input.id]: { startMs: 0, endMs: done.durationMs as number },
            }));
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setUploads((u) => ({
            ...u,
            [input.id]: {
              status: "error",
              name: file.name,
              message: `${file.name} ${err instanceof Error ? err.message : "couldn't be uploaded"}.`,
            },
          }));
        })
        .finally(() => {
          if (
            runningUploadsRef.current.get(input.id)?.controller === controller
          ) {
            runningUploadsRef.current.delete(input.id);
          }
        });
      runningUploadsRef.current.set(input.id, { promise, controller });
    },
    [maxUploadMb],
  );

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setNotFound(false);
    setSelectedModeId(null);

    fetch(`/api/models/${slug}`)
      .then((res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ model: WorkbenchModel }>;
      })
      .then((body) => {
        if (cancelled || !body) return;
        setModel(body.model);
        const firstMode = body.model.modes[0];
        if (firstMode) selectMode(firstMode);
        // Blocking dialog the first time a user opens a Model with terms,
        // and again whenever re-asked (issue #61).
        if (body.model.terms && !body.model.terms.accepted) {
          setTermsDialog({ blocking: true, error: null });
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, selectMode]);

  useEffect(() => {
    if (!model) return;
    let cancelled = false;

    fetch(`/api/models/${slug}/generations`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ submissions: SubmissionSummary[] }>;
      })
      .then((body) => {
        if (!cancelled) setSubmissions(body.submissions);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [model, slug]);

  useEffect(() => {
    refreshCaps();
  }, [refreshCaps]);

  useEffect(() => {
    const source = new EventSource("/api/generations/stream");

    source.addEventListener("snapshot", (event) => {
      const body = JSON.parse((event as MessageEvent).data) as {
        generations: GenerationSummary[];
      };
      setActiveStates(new Map(body.generations.map((g) => [g.id, g.state])));
      const forThisModel = body.generations.filter((g) => g.modelSlug === slug);
      setSubmissions((current) => {
        let next = current;
        for (const generation of forThisModel) {
          next = upsertGeneration(next, generation);
        }
        return next;
      });
    });

    source.addEventListener("change", (event) => {
      const generation = JSON.parse(
        (event as MessageEvent).data,
      ) as GenerationSummary;
      setActiveStates((current) => {
        const next = new Map(current);
        next.set(generation.id, generation.state);
        return next;
      });
      // A Generation finishing (or starting) moves the concurrent Cap's
      // own count, so the foot's "more at once" needs a fresh read.
      if (DONE_STATES.has(generation.state)) refreshCaps();
      if (generation.modelSlug !== slug) return;
      setSubmissions((current) => upsertGeneration(current, generation));
    });

    source.addEventListener("progress", (event) => {
      const progress = JSON.parse(
        (event as MessageEvent).data,
      ) as GenerationProgress;
      setProgressById((current) => {
        const next = new Map(current);
        next.set(progress.generationId, progress);
        return next;
      });
    });

    return () => source.close();
  }, [slug, refreshCaps]);

  const handleGenerate = useCallback(async () => {
    // Issue #50: pressed early, Generate waits for running Uploads, then
    // submits, unless "Don't start" is pressed meanwhile.
    const running = [...runningUploadsRef.current.values()];
    if (running.length > 0) {
      const wait = { cancelled: false };
      waitRef.current = wait;
      setSubmitState({ status: "waiting" });
      await Promise.allSettled(running.map((r) => r.promise));
      if (wait.cancelled) return;
      waitRef.current = null;
    }

    const current = modelRef.current;
    const mode = current?.modes.find((m) => m.id === selectedModeId);
    if (!current || !mode) return;
    let values = valuesRef.current;

    const issues = liveIssuesFor(current.revision, mode, values);
    if (Object.keys(issues).length > 0) {
      setIssuesByInputId(issues);
      setSubmitState({
        status: "error",
        message: "Check the highlighted fields.",
      });
      return;
    }

    // Issue #51's AC: one trim, covering every Generation this Submission
    // creates, run here (not on every drag of the range) and only for a
    // range that actually cuts something.
    const mediaInputs = mode.inputs.filter(
      (input): input is MediaUploadInput =>
        input.kind === "video_upload" || input.kind === "audio_upload",
    );
    const toTrim = mediaInputs.filter((input) => {
      const upload = uploads[input.id];
      const range = trimRangeByInputId[input.id];
      return (
        upload?.status === "complete" &&
        upload.durationMs !== null &&
        range &&
        (range.startMs > 0 || range.endMs < upload.durationMs)
      );
    });
    if (toTrim.length > 0) {
      setSubmitState({ status: "trimming" });
      try {
        const trimmed = await Promise.all(
          toTrim.map(async (input) => {
            const upload = uploads[input.id];
            const range = trimRangeByInputId[input.id];
            if (upload?.status !== "complete" || !range) return null;
            const result = await trimUpload(
              upload.uploadId,
              range.startMs,
              range.endMs,
            );
            return [input.id, result.id] as const;
          }),
        );
        const updates = Object.fromEntries(
          trimmed.filter((t): t is readonly [string, string] => t !== null),
        );
        values = { ...values, ...updates };
        valuesRef.current = values;
        setValues((v) => ({ ...v, ...updates }));
      } catch (err) {
        setSubmitState({
          status: "error",
          message: err instanceof Error ? err.message : "couldn't be trimmed",
        });
        return;
      }
    }

    setSubmitState({ status: "submitting" });
    setIssuesByInputId({});

    try {
      const res = await fetch(`/api/models/${current.slug}/generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modeId: mode.id,
          revision: current.revision,
          values: valuesPayload(mode, values),
          ...(mode.inputs.some((input) => input.kind === "seed")
            ? { count }
            : {}),
        }),
      });

      if (res.status === 409) {
        const body = (await res.json()) as {
          error: string;
          model?: WorkbenchModel;
          cap?: number;
          remaining?: number;
        };
        if (body.error === "daily_cap_exceeded") {
          refreshCaps();
          setSubmitState({
            status: "error",
            message: `You've reached today's Cap of ${body.cap}.`,
          });
          return;
        }
        if (body.error === "concurrent_cap_exceeded") {
          refreshCaps();
          setSubmitState({
            status: "error",
            message: `You already have ${body.cap} Generations at once; wait for one to finish.`,
          });
          return;
        }
        if (body.error === "model_changed" && body.model) {
          setModel(body.model);
          const stillSelected = body.model.modes.find(
            (m) => m.id === selectedModeId,
          );
          const nextMode = stillSelected ?? body.model.modes[0] ?? mode;
          setSelectedModeId(nextMode.id);
          setValues((current) => carryValuesFor(nextMode, current, true));
          setIssuesByInputId({});
          setSubmitState({
            status: "error",
            message:
              "This Model changed; reloaded. Check your Mode and try again.",
          });
          return;
        }
        if (body.error === "model_terms_required") {
          // Re-fetch so the dialog shows the current (possibly re-asked)
          // terms version; the submit itself queued nothing (issue #61).
          const refreshed = await fetch(`/api/models/${current.slug}`)
            .then((r) =>
              r.ok ? (r.json() as Promise<{ model: WorkbenchModel }>) : null,
            )
            .catch(() => null);
          if (refreshed) setModel(refreshed.model);
          setTermsDialog({
            blocking: true,
            error: "Accept this Model's terms to continue.",
          });
          setSubmitState({ status: "idle" });
          return;
        }
        setSubmitState({
          status: "error",
          message: "This Model is no longer available.",
        });
        return;
      }

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          issues?: InputIssue[];
        };
        if (body.error === "invalid" && body.issues) {
          setIssuesByInputId(
            Object.fromEntries(
              body.issues.map((issue) => [issue.path, issue.message]),
            ),
          );
          setSubmitState({
            status: "error",
            message: "Check the highlighted fields.",
          });
          return;
        }
        setSubmitState({
          status: "error",
          message:
            body.message ?? body.error ?? `unexpected status ${res.status}`,
        });
        return;
      }

      // The 201 carries this Submission's own prompt (issue #47 AC); SSE's
      // `change` events, which have no prompt, would otherwise leave it
      // blank until a reload.
      const created = (await res.json()) as {
        generations: GenerationSummary[];
        prompt: string | null;
      };
      if (created.generations.length > 0) {
        const submissionId = created.generations[0]?.submissionId;
        setSubmissions((current) => {
          const next = created.generations.reduce(upsertGeneration, current);
          return next.map((submission) =>
            submission.submissionId === submissionId
              ? { ...submission, prompt: created.prompt }
              : submission,
          );
        });
      }

      refreshCaps();
      setSubmitState({ status: "idle" });
    } catch {
      setSubmitState({ status: "error", message: "could not submit" });
    }
  }, [selectedModeId, count, uploads, trimRangeByInputId, refreshCaps]);

  const cancelWaiting = useCallback(() => {
    if (waitRef.current) waitRef.current.cancelled = true;
    waitRef.current = null;
    setSubmitState({ status: "idle" });
  }, []);

  const handleCancelSubmission = useCallback(async (submissionId: string) => {
    setCancellingSubmissionIds((current) => new Set(current).add(submissionId));
    setCancelErrorSubmissionId(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        setCancelErrorSubmissionId(submissionId);
      }
    } catch {
      // The SSE stream carries the real outcome either way; a failed
      // request here just means this button stays enabled to retry.
      setCancelErrorSubmissionId(submissionId);
    } finally {
      setCancellingSubmissionIds((current) => {
        const next = new Set(current);
        next.delete(submissionId);
        return next;
      });
    }
  }, []);

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (notFound) {
    return (
      <>
        <main>
          <p role="alert">Model not found.</p>
        </main>
        <Footer />
      </>
    );
  }
  if (!model) return <p>Loading…</p>;
  const currentModel = model;

  async function handleAcceptTerms() {
    setAccepting(true);
    try {
      const res = await fetch(`/api/models/${currentModel.slug}/terms/accept`, {
        method: "POST",
      });
      if (!res.ok) {
        setTermsDialog({
          blocking: true,
          error: "Could not record your acceptance. Please try again.",
        });
        return;
      }
      setModel((current) =>
        current?.terms
          ? { ...current, terms: { ...current.terms, accepted: true } }
          : current,
      );
      setTermsDialog(null);
    } finally {
      setAccepting(false);
    }
  }

  return (
    <>
      <main className="workbench">
        <style>{WORKBENCH_STYLE}</style>

        <header className="workbench-header">
          <h1>{model.name}</h1>
          {model.description && <p>{model.description}</p>}
          {model.attribution && <p>{model.attribution}</p>}
          <p>
            <Link to={`/gallery?model=${model.id}`}>View in Gallery</Link>
          </p>
          {model.terms && (
            <p>
              <button
                type="button"
                onClick={() => setTermsDialog({ blocking: false, error: null })}
              >
                Model terms
              </button>
            </p>
          )}
        </header>

        {termsDialog && model.terms && (
          <ModelTermsDialog
            modelName={model.name}
            terms={model.terms}
            blocking={termsDialog.blocking}
            accepting={accepting}
            error={termsDialog.error}
            onAccept={() => void handleAcceptTerms()}
            onClose={() => setTermsDialog(null)}
          />
        )}

        {selectedSubmission && (
          <GenerationDetailDialog
            detail={{ submission: selectedSubmission, model }}
            onClose={() => setSelectedSubmission(null)}
          />
        )}

        <div className="workbench-layout">
          <section className="workbench-form">
            {model.modes.length <= 1 ? (
              <h2>{model.modes[0]?.name ?? "Default"}</h2>
            ) : (
              <fieldset>
                <legend>Mode</legend>
                {groupModesForMenu(model.modes).map(({ group, modes }) => (
                  <fieldset key={group}>
                    <legend>{MODE_MENU_GROUP_LABELS[group]}</legend>
                    {modes.map((mode) => (
                      <label key={mode.id} style={{ display: "block" }}>
                        <input
                          type="radio"
                          name="mode"
                          value={mode.id}
                          checked={selectedModeId === mode.id}
                          onChange={() => selectMode(mode)}
                        />
                        {mode.name}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </fieldset>
            )}

            {selectedMode && (
              <YourFiles
                inputs={selectedMode.inputs.filter(
                  (input): input is ImageUploadInput =>
                    input.kind === "image_upload",
                )}
                uploads={uploads}
                issuesByInputId={displayedIssuesByInputId}
                onPick={(input, file) => void startUpload(input, file)}
              />
            )}

            {selectedMode && (
              <YourMedia
                inputs={selectedMode.inputs.filter(
                  (input): input is MediaUploadInput =>
                    input.kind === "video_upload" ||
                    input.kind === "audio_upload",
                )}
                uploads={uploads}
                trimRangeByInputId={trimRangeByInputId}
                onTrimRangeChange={(inputId, range) =>
                  setTrimRangeByInputId((ranges) => ({
                    ...ranges,
                    [inputId]: range,
                  }))
                }
                issuesByInputId={displayedIssuesByInputId}
                onPick={(input, file) => void startUpload(input, file)}
              />
            )}

            {selectedMode && (
              <InputGroups
                mode={selectedMode}
                values={values}
                setValues={(update) => {
                  setValues((current) => {
                    const next = update(current);
                    const changedIds = Object.keys(next).filter(
                      (id) => next[id] !== current[id],
                    );
                    if (changedIds.length > 0) {
                      setIssuesByInputId((issues) => {
                        const remaining = { ...issues };
                        for (const id of changedIds) delete remaining[id];
                        return remaining;
                      });
                    }
                    return next;
                  });
                }}
                issuesByInputId={displayedIssuesByInputId}
              />
            )}

            {hasSeedInput && (
              <fieldset>
                <legend>Variants</legend>
                <label htmlFor="submission-count">How many (1-4)</label>
                <select
                  id="submission-count"
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </fieldset>
            )}

            {submitState.status === "error" && (
              <p role="alert">{submitState.message}</p>
            )}
          </section>

          <aside className="workbench-submissions" aria-label="Submissions">
            <h2>Submissions</h2>
            {submissions.length === 0 && <p>No Submissions yet.</p>}
            <ul>
              {submissions.map((submission) => {
                const hasUnfinished = submission.generations.some(
                  (g) => !DONE_STATES.has(g.state),
                );
                return (
                  <li key={submission.submissionId}>
                    <button
                      type="button"
                      onClick={() => setSelectedSubmission(submission)}
                    >
                      <strong>{submission.modeName}</strong>{" "}
                      <time dateTime={submission.submittedAt}>
                        {new Date(submission.submittedAt).toLocaleString()}
                      </time>
                      {submission.prompt && (
                        <span style={{ display: "block" }}>
                          {submission.prompt}
                        </span>
                      )}
                    </button>
                    {hasUnfinished && (
                      <button
                        type="button"
                        disabled={cancellingSubmissionIds.has(
                          submission.submissionId,
                        )}
                        onClick={() =>
                          void handleCancelSubmission(submission.submissionId)
                        }
                      >
                        Cancel
                      </button>
                    )}
                    {cancelErrorSubmissionId === submission.submissionId && (
                      <p role="alert">Could not cancel. Please try again.</p>
                    )}
                    <ul>
                      {submission.generations.map((generation) => (
                        <GenerationCard
                          key={generation.id}
                          generation={generation}
                          progress={progressById.get(generation.id)}
                          paused={paused}
                        />
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>

        <footer className="workbench-generate-bar">
          {capsStatus && (
            <span className="workbench-caps">
              {capsFooterText(capsStatus, new Date())}
            </span>
          )}
          {activeCount > 0 && (
            <span className="workbench-chip">{activeCount} under way</span>
          )}
          {submitState.status === "waiting" ? (
            <>
              <output>Waiting for your files to finish…</output>
              <button type="button" onClick={cancelWaiting}>
                Don't start
              </button>
            </>
          ) : submitState.status === "trimming" ? (
            <output>Trimming your video or audio…</output>
          ) : (
            <>
              {paused && pauseNoticeText && (
                // biome-ignore lint/a11y/useSemanticElements: <output> is for a form's calculated result, not this status message
                <p role="status">{pauseNoticeText}</p>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={
                  !selectedModeId ||
                  submitState.status === "submitting" ||
                  paused
                }
              >
                Generate
              </button>
            </>
          )}
        </footer>
      </main>
      <Footer />
    </>
  );
}

interface InputGroupsProps {
  mode: WorkbenchMode;
  values: Record<string, string>;
  setValues: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  issuesByInputId: Record<string, string>;
}

const GROUP_LABELS: Record<WorkbenchInput["group"], string> = {
  describe: "Describe it",
  settings: "Settings",
};

/** The Workbench's Inputs, grouped as Describe it and Settings, in the Admin's order (issue #46). */
function InputGroups({
  mode,
  values,
  setValues,
  issuesByInputId,
}: InputGroupsProps) {
  function setValue(inputId: string, value: string) {
    setValues((current) => ({ ...current, [inputId]: value }));
  }

  return (
    <>
      {(["describe", "settings"] as const).map((group) => {
        const inputs = mode.inputs.filter(
          (input) => input.group === group && !UPLOAD_KINDS.has(input.kind),
        );
        if (inputs.length === 0) return null;
        return (
          <fieldset key={group}>
            <legend>{GROUP_LABELS[group]}</legend>
            {inputs.map((input) => (
              <InputField
                key={input.id}
                input={input}
                value={values[input.id] ?? ""}
                onChange={(value) => setValue(input.id, value)}
                issue={issuesByInputId[input.id]}
              />
            ))}
          </fieldset>
        );
      })}
    </>
  );
}

/** The Workbench's Image Upload Inputs (issue #50), always required: pick a file, watch it upload, see its thumbnail. */
function YourFiles({
  inputs,
  uploads,
  issuesByInputId,
  onPick,
}: {
  inputs: ImageUploadInput[];
  uploads: Record<string, UploadState>;
  issuesByInputId: Record<string, string>;
  onPick: (input: ImageUploadInput, file: File) => void;
}) {
  if (inputs.length === 0) return null;
  return (
    <fieldset>
      <legend>Your files</legend>
      {inputs.map((input) => {
        const upload = uploads[input.id];
        const issue =
          upload?.status === "error"
            ? upload.message
            : upload?.status === "uploading"
              ? undefined
              : issuesByInputId[input.id];
        const issueId = issue ? `input-issue-${input.id}` : undefined;
        return (
          <div key={input.id}>
            <label htmlFor={`input-${input.id}`}>{input.label}</label>
            {input.help && <p>{input.help}</p>}
            <input
              id={`input-${input.id}`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              aria-describedby={issueId}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPick(input, file);
              }}
            />
            <p>
              PNG, JPEG or WebP, up to {input.maxSizeMb} MB
              {input.maxLongSide !== null &&
                `, at most ${input.maxLongSide} px on its long side`}
              .
            </p>
            {upload?.status === "uploading" && (
              <progress
                aria-label={`Uploading ${upload.name}`}
                max={1}
                value={upload.progress}
              />
            )}
            {upload?.status === "complete" && (
              <p>
                <img
                  src={`/api/uploads/${upload.uploadId}/thumb`}
                  alt=""
                  className="workbench-thumb"
                />{" "}
                {upload.name}
              </p>
            )}
            {issue && (
              <p id={issueId} role="alert">
                {issue}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

const VIDEO_ACCEPT = ".mp4,.mov,.webm,.mkv";
const AUDIO_ACCEPT = ".wav,.mp3,.flac,.ogg,.opus,.m4a,.aac";

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** The Workbench's Video/Audio Upload Inputs (issue #51): pick a file, watch it upload, then optionally trim it on a local player. */
function YourMedia({
  inputs,
  uploads,
  trimRangeByInputId,
  onTrimRangeChange,
  issuesByInputId,
  onPick,
}: {
  inputs: MediaUploadInput[];
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, { startMs: number; endMs: number }>;
  onTrimRangeChange: (
    inputId: string,
    range: { startMs: number; endMs: number },
  ) => void;
  issuesByInputId: Record<string, string>;
  onPick: (input: MediaUploadInput, file: File) => void;
}) {
  if (inputs.length === 0) return null;
  return (
    <fieldset>
      <legend>Your media</legend>
      {inputs.map((input) => {
        const upload = uploads[input.id];
        const issue =
          upload?.status === "error"
            ? upload.message
            : upload?.status === "uploading"
              ? undefined
              : issuesByInputId[input.id];
        const issueId = issue ? `input-issue-${input.id}` : undefined;
        const isVideo = input.kind === "video_upload";
        const range = trimRangeByInputId[input.id];
        const canTrim =
          input.trimmable &&
          upload?.status === "complete" &&
          upload.durationMs !== null &&
          upload.browserPlayable !== false;
        return (
          <div key={input.id}>
            <label htmlFor={`input-${input.id}`}>{input.label}</label>
            {input.help && <p>{input.help}</p>}
            <input
              id={`input-${input.id}`}
              type="file"
              accept={isVideo ? VIDEO_ACCEPT : AUDIO_ACCEPT}
              required
              aria-describedby={issueId}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPick(input, file);
              }}
            />
            <p>
              {isVideo
                ? "MP4, MOV, WebM or MKV"
                : "WAV, MP3, FLAC, OGG/Opus or M4A/AAC"}
              , up to {input.maxSizeMb} MB, {formatSeconds(input.minDurationMs)}
              –{formatSeconds(input.maxDurationMs)}s
              {isVideo &&
                (input as VideoUploadInput).maxLongSide !== null &&
                `, at most ${(input as VideoUploadInput).maxLongSide} px on its long side`}
              .
            </p>
            {upload?.status === "uploading" && (
              <progress
                aria-label={`Uploading ${upload.name}`}
                max={1}
                value={upload.progress}
              />
            )}
            {upload?.status === "complete" && (
              <div>
                <p>{upload.name}</p>
                {upload.browserPlayable === false ? (
                  <p>
                    This browser can't preview this file, so it's used as
                    uploaded, untrimmed.
                  </p>
                ) : isVideo ? (
                  // biome-ignore lint/a11y/useMediaCaption: a user's own upload has no captions to offer.
                  <video
                    controls
                    src={`/api/uploads/${upload.uploadId}`}
                    className="workbench-thumb"
                  />
                ) : (
                  // biome-ignore lint/a11y/useMediaCaption: a user's own upload has no captions to offer.
                  <audio controls src={`/api/uploads/${upload.uploadId}`} />
                )}
                {canTrim && range && (
                  <div>
                    <label htmlFor={`input-trim-start-${input.id}`}>
                      Start (s)
                    </label>
                    <input
                      id={`input-trim-start-${input.id}`}
                      type="number"
                      min={0}
                      max={formatSeconds(range.endMs)}
                      step={0.1}
                      value={formatSeconds(range.startMs)}
                      onChange={(event) => {
                        const startMs = Math.round(
                          Number(event.target.value) * 1000,
                        );
                        if (Number.isFinite(startMs)) {
                          onTrimRangeChange(input.id, { ...range, startMs });
                        }
                      }}
                    />
                    <label htmlFor={`input-trim-end-${input.id}`}>
                      End (s)
                    </label>
                    <input
                      id={`input-trim-end-${input.id}`}
                      type="number"
                      min={formatSeconds(range.startMs)}
                      max={formatSeconds(upload.durationMs ?? 0)}
                      step={0.1}
                      value={formatSeconds(range.endMs)}
                      onChange={(event) => {
                        const endMs = Math.round(
                          Number(event.target.value) * 1000,
                        );
                        if (Number.isFinite(endMs)) {
                          onTrimRangeChange(input.id, { ...range, endMs });
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            {issue && (
              <p id={issueId} role="alert">
                {issue}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

interface InputFieldProps {
  input: WorkbenchInput;
  value: string;
  onChange: (value: string) => void;
  issue: string | undefined;
}

/** One Input's field: a blank, optional Input shows the Workflow's own value as its placeholder (issue #46). */
function InputField({ input, value, onChange, issue }: InputFieldProps) {
  const placeholder =
    input.placeholder === null ? undefined : String(input.placeholder);
  const helpId = input.help ? `input-help-${input.id}` : undefined;
  const issueId = issue ? `input-issue-${input.id}` : undefined;
  const describedBy = [helpId, issueId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={`input-${input.id}`}>
        {input.label}
        {input.required && " (required)"}
      </label>
      {input.help && <p id={helpId}>{input.help}</p>}

      {input.kind === "text" &&
        (input.multiline ? (
          <textarea
            id={`input-${input.id}`}
            value={value}
            placeholder={placeholder}
            maxLength={input.maxLength}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <input
            id={`input-${input.id}`}
            value={value}
            placeholder={placeholder}
            maxLength={input.maxLength}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value)}
          />
        ))}

      {input.kind === "number" && (
        <input
          id={`input-${input.id}`}
          type="number"
          value={value}
          placeholder={placeholder}
          min={input.min}
          max={input.max}
          step={input.step}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {input.kind === "seed" && (
        <input
          id={`input-${input.id}`}
          type="number"
          value={value}
          placeholder="Random"
          min={0}
          max={input.max ?? undefined}
          step={1}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {input.kind === "select" && input.options.length === 2 && (
        <label>
          <input
            type="checkbox"
            id={`input-${input.id}`}
            checked={value === input.options[1]?.id}
            aria-describedby={describedBy}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? (input.options[1]?.id ?? "")
                  : (input.options[0]?.id ?? ""),
              )
            }
          />
          {value === input.options[1]?.id
            ? input.options[1]?.label
            : (input.options[0]?.label ?? "")}
        </label>
      )}

      {input.kind === "select" && input.options.length !== 2 && (
        <select
          id={`input-${input.id}`}
          value={value}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Use the Workflow's value</option>
          {input.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      )}

      {issue && (
        <p id={issueId} role="alert">
          {issue}
        </p>
      )}
    </div>
  );
}

function groupBySubmission(
  generations: GenerationSummary[],
): SubmissionSummary[] {
  const bySubmission = new Map<string, GenerationSummary[]>();
  for (const generation of generations) {
    const list = bySubmission.get(generation.submissionId) ?? [];
    list.push(generation);
    bySubmission.set(generation.submissionId, list);
  }
  return [...bySubmission.entries()].map(([submissionId, gens]) => ({
    submissionId,
    modeId: gens[0]?.modeId ?? "",
    modeName: gens[0]?.modeName ?? "",
    submittedAt: gens[0]?.submittedAt ?? "",
    generations: gens,
  }));
}

const WORKBENCH_STYLE = `
.workbench-asset {
  display: block;
  max-width: 100%;
  margin-top: 0.25rem;
}
.workbench-progress {
  opacity: 0.8;
}
.workbench-thumb {
  max-width: 160px;
  max-height: 160px;
  vertical-align: middle;
}
.workbench-download {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
}
.workbench-ai-reminder {
  opacity: 0.7;
}
.workbench-layout {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
}
.workbench-form {
  flex: 1;
  min-width: 0;
}
.workbench-submissions {
  width: 320px;
  flex-shrink: 0;
}
.workbench-generate-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
  border-top: 1px solid currentColor;
}
.workbench-caps {
  margin-right: auto;
  opacity: 0.8;
  font-size: 0.9em;
}
@media (max-width: 640px) {
  .workbench-layout {
    flex-direction: column;
  }
  .workbench-submissions {
    width: auto;
  }
  .workbench-generate-bar {
    justify-content: space-between;
  }
}
`;
