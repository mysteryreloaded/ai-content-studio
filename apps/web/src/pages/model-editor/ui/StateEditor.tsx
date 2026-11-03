import type { InputDefinition } from "@ai-content-studio/shared";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../components/ui/toggle-group.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip.js";
import { FixedValueEditor } from "../modes/FixedValueEditor.js";
import type { InputState } from "./StateChip.js";

const TOOLTIP_BY_STATE: Record<InputState, string> = {
  hidden: "Not shown; its fields keep the Workflow's values",
  optional: "Shown; blank keeps the Workflow's value",
  required: "Shown; must be filled",
  fixed: "Not shown; always writes this value",
};

/**
 * ADR 0007 / issue #51/#52: Fixed is never offered for a Seed, an
 * Upload, or a Points Input — the same rule `ModeInputGrid` enforces
 * today for its own inline state select.
 */
export function fixedAllowedFor(input: InputDefinition): boolean {
  return (
    input.kind !== "seed" &&
    input.kind !== "image_upload" &&
    input.kind !== "video_upload" &&
    input.kind !== "audio_upload" &&
    input.kind !== "points"
  );
}

const LABEL_BY_STATE: Record<InputState, string> = {
  hidden: "Hidden",
  optional: "Optional",
  required: "Required",
  fixed: "Fixed",
};

/** `ToggleGroup` with Hidden/Optional/Required/Fixed, plus `FixedValueEditor` (issue #213). */
export function StateEditor({
  input,
  state,
  fixedValue,
  onStateChange,
  onFixedValueChange,
}: {
  input: InputDefinition;
  state: InputState;
  fixedValue: string | number | boolean | null;
  onStateChange: (state: InputState) => void;
  onFixedValueChange: (value: string | number | boolean | null) => void;
}) {
  const states: InputState[] = fixedAllowedFor(input)
    ? ["hidden", "optional", "required", "fixed"]
    : ["hidden", "optional", "required"];

  return (
    <div className="flex flex-col gap-2">
      <TooltipProvider>
        <ToggleGroup
          type="single"
          value={state}
          onValueChange={(value) => {
            if (value) onStateChange(value as InputState);
          }}
          aria-label={`${input.label} state`}
        >
          {states.map((candidate) => (
            <Tooltip key={candidate}>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value={candidate}
                  aria-label={LABEL_BY_STATE[candidate]}
                >
                  {LABEL_BY_STATE[candidate]}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{TOOLTIP_BY_STATE[candidate]}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      </TooltipProvider>
      {state === "fixed" && (
        <FixedValueEditor
          input={input}
          value={fixedValue}
          onChange={onFixedValueChange}
        />
      )}
    </div>
  );
}
