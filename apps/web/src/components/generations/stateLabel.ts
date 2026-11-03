import type { GenerationState } from "./types.js";

/** Issue #55's AC: a queued card says it's waiting for a GPU or retrying, never a queue position. */
export function stateLabel(
  state: GenerationState,
  tries: number,
  paused: boolean,
): string {
  switch (state) {
    case "queued":
      if (paused) return "Queued · paused";
      return tries > 0 ? "Retrying…" : "Waiting for a GPU…";
    case "starting":
      return "Starting…";
    case "running":
      return "Running…";
    case "saving":
      return "Saving…";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelling":
      return "Cancelling…";
    case "cancelled":
      return "Cancelled";
    default:
      return state;
  }
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
