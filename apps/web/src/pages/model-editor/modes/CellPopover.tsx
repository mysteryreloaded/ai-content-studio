import type {
  InputDefinition,
  ModeInputSetting,
} from "@ai-content-studio/shared";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "../../../components/ui/popover.js";
import { Field } from "../ui/Field.js";
import { StateEditor } from "../ui/StateEditor.js";

/**
 * The grid's only edit surface (issue #216): State (`StateEditor`), a
 * per-Mode label override, and "Apply to every Mode whose Path holds
 * this Input's fields" — the grid's sole bulk edit, no row menus, no
 * multi-select. Closes on Escape, an outside click (Radix's own
 * defaults) and on scroll.
 */
export function CellPopover({
  input,
  modeName,
  setting,
  open,
  onOpenChange,
  onChange,
  onApplyToEveryEligibleMode,
  children,
}: {
  input: InputDefinition;
  modeName: string;
  setting: ModeInputSetting;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (patch: Partial<ModeInputSetting>) => void;
  onApplyToEveryEligibleMode: () => void;
  children: ReactNode;
}) {
  // The prototype closes the popover on scroll, not just Escape and an
  // outside click (Radix's own defaults for those two) — but not a
  // scroll inside the popover itself (e.g. a long label or hint text
  // scrolling its own field), which isn't "the page moved under it".
  useEffect(() => {
    if (!open) return;
    function onScroll(event: Event) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-slot="popover-content"]')
      ) {
        return;
      }
      onOpenChange(false);
    }
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open, onOpenChange]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto min-w-60 p-2.5">
        <PopoverTitle>
          <strong>{input.label || "Untitled Input"}</strong> in {modeName}
        </PopoverTitle>

        <StateEditor
          input={input}
          state={setting.state}
          fixedValue={setting.fixedValue}
          onStateChange={(state) =>
            onChange({
              state,
              fixedValue: state === "fixed" ? setting.fixedValue : null,
            })
          }
          onFixedValueChange={(fixedValue) => onChange({ fixedValue })}
        />

        <Field
          label="Label in this Mode"
          hint="Blank uses the Input's label."
          htmlFor={`cell-label-${input.id}`}
        >
          <Input
            id={`cell-label-${input.id}`}
            value={setting.label}
            placeholder={input.label}
            maxLength={60}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </Field>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onApplyToEveryEligibleMode();
            onOpenChange(false);
          }}
        >
          Apply to every Mode whose Path holds this Input's fields
        </Button>
      </PopoverContent>
    </Popover>
  );
}
