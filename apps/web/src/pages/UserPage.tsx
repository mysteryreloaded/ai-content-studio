import {
  USER_CAP_OVERRIDE_MAX,
  USER_CAP_OVERRIDE_MIN,
} from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useSession } from "../useSession.js";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
  pinned: boolean;
  dailyCapOverride: number | null;
  concurrentCapOverride: number | null;
  disabledReason: string | null;
  disabledAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

const DISABLE_REASON_MAX_LENGTH = 500;

/** Blank, "0" or a whole number in range; anything else is left for the server to refuse. */
function parseOverride(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

/** `/admin/users/:id`: a user's profile, with a History link, approve/promote/demote/disable/enable/delete (issue #62, #64) and Cap overrides (issue #64). */
export function UserPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const [disableReason, setDisableReason] = useState("");
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [showDeleteForm, setShowDeleteForm] = useState(false);

  const [dailyCap, setDailyCap] = useState("");
  const [concurrentCap, setConcurrentCap] = useState("");
  const [capsSaving, setCapsSaving] = useState(false);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [capsSaved, setCapsSaved] = useState(false);

  function load() {
    if (!id) return;
    fetch(`/api/admin/users/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<AdminUser>;
      })
      .then((body) => {
        setUser(body);
        setLoadError(null);
        setDailyCap(
          body.dailyCapOverride === null ? "" : String(body.dailyCapOverride),
        );
        setConcurrentCap(
          body.concurrentCapOverride === null
            ? ""
            : String(body.concurrentCapOverride),
        );
      })
      .catch(() => setLoadError("could not load this user"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render, id is the actual dependency
  useEffect(load, [id]);

  async function act(action: "approve" | "promote" | "demote" | "enable") {
    if (!id) return;
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

  async function disable() {
    if (!id) return;
    setActionError(null);
    const res = await fetch(`/api/admin/users/${id}/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: disableReason.trim() || undefined }),
    });
    if (!res.ok) {
      setActionError("could not disable this user");
      return;
    }
    setShowDisableForm(false);
    setDisableReason("");
    load();
  }

  async function remove() {
    if (!id) return;
    setActionError(null);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: deleteReason.trim() || undefined }),
    });
    if (!res.ok) {
      setActionError("could not delete this user");
      return;
    }
    setDeleted(true);
  }

  async function saveCaps(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    setCapsError(null);
    setCapsSaved(false);

    const dailyCapOverride = parseOverride(dailyCap);
    const concurrentCapOverride = parseOverride(concurrentCap);
    if (
      (dailyCapOverride !== null &&
        (!Number.isInteger(dailyCapOverride) ||
          dailyCapOverride < USER_CAP_OVERRIDE_MIN ||
          dailyCapOverride > USER_CAP_OVERRIDE_MAX)) ||
      (concurrentCapOverride !== null &&
        (!Number.isInteger(concurrentCapOverride) ||
          concurrentCapOverride < USER_CAP_OVERRIDE_MIN ||
          concurrentCapOverride > USER_CAP_OVERRIDE_MAX))
    ) {
      setCapsError(
        `Each override must be blank, or a whole number between ${USER_CAP_OVERRIDE_MIN} and ${USER_CAP_OVERRIDE_MAX.toLocaleString()}.`,
      );
      return;
    }

    setCapsSaving(true);
    const res = await fetch(`/api/admin/users/${id}/caps`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyCapOverride, concurrentCapOverride }),
    });
    setCapsSaving(false);
    if (!res.ok) {
      setCapsError("could not save Cap overrides");
      return;
    }
    setCapsSaved(true);
    load();
  }

  if (deleted) return <Navigate to="/admin/users" replace />;
  if (loadError) return <p role="alert">{loadError}</p>;
  if (!user) return <p>Loading…</p>;

  const isSelf = session.status === "signed-in" && session.user.id === user.id;
  // Issue #64: a "Deleted user" row (deletedAt set) offers no action —
  // the server refuses all of them 404, the same as a pinned or
  // self-targeted row.
  const canAct = !user.pinned && !isSelf && !user.deletedAt;

  return (
    <section>
      <h2>{user.name}</h2>
      <Link to={`/admin/audit?targetType=user&targetId=${user.id}`}>
        History
      </Link>{" "}
      <Link to={`/admin/generations?user=${user.id}`}>Generations</Link>{" "}
      <Link to={`/admin/users/${user.id}/uploads`}>Uploads</Link>
      <dl>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Role</dt>
        <dd>
          {user.role}
          {user.pinned ? " (pinned)" : ""}
        </dd>
        <dt>Status</dt>
        <dd>{user.status}</dd>
        {user.status === "disabled" && !user.deletedAt && (
          <>
            <dt>Disabled</dt>
            <dd>
              {user.disabledAt && new Date(user.disabledAt).toLocaleString()}
              {user.disabledReason ? ` — ${user.disabledReason}` : ""}
            </dd>
          </>
        )}
        {user.deletedAt && (
          <>
            <dt>Deleted</dt>
            <dd>{new Date(user.deletedAt).toLocaleString()}</dd>
          </>
        )}
        <dt>Joined</dt>
        <dd>{new Date(user.createdAt).toLocaleString()}</dd>
      </dl>
      {actionError && <p role="alert">{actionError}</p>}
      {canAct && user.status === "pending" && (
        <button type="button" onClick={() => void act("approve")}>
          Approve
        </button>
      )}
      {canAct && user.role === "user" && user.status === "active" && (
        <button type="button" onClick={() => void act("promote")}>
          Promote to Admin
        </button>
      )}
      {canAct && user.role === "admin" && (
        <button type="button" onClick={() => void act("demote")}>
          Demote to user
        </button>
      )}
      {canAct && user.status !== "disabled" && !showDisableForm && (
        <button type="button" onClick={() => setShowDisableForm(true)}>
          Disable
        </button>
      )}
      {canAct && user.status !== "disabled" && showDisableForm && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void disable();
          }}
        >
          <label htmlFor="disable-reason">Reason (optional, Admin-only)</label>
          <textarea
            id="disable-reason"
            maxLength={DISABLE_REASON_MAX_LENGTH}
            value={disableReason}
            onChange={(event) => setDisableReason(event.target.value)}
          />
          <button type="submit">Confirm disable</button>
          <button type="button" onClick={() => setShowDisableForm(false)}>
            Cancel
          </button>
        </form>
      )}
      {canAct && user.status === "disabled" && (
        <button type="button" onClick={() => void act("enable")}>
          Enable
        </button>
      )}
      {canAct && !showDeleteForm && (
        <button type="button" onClick={() => setShowDeleteForm(true)}>
          Delete account
        </button>
      )}
      {canAct && showDeleteForm && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          <p>
            This scrubs {user.name}'s account like a self-delete.
            {user.status === "disabled" &&
              " Their Google account will also be blocked from signing up again."}
          </p>
          <label htmlFor="delete-reason">
            Blocked-account reason (optional)
          </label>
          <textarea
            id="delete-reason"
            maxLength={DISABLE_REASON_MAX_LENGTH}
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
          />
          <button type="submit">Confirm delete</button>
          <button type="button" onClick={() => setShowDeleteForm(false)}>
            Cancel
          </button>
        </form>
      )}
      {!user.deletedAt && (
        <form onSubmit={(event) => void saveCaps(event)}>
          <h3>Cap overrides</h3>
          <p>
            Blank uses the Site default; 0 blocks this user from generating.
            Whole numbers between {USER_CAP_OVERRIDE_MIN} and{" "}
            {USER_CAP_OVERRIDE_MAX.toLocaleString()}.
          </p>
          <label htmlFor="daily-cap-override">Daily cap override</label>
          <input
            id="daily-cap-override"
            type="number"
            min={USER_CAP_OVERRIDE_MIN}
            max={USER_CAP_OVERRIDE_MAX}
            value={dailyCap}
            onChange={(event) => setDailyCap(event.target.value)}
          />
          <label htmlFor="concurrent-cap-override">
            Concurrent cap override
          </label>
          <input
            id="concurrent-cap-override"
            type="number"
            min={USER_CAP_OVERRIDE_MIN}
            max={USER_CAP_OVERRIDE_MAX}
            value={concurrentCap}
            onChange={(event) => setConcurrentCap(event.target.value)}
          />
          <button type="submit" disabled={capsSaving}>
            Save
          </button>
          {capsError && <p role="alert">{capsError}</p>}
          {capsSaved && <p>Saved.</p>}
        </form>
      )}
    </section>
  );
}
