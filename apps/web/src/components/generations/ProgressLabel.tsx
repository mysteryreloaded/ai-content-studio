import { formatElapsed } from "./stateLabel.js";
import type { GenerationProgress } from "./types.js";

/** Elapsed time against the median of its last 10 successes, capped at 99%; without that history, just the elapsed time, indeterminate. */
export function ProgressLabel({
  progress,
}: { progress: GenerationProgress | undefined }) {
  if (!progress) return null;
  const parts: string[] = [];
  if (progress.estimateMs !== null && progress.estimateMs > 0) {
    const percent = Math.min(
      99,
      Math.round((progress.elapsedMs / progress.estimateMs) * 100),
    );
    parts.push(`${percent}%`);
  } else {
    parts.push(`${formatElapsed(progress.elapsedMs)} elapsed`);
  }
  if (progress.step !== null && progress.totalSteps !== null) {
    parts.push(`step ${progress.step} / ${progress.totalSteps}`);
  }
  return <span className="workbench-progress">{parts.join(" · ")}</span>;
}
