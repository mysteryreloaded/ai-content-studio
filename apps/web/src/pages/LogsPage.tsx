import { type FormEvent, useEffect, useRef, useState } from "react";

type LogLevel = "error" | "warning" | "info";
type LogSource = "backend" | "app";

interface LogEntry {
  id: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  details: string | null;
  backendId: string | null;
  backendName: string | null;
  userId: string | null;
  userEmail: string | null;
  modelId: string | null;
  generationId: string | null;
  createdAt: string;
}

interface LogsResponse {
  entries: LogEntry[];
}

interface AdminBackendOption {
  id: string;
  name: string;
}

interface FilterState {
  level: LogLevel | "";
  source: LogSource | "";
  backendId: string;
  userId: string;
  modelId: string;
  generationId: string;
  from: string;
  to: string;
  q: string;
}

const BLANK_FILTERS: FilterState = {
  level: "",
  source: "",
  backendId: "",
  userId: "",
  modelId: "",
  generationId: "",
  from: "",
  to: "",
  q: "",
};

function queryStringFrom(filters: FilterState): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    if (key === "from" || key === "to") {
      params.set(key, new Date(value).toISOString());
    } else {
      params.set(key, value);
    }
  }
  return params.toString();
}

/** The admin Logs page: filters, raw ComfyUI errors as recorded, refresh (issue #67). */
export function LogsPage() {
  // `draft` is what the form shows as the user types/picks; `applied` is
  // what was last actually sent to the server, only updated on Apply (or
  // Refresh with the same filters), so filling in a Model/User/Generation
  // id or Text search doesn't fire a request per keystroke.
  const [draft, setDraft] = useState<FilterState>(BLANK_FILTERS);
  const [applied, setApplied] = useState<FilterState>(BLANK_FILTERS);
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendOptions, setBackendOptions] = useState<AdminBackendOption[]>(
    [],
  );
  const requestSeq = useRef(0);

  function load() {
    const seq = ++requestSeq.current;
    const qs = queryStringFrom(applied);
    fetch(`/api/admin/logs${qs ? `?${qs}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<LogsResponse>;
      })
      .then((body) => {
        // An older request that resolves after a newer one must not
        // overwrite it with stale results.
        if (seq !== requestSeq.current) return;
        setData(body);
        setLoadError(null);
      })
      .catch(() => {
        if (seq !== requestSeq.current) return;
        setLoadError("could not load Log entries");
      });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render, applied is the actual dependency
  useEffect(load, [applied]);

  useEffect(() => {
    fetch("/api/admin/backends")
      .then((res) => (res.ok ? res.json() : { backends: [] }))
      .then((body: { backends: AdminBackendOption[] }) =>
        setBackendOptions(body.backends ?? []),
      )
      .catch(() => setBackendOptions([]));
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setApplied(draft);
  }

  function handleClear() {
    setDraft(BLANK_FILTERS);
    setApplied(BLANK_FILTERS);
  }

  return (
    <section>
      <h2>Logs</h2>

      <form onSubmit={handleSubmit}>
        <label htmlFor="log-level">Level</label>
        <select
          id="log-level"
          value={draft.level}
          onChange={(event) =>
            setDraft({
              ...draft,
              level: event.target.value as FilterState["level"],
            })
          }
        >
          <option value="">Any</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        <label htmlFor="log-source">Source</label>
        <select
          id="log-source"
          value={draft.source}
          onChange={(event) =>
            setDraft({
              ...draft,
              source: event.target.value as FilterState["source"],
            })
          }
        >
          <option value="">Any</option>
          <option value="backend">Backend</option>
          <option value="app">App</option>
        </select>

        <label htmlFor="log-backend">Backend</label>
        <select
          id="log-backend"
          value={draft.backendId}
          onChange={(event) =>
            setDraft({ ...draft, backendId: event.target.value })
          }
        >
          <option value="">Any</option>
          {backendOptions.map((backend) => (
            <option key={backend.id} value={backend.id}>
              {backend.name}
            </option>
          ))}
        </select>

        <label htmlFor="log-model">Model</label>
        <input
          id="log-model"
          placeholder="Model id"
          value={draft.modelId}
          onChange={(event) =>
            setDraft({ ...draft, modelId: event.target.value })
          }
        />

        <label htmlFor="log-user">User</label>
        <input
          id="log-user"
          placeholder="User id"
          value={draft.userId}
          onChange={(event) =>
            setDraft({ ...draft, userId: event.target.value })
          }
        />

        <label htmlFor="log-generation">Generation</label>
        <input
          id="log-generation"
          placeholder="Generation id"
          value={draft.generationId}
          onChange={(event) =>
            setDraft({ ...draft, generationId: event.target.value })
          }
        />

        <label htmlFor="log-from">From</label>
        <input
          id="log-from"
          type="datetime-local"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />

        <label htmlFor="log-to">To</label>
        <input
          id="log-to"
          type="datetime-local"
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
        />

        <label htmlFor="log-text">Text</label>
        <input
          id="log-text"
          placeholder="Search message or details"
          value={draft.q}
          onChange={(event) => setDraft({ ...draft, q: event.target.value })}
        />

        <button type="submit">Apply</button>
        <button type="button" onClick={handleClear}>
          Clear
        </button>
        <button type="button" onClick={load}>
          Refresh
        </button>
      </form>

      {loadError && <p role="alert">{loadError}</p>}
      {!data && !loadError && <p>Loading…</p>}

      {data && (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Level</th>
              <th>Source</th>
              <th>Message</th>
              <th>Details</th>
              <th>Backend</th>
              <th>User</th>
              <th>Model</th>
              <th>Generation</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleString()}</td>
                <td>{entry.level}</td>
                <td>{entry.source}</td>
                <td>{entry.message}</td>
                <td>{entry.details && <pre>{entry.details}</pre>}</td>
                <td>{entry.backendName ?? "–"}</td>
                <td>{entry.userEmail ?? "–"}</td>
                <td>{entry.modelId ?? "–"}</td>
                <td>{entry.generationId ?? "–"}</td>
              </tr>
            ))}
            {data.entries.length === 0 && (
              <tr>
                <td colSpan={9}>No Log entries match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
