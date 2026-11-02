import { cn } from "cn";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../useSession.js";
import { useSiteSettings } from "../useSiteSettings.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";

interface NavModel {
  id: string;
  slug: string;
  name: string;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

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
 * Measurements follow the Workbench prototype's `.app-head`: sticky with a
 * panel background and bottom border, 8px/16px padding and a 14px gap (the
 * 32px avatar sets its ~49px height). At ≤560px the brand text hides, the
 * gap tightens to 8px, and the nav scrolls sideways.
 */
export function AppHeader() {
  const settings = useSiteSettings();
  const { session, signOut } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [models, setModels] = useState<NavModel[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { models: NavModel[] } | null) => {
        if (!cancelled && body) setModels(body.models);
      })
      .catch(() => {
        /* the nav keeps Gallery (and Admin) rather than break the header */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The header lives on signed-in pages only. The app pages themselves render
  // nothing while the session is still loading, so the header and the page
  // content appear together once `/api/auth/me` resolves (no layout shift).
  if (session.status !== "signed-in") return null;
  const user = session.user;
  const title = settings?.title ?? "AI Content Studio";

  return (
    <header className="sticky top-0 z-[25] flex min-w-0 items-center gap-3.5 border-b border-border bg-card px-4 py-2 max-[560px]:gap-2">
      <a
        href="/"
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
      </a>

      <nav
        aria-label="Studio"
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
      >
        {models?.map((model) => (
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
          Gallery
          {/* Hidden slot for the live "N under way" count (issue #173): the
              prototype's .nav-count badge (11px/600, 9px radius); a later
              issue feeds it the value. */}
          <span
            data-slot="nav-count"
            aria-hidden="true"
            className="hidden rounded-[9px] bg-primary px-1.5 text-[11px] leading-[17px] font-semibold text-primary-foreground"
          />
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
              className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c2884f] text-xs font-semibold text-white"
            >
              {user?.picture ? (
                <img
                  src={user.picture}
                  alt=""
                  className="size-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : user ? (
                initials(user.name)
              ) : null}
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
