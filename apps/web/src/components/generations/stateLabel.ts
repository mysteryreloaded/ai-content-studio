import type { GenerationProgress, GenerationSummary } from "./types.js";

export type PillTone = "neutral" | "accent" | "ok" | "err" | "warn";

export interface GenerationStatus {
  pill: string;
  tone: PillTone;
  text: string;
  /** The placeholder's big heading while under way: "queued", "starting", "generating", "saving" or "cancelling" — null once ended. */
  stage: string | null;
}

/** Elapsed time against the median of the Mode's last 10 successes, capped at 99%; `null` (indeterminate) without that history. */
export function progressPercent(
  progress: GenerationProgress | undefined,
): number | null {
  if (!progress || progress.estimateMs === null || progress.estimateMs <= 0) {
    return null;
  }
  return Math.min(
    99,
    Math.round((progress.elapsedMs / progress.estimateMs) * 100),
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Issue #55/#195's AC: a queued card says it's waiting for a GPU or retrying, never a queue position. */
export function genStatus(
  generation: GenerationSummary,
  {
    paused,
    progress,
  }: { paused: boolean; progress: GenerationProgress | undefined },
): GenerationStatus {
  const { state, tries, error, startedAt, endedAt } = generation;

  if (state === "cancelling") {
    return {
      pill: "Cancelling…",
      tone: "warn",
      text: "waiting for the GPU to stop",
      stage: "cancelling",
    };
  }

  switch (state) {
    case "queued":
      if (paused) {
        return {
          pill: "Queued · paused",
          tone: "warn",
          text: "",
          stage: "queued",
        };
      }
      if (tries > 0) {
        return {
          pill: "Queued",
          tone: "neutral",
          text: "Retrying on another GPU: the first one stopped responding.",
          stage: "queued",
        };
      }
      return {
        pill: "Queued",
        tone: "neutral",
        text: "waiting for a free GPU",
        stage: "queued",
      };
    case "starting":
      return {
        pill: "Running",
        tone: "accent",
        text: "starting · sending your files",
        stage: "starting",
      };
    case "running": {
      const parts = ["generating"];
      if (progress?.step != null && progress?.totalSteps != null) {
        parts.push(`step ${progress.step} / ${progress.totalSteps}`);
      }
      const pct = progressPercent(progress);
      if (pct !== null) parts.push(`${pct}%`);
      return {
        pill: "Running",
        tone: "accent",
        text: parts.join(" · "),
        stage: "generating",
      };
    }
    case "saving":
      return {
        pill: "Running",
        tone: "accent",
        text: "saving",
        stage: "saving",
      };
    case "succeeded":
      return {
        pill: "Done",
        tone: "ok",
        text:
          startedAt && endedAt
            ? `took ${formatDuration(new Date(endedAt).getTime() - new Date(startedAt).getTime())}`
            : "",
        stage: null,
      };
    case "failed":
      return { pill: "Failed", tone: "err", text: error ?? "", stage: null };
    case "cancelled":
      return { pill: "Cancelled", tone: "neutral", text: "", stage: null };
    default:
      return { pill: state, tone: "neutral", text: "", stage: null };
  }
}

/** Issue #195's AC: relative submission time — "just now", "{m} min ago", "{h} h ago", else the date. */
export function ago(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(then).toLocaleDateString([], {
    day: "numeric",
    month: "short",
  });
}
