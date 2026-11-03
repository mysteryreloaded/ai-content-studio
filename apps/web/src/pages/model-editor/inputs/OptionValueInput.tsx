import type { NodeFieldValue } from "@ai-content-studio/shared";
import { Input } from "../../../components/ui/input.js";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../components/ui/toggle-group.js";

/**
 * A select option's value for one bound field (issue #215): a select of
 * the Backend's COMBO choices when known, true/false for a boolean
 * field, a number input for a number field, otherwise text. Mirrors
 * today's `bindingValueKind` coercion.
 */
export function OptionValueInput({
  id,
  label,
  valueKind,
  comboOptions,
  value,
  onChange,
}: {
  id: string;
  label: string;
  valueKind: "string" | "number" | "boolean" | null;
  comboOptions: readonly string[] | null;
  value: NodeFieldValue;
  onChange: (value: string | number | boolean) => void;
}) {
  if (comboOptions) {
    return (
      <select
        id={id}
        aria-label={label}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-[130px] rounded-md border border-input bg-transparent px-2 text-[13px]"
      >
        <option value="">(choose)</option>
        {comboOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (valueKind === "boolean") {
    const current = value === true ? "true" : value === false ? "false" : "";
    return (
      <ToggleGroup
        type="single"
        size="sm"
        value={current}
        onValueChange={(next) => {
          if (next) onChange(next === "true");
        }}
        aria-label={label}
      >
        <ToggleGroupItem value="true">true</ToggleGroupItem>
        <ToggleGroupItem value="false">false</ToggleGroupItem>
      </ToggleGroup>
    );
  }
  if (valueKind === "number") {
    return (
      <Input
        id={id}
        aria-label={label}
        type="number"
        className="min-w-[130px]"
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    );
  }
  return (
    <Input
      id={id}
      aria-label={label}
      className="min-w-[130px]"
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
