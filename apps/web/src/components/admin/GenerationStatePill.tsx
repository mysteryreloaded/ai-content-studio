// A Generation's state pill for the Admin's own views (issue #209): the
// Admin sees every raw state label (unlike the owner's merged "Running"),
// plus the synthetic Deleted/Removed states and a Test pill.

import type { PillTone } from "../generations/stateLabel.js";
import type { GenerationState } from "../generations/types.js";
import { Pill } from "../ui/pill.js";

const STATE_LABELS: Record<GenerationState, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  saving: "Saving",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelling: "Cancelling…",
  cancelled: "Cancelled",
};

const STATE_TONES: Record<GenerationState, PillTone> = {
  queued: "neutral",
  starting: "neutral",
  running: "accent",
  saving: "accent",
  succeeded: "ok",
  failed: "err",
  cancelling: "neutral",
  cancelled: "neutral",
};

export function GenerationStatePill({
  state,
  deletedAt,
  removedAt,
}: {
  state: GenerationState;
  deletedAt: string | null;
  removedAt: string | null;
}) {
  if (deletedAt) return <Pill tone="neutral">Deleted</Pill>;
  if (removedAt) return <Pill tone="err">Removed</Pill>;
  return <Pill tone={STATE_TONES[state]}>{STATE_LABELS[state]}</Pill>;
}

export function TestPill() {
  return <Pill className="border border-input bg-transparent">Test</Pill>;
}
