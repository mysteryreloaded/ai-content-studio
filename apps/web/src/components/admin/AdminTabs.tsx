import { Link, useLocation } from "react-router-dom";

export interface AdminTab {
  to: string;
  label: string;
}

/**
 * The Users / Blocked accounts section's link tabs (issue #207, the
 * prototype's `.tabs`): a `border-b` row of `Link`s where the current
 * page carries `aria-current="page"` and the 2px accent bottom border
 * (the prototype's selected tab state).
 */
export function AdminTabs({ tabs }: { tabs: readonly AdminTab[] }) {
  const location = useLocation();
  return (
    <nav className="flex gap-2 overflow-x-auto border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={location.pathname === tab.to ? "page" : undefined}
          className="border-b-2 border-transparent px-[9px] pt-[9px] pb-2 font-medium whitespace-nowrap text-muted-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** The two pages of the Users section (issue #207). */
export const userSectionTabs: readonly AdminTab[] = [
  { to: "/admin/users", label: "Users" },
  { to: "/admin/blocked-accounts", label: "Blocked accounts" },
];
