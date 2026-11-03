import type { WorkbenchInput } from "@ai-content-studio/shared";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

type SeedInput = Extract<WorkbenchInput, { kind: "seed" }>;

/** The seed Input's control (prototype `InputControl`'s seed branch, issue #194 step 7): blank means random, with a "Random" button that clears a typed seed. */
export function SeedControl({
  id,
  input,
  value,
  onChange,
  describedBy,
  invalid,
}: {
  id: string;
  input: SeedInput;
  value: string;
  onChange: (value: string) => void;
  describedBy?: string;
  invalid: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={`input-${id}`}
        inputMode="numeric"
        className="max-w-[140px] font-mono"
        placeholder="Random"
        value={value}
        max={input.max ?? undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        onChange={(event) =>
          onChange(event.target.value.replace(/[^0-9]/g, ""))
        }
      />
      {value !== "" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange("")}
        >
          Random
        </Button>
      )}
    </div>
  );
}
