import { type FormEvent, useEffect, useState } from "react";

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
  const [filters, setFilters] = useState<FilterState>(BLANK_FILTERS);
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendOptions, setBackendOptions] = useState<AdminBackendOption[]>(
    [],
  );

  function load() {
    const qs = queryStringFrom(filters);
    fetch(`/api/admin/logs${qs ? `?${qs}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<LogsResponse>;
      })
      .then((body) => {
        setData(body);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load Log entries"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render, filters is the actual dependency
  useEffect(load, [filters]);

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
    load();
  }

  return (
    <section>
      <h2>Logs</h2>

      <form onSubmit={handleSubmit}>
        <label htmlFor="log-level">Level</label>
        <select
          id="log-level"
          value={filters.level}
          onChange={(event) =>
            setFilters({
              ...filters,
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
          value={filters.source}
          onChange={(event) =>
            setFilters({
              ...filters,
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
          value={filters.backendId}
          onChange={(event) =>
            setFilters({ ...filters, backendId: event.target.value })
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
          value={filters.modelId}
          onChange={(event) =>
            setFilters({ ...filters, modelId: event.target.value })
          }
        />

        <label htmlFor="log-user">User</label>
        <input
          id="log-user"
          placeholder="User id"
          value={filters.userId}
          onChange={(event) =>
            setFilters({ ...filters, userId: event.target.value })
          }
        />

        <label htmlFor="log-generation">Generation</label>
        <input
          id="log-generation"
          placeholder="Generation id"
          value={filters.generationId}
          onChange={(event) =>
            setFilters({ ...filters, generationId: event.target.value })
          }
        />

        <label htmlFor="log-from">From</label>
        <input
          id="log-from"
          type="datetime-local"
          value={filters.from}
          onChange={(event) =>
            setFilters({ ...filters, from: event.target.value })
          }
        />

        <label htmlFor="log-to">To</label>
        <input
          id="log-to"
          type="datetime-local"
          value={filters.to}
          onChange={(event) =>
            setFilters({ ...filters, to: event.target.value })
          }
        />

        <label htmlFor="log-text">Text</label>
        <input
          id="log-text"
          placeholder="Search message or details"
          value={filters.q}
          onChange={(event) =>
            setFilters({ ...filters, q: event.target.value })
          }
        />

        <button type="submit">Apply</button>
        <button type="button" onClick={() => setFilters(BLANK_FILTERS)}>
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
