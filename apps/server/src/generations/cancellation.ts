// Cancelling a Generation or a whole Submission (issue #54): a `queued`
// Generation cancels at once, a `starting`/`running` one is moved to
// `cancelling` for the dispatcher's own runner loop to confirm against its
// Backend (dispatch/runner.ts). Admin has no cancel (the AC); only the
// owning user does, via the Submission block in the Workbench.

import type { Clock } from "@ai-content-studio/shared";
import type { DispatchQueue } from "../dispatch/queue.js";
import type { GenerationEvents } from "./events.js";
import type { GenerationsRepository } from "./repository.js";

export class GenerationNotFound extends Error {
  constructor() {
    super("Generation not found");
  }
}

export interface CancellationDeps {
  queue: DispatchQueue;
  generationsRepository: GenerationsRepository;
  generationEvents: GenerationEvents;
  /** Wakes the dispatcher (issue #44/#54): a `cancelling` Generation's runner loop notices right away, and a Backend freed by a `queued` cancel may let something else dispatch. */
  wakeDispatcher: () => void;
  clock: Clock;
}

async function publishCurrent(
  deps: CancellationDeps,
  generationId: string,
  userId: string,
): Promise<void> {
  const summary = await deps.generationsRepository.getSummary(generationId);
  if (!summary) return;
  deps.generationEvents.publish(userId, {
    type: "change",
    generation: summary,
  });
}

/**
 * Cancels one Generation (issue #54's AC): at once if it's still `queued`,
 * or moved to `cancelling` for the runner to confirm against the Backend
 * if it's `starting`/`running`. A no-op for anything already past that
 * (it raced to a terminal state, or a cancel's already under way).
 */
export async function cancelGeneration(
  generationId: string,
  userId: string,
  deps: CancellationDeps,
): Promise<void> {
  const row = await deps.generationsRepository.getForCancel(generationId);
  if (!row || row.userId !== userId) throw new GenerationNotFound();

  if (row.state === "queued") {
    const cancelled = await deps.queue.cancelQueued(
      generationId,
      deps.clock.now(),
    );
    if (cancelled) {
      await publishCurrent(deps, generationId, userId);
      deps.wakeDispatcher();
      return;
    }
    // Lost the race to the dispatcher claiming it just now; fall through
    // to the starting/running path below.
  }

  const movedToCancelling = await deps.queue.markCancelling(generationId);
  if (movedToCancelling) {
    await publishCurrent(deps, generationId, userId);
    deps.wakeDispatcher();
  }
}

/** Cancels every one of the caller's own unfinished Generations in a Submission (issue #54's AC: "Cancel all on a Submission block"). */
export async function cancelSubmission(
  submissionId: string,
  userId: string,
  deps: CancellationDeps,
): Promise<void> {
  const generationIds =
    await deps.generationsRepository.listUnfinishedIdsForSubmission(
      submissionId,
      userId,
    );
  for (const generationId of generationIds) {
    await cancelGeneration(generationId, userId, deps);
  }
}
