import { cn } from "cn";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";

const COUNTS = [1, 2, 3, 4];

/** The foot's "Generations" picker (issue #196, prototype `.count-pick`): shown whenever the Mode's Path holds a bound Seed Input. A count above `maxCount` stays pickable (the server refuses with the Cap message) but shows struck through, with a tooltip. */
export function CountPicker({
  count,
  onChange,
  maxCount,
}: {
  count: number;
  onChange: (count: number) => void;
  maxCount: number;
}) {
  const labelId = "count-picker-label";
  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="text-[12.5px] text-muted-foreground">
        Generations
      </span>
      <TooltipProvider>
        <ToggleGroup
          type="single"
          // biome-ignore lint/a11y/useSemanticElements: a Radix ToggleGroup, not a native <fieldset>; `role="group"` names it "Generations" for assistive tech.
          role="group"
          aria-labelledby={labelId}
          value={String(count)}
          onValueChange={(value) => {
            if (value) onChange(Number(value));
          }}
        >
          {COUNTS.map((n) => {
            const overCap = n > maxCount;
            const item = (
              <ToggleGroupItem
                key={n}
                value={String(n)}
                className={cn(
                  "h-auto min-w-[30px] px-[9px] py-[5px] text-[13px]",
                  overCap &&
                    // The over-cap items are wrapped in a Tooltip below, whose
                    // own open/closed `data-state` clobbers the Toggle's
                    // on/off one on the shared DOM node (Radix `asChild`
                    // merges both onto it) — `aria-checked` is untouched by
                    // the Tooltip, so the pressed look keys off that instead.
                    "text-faint line-through decoration-faint/60 aria-checked:bg-warn-soft aria-checked:text-warn aria-checked:no-underline!",
                )}
              >
                {n}
              </ToggleGroupItem>
            );
            if (!overCap) return item;
            return (
              <Tooltip key={n}>
                <TooltipTrigger asChild>{item}</TooltipTrigger>
                <TooltipContent>
                  More than your Caps allow right now
                </TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </TooltipProvider>
    </div>
  );
}
