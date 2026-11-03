import { cn } from "cn";
import type { ReactNode } from "react";
import { Table } from "../ui/table.js";

/** Shared cell classes (issue #200) so every admin table looks the same. */
export const adminHeadCell =
  "h-auto px-2.5 py-[7px] text-xs font-semibold text-muted-foreground";
export const adminCell = "px-2.5 py-[7px] text-[13px]";
export const adminRowClickable = "cursor-pointer hover:bg-muted";
export const adminRowSelected = "bg-accent-soft";

/**
 * The `.table-wrap` wrapper around a shadcn `Table` (issue #200): a
 * bordered, rounded, horizontally scrollable frame so a wide table never
 * forces the page itself to scroll sideways.
 */
export function AdminTable({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-border bg-card",
        className,
      )}
    >
      <Table>{children}</Table>
    </div>
  );
}
