import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../useSession.js";

type Role = "user" | "admin";
type Status = "pending" | "active" | "disabled";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: Status;
  pinned: boolean;
  createdAt: string;
}

interface UsersResponse {
  users: AdminUser[];
  hasMore: boolean;
}

interface FilterState {
  q: string;
  role: Role | "";
  status: Status | "";
}

const BLANK_FILTERS: FilterState = { q: "", role: "", status: "" };

function queryStringFrom(filters: FilterState): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

/** The admin Users page: newest first, with search, filters and a pending badge (issue #62). */
export function UsersPage() {
  const { session } = useSession();
  const [draft, setDraft] = useState<FilterState>(BLANK_FILTERS);
  const [applied, setApplied] = useState<FilterState>(BLANK_FILTERS);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function fetchPage(cursor?: { createdAt: string; id: string }) {
    const params = new URLSearchParams(queryStringFrom(applied));
    if (cursor) {
      params.set("beforeCreatedAt", cursor.createdAt);
      params.set("beforeId", cursor.id);
    }
    const qs = params.toString();
    return fetch(`/api/admin/users${qs ? `?${qs}` : ""}`).then((res) => {
      if (!res.ok) throw new Error(`unexpected status ${res.status}`);
      return res.json() as Promise<UsersResponse>;
    });
  }

  function load() {
    fetchPage()
      .then((body) => {
        setUsers(body.users);
        setHasMore(body.hasMore);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load users"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render, applied is the actual dependency
  useEffect(load, [applied]);

  function loadMore() {
    const last = users?.[users.length - 1];
    if (!last) return;
    setLoadingMore(true);
    fetchPage({ createdAt: last.createdAt, id: last.id })
      .then((body) => {
        setUsers((current) => [...(current ?? []), ...body.users]);
        setHasMore(body.hasMore);
      })
      .catch(() => setLoadError("could not load older users"))
      .finally(() => setLoadingMore(false));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setApplied(draft);
  }

  function handleClear() {
    setDraft(BLANK_FILTERS);
    setApplied(BLANK_FILTERS);
  }

  async function act(id: string, action: "approve" | "promote" | "demote") {
    setActionError(null);
    const res = await fetch(`/api/admin/users/${id}/${action}`, {
      method: "POST",
    });
    if (!res.ok) {
      setActionError(`could not ${action} this user`);
      return;
    }
    load();
  }

  const selfId = session.status === "signed-in" ? session.user.id : null;

  return (
    <section>
      <h2>Users</h2>

      <form onSubmit={handleSubmit}>
        <label htmlFor="users-q">Search</label>
        <input
          id="users-q"
          placeholder="Name or email"
          value={draft.q}
          onChange={(event) => setDraft({ ...draft, q: event.target.value })}
        />

        <label htmlFor="users-role">Role</label>
        <select
          id="users-role"
          value={draft.role}
          onChange={(event) =>
            setDraft({ ...draft, role: event.target.value as Role | "" })
          }
        >
          <option value="">Any</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>

        <label htmlFor="users-status">Status</label>
        <select
          id="users-status"
          value={draft.status}
          onChange={(event) =>
            setDraft({ ...draft, status: event.target.value as Status | "" })
          }
        >
          <option value="">Any</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>

        <button type="submit">Apply</button>
        <button type="button" onClick={handleClear}>
          Clear
        </button>
      </form>

      {loadError && <p role="alert">{loadError}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {!users && !loadError && <p>Loading…</p>}

      {users && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === selfId;
              const canAct = !user.pinned && !isSelf;
              return (
                <tr key={user.id}>
                  <td>
                    <Link to={`/admin/users/${user.id}`}>{user.name}</Link>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    {user.role}
                    {user.pinned ? " (pinned)" : ""}
                  </td>
                  <td>
                    {user.status === "pending" ? (
                      <strong>pending</strong>
                    ) : (
                      user.status
                    )}
                  </td>
                  <td>
                    {canAct && user.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => act(user.id, "approve")}
                      >
                        Approve
                      </button>
                    )}
                    {canAct &&
                      user.role === "user" &&
                      user.status === "active" && (
                        <button
                          type="button"
                          onClick={() => act(user.id, "promote")}
                        >
                          Promote
                        </button>
                      )}
                    {canAct && user.role === "admin" && (
                      <button
                        type="button"
                        onClick={() => act(user.id, "demote")}
                      >
                        Demote
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={5}>No users match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {hasMore && (
        <button type="button" onClick={loadMore} disabled={loadingMore}>
          Load older
        </button>
      )}
    </section>
  );
}
