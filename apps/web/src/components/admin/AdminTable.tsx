import { cn } from "cn";
import type { ReactNode } from "react";
import { Table } from "../ui/table.js";

/**
 * Shared cell classes (issue #200) so every admin table looks the same.
 * The `Table` primitive's own 48px rows and padding (docs/ui-sizes.md)
 * apply unmodified; `adminHeadCell` only adds the muted colour and
 * weight the prototype's head row carries over the primitive's default.
 */
export const adminHeadCell = "text-muted-foreground font-semibold";
export const adminCell = "";
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
