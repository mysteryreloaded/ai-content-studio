import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "../useSession.js";
import { BackendsPage } from "./BackendsPage.js";
import { LogsPage } from "./LogsPage.js";
import { SiteSettingsForm } from "./SiteSettingsForm.js";

const ERROR_BADGE_POLL_MS = 30_000;

/** The 24h error-count badge next to the Logs nav link (issue #67). */
function useErrorBadge(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
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
  }, []);

  return count;
}

export function AdminShell() {
  const { session } = useSession();
  const errorCount = useErrorBadge();

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (session.user.role !== "admin") return <Navigate to="/models" replace />;

  return (
    <main>
      <h1>Admin</h1>
      <nav>
        <Link to="/admin">Dashboard</Link>
        <Link to="/admin/logs">Logs{errorCount ? ` (${errorCount})` : ""}</Link>
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
      </Routes>
    </main>
  );
}
