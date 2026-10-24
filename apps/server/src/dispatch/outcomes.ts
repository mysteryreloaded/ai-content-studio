// Shared "what happens to a Generation" helpers (issue #55): writing its
// next state, publishing the change over SSE and writing the matching Log
// entry, the same way whether the runner's own in-flight run, the
// dispatcher's watchdog sweep, or boot recovery is the one deciding it.
// A lost try logs a `warning` with ComfyUI's own raw error; a final
// failure logs an `error` the same way (issue #55's AC).

import type { Clock } from "@ai-content-studio/shared";
import type { LogEntryWriter } from "../backends/log-entries.js";
import { deleteStorageFor } from "../generations/deletion.js";
import type { GenerationEvents } from "../generations/events.js";
import type {
  GenerationState,
  GenerationSummary,
  GenerationsRepository,
} from "../generations/repository.js";
import type { Storage } from "../storage/storage.js";
import type { DispatchQueue, LoseTryOutcome, RunDetail } from "./queue.js";

export interface OutcomeDeps {
  queue: DispatchQueue;
  generationEvents: GenerationEvents;
  logWriter: LogEntryWriter;
  clock: Clock;
  /** Issue #63 round 4: finalizes a Tombstone for a Generation whose owner self-deleted while it was still under way, the moment it reaches a terminal state here. */
  generationsRepository: Pick<
    GenerationsRepository,
    "finalizeIfPendingDeletion"
  >;
  storage: Storage;
}

/**
 * Issue #63 round 4: Tombstones a Generation for good right after its
 * terminal write lands, but only if {@link GenerationsRepository}'s own
 * `markUnfinishedForPendingDeletion` already flagged it — its owner
 * self-deleted while this one was still under way. A no-op otherwise.
 * Shared by every terminal write below and by `runner.ts`'s own
 * `finalizeCancelled`/`finalizeSucceeded`.
 */
export async function finalizePendingDeletion(
  deps: OutcomeDeps,
  generationId: string,
): Promise<void> {
  const keys = await deps.generationsRepository.finalizeIfPendingDeletion(
    generationId,
    deps.clock.now(),
  );
  if (keys) await deleteStorageFor(deps.storage, keys);
}

function toSummary(
  detail: RunDetail,
  state: GenerationState,
  tries: number,
  error: string | null,
  assets: GenerationSummary["assets"] = [],
): GenerationSummary {
  return {
    id: detail.id,
    modelId: detail.modelId,
    revisionId: detail.revisionId,
    modeId: detail.modeId,
    modeName: detail.modeName,
    userId: detail.userId,
    submissionId: detail.submissionId,
    state,
    tries,
    error,
    submittedAt: detail.submittedAt,
    // RunDetail doesn't carry these (issue #57): a Gallery/Workbench
    // client refetches the Generation's own detail for them; the SSE
    // event only needs to say a change happened.
    startedAt: null,
    endedAt: null,
    deletedAt: null,
    modelSlug: detail.modelSlug,
    modelName: detail.modelName,
    isTest: detail.isTest,
    assets,
  };
}

export async function publishChange(
  deps: OutcomeDeps,
  detail: RunDetail,
  state: GenerationState,
  tries: number,
  error: string | null,
  assets?: GenerationSummary["assets"],
): Promise<void> {
  deps.generationEvents.publish(detail.userId, {
    type: "change",
    generation: toSummary(detail, state, tries, error, assets),
  });
}

/**
 * Ends a try without retrying it (issue #55's AC: any rejection but a
 * missing node, `execution_error`, no outputs, a 413, a save that never
 * lands, or a timeout). `rawDetail` — ComfyUI's own error text — goes
 * only into the Log entry, kept apart from the plain reason shown on the
 * card. Returns `false` when this try had already been superseded (a
 * watchdog sweep moved the row on first), in which case nothing is
 * written or published.
 */
export async function reportFailure(
  deps: OutcomeDeps,
  detail: RunDetail,
  backendId: string | null,
  tries: number,
  message: string,
  rawDetail?: string,
): Promise<boolean> {
  const ok = await deps.queue.markFailed(
    detail.id,
    tries,
    message,
    deps.clock.now(),
  );
  if (!ok) return false;
  await deps.logWriter.log({
    level: "error",
    source: backendId ? "backend" : "app",
    message: `Generation failed: ${message}`,
    details: rawDetail,
    backendId: backendId ?? undefined,
    userId: detail.userId,
    modelId: detail.modelId,
    generationId: detail.id,
  });
  await publishChange(deps, detail, "failed", tries, message);
  await finalizePendingDeletion(deps, detail.id);
  return true;
}

/**
 * Ends a try as lost (issue #55's AC): unreachable while starting,
 * unreachable for > 2 min while running, a 404'd job, or a missing-node
 * rejection. Below the try cap this requeues for any Backend (published
 * as `queued` again, `tries` bumped so the card reads "retrying"); at
 * the cap it fails with `exhaustedMessage` instead. Returns `"stale"`
 * without writing or publishing anything when this try had already been
 * superseded.
 */
export async function reportLostTry(
  deps: OutcomeDeps,
  detail: RunDetail,
  backendId: string,
  tries: number,
  rawReason: string,
  exhaustedMessage: string,
): Promise<LoseTryOutcome> {
  const outcome = await deps.queue.loseTry(
    detail.id,
    tries,
    exhaustedMessage,
    deps.clock.now(),
  );
  if (outcome === "stale") return outcome;

  await deps.logWriter.log({
    level: outcome === "retried" ? "warning" : "error",
    source: "backend",
    message:
      outcome === "retried"
        ? `Generation lost its try: ${rawReason}`
        : `Generation failed: ${exhaustedMessage}`,
    details: rawReason,
    backendId,
    userId: detail.userId,
    modelId: detail.modelId,
    generationId: detail.id,
  });

  if (outcome === "retried") {
    await publishChange(deps, detail, "queued", tries, null);
  } else {
    await publishChange(deps, detail, "failed", tries, exhaustedMessage);
    await finalizePendingDeletion(deps, detail.id);
  }
  return outcome;
}
