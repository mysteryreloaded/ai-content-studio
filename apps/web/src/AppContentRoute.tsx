import {
  type Location,
  Route,
  Routes,
  matchPath,
  useLocation,
} from "react-router-dom";
import { RoutedGenerationIdProvider } from "./lib/routedGeneration.js";
import { GalleryPage } from "./pages/GalleryPage.js";
import { WorkbenchPage } from "./pages/WorkbenchPage.js";

/**
 * The single `element` for `/models/:slug`, `/gallery` AND
 * `/generations/:id` (issue #199 round 2): the Workbench and the
 * Gallery must stay mounted — their own local state (a typed prompt,
 * the picked Mode, scroll position) and focus — when the Generation
 * detail dialog opens and closes over them, not just visually the
 * same page underneath. React only preserves a subtree across a route
 * change when the *same component* sits at the *same position* in the
 * tree on both sides of the navigation; three separate `element`s (one
 * per path, as this had before) would make `main.tsx`'s `<Outlet/>`
 * swap to a different element and unmount everything below it. Using
 * this one component for all three paths keeps that position stable,
 * so only what's *inside* `<Routes location={...}>` actually changes.
 *
 * A pasted link, a reload or a Notification click carries no
 * `state.backgroundLocation`, so `<Routes>` matches the real location
 * (the `/generations/:id` entry below it), and `GalleryPage` reads the
 * `:id` itself to open the dialog over the Gallery, as before #199.
 * Opened from the Workbench (`WorkbenchFeed.openDetails`),
 * `state.backgroundLocation` names the Workbench's own location (its
 * URL never actually changes); matching `<Routes>` against it —
 * React Router's modal-route pattern — keeps the Workbench's
 * `/models/:slug` match (and so its component instance) in place while
 * the real URL sits on top. The real id isn't a param anywhere in that
 * background match, so it's handed down through
 * `RoutedGenerationIdProvider` instead.
 */
export function AppContentRoute() {
  const location = useLocation();
  const background = (
    location.state as { backgroundLocation?: Location } | null
  )?.backgroundLocation;
  const generationId = matchPath("/generations/:id", location.pathname)?.params
    .id;

  // Always the same wrapper, dialog open or not — conditionally
  // rendering the provider only while a Generation is open would swap
  // this component's own rendered root between `Routes` and
  // `RoutedGenerationIdProvider` (a different type at the same tree
  // position), which unmounts the `Routes` subtree underneath it,
  // the exact remount this component exists to prevent.
  return (
    <RoutedGenerationIdProvider
      value={background ? (generationId ?? null) : null}
    >
      <Routes location={background ?? location}>
        <Route path="/models/:slug" element={<WorkbenchPage />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/generations/:id" element={<GalleryPage />} />
      </Routes>
    </RoutedGenerationIdProvider>
  );
}

/** Issue #199: the Generation detail dialog's own route carries no `layout: "full"` handle — `RootLayout` checks this for the Workbench background behind it instead. */
export function isWorkbenchLocation(pathname: string): boolean {
  return matchPath("/models/:slug", pathname) !== null;
}
