import { cn } from "cn";
import { Lock } from "lucide-react";

export type InputState = "hidden" | "optional" | "required" | "fixed";

/** A read-only state chip (the prototype's `.st`), issue #213. */
export function StateChip({
  state,
  fixedValue,
}: {
  state: InputState;
  fixedValue?: string | number | boolean | null;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px text-xs leading-[1.4]";

  if (state === "hidden") {
    return <span className={cn(base, "text-faint")}>—</span>;
  }
  if (state === "optional") {
    return <span className={cn(base, "border border-input")}>Optional</span>;
  }
  if (state === "required") {
    return (
      <span
        className={cn(base, "bg-primary font-semibold text-primary-foreground")}
      >
        Required
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-muted font-mono text-[11.5px]")}>
      <Lock aria-hidden="true" className="size-3" />
      {fixedValue === null || fixedValue === undefined || fixedValue === ""
        ? "—"
        : String(fixedValue)}
    </span>
  );
}
