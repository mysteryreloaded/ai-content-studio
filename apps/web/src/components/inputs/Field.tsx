import { Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One Input's field wrapper (prototype `Field`, issue #194 step 7):
 * label, an "Optional" mark on optional Inputs (in a sibling `<span>`,
 * outside the `<label>`, so `getByLabelText` still matches the control
 * alone), the control, help under it, an info note line, and the error
 * with an alert icon.
 */
export function Field({
  id,
  label,
  optional,
  help,
  note,
  error,
  children,
}: {
  id: string;
  label: string;
  optional: boolean;
  help?: string | null;
  note?: string | null;
  error?: string | null;
  children: ReactNode;
}) {
  const helpId = help ? `input-help-${id}` : undefined;
  const issueId = error ? `input-issue-${id}` : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <label htmlFor={`input-${id}`} className="text-[13.5px] font-semibold">
          {label}
        </label>
        {optional && (
          <span className="text-[11.5px] font-normal text-faint">Optional</span>
        )}
      </div>
      {children}
      {help && (
        <p id={helpId} className="text-[12.5px] text-muted-foreground">
          {help}
        </p>
      )}
      {note && (
        <p className="flex items-start gap-[5px] text-[12.5px] text-info">
          <Info className="size-[13px] shrink-0 translate-y-px" /> {note}
        </p>
      )}
      {error && (
        <p
          id={issueId}
          role="alert"
          className="flex items-start gap-[5px] text-[12.5px] text-err"
        >
          <TriangleAlert className="size-[13px] shrink-0 translate-y-px" />{" "}
          {error}
        </p>
      )}
    </div>
  );
}

/** The ids a `Field`'s own control should wire up: label, help and the error, for `aria-describedby`. */
export function fieldDescribedBy(
  id: string,
  help: string | null | undefined,
  error: string | null | undefined,
): string | undefined {
  const helpId = help ? `input-help-${id}` : undefined;
  const issueId = error ? `input-issue-${id}` : undefined;
  return [helpId, issueId].filter(Boolean).join(" ") || undefined;
}
