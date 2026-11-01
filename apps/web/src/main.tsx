import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Outlet, RouterProvider, createBrowserRouter } from "react-router-dom";
import "./index.css";
import { Footer } from "./Footer.js";
import { LandingPage } from "./LandingPage.js";
import { NoticeBanner } from "./NoticeBanner.js";
import { RequireActive } from "./RequireActive.js";
import { RequireTermsAccepted } from "./RequireTermsAccepted.js";
import { AppHeader } from "./components/AppHeader.js";
import { useTabNotifier } from "./notifications/useTabNotifier.js";
import { AccountPage } from "./pages/AccountPage.js";
import { AdminShell } from "./pages/AdminShell.js";
import { GalleryPage } from "./pages/GalleryPage.js";
import { ModelsHome } from "./pages/ModelsHome.js";
import { PrivacyPage } from "./pages/PrivacyPage.js";
import { TermsPage } from "./pages/TermsPage.js";
import { WaitingPage } from "./pages/WaitingPage.js";
import { WorkbenchPage } from "./pages/WorkbenchPage.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

/**
 * The app shell (issue #173): the Notice/Pause banner (issue #59) on every
 * page, the `AppHeader` on signed-in pages (it self-hides otherwise), the
 * page container the routed page's content sits in, and the `Footer` on
 * every page. Also the tab title/favicon cue and Notification pipeline
 * (issue #58), mounted once here so they run regardless of which page is open.
 */
function RootLayout() {
  useTabNotifier();
  return (
    <>
      <NoticeBanner />
      <AppHeader />
      <div className="mx-auto w-full max-w-320 px-4 py-[22px]">
        <Outlet />
      </div>
      <Footer />
    </>
  );
}

// A data router (rather than <BrowserRouter>) so the Model editor can use
// useBlocker to guard every in-app navigation away from unsaved changes,
// not just the ones it wires up by hand (issue #40 follow-up). AdminShell
// keeps its own nested <Routes>, which still works under a data router.
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <LandingPage /> },
      {
        path: "/models",
        element: (
          <RequireTermsAccepted>
            <RequireActive>
              <ModelsHome />
            </RequireActive>
          </RequireTermsAccepted>
        ),
      },
      {
        path: "/models/:slug",
        element: (
          <RequireTermsAccepted>
            <RequireActive>
              <WorkbenchPage />
            </RequireActive>
          </RequireTermsAccepted>
        ),
      },
      {
        path: "/gallery",
        element: (
          <RequireTermsAccepted>
            <RequireActive>
              <GalleryPage />
            </RequireActive>
          </RequireTermsAccepted>
        ),
      },
      {
        // Issue #57: a Generation's own link opens its detail dialog
        // over the Gallery — `GalleryPage` renders the same either way,
        // reading an optional `:id` param to decide whether the dialog
        // is open.
        path: "/generations/:id",
        element: (
          <RequireTermsAccepted>
            <RequireActive>
              <GalleryPage />
            </RequireActive>
          </RequireTermsAccepted>
        ),
      },
      { path: "/account", element: <AccountPage /> },
      {
        path: "/admin/*",
        element: (
          <RequireTermsAccepted>
            <RequireActive>
              <AdminShell />
            </RequireActive>
          </RequireTermsAccepted>
        ),
      },
      { path: "/terms", element: <TermsPage /> },
      { path: "/privacy", element: <PrivacyPage /> },
      {
        path: "/waiting",
        element: (
          <RequireTermsAccepted>
            <WaitingPage />
          </RequireTermsAccepted>
        ),
      },
    ],
  },
]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
