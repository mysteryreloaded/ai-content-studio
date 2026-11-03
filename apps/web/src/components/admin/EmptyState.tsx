import type { ReactNode } from "react";

/** The prototype's `.note` (issue #200): a muted, sunk block for an empty list or table. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-muted px-[11px] py-[9px] text-muted-foreground">
      {children}
    </p>
  );
}
