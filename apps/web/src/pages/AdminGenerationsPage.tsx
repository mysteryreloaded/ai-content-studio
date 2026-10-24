// The Admin Generations page (issue #68): across every user, filterable
// by Model, Mode, user, state (including Deleted and Removed) and date,
// a jump-to box for a Generation or Asset id, and a read-only detail.

import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

interface AdminGenerationRow {
  id: string;
  modelId: string;
  modelName: string;
  modelSlug: string;
  modeId: string;
  modeName: string;
  userId: string;
  userEmail: string;
  userName: string;
  state: string;
  isTest: boolean;
  deletedAt: string | null;
  removedAt: string | null;
  submittedAt: string;
  endedAt: string | null;
}

interface ListResponse {
  generations: AdminGenerationRow[];
  hasMore: boolean;
}

interface AdminModelOption {
  id: string;
  name: string;
}

interface AdminModeOption {
  id: string;
  name: string;
}

const STATUS_OPTIONS = [
  "",
  "queued",
  "starting",
  "running",
  "saving",
  "succeeded",
  "failed",
  "cancelling",
  "cancelled",
  "deleted",
  "removed",
];

/** This row's own status, combining its real state with whether it's a Tombstone or a Removal (issue #68's AC). */
function statusLabel(row: AdminGenerationRow): string {
  if (row.deletedAt) return "deleted";
  if (row.removedAt) return "removed";
  return row.state;
}

export function AdminGenerationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [models, setModels] = useState<AdminModelOption[]>([]);
  const [modes, setModes] = useState<AdminModeOption[]>([]);
  const [rows, setRows] = useState<AdminGenerationRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jumpId, setJumpId] = useState("");
  const [jumpError, setJumpError] = useState<string | null>(null);

  const modelId = searchParams.get("model") ?? "";
  const modeId = searchParams.get("mode") ?? "";
  const userId = searchParams.get("user") ?? "";
  const status = searchParams.get("status") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  useEffect(() => {
    fetch("/api/admin/models")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { models: AdminModelOption[] } | null) => {
        if (body) setModels(body.models);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!modelId) {
      setModes([]);
      return;
    }
    fetch(`/api/admin/models/${modelId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { modes: AdminModeOption[] } | null) => {
        if (body) setModes(body.modes);
      })
      .catch(() => setModes([]));
  }, [modelId]);

  function queryString(
    cursor?: { submittedAt: string; id: string } | null,
  ): string {
    const params = new URLSearchParams();
    if (modelId) params.set("model", modelId);
    if (modeId) params.set("mode", modeId);
    if (userId) params.set("user", userId);
    if (status) params.set("status", status);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    if (cursor) {
      params.set("beforeSubmittedAt", cursor.submittedAt);
      params.set("beforeId", cursor.id);
    }
    return params.toString();
  }

  function load() {
    fetch(`/api/admin/generations?${queryString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<ListResponse>;
      })
      .then((body) => {
        setRows(body.generations);
        setHasMore(body.hasMore);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load Generations"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render; the filters above are the actual dependencies
  useEffect(load, [modelId, modeId, userId, status, from, to]);

  function loadMore() {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    fetch(
      `/api/admin/generations?${queryString({
        submittedAt: last.submittedAt,
        id: last.id,
      })}`,
    )
      .then((res) => res.json() as Promise<ListResponse>)
      .then((body) => {
        setRows((current) => [...(current ?? []), ...body.generations]);
        setHasMore(body.hasMore);
      })
      .catch(() => setLoadError("could not load more"));
  }

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "model") next.delete("mode");
    setSearchParams(next);
  }

  async function handleJump(event: FormEvent) {
    event.preventDefault();
    setJumpError(null);
    const id = jumpId.trim();
    if (!id) return;
    const res = await fetch(`/api/admin/generations/resolve/${id}`);
    if (!res.ok) {
      setJumpError("No Generation or Asset with that id.");
      return;
    }
    const body = (await res.json()) as { generationId: string };
    navigate(`/admin/generations/${body.generationId}`);
  }

  return (
    <section>
      <h2>Generations</h2>

      <form aria-label="Filters" style={{ display: "contents" }}>
        <label htmlFor="admin-generations-model">Model</label>
        <select
          id="admin-generations-model"
          value={modelId}
          onChange={(event) => setFilter("model", event.target.value)}
        >
          <option value="">All Models</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>

        <label htmlFor="admin-generations-mode">Mode</label>
        <select
          id="admin-generations-mode"
          value={modeId}
          disabled={!modelId}
          onChange={(event) => setFilter("mode", event.target.value)}
        >
          <option value="">All Modes</option>
          {modes.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.name}
            </option>
          ))}
        </select>

        <label htmlFor="admin-generations-user">User id</label>
        <input
          id="admin-generations-user"
          value={userId}
          onChange={(event) => setFilter("user", event.target.value)}
        />

        <label htmlFor="admin-generations-status">State</label>
        <select
          id="admin-generations-status"
          value={status}
          onChange={(event) => setFilter("status", event.target.value)}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "" ? "All" : option}
            </option>
          ))}
        </select>

        <label htmlFor="admin-generations-from">From</label>
        <input
          id="admin-generations-from"
          type="datetime-local"
          value={from}
          onChange={(event) => setFilter("from", event.target.value)}
        />

        <label htmlFor="admin-generations-to">To</label>
        <input
          id="admin-generations-to"
          type="datetime-local"
          value={to}
          onChange={(event) => setFilter("to", event.target.value)}
        />

        <button type="button" onClick={() => setSearchParams({})}>
          Clear filters
        </button>
      </form>

      <form onSubmit={(event) => void handleJump(event)}>
        <label htmlFor="admin-generations-jump">
          Jump to a Generation or Asset id
        </label>
        <input
          id="admin-generations-jump"
          value={jumpId}
          onChange={(event) => setJumpId(event.target.value)}
        />
        <button type="submit">Go</button>
        {jumpError && <p role="alert">{jumpError}</p>}
      </form>

      {loadError && <p role="alert">{loadError}</p>}
      {!rows && !loadError && <p>Loading…</p>}

      {rows && rows.length === 0 && <p>No Generations match these filters.</p>}

      {rows && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Submitted</th>
              <th>User</th>
              <th>Model</th>
              <th>Mode</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link to={`/admin/generations/${row.id}`}>
                    {new Date(row.submittedAt).toLocaleString()}
                  </Link>
                </td>
                <td>
                  <Link to={`/admin/users/${row.userId}`}>{row.userName}</Link>
                </td>
                <td>{row.modelName}</td>
                <td>{row.modeName}</td>
                <td>
                  {statusLabel(row)}
                  {row.isTest ? " (Test)" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hasMore && (
        <button type="button" onClick={loadMore}>
          Load more
        </button>
      )}
    </section>
  );
}
