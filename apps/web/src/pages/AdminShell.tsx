import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Footer } from "../Footer.js";
import { useSession } from "../useSession.js";
import { AuditPage } from "./AuditPage.js";
import { BackendsPage } from "./BackendsPage.js";
import { BlockedWordsForm } from "./BlockedWordsForm.js";
import { CapsForm } from "./CapsForm.js";
import { LogsPage } from "./LogsPage.js";
import { ModelEditorPage } from "./ModelEditorPage.js";
import { ModelsPage } from "./ModelsPage.js";
import { OverviewPage } from "./OverviewPage.js";
import { PauseNoticeForm } from "./PauseNoticeForm.js";
import { SitePrivacyForm } from "./SitePrivacyForm.js";
import { SiteSettingsForm } from "./SiteSettingsForm.js";
import { SiteTermsForm } from "./SiteTermsForm.js";
import { UserPage } from "./UserPage.js";
import { UsersPage } from "./UsersPage.js";

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

/** The pending-users badge next to the Users nav link (issue #62). Same gating as `useErrorBadge`. */
function usePendingBadge(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function poll() {
      fetch("/api/admin/users/pending-count")
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
  const pendingCount = usePendingBadge(isAdmin);

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (session.user.role !== "admin") return <Navigate to="/models" replace />;

  return (
    <>
      <main>
        <h1>Admin</h1>
        <nav>
          <Link to="/admin">Overview</Link>
          <Link to="/admin/settings">Settings</Link>
          <Link to="/admin/models">Models</Link>
          <Link to="/admin/users">
            Users{pendingCount ? ` (${pendingCount})` : ""}
          </Link>
          <Link to="/admin/logs">
            Logs{errorCount ? ` (${errorCount})` : ""}
          </Link>
          <Link to="/admin/audit">Audit</Link>
        </nav>

        <Routes>
          <Route index element={<OverviewPage />} />
          <Route
            path="settings"
            element={
              <>
                <SiteSettingsForm />
                <PauseNoticeForm />
                <SiteTermsForm />
                <SitePrivacyForm />
                <BlockedWordsForm />
                <CapsForm />
                <BackendsPage />
              </>
            }
          />
          <Route path="models" element={<ModelsPage />} />
          <Route path="models/:id" element={<ModelEditorPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="audit" element={<AuditPage />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
