import { cn } from "cn";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  underwayCount,
  useActiveGenerations,
} from "../lib/generationsStream.js";
import { useEnabledModels } from "../lib/models.js";
import { useSession } from "../useSession.js";
import { useSiteSettings } from "../useSiteSettings.js";
import { Avatar } from "./Avatar.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";

/** One link in the header's Studio nav; the current page gets `aria-current` and the accent-soft background. */
function NavItem({
  to,
  current,
  children,
}: {
  to: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium whitespace-nowrap",
        current
          ? "bg-accent-soft text-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * The app shell's header (issue #173): a brand mark (the Site's logo when
 * set, otherwise the 18px conic-gradient mark) with the Site title, one
 * link per enabled Model plus Gallery (and Admin for Admins), and a 32px
 * round avatar (the Google picture, or initials) opening the Account /
 * Sign out menu.
 *
 * The Gallery link carries the live "N under way" count of the user's own
 * Generations (issue #188) — the same N as the tab title's cue, both from
 * the one shared `["generations", "active"]` store. The brand is a
 * `<Link>` to the Models home (issue #188's gap 3), so clicking it keeps
 * the query cache and the open streams.
 *
 * Measurements follow the Workbench prototype's `.app-head`: sticky with a
 * panel background and bottom border, 16px horizontal padding; its height
 * is `--app-header-h` (64px, issue #222 — the token in index.css, shared
 * with the Model editor's sticky header and checks rail, #213), so the two
 * can't drift. The nav links sit 24px apart (docs/ui-sizes.md); at ≤560px
 * the brand text hides, the gap tightens to 8px, and the nav scrolls
 * sideways.
 */
export function AppHeader() {
  const settings = useSiteSettings();
  const { session, signOut } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  // The header's data is query-fed (issue #183, #188): the Models come
  // from the one shared `["models"]` query, and the live count from the
  // shared generations stream (one `EventSource` per tab, with
  // `useTabNotifier` — the shell adds no extra connection).
  const { models } = useEnabledModels();
  const underway = underwayCount(useActiveGenerations().generations);

  // The header lives on signed-in pages only. The app pages themselves
  // render nothing while the session is still loading, so the header and
  // the page content appear together once `/api/auth/me` resolves (no
  // layout shift).
  if (session.status !== "signed-in") return null;
  const user = session.user;
  const title = settings?.title ?? "AI Content Studio";

  return (
    <header className="sticky top-0 z-[25] flex h-[var(--app-header-h)] min-w-0 items-center gap-3.5 border-b border-border bg-card px-4 max-[560px]:gap-2">
      <Link
        to="/models"
        aria-label={title}
        className="inline-flex min-w-0 items-center gap-2 font-heading text-base font-semibold text-foreground max-[560px]:gap-0 max-[560px]:text-[0px]"
      >
        {settings?.hasLogo ? (
          <img
            src="/api/site-settings/logo"
            alt=""
            className="size-4.5 shrink-0 rounded-[5px] object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="size-4.5 shrink-0 rounded-[5px] bg-[conic-gradient(from_210deg,var(--accent),var(--ok),var(--info),var(--accent))]"
          />
        )}
        {title}
      </Link>

      <nav
        aria-label="Studio"
        className="flex min-w-0 items-center gap-6 overflow-x-auto [scrollbar-width:none] max-[560px]:gap-2"
      >
        {models.map((model) => (
          <NavItem
            key={model.id}
            to={`/models/${model.slug}`}
            current={location.pathname === `/models/${model.slug}`}
          >
            {model.name}
          </NavItem>
        ))}
        <NavItem
          to="/gallery"
          current={
            location.pathname === "/gallery" ||
            location.pathname.startsWith("/generations/")
          }
        >
          {"Gallery "}
          {/* The live "N under way" count (issue #188): the prototype's
              .nav-count badge (11px/600, 9px radius), shown only when N >
              0; ` under way` is screen-reader-only, so the link reads
              "Gallery 2 under way". At 0 the badge is display-none and
              out of the accessible name (the sr-only suffix isn't
              rendered then either). */}
          <span
            data-slot="nav-count"
            aria-hidden={underway === 0 ? "true" : undefined}
            className={cn(
              "rounded-[9px] bg-primary px-1.5 text-[11px] leading-[17px] font-semibold text-primary-foreground",
              underway === 0 && "hidden",
            )}
          >
            {underway}
          </span>
          {underway > 0 && <span className="sr-only"> under way</span>}
        </NavItem>
        {user?.role === "admin" && (
          <NavItem to="/admin" current={location.pathname.startsWith("/admin")}>
            Admin
          </NavItem>
        )}
      </nav>

      <div className="ml-auto shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account"
              className="flex size-8 shrink-0 items-center justify-center"
            >
              <Avatar name={user.name} picture={user.picture} size={32} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* The prototype's avatar menu leads with who is signed in. */}
            <DropdownMenuLabel className="flex flex-col gap-1.5 px-2 py-1.5">
              <span className="text-sm font-semibold text-foreground">
                {user.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {user.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                to="/account"
                className="focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-2"
              >
                Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                // Navigate only after the session clears, so LandingPage
                // never sees a still-signed-in user and bounces to /models
                // (QA round 1, PR #184).
                void signOut().then(() => navigate("/"));
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
