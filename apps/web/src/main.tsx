import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "./index.css";
import { AppContentRoute } from "./AppContentRoute.js";
import { LandingPage } from "./LandingPage.js";
import { RequireActive } from "./RequireActive.js";
import { RequireTermsAccepted } from "./RequireTermsAccepted.js";
import { RootLayout } from "./RootLayout.js";
import { queryClient } from "./lib/query.js";
import { AccountPage } from "./pages/AccountPage.js";
import { AdminShell } from "./pages/AdminShell.js";
import { ModelsHome } from "./pages/ModelsHome.js";
import { PrivacyPage } from "./pages/PrivacyPage.js";
import { TermsPage } from "./pages/TermsPage.js";
import { WaitingPage } from "./pages/WaitingPage.js";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

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
        // `/models/:slug`, `/gallery` and `/generations/:id` (issue
        // #199 round 2) all resolve here, through one shared `*`
        // catch-all rather than three separate entries. `AppContentRoute`
        // tells them apart itself (`useLocation`) and renders a nested
        // `<Routes>` over the matching one — but that nested match only
        // comes out right when *this* outer route's own matched prefix
        // is "/" (react-router computes the nested `<Routes>`'s pathname
        // by stripping the outer match's prefix first); a concrete path
        // like "/models/:slug" would strip itself away and leave the
        // nested match with nothing to go on. React Router ranks a
        // static/dynamic path like "/models" or "/account" above this
        // catch-all, so those keep matching themselves as before.
        //
        // `RootLayout` decides the full-width layout (issue #194) for
        // whichever of these is the Workbench itself by checking the
        // location (`isWorkbenchLocation`, exported alongside
        // `AppContentRoute`), since a `handle` here would apply to all
        // three alike.
        path: "*",
        element: (
          <RequireTermsAccepted>
            <RequireActive>
              <AppContentRoute />
            </RequireActive>
          </RequireTermsAccepted>
        ),
      },
      { path: "/account", element: <AccountPage /> },
      {
        path: "/admin/*",
        // Full width (issue #200): AdminShell puts most of its own
        // routes back in the 1280px frame via `AdminPage`, but the
        // Model editor route needs the full width RootLayout's default
        // container would otherwise deny it.
        handle: { layout: "full" },
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
    {/* The one app-wide QueryClient (see lib/query.ts); every page's
        query and SSE-fed cache update runs against it. */}
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
