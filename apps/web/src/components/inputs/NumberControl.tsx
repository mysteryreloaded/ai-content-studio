import type { WorkbenchInput } from "@ai-content-studio/shared";
import { Input } from "../ui/input.js";

type NumberInput = Extract<WorkbenchInput, { kind: "number" }>;

/** A number Input's control (prototype `InputControl`'s number branch, issue #194 step 7): whole or decimal, with a range + step hint. Units go in the label (e.g. "Duration (s)"). */
export function NumberControl({
  id,
  input,
  value,
  onChange,
  placeholder,
  describedBy,
  invalid,
}: {
  id: string;
  input: NumberInput;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  describedBy?: string;
  invalid: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id={`input-${id}`}
        type="number"
        inputMode={input.numberMode === "integer" ? "numeric" : "decimal"}
        className="max-w-[140px]"
        value={value}
        placeholder={placeholder}
        min={input.min}
        max={input.max}
        step={input.step}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="text-sm text-faint tabular-nums">
        {input.min}–{input.max}
        {input.step !== 1 ? `, steps of ${input.step}` : ""}
      </span>
    </div>
  );
}
