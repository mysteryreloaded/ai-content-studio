import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Link, useLocation } from "react-router-dom";
import { api, ok } from "../../lib/api.js";
import { Count } from "./Count.js";

const BADGE_POLL_MS = 30_000;

/** Exported so the Users pages can invalidate the pending count after Approve/Disable/Delete. */
export const adminBadgeKeys = {
  pending: ["admin", "users", "pending-count"] as const,
  errors: ["admin", "logs", "error-count-24h"] as const,
};

interface Section {
  key: string;
  label: string;
  to: string;
  isCurrent: (path: string) => boolean;
}

const SECTIONS: Section[] = [
  {
    key: "overview",
    label: "Overview",
    to: "/admin",
    isCurrent: (p) => p === "/admin",
  },
  {
    key: "models",
    label: "Models",
    to: "/admin/models",
    isCurrent: (p) => p === "/admin/models" || p.startsWith("/admin/models/"),
  },
  {
    key: "backends",
    label: "Backends",
    to: "/admin/backends",
    isCurrent: (p) => p === "/admin/backends",
  },
  {
    key: "users",
    label: "Users",
    to: "/admin/users",
    isCurrent: (p) =>
      p === "/admin/users" ||
      p.startsWith("/admin/users/") ||
      p === "/admin/blocked-accounts",
  },
  {
    key: "generations",
    label: "Generations",
    to: "/admin/generations",
    isCurrent: (p) =>
      p === "/admin/generations" || p.startsWith("/admin/generations/"),
  },
  {
    key: "settings",
    label: "Site settings",
    to: "/admin/settings",
    isCurrent: (p) => p === "/admin/settings",
  },
  {
    key: "audit",
    label: "Audit",
    to: "/admin/audit",
    isCurrent: (p) => p === "/admin/audit",
  },
  {
    key: "logs",
    label: "Logs",
    to: "/admin/logs",
    isCurrent: (p) => p === "/admin/logs",
  },
];

/**
 * The admin section nav (the prototype's `.va-nav`, issue #200): one
 * horizontal bar under the app header, scrolling sideways rather than
 * wrapping on phones. The Users and Logs badges poll only while
 * `isAdmin`, so a non-Admin routed through `AdminShell` (briefly, before
 * its redirect) never calls an admin-only endpoint.
 */
export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const { pathname } = useLocation();

  const { data: pendingCount } = useQuery({
    queryKey: adminBadgeKeys.pending,
    queryFn: () =>
      ok<{ count: number }>(api.api.admin.users["pending-count"].$get()),
    enabled: isAdmin,
    refetchInterval: BADGE_POLL_MS,
  });

  const { data: errorCount } = useQuery({
    queryKey: adminBadgeKeys.errors,
    queryFn: () =>
      ok<{ count: number }>(api.api.admin.logs["error-count-24h"].$get()),
    enabled: isAdmin,
    refetchInterval: BADGE_POLL_MS,
  });

  return (
    <div className="w-full border-b border-border bg-card">
      <nav
        aria-label="Admin"
        className="mx-auto flex max-w-320 gap-1 overflow-x-auto px-4 py-1.5 [scrollbar-width:none]"
      >
        {SECTIONS.map((section) => {
          const current = section.isCurrent(pathname);
          const badge =
            section.key === "users" &&
            pendingCount &&
            pendingCount.count > 0 ? (
              <>
                <Count tone="accent">{pendingCount.count}</Count>
                <span className="sr-only">, {pendingCount.count} pending</span>
              </>
            ) : section.key === "logs" && errorCount && errorCount.count > 0 ? (
              <>
                <Count tone="err">{errorCount.count}</Count>
                <span className="sr-only">
                  , {errorCount.count} errors in the last 24 hours
                </span>
              </>
            ) : null;

          return (
            <Link
              key={section.key}
              to={section.to}
              aria-current={current ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-md px-2.5 py-[7px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent-soft aria-[current=page]:text-foreground",
              )}
            >
              {section.label}
              {badge}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
