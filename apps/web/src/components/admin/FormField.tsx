import type { ReactNode } from "react";
import { Label } from "../ui/label.js";

/** The prototype's `Field` helper (issue #200): a labelled control with an optional hint or error line. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-err">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
