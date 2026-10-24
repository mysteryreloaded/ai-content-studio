import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useSession } from "../useSession.js";

interface WorkbenchMode {
  id: string;
  name: string;
  description: string;
}

interface WorkbenchModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  revision: number;
  modes: WorkbenchMode[];
}

interface GenerationSummary {
  id: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modeId: string;
  modeName: string;
  submissionId: string;
  state: "queued";
  submittedAt: string;
}

interface SubmissionSummary {
  submissionId: string;
  modeId: string;
  modeName: string;
  submittedAt: string;
  generations: GenerationSummary[];
}

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

function dedupeBySubmission(
  submissions: SubmissionSummary[],
): SubmissionSummary[] {
  const seen = new Set<string>();
  const result: SubmissionSummary[] = [];
  for (const submission of submissions) {
    if (seen.has(submission.submissionId)) continue;
    seen.add(submission.submissionId);
    result.push(submission);
  }
  return result.slice(0, 8);
}

/** A Model's Workbench at its slug (issue #43): pick the Mode, press Generate, watch it queue live. */
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
  const [activeCount, setActiveCount] = useState(0);

  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    setModel(null);
    setNotFound(false);
    setSelectedModeId(null);

    fetch(`/api/models/${slug}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ model: WorkbenchModel }>;
      })
      .then((body) => {
        if (!body) return;
        setModel(body.model);
        setSelectedModeId(body.model.modes[0]?.id ?? null);
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  useEffect(() => {
    if (!model) return;
    fetch(`/api/models/${slug}/generations`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ submissions: SubmissionSummary[] }>;
      })
      .then((body) => setSubmissions(body.submissions))
      .catch(() => {});
  }, [model, slug]);

  useEffect(() => {
    const source = new EventSource("/api/generations/stream");

    source.addEventListener("snapshot", (event) => {
      const body = JSON.parse((event as MessageEvent).data) as {
        generations: GenerationSummary[];
      };
      setActiveCount(body.generations.length);
      const forThisModel = body.generations.filter((g) => g.modelSlug === slug);
      if (forThisModel.length > 0) {
        setSubmissions((current) =>
          dedupeBySubmission([...groupBySubmission(forThisModel), ...current]),
        );
      }
    });

    source.addEventListener("change", (event) => {
      const generation = JSON.parse(
        (event as MessageEvent).data,
      ) as GenerationSummary;
      // Every "change" is a newly queued Generation for now (issue #43:
      // nothing moves it on yet), so the active count only ever grows.
      setActiveCount((count) => count + 1);
      if (generation.modelSlug !== slug) return;
      setSubmissions((current) =>
        dedupeBySubmission([
          {
            submissionId: generation.submissionId,
            modeId: generation.modeId,
            modeName: generation.modeName,
            submittedAt: generation.submittedAt,
            generations: [generation],
          },
          ...current,
        ]),
      );
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
      <main>
        <p role="alert">Model not found.</p>
      </main>
    );
  }
  if (!model) return <p>Loading…</p>;

  return (
    <main className="workbench">
      <style>{WORKBENCH_STYLE}</style>

      <header className="workbench-header">
        <h1>{model.name}</h1>
        {model.description && <p>{model.description}</p>}
      </header>

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
                <strong>{submission.modeName}</strong>{" "}
                <time dateTime={submission.submittedAt}>
                  {new Date(submission.submittedAt).toLocaleString()}
                </time>{" "}
                <span>Queued</span>
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
