import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "../useSession.js";
import { AuditPage } from "./AuditPage.js";
import { BackendsPage } from "./BackendsPage.js";
import { LogsPage } from "./LogsPage.js";
import { SiteSettingsForm } from "./SiteSettingsForm.js";

const ERROR_BADGE_POLL_MS = 30_000;

/**
 * The 24h error-count badge next to the Logs nav link (issue #67). Polls
 * only once `enabled`, so an Admin-only page opened by a non-Admin never
 * calls an admin route (and so never leaves its own "non-Admin called an
 * admin route" warning Log entry) before the role check below redirects.
 */
function useErrorBadge(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function poll() {
      fetch("/api/admin/logs/error-count-24h")
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { count: number } | null) => {
          if (!cancelled && body) setCount(body.count);
        })
        .catch(() => {
          /* leave the previous count showing */
        });
    }

    poll();
    const timer = setInterval(poll, ERROR_BADGE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  return count;
}

export function AdminShell() {
  const { session } = useSession();
  const isAdmin =
    session.status === "signed-in" && session.user.role === "admin";
  const errorCount = useErrorBadge(isAdmin);

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (session.user.role !== "admin") return <Navigate to="/models" replace />;

  return (
    <main>
      <h1>Admin</h1>
      <nav>
        <Link to="/admin">Dashboard</Link>
        <Link to="/admin/logs">Logs{errorCount ? ` (${errorCount})` : ""}</Link>
        <Link to="/admin/audit">Audit</Link>
      </nav>

      <Routes>
        <Route
          index
          element={
            <>
              <SiteSettingsForm />
              <BackendsPage />
            </>
          }
        />
        <Route path="logs" element={<LogsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Routes>
    </main>
  );
}
