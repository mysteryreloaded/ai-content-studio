import { renderMarkdown } from "@ai-content-studio/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Footer } from "../Footer.js";
import { useSession } from "../useSession.js";

interface WorkbenchMode {
  id: string;
  name: string;
  description: string;
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
    // biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer.
    return <video controls src={assetSrc(asset)} className="workbench-asset" />;
  }
  if (asset.kind === "audio") {
    // biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer.
    return <audio controls src={assetSrc(asset)} className="workbench-asset" />;
  }
  return <img src={assetSrc(asset)} alt="" className="workbench-asset" />;
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
        <AssetPlayer asset={mainAsset} />
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
        setSelectedModeId(body.model.modes[0]?.id ?? null);
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
  }, [slug]);

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
    if (!current || !selectedModeId) return;
    setSubmitState({ status: "submitting" });

    try {
      const res = await fetch(`/api/models/${current.slug}/generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modeId: selectedModeId,
          revision: current.revision,
        }),
      });

      if (res.status === 409) {
        const body = (await res.json()) as {
          error: string;
          model?: WorkbenchModel;
        };
        if (body.error === "model_changed" && body.model) {
          setModel(body.model);
          setSelectedModeId(
            body.model.modes.find((m) => m.id === selectedModeId)?.id ??
              body.model.modes[0]?.id ??
              null,
          );
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
        };
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
  }, [selectedModeId]);

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
                {model.modes.map((mode) => (
                  <label key={mode.id} style={{ display: "block" }}>
                    <input
                      type="radio"
                      name="mode"
                      value={mode.id}
                      checked={selectedModeId === mode.id}
                      onChange={() => setSelectedModeId(mode.id)}
                    />
                    {mode.name}
                  </label>
                ))}
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

const WORKBENCH_STYLE = `
.workbench-asset {
  display: block;
  max-width: 100%;
  margin-top: 0.25rem;
}
.workbench-progress {
  opacity: 0.8;
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
