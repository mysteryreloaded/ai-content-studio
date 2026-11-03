import type {
  InputDefinition,
  ModeInputSetting,
} from "@ai-content-studio/shared";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover.js";
import type { DraftMode } from "../types.js";
import { Field } from "../ui/Field.js";
import type { InputState } from "../ui/StateChip.js";
import { StateEditor } from "../ui/StateEditor.js";

/**
 * The grid's only edit surface (issue #216): a popover with State, the
 * fixed-value editor when Fixed, "Label in this Mode", and "Apply to
 * every Mode whose Path holds this Input's fields". No row menus, no
 * multi-select.
 */
export function CellPopover({
  input,
  mode,
  setting,
  defaultOpen,
  ariaLabel,
  onChange,
  onApplyToEveryEligibleMode,
  children,
}: {
  input: InputDefinition;
  mode: DraftMode;
  setting: ModeInputSetting;
  defaultOpen?: boolean;
  ariaLabel: string;
  onChange: (patch: Partial<ModeInputSetting>) => void;
  onApplyToEveryEligibleMode: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));

  // The checks rail's "jump to this cell" (issue #216's `openCell`) can
  // target a cell well after this popover first mounted, so it's not
  // enough to seed `open` from `defaultOpen` once.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

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
      setOpen(false);
    }
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="block min-h-[22px] w-full rounded-sm text-left hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-primary focus-visible:outline-2"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-60 p-2.5">
        <p className="text-[13px]">
          <strong>{input.label || "this Input"}</strong> in{" "}
          {mode.name || "this Mode"}
        </p>
        <StateEditor
          input={input}
          state={setting.state}
          fixedValue={setting.fixedValue}
          onStateChange={(state: InputState) =>
            onChange({
              state,
              fixedValue: state === "fixed" ? setting.fixedValue : null,
            })
          }
          onFixedValueChange={(fixedValue) => onChange({ fixedValue })}
        />
        <Field
          label="Label in this Mode"
          htmlFor={`cell-label-${mode.key}-${input.id}`}
          hint="Blank uses the Input's label."
        >
          <Input
            id={`cell-label-${mode.key}-${input.id}`}
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
          onClick={onApplyToEveryEligibleMode}
        >
          Apply to every Mode whose Path holds this Input's fields
        </Button>
      </PopoverContent>
    </Popover>
  );
}
