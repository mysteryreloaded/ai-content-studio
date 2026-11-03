import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { ModeUses } from "../../components/inputs/ModeUses.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { MODE_MENU_GROUP_LABELS, groupModesForMenu } from "./modeMenuGroups.js";
import type { WorkbenchMode } from "./types.js";

const EYEBROW =
  "text-xs leading-tight font-semibold uppercase tracking-[0.08em] text-muted-foreground";

/**
 * The Mode menu (prototype `ModeMenu`, issue #194 story 20): one Mode
 * shows an eyebrow heading with the Mode's name and description; two or
 * more show a button opening a popover of Modes grouped by what the
 * user starts from.
 */
export function ModeMenu({
  modes,
  selectedModeId,
  onSelect,
}: {
  modes: WorkbenchMode[];
  selectedModeId: string | null;
  onSelect: (mode: WorkbenchMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const listboxId = useId();
  const currentMode = modes.find((mode) => mode.id === selectedModeId);

  if (modes.length <= 1) {
    const mode = modes[0];
    return (
      <div className="flex flex-col gap-1">
        <span className={EYEBROW}>Mode</span>
        {mode && (
          <>
            <h2 className="text-base font-semibold">{mode.name}</h2>
            <p className="text-sm text-muted-foreground">{mode.description}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className={EYEBROW}>
        Mode
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: a rich trigger (name + description) opening a custom listbox isn't a native <select>.
            role="combobox"
            aria-haspopup="listbox"
            aria-labelledby={labelId}
            aria-expanded={open}
            aria-controls={listboxId}
            className="flex w-full items-center gap-2.5 rounded-xl border border-input bg-card px-3 py-[9px] text-left hover:border-foreground"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <strong className="text-base font-semibold">
                {currentMode?.name}
              </strong>
              <span className="text-sm text-muted-foreground">
                {currentMode?.description}
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          id={listboxId}
          // biome-ignore lint/a11y/useSemanticElements: a popover of rich options (each with its own ModeUses line) isn't a native <select>.
          role="listbox"
          aria-label="Modes"
          align="start"
          className="flex max-h-[min(70vh,560px)] w-[min(420px,calc(100vw-32px))] flex-col gap-2.5 overflow-y-auto p-2.5"
        >
          {groupModesForMenu(modes).map(({ group, modes: groupModes }) => (
            <div key={group} className="flex flex-col gap-0.5">
              <div className={`${EYEBROW} px-2 py-0.5`}>
                {MODE_MENU_GROUP_LABELS[group]}
              </div>
              {groupModes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: a rich option (name + ModeUses) inside a custom listbox isn't a native <option>.
                  role="option"
                  aria-selected={mode.id === selectedModeId}
                  className="flex flex-col gap-0.5 rounded-md px-2 py-[7px] text-left hover:bg-muted aria-selected:bg-accent-soft"
                  onClick={() => {
                    onSelect(mode);
                    setOpen(false);
                  }}
                >
                  <strong className="text-sm font-semibold">{mode.name}</strong>
                  <ModeUses mode={mode} />
                </button>
              ))}
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
