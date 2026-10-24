import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { LandingPage } from "./LandingPage.js";
import { RequireActive } from "./RequireActive.js";
import { RequireTermsAccepted } from "./RequireTermsAccepted.js";
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

// A data router (rather than <BrowserRouter>) so the Model editor can use
// useBlocker to guard every in-app navigation away from unsaved changes,
// not just the ones it wires up by hand (issue #40 follow-up). AdminShell
// keeps its own nested <Routes>, which still works under a data router.
const router = createBrowserRouter([
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
]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
