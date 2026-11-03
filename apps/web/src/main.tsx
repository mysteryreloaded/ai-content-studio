import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  type Location,
  Route,
  RouterProvider,
  Routes,
  createBrowserRouter,
  useLocation,
  useParams,
} from "react-router-dom";
import "./index.css";
import { LandingPage } from "./LandingPage.js";
import { RequireActive } from "./RequireActive.js";
import { RequireTermsAccepted } from "./RequireTermsAccepted.js";
import { RootLayout } from "./RootLayout.js";
import { queryClient } from "./lib/query.js";
import { RoutedGenerationIdProvider } from "./lib/routedGeneration.js";
import { AccountPage } from "./pages/AccountPage.js";
import { AdminShell } from "./pages/AdminShell.js";
import { GalleryPage } from "./pages/GalleryPage.js";
import { ModelsHome } from "./pages/ModelsHome.js";
import { PrivacyPage } from "./pages/PrivacyPage.js";
import { TermsPage } from "./pages/TermsPage.js";
import { WaitingPage } from "./pages/WaitingPage.js";
import { WorkbenchPage } from "./pages/WorkbenchPage.js";

/**
 * `/generations/:id` (issue #199): a pasted link, a reload or a
 * Notification click carries no `state.backgroundLocation`, so it opens
 * over the Gallery, exactly like before #199 — `GalleryPage` reads the
 * `:id` itself from this route's own params. Opened from the Workbench
 * (`WorkbenchFeed.openDetails`), `state.backgroundLocation` names the
 * Workbench's own location (its URL never actually changes); re-running
 * the route tree against it, React Router's modal-route pattern, keeps
 * the Workbench mounted underneath while this route's real URL sits on
 * top. The real id isn't a param anywhere in that background tree, so
 * it's handed down through `RoutedGenerationIdProvider` instead.
 */
function GenerationDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const background = (
    location.state as { backgroundLocation?: Location } | null
  )?.backgroundLocation;

  if (!background) return <GalleryPage />;

  return (
    <RoutedGenerationIdProvider value={id ?? null}>
      <Routes location={background}>
        <Route
          path="/models/:slug"
          element={
            <RequireTermsAccepted>
              <RequireActive>
                <WorkbenchPage />
              </RequireActive>
            </RequireTermsAccepted>
          }
        />
      </Routes>
    </RoutedGenerationIdProvider>
  );
}

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
        path: "/models/:slug",
        element: (
          <RequireTermsAccepted>
            <RequireActive>
              <WorkbenchPage />
            </RequireActive>
          </RequireTermsAccepted>
        ),
        // Full-width (issue #194): the Workbench runs its own `.va-grid`
        // edge to edge, not the default 1280px page container.
        handle: { layout: "full" },
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
        // Issue #57/#199: a Generation's own link opens its detail
        // dialog over the Gallery, or over the Workbench when it was
        // opened from there — see `GenerationDetailRoute`'s own comment.
        path: "/generations/:id",
        element: (
          <RequireTermsAccepted>
            <RequireActive>
              <GenerationDetailRoute />
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
