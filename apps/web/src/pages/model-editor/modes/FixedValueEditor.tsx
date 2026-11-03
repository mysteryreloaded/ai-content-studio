import type { InputDefinition } from "@ai-content-studio/shared";

/** One grid cell's fixed-value editor, matching the Input's own kind (issue #48: "fixed values respect options and ranges"). */
export function FixedValueEditor({
  input,
  value,
  onChange,
}: {
  input: InputDefinition;
  value: string | number | boolean | null;
  onChange: (value: string | number | boolean | null) => void;
}) {
  if (input.kind === "text") {
    return (
      <input
        aria-label={`${input.label} fixed value`}
        value={typeof value === "string" ? value : ""}
        maxLength={input.maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (input.kind === "number") {
    return (
      <input
        aria-label={`${input.label} fixed value`}
        type="number"
        value={typeof value === "number" ? value : ""}
        min={input.min}
        max={input.max}
        step={input.step}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
      />
    );
  }
  // A Seed can't be fixed (ADR 0007: the grid never offers it), so the
  // only kind left here is select.
  if (input.kind !== "select") return null;
  return (
    <select
      aria-label={`${input.label} fixed value`}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose…</option>
      {input.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
