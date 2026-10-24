import { TERMINAL_STATES } from "./types.js";
import type { TrackedSubmission } from "./types.js";

/** A Submission has ended once every Generation it holds is terminal or was found removed (issue #58). */
export function isSubmissionEnded(submission: TrackedSubmission): boolean {
  return submission.generations.every(
    (generation) => generation.removed || TERMINAL_STATES.has(generation.state),
  );
}

export interface OutcomeCounts {
  ready: number;
  failed: number;
}

/** Counts a Submission's own outcome, skipping any Generation found removed (a Tombstone has nothing to show). */
export function outcomeCounts(submission: TrackedSubmission): OutcomeCounts {
  let ready = 0;
  let failed = 0;
  for (const generation of submission.generations) {
    if (generation.removed) continue;
    if (generation.state === "succeeded") ready++;
    else if (TERMINAL_STATES.has(generation.state)) failed++;
  }
  return { ready, failed };
}

export function hasAnyOutcome(counts: OutcomeCounts): boolean {
  return counts.ready + counts.failed > 0;
}

/** The first succeeded Generation, else the first failed/cancelled one, else null (every Generation was removed). */
export function firstClickGenerationId(
  submission: TrackedSubmission,
): string | null {
  const succeeded = submission.generations.find(
    (generation) => !generation.removed && generation.state === "succeeded",
  );
  if (succeeded) return succeeded.id;

  const failed = submission.generations.find(
    (generation) =>
      !generation.removed &&
      (generation.state === "failed" || generation.state === "cancelled"),
  );
  return failed?.id ?? null;
}
