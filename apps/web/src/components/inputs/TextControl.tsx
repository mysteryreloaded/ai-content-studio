import type { WorkbenchInput } from "@ai-content-studio/shared";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";

type TextInput = Extract<WorkbenchInput, { kind: "text" }>;

/** A text Input's control (prototype `InputControl`'s text branch, issue #194 step 7): one- or multi-line, with a `len / max` counter. */
export function TextControl({
  id,
  input,
  value,
  onChange,
  placeholder,
  describedBy,
  invalid,
}: {
  id: string;
  input: TextInput;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  describedBy?: string;
  invalid: boolean;
}) {
  const len = value.length;
  const over = len > input.maxLength;
  const counter = (
    <span
      className={`pointer-events-none absolute right-2 bottom-1.5 rounded-[3px] bg-card px-[3px] text-xs tabular-nums ${
        over ? "font-semibold text-err" : "text-faint"
      }`}
    >
      {len} / {input.maxLength}
    </span>
  );

  if (input.multiline) {
    return (
      <div className="relative">
        <Textarea
          id={`input-${id}`}
          rows={3}
          className="min-h-16 pb-5"
          value={value}
          placeholder={placeholder}
          maxLength={input.maxLength}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
        {counter}
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        id={`input-${id}`}
        value={value}
        placeholder={placeholder}
        maxLength={input.maxLength}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="pr-14"
        onChange={(event) => onChange(event.target.value)}
      />
      {counter}
    </div>
  );
}
