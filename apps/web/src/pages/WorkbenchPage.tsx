import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
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

interface WorkbenchMode {
  id: string;
  name: string;
  description: string;
  inputs: WorkbenchInput[];
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
  const [values, setValues] = useState<Record<string, string>>({});
  const [issuesByInputId, setIssuesByInputId] = useState<
    Record<string, string>
  >({});
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
  });
  const [activeCount, setActiveCount] = useState(0);

  const selectedMode =
    model?.modes.find((m) => m.id === selectedModeId) ?? null;

  const selectMode = useCallback((mode: WorkbenchMode) => {
    setSelectedModeId(mode.id);
    setValues(initialValuesFor(mode));
    setIssuesByInputId({});
  }, []);

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
    const mode = current?.modes.find((m) => m.id === selectedModeId);
    if (!current || !mode) return;
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
          selectMode(stillSelected ?? body.model.modes[0] ?? mode);
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
  }, [selectedModeId, values, selectMode]);

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
                    onChange={() => selectMode(mode)}
                  />
                  {mode.name}
                </label>
              ))}
            </fieldset>
          )}

          {selectedMode && (
            <InputGroups
              mode={selectedMode}
              values={values}
              setValues={setValues}
              issuesByInputId={issuesByInputId}
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
      <label htmlFor={`input-${input.id}`}>{input.label}</label>
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
