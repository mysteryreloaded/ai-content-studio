import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

interface AuditImage {
  key: string;
  hash: string;
  size: number;
}

interface AuditEntry {
  id: string;
  createdAt: string;
  actorType: string;
  actorName: string | null;
  targetType: string;
  targetId: string;
  targetName: string | null;
  action: string;
  before: unknown;
  after: unknown;
  images: AuditImage[] | null;
}

interface AuditResponse {
  entries: AuditEntry[];
}

interface FilterState {
  actor: string;
  targetType: string;
  targetId: string;
  action: string;
  from: string;
  to: string;
}

const BLANK_FILTERS: FilterState = {
  actor: "",
  targetType: "",
  targetId: "",
  action: "",
  from: "",
  to: "",
};

function filtersFromParams(params: URLSearchParams): FilterState {
  return {
    actor: params.get("actor") ?? "",
    targetType: params.get("targetType") ?? "",
    targetId: params.get("targetId") ?? "",
    action: params.get("action") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
}

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

function actorLabel(entry: AuditEntry): string {
  if (entry.actorType === "system") return "System";
  return entry.actorName ?? "Deleted user";
}

function targetLabel(entry: AuditEntry): string {
  if (entry.targetType === "user") return entry.targetName ?? "Deleted user";
  return entry.targetId;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "–";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

interface DiffRow {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

/** A readable diff computed from the entry's before/after snapshots, not stored. */
function diffRows(before: unknown, after: unknown): DiffRow[] {
  const beforeObj =
    before && typeof before === "object"
      ? (before as Record<string, unknown>)
      : {};
  const afterObj =
    after && typeof after === "object"
      ? (after as Record<string, unknown>)
      : {};
  const keys = Array.from(
    new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]),
  ).sort();

  return keys.map((field) => {
    const beforeText = formatValue(beforeObj[field]);
    const afterText = formatValue(afterObj[field]);
    return {
      field,
      before: beforeText,
      after: afterText,
      changed: beforeText !== afterText,
    };
  });
}

function EntryDiff({ entry }: { entry: AuditEntry }) {
  const rows = diffRows(entry.before, entry.after);

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field}>
              <td>{row.field}</td>
              <td>{row.before}</td>
              <td>{row.changed ? row.after : "(unchanged)"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3}>No fields recorded.</td>
            </tr>
          )}
        </tbody>
      </table>
      {entry.images && entry.images.length > 0 && (
        <ul>
          {entry.images.map((image) => (
            <li key={image.key}>
              {image.key}: hash {image.hash}, {image.size} bytes
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The Admin Audit page: every recorded change, newest first, with filters and a diff (issue #38). */
export function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = filtersFromParams(searchParams);
  const [draft, setDraft] = useState<FilterState>(initialFilters);
  const [applied, setApplied] = useState<FilterState>(initialFilters);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    const qs = queryStringFrom(applied);
    fetch(`/api/admin/audit${qs ? `?${qs}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<AuditResponse>;
      })
      .then((body) => {
        setData(body);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load the Audit trail"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render, applied is the actual dependency
  useEffect(load, [applied]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setApplied(draft);
    setSearchParams(queryStringFrom(draft));
  }

  function handleClear() {
    setDraft(BLANK_FILTERS);
    setApplied(BLANK_FILTERS);
    setSearchParams({});
  }

  return (
    <section>
      <h2>Audit</h2>

      <form onSubmit={handleSubmit}>
        <label htmlFor="audit-actor">Actor</label>
        <input
          id="audit-actor"
          placeholder="Admin email, id, or 'system'"
          value={draft.actor}
          onChange={(event) =>
            setDraft({ ...draft, actor: event.target.value })
          }
        />

        <label htmlFor="audit-target-type">Target type</label>
        <input
          id="audit-target-type"
          placeholder="e.g. site_settings, backend, user"
          value={draft.targetType}
          onChange={(event) =>
            setDraft({ ...draft, targetType: event.target.value })
          }
        />

        <label htmlFor="audit-target-id">Target</label>
        <input
          id="audit-target-id"
          placeholder="Target id"
          value={draft.targetId}
          onChange={(event) =>
            setDraft({ ...draft, targetId: event.target.value })
          }
        />

        <label htmlFor="audit-action">Action</label>
        <input
          id="audit-action"
          value={draft.action}
          onChange={(event) =>
            setDraft({ ...draft, action: event.target.value })
          }
        />

        <label htmlFor="audit-from">From</label>
        <input
          id="audit-from"
          type="datetime-local"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />

        <label htmlFor="audit-to">To</label>
        <input
          id="audit-to"
          type="datetime-local"
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
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

      {data && data.entries.length === 0 && (
        <p>No Audit entries match these filters.</p>
      )}

      {data && data.entries.length > 0 && (
        <ul>
          {data.entries.map((entry) => (
            <li key={entry.id}>
              <details>
                <summary>
                  {new Date(entry.createdAt).toLocaleString()} —{" "}
                  {actorLabel(entry)} {entry.action} {entry.targetType}{" "}
                  {targetLabel(entry)}
                </summary>
                <EntryDiff entry={entry} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
