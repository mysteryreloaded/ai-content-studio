export type GenerationState =
  | "queued"
  | "starting"
  | "running"
  | "saving"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled";

export const UNDERWAY_STATES = new Set<GenerationState>([
  "queued",
  "starting",
  "running",
  "saving",
  "cancelling",
]);

export const TERMINAL_STATES = new Set<GenerationState>([
  "succeeded",
  "failed",
  "cancelled",
]);

export interface TrackedGeneration {
  id: string;
  state: GenerationState;
  /** Set once this tab learns (by fetching its id) that it was deleted — a Tombstone never notifies. */
  removed?: boolean;
}

/** One Submission this tab has seen under way, kept until every Generation ends or is found removed. */
export interface TrackedSubmission {
  submissionId: string;
  modelName: string;
  modeName: string;
  generations: TrackedGeneration[];
}
