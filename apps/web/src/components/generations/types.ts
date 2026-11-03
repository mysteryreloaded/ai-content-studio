export type GenerationState =
  | "queued"
  | "starting"
  | "running"
  | "saving"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled";

export const DONE_STATES = new Set<GenerationState>([
  "succeeded",
  "failed",
  "cancelled",
]);

/** Issue #195: a card's own Cancel button, excluding `saving` (too late to matter) and `cancelling` itself. */
export const CANCELLABLE_STATES = new Set<GenerationState>([
  "queued",
  "starting",
  "running",
]);

export interface AssetSummary {
  id: string;
  nodeId: string;
  sortOrder: number;
  kind: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface GenerationSummary {
  id: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modeId: string;
  modeName: string;
  submissionId: string;
  state: GenerationState;
  /** Issue #55: tries made so far. A queued Generation with `tries > 0` is retrying, not waiting for its first try. */
  tries: number;
  error: string | null;
  submittedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  assets: AssetSummary[];
  /** Issue #68: an Admin removed this Generation — shown as a dismissable card, same as the Gallery's. */
  removedAt: string | null;
}

export interface GenerationProgress {
  generationId: string;
  elapsedMs: number;
  estimateMs: number | null;
  step: number | null;
  totalSteps: number | null;
}

/** Issue #190: one Upload a Submission used, for its thumbnails. */
export interface SubmissionUploadSummary {
  id: string;
  kind: "image" | "video" | "audio";
  thumbnailKey: string | null;
  removed: boolean;
}

export interface SubmissionSummary {
  submissionId: string;
  modeId: string;
  modeName: string;
  submittedAt: string;
  prompt?: string | null;
  uploads?: SubmissionUploadSummary[];
  generations: GenerationSummary[];
}
