import type { WorkbenchInput } from "@ai-content-studio/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";

type SelectInput = Extract<WorkbenchInput, { kind: "select" }>;

/** Radix forbids `""` as an item's value, so a blank ("Use the Workflow's value") choice uses this sentinel instead. */
const BLANK_SENTINEL = "__workbench_use_workflow_value__";

/**
 * A select Input's control (prototype `InputControl`'s select branch,
 * issue #194 step 7): a 2-option select is a segmented toggle; 3 or
 * more is a shadcn `Select`. Pressing a pressed, optional toggle option
 * again clears it. An option matching `input.placeholder` is marked
 * the default while the value is blank.
 */
export function SelectControl({
  id,
  input,
  value,
  onChange,
  optional,
  describedBy,
  invalid,
}: {
  id: string;
  input: SelectInput;
  value: string;
  onChange: (value: string) => void;
  optional: boolean;
  describedBy?: string;
  invalid: boolean;
}) {
  const blank = value === "";
  const isDefault = (optionId: string) =>
    blank && input.placeholder === optionId;

  if (input.options.length === 2) {
    return (
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        id={`input-${id}`}
        value={value}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        onValueChange={(next) => {
          if (next === "") {
            if (optional) onChange("");
            return;
          }
          onChange(next);
        }}
      >
        {input.options.map((option) => {
          const def = isDefault(option.id);
          return (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              className={
                def
                  ? "shadow-[inset_0_0_0_1px_var(--line-strong)] bg-[repeating-linear-gradient(135deg,transparent_0_5px,var(--sunk)_5px_7px)] data-[state=on]:bg-accent-soft data-[state=on]:font-semibold data-[state=on]:text-foreground"
                  : "data-[state=on]:bg-accent-soft data-[state=on]:font-semibold data-[state=on]:text-foreground"
              }
            >
              {option.label}
              {def && (
                <span className="ml-1 text-xs font-normal text-faint">
                  default
                </span>
              )}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    );
  }

  return (
    <Select
      value={blank ? BLANK_SENTINEL : value}
      onValueChange={(next) => onChange(next === BLANK_SENTINEL ? "" : next)}
    >
      <SelectTrigger
        id={`input-${id}`}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className="w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {optional && (
          <SelectItem value={BLANK_SENTINEL}>
            Use the Workflow's value
          </SelectItem>
        )}
        {input.options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
            {isDefault(option.id) ? " (default)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
