import { useEffect, useState } from "react";

interface BlockedAccount {
  id: string;
  reason: string | null;
  createdAt: string;
}

/** `/admin/blocked-accounts`: the Google accounts an Admin delete blocked from signing up again (issue #64), and clearing one off the list. */
export function BlockedAccountsPage() {
  const [rows, setRows] = useState<BlockedAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/blocked-accounts")
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ blockedAccounts: BlockedAccount[] }>;
      })
      .then((body) => {
        setRows(body.blockedAccounts);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load blocked accounts"));
  }

  useEffect(load, []);

  async function clear(id: string) {
    setActionError(null);
    const res = await fetch(`/api/admin/blocked-accounts/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setActionError("could not clear this entry");
      return;
    }
    load();
  }

  if (loadError) return <p role="alert">{loadError}</p>;
  if (!rows) return <p>Loading…</p>;

  return (
    <section>
      <h2>Blocked accounts</h2>
      <p>
        A Google account an Admin deleted while it was disabled, kept here so it
        can't simply sign up again. Clearing an entry lets that account sign up
        as a brand-new user.
      </p>
      {actionError && <p role="alert">{actionError}</p>}
      <table>
        <thead>
          <tr>
            <th>Blocked</th>
            <th>Reason</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.createdAt).toLocaleString()}</td>
              <td>{row.reason || "—"}</td>
              <td>
                <button type="button" onClick={() => void clear(row.id)}>
                  Clear
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3}>No blocked accounts.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
