import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../useSession.js";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
  pinned: boolean;
  createdAt: string;
}

/** `/admin/users/:id`: a user's profile, with a History link and approve/promote/demote (issue #62). */
export function UserPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      })
      .catch(() => setLoadError("could not load this user"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render, id is the actual dependency
  useEffect(load, [id]);

  async function act(action: "approve" | "promote" | "demote") {
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

  if (loadError) return <p role="alert">{loadError}</p>;
  if (!user) return <p>Loading…</p>;

  const isSelf = session.status === "signed-in" && session.user.id === user.id;
  const canAct = !user.pinned && !isSelf;

  return (
    <section>
      <h2>{user.name}</h2>
      <Link to={`/admin/audit?targetType=user&targetId=${user.id}`}>
        History
      </Link>

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
    </section>
  );
}
