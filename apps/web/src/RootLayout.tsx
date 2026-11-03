import { cn } from "cn";
import type { ReactNode } from "react";
import { Outlet, useMatches } from "react-router-dom";
import { Footer } from "./Footer.js";
import { NoticeBanner } from "./NoticeBanner.js";
import { AppHeader } from "./components/AppHeader.js";
import { useTabNotifier } from "./notifications/useTabNotifier.js";

/**
 * A route's layout handle (issue #188): a route opts out of the default
 * page container with `handle: { layout: "full" }`. The data router
 * (react-router-dom's `useMatches`) exposes every match's `handle`
 * before the page renders, so the decision is known with no jump — this
 * ticket sets none; the Workbench (#195), the landing (#175) and the
 * admin shell (#200) add theirs.
 */
export interface RouteHandle {
  layout?: "full";
}

/** The default page container: the prototype's `.page` — max-width 1280px, 22px top/bottom, 16px left/right. */
const PAGE_CONTAINER_CLASS = "mx-auto w-full max-w-320 flex-1 px-4 py-[22px]";

/**
 * The default page container as a component (issue #188): full-width
 * routes that still need a contained section — the admin shell's pages,
 * once its nested `<Routes>` routes can't carry a data-router `handle`
 * (#200).
 */
export function PageContainer({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="page-container"
      className={cn(PAGE_CONTAINER_CLASS, className)}
    >
      {children}
    </div>
  );
}

/**
 * The app shell (issue #173): the Notice/Pause banner (issue #59) on every
 * page, the `AppHeader` on signed-in pages (it self-hides otherwise), the
 * page container the routed page's content sits in, and the `Footer` on
 * every page. Also the tab title/favicon cue and Notification pipeline
 * (issue #58), mounted once here so they run regardless of which page is
 * open.
 *
 * The wrapper is `flex min-h-dvh flex-col` (issue #188): the content
 * column stretches, so the footer sits at the bottom of short pages
 * instead of floating mid-screen.
 */
export function RootLayout() {
  useTabNotifier();
  const full = useMatches().some(
    (match) => (match.handle as RouteHandle | undefined)?.layout === "full",
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <NoticeBanner />
      <AppHeader />
      {full ? (
        // The full-width opt-out (issue #188): no max-width, no padding —
        // the route's own grid (the Workbench, the Model editor) runs
        // edge to edge.
        <div className="w-full flex-1">
          <Outlet />
        </div>
      ) : (
        <PageContainer>
          <Outlet />
        </PageContainer>
      )}
      <Footer />
    </div>
  );
}
