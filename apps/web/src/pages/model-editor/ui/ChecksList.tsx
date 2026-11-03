import type { ModelIssue } from "@ai-content-studio/shared";
import { cn } from "cn";
import { CircleAlert, TriangleAlert } from "lucide-react";
import { Pill } from "../../../components/ui/pill.js";

/** The prototype's `.count` (issue #213): a small error/warning count pill. */
export function IssueCount({
  count,
  tone,
}: {
  count: number;
  tone: "err" | "warn";
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
        tone === "err" ? "bg-err text-card" : "bg-warn-soft text-warn",
      )}
    >
      {count}
    </span>
  );
}

/**
 * Errors first, then warnings (issue #213's "Checks"): reused by the
 * checks rail and, once #216 lands, the Mode sheet's own list via
 * `filter`.
 */
export function ChecksList({
  issues,
  title = "Checks",
  filter,
  onJump,
}: {
  issues: ModelIssue[];
  title?: string;
  filter?: (issue: ModelIssue) => boolean;
  onJump: (issue: ModelIssue) => void;
}) {
  const filtered = filter ? issues.filter(filter) : issues;
  const errors = filtered.filter((issue) => issue.severity === "error");
  const warnings = filtered.filter((issue) => issue.severity === "warning");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <IssueCount count={errors.length} tone="err" />
        {errors.length > 0 && <Pill tone="err">{errors.length} error(s)</Pill>}
        {warnings.length > 0 && (
          <Pill tone="warn">{warnings.length} warning(s)</Pill>
        )}
        {errors.length === 0 && warnings.length === 0 && (
          <Pill tone="ok">No problems</Pill>
        )}
      </div>
      {errors.length > 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          Errors keep the Model from being enabled. A draft with errors can
          still be saved.
        </p>
      )}
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="flex flex-col gap-0.5">
          {[...errors, ...warnings].map((issue, index) => (
            <li key={`${issue.severity}-${issue.message}-${index}`}>
              <button
                type="button"
                onClick={() => onJump(issue)}
                className="flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-muted"
              >
                {issue.severity === "error" ? (
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-err"
                  />
                ) : (
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-warn"
                  />
                )}
                <span>{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
