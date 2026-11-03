import { Navigate, Route, Routes } from "react-router-dom";
import { AdminNav } from "../components/admin/AdminNav.js";
import { AdminPage } from "../components/admin/AdminPage.js";
import { useSession } from "../useSession.js";
import { AdminGenerationDetailPage } from "./AdminGenerationDetailPage.js";
import { AdminGenerationsPage } from "./AdminGenerationsPage.js";
import { AdminUploadsPage } from "./AdminUploadsPage.js";
import { AuditPage } from "./AuditPage.js";
import { BackendsPage } from "./BackendsPage.js";
import { BlockedAccountsPage } from "./BlockedAccountsPage.js";
import { BlockedWordsForm } from "./BlockedWordsForm.js";
import { CapsForm } from "./CapsForm.js";
import { LogsPage } from "./LogsPage.js";
import { ModelsPage } from "./ModelsPage.js";
import { OverviewPage } from "./OverviewPage.js";
import { PauseNoticeForm } from "./PauseNoticeForm.js";
import { SitePrivacyForm } from "./SitePrivacyForm.js";
import { SiteSettingsForm } from "./SiteSettingsForm.js";
import { SiteTermsForm } from "./SiteTermsForm.js";
import { UserPage } from "./UserPage.js";
import { UsersPage } from "./UsersPage.js";
import { ModelEditorPage } from "./model-editor/ModelEditorPage.js";

/**
 * The admin frame (issue #200): the section nav restyled to the Model
 * editor prototype's shared admin design system, sitting under the app
 * header (`RootLayout`'s `handle: { layout: "full" }` on `/admin/*`
 * gives this component the full width to put it in). The routed content
 * — not the nav — is the page's `<main>` landmark (the old shell's own
 * `<main>` is gone, and `RootLayout` has none of its own for a full-width
 * route). Every route except the Model editor renders inside `AdminPage`
 * (`PageContainer`, the same frame the rest of the app uses); the Model
 * editor gets a full-width, unpadded slot for its own `.va` workspace
 * (#212–#217).
 */
export function AdminShell() {
  const { session } = useSession();
  const isAdmin =
    session.status === "signed-in" && session.user.role === "admin";

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (session.user.role !== "admin") return <Navigate to="/models" replace />;

  return (
    <>
      <AdminNav isAdmin={isAdmin} />
      <main>
        <Routes>
          <Route
            index
            element={
              <AdminPage>
                <OverviewPage />
              </AdminPage>
            }
          />
          <Route
            path="settings"
            element={
              <AdminPage>
                <SiteSettingsForm />
                <PauseNoticeForm />
                <SiteTermsForm />
                <SitePrivacyForm />
                <BlockedWordsForm />
                <CapsForm />
              </AdminPage>
            }
          />
          <Route
            path="backends"
            element={
              <AdminPage>
                <BackendsPage />
              </AdminPage>
            }
          />
          <Route
            path="models"
            element={
              <AdminPage>
                <ModelsPage />
              </AdminPage>
            }
          />
          <Route
            path="models/:id"
            element={
              <div className="w-full min-w-0">
                <ModelEditorPage />
              </div>
            }
          />
          <Route
            path="generations"
            element={
              <AdminPage>
                <AdminGenerationsPage />
              </AdminPage>
            }
          />
          <Route
            path="generations/:id"
            element={
              <AdminPage>
                <AdminGenerationDetailPage />
              </AdminPage>
            }
          />
          <Route
            path="users"
            element={
              <AdminPage>
                <UsersPage />
              </AdminPage>
            }
          />
          <Route
            path="users/:id"
            element={
              <AdminPage>
                <UserPage />
              </AdminPage>
            }
          />
          <Route
            path="users/:id/uploads"
            element={
              <AdminPage>
                <AdminUploadsPage />
              </AdminPage>
            }
          />
          <Route
            path="blocked-accounts"
            element={
              <AdminPage>
                <BlockedAccountsPage />
              </AdminPage>
            }
          />
          <Route
            path="logs"
            element={
              <AdminPage>
                <LogsPage />
              </AdminPage>
            }
          />
          <Route
            path="audit"
            element={
              <AdminPage>
                <AuditPage />
              </AdminPage>
            }
          />
        </Routes>
      </main>
    </>
  );
}
