import type { ReactNode } from "react";
import { Button } from "../ui/button.js";

/**
 * The prototype's `.panel.pad-sm` filter bar (issue #200): a `.fields`
 * grid of labelled controls the caller supplies as `children`, plus a
 * right-aligned action row. Presentational only — each page keeps its
 * own filter state and passes the handlers it wants wired up.
 */
export function FilterBar({
  onApply,
  onClear,
  onRefresh,
  children,
}: {
  onApply?: () => void;
  onClear: () => void;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 max-[760px]:grid-cols-1">
        {children}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {onRefresh && (
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          Clear filters
        </Button>
        {onApply && (
          <Button type="button" size="sm" onClick={onApply}>
            Apply
          </Button>
        )}
      </div>
    </div>
  );
}
