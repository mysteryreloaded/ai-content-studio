import {
  parseInputValues,
  renderMarkdown,
  toInputIssues,
} from "@ai-content-studio/shared";
import type { InputDefinition } from "@ai-content-studio/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Footer } from "../Footer.js";
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
);

type ModeMenuGroup = "prompt" | "images" | "audio" | "video";

interface WorkbenchMode {
  id: string;
  name: string;
  description: string;
  inputs: WorkbenchInput[];
  menuGroup: ModeMenuGroup;
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
    values[input.id] =
      input.default === null || input.default === undefined
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
    payload[input.id] = input.kind === "number" ? Number(raw) : raw;
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
  | "failed";

const DONE_STATES = new Set<GenerationState>(["succeeded", "failed"]);

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
  | { status: "submitting" }
  | { status: "error"; message: string };

function stateLabel(state: GenerationState): string {
  switch (state) {
    case "queued":
      return "Queued";
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
}: {
  generation: GenerationSummary;
  progress: GenerationProgress | undefined;
}) {
  const mainAsset = generation.assets?.[0];
  return (
    <li>
      <span>{stateLabel(generation.state)}</span>{" "}
      {(generation.state === "starting" || generation.state === "running") && (
        <ProgressLabel progress={progress} />
      )}
      {generation.state === "failed" && generation.error && (
        <span role="alert">{generation.error}</span>
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

  const [model, setModel] = useState<WorkbenchModel | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
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

  const selectedMode =
    model?.modes.find((m) => m.id === selectedModeId) ?? null;

  const selectMode = useCallback((mode: WorkbenchMode) => {
    setSelectedModeId(mode.id);
    setValues((current) => carryValuesFor(mode, current));
    setIssuesByInputId({});
  }, []);

  // Live validation (issue #46): the same parseInputValues schema the
  // server uses as the form resolver, so issues show before submit.
  const liveIssuesByInputId = useMemo(() => {
    if (!model || !selectedMode) return {};
    return liveIssuesFor(model.revision, selectedMode, values);
  }, [model, selectedMode, values]);

  const displayedIssuesByInputId = {
    ...liveIssuesByInputId,
    ...issuesByInputId,
  };

  const modelRef = useRef(model);
  modelRef.current = model;

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
  }, [slug]);

  const handleGenerate = useCallback(async () => {
    const current = modelRef.current;
    const mode = current?.modes.find((m) => m.id === selectedModeId);
    if (!current || !mode) return;

    const issues = liveIssuesFor(current.revision, mode, values);
    if (Object.keys(issues).length > 0) {
      setIssuesByInputId(issues);
      setSubmitState({
        status: "error",
        message: "Check the highlighted fields.",
      });
      return;
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
        }),
      });

      if (res.status === 409) {
        const body = (await res.json()) as {
          error: string;
          model?: WorkbenchModel;
        };
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

      setSubmitState({ status: "idle" });
    } catch {
      setSubmitState({ status: "error", message: "could not submit" });
    }
  }, [selectedModeId, values]);

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

            {submitState.status === "error" && (
              <p role="alert">{submitState.message}</p>
            )}
          </section>

          <aside className="workbench-submissions" aria-label="Submissions">
            <h2>Submissions</h2>
            {submissions.length === 0 && <p>No Submissions yet.</p>}
            <ul>
              {submissions.map((submission) => (
                <li key={submission.submissionId}>
                  <button
                    type="button"
                    onClick={() => setSelectedSubmission(submission)}
                  >
                    <strong>{submission.modeName}</strong>{" "}
                    <time dateTime={submission.submittedAt}>
                      {new Date(submission.submittedAt).toLocaleString()}
                    </time>
                  </button>
                  <ul>
                    {submission.generations.map((generation) => (
                      <GenerationCard
                        key={generation.id}
                        generation={generation}
                        progress={progressById.get(generation.id)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <footer className="workbench-generate-bar">
          {activeCount > 0 && (
            <span className="workbench-chip">{activeCount} under way</span>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!selectedModeId || submitState.status === "submitting"}
          >
            Generate
          </button>
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
        const inputs = mode.inputs.filter((input) => input.group === group);
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
