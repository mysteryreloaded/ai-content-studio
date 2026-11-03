import { cn } from "cn";
import { progressPercent } from "./stateLabel.js";
import type {
  GenerationProgress as GenerationProgressData,
  GenerationSummary,
} from "./types.js";

const BAR_STATES = new Set(["starting", "running", "saving"]);

/** The placeholder's thin progress bar: determinate once there's an estimate, indeterminate for `starting` or with no estimate yet, 99% while `saving`. */
export function GenerationProgress({
  generation,
  progress,
}: {
  generation: GenerationSummary;
  progress: GenerationProgressData | undefined;
}) {
  if (!BAR_STATES.has(generation.state)) return null;
  const indeterminate =
    generation.state === "starting" ||
    (generation.state === "running" && progressPercent(progress) === null);
  const pct =
    generation.state === "saving" ? 99 : (progressPercent(progress) ?? 0);

  return (
    // biome-ignore lint/a11y/useFocusableInteractive: a progress bar reports status, it doesn't take focus.
    <div
      className="absolute inset-x-2.5 bottom-2.5 h-1 overflow-hidden rounded-[3px] bg-white/18"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
    >
      <div
        className={cn(
          "h-full rounded-[3px] bg-media-foreground",
          indeterminate && "w-[35%] animate-indet",
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
