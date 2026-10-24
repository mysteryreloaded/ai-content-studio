// Boot recovery (issue #55's AC): every Generation left `starting`,
// `running` or `saving` when the process last stopped — a crash, a
// restart, a deploy — checks `/api/jobs/:id` on its own Backend to
// reattach: still running resumes tracking it, completed saves it,
// failed fails it, and not found (or unreachable to ask) marks the try
// lost, same as any other lost try. Runs once at startup, before the
// Dispatcher starts claiming anything new.
//
// Issue #54: a Generation left `cancelling` is recovered the same way,
// except a lost/unreachable/404 outcome finalizes it as `cancelled`
// (optimistically if the Backend couldn't be reached) instead of a lost
// try — a crash mid-cancel must never come back as still queued/running.

import { comfyUiTarget } from "../backends/client.js";
import type { BackendRepository } from "../backends/repository.js";
import type { readJob } from "../comfyui/client.js";
import { publishChange, reportFailure, reportLostTry } from "./outcomes.js";
import { ProgressTracker } from "./progress.js";
import type { UnfinishedGeneration } from "./queue.js";
import {
  type RunnerDeps,
  allOutputFiles,
  describeError,
  finalizeCancelled,
  pollUntilDone,
  readJobWithGrace,
  saveWithBackoff,
} from "./runner.js";

export interface RecoveryDeps extends RunnerDeps {
  backendRepository: BackendRepository;
  /** Issue #77 CEO review: a restore drill's whole point is never reaching a production Backend, so recovery must skip the `/api/jobs/:id` read entirely while this is false, not just the Dispatcher's normal claiming. */
  backendsEnabled: boolean;
}

export async function recoverInFlightGenerations(
  deps: RecoveryDeps,
): Promise<void> {
  const unfinished = await deps.queue.listUnfinished();
  for (const item of unfinished) {
    try {
      await recoverOne(item, deps);
    } catch (err) {
      await deps.logWriter
        .log({
          level: "error",
          source: "app",
          message: "boot recovery failed for a Generation",
          details: describeError(err),
          generationId: item.id,
        })
        .catch(() => {});
    }
  }
}

async function recoverOne(
  item: UnfinishedGeneration,
  deps: RecoveryDeps,
): Promise<void> {
  const detail = await deps.queue.detailForRun(item.id);
  if (!detail) return;

  const cancelling = item.state === "cancelling";

  const backend = await deps.backendRepository.get(item.backendId);
  if (!backend || !deps.backendsEnabled) {
    if (cancelling) {
      // Nothing left to tell; cancel it anyway (issue #54's AC).
      await finalizeCancelled(deps, detail, item.backendId, item.tries, true);
      return;
    }
    await reportLostTry(
      deps,
      detail,
      item.backendId,
      item.tries,
      backend
        ? "Backend contact is disabled (BACKENDS_ENABLED=false)"
        : "its Backend no longer exists",
      "the GPU server couldn't run this",
    );
    return;
  }

  const target = await comfyUiTarget(backend, deps.backendRepository);
  let job: Awaited<ReturnType<typeof readJob>>;
  try {
    job = await readJobWithGrace(target, item.id, deps);
  } catch (err) {
    // Still can't reach the Backend after resuming polling for a while
    // (issue #55's AC): a lost try, same as a 404. Except while
    // cancelling (issue #54), where it's cancelled anyway instead.
    if (cancelling) {
      await finalizeCancelled(deps, detail, backend.id, item.tries, true);
      return;
    }
    await reportLostTry(
      deps,
      detail,
      backend.id,
      item.tries,
      describeError(err),
      "the GPU server couldn't run this",
    );
    return;
  }

  if (job === null) {
    if (cancelling) {
      await finalizeCancelled(deps, detail, backend.id, item.tries, false);
      return;
    }
    await reportLostTry(
      deps,
      detail,
      backend.id,
      item.tries,
      "the Backend no longer knew this job",
      "the GPU server couldn't run this",
    );
    return;
  }

  if (cancelling) {
    if (job.status === "running") {
      // Still running there and never actually interrupted before the
      // crash: hand it back to the normal poll loop, which notices
      // `cancelling` again on its own first iteration and re-sends the
      // Backend's interrupt (issue #54).
      deps.progress.start(
        item.id,
        ProgressTracker.keyFor(detail.modelId, detail.modeId, backend.id),
      );
      void pollUntilDone(backend, detail, item.tries, target, deps).catch(
        (err) =>
          deps.logWriter
            .log({
              level: "error",
              source: "app",
              message: "resumed Generation run crashed",
              details: describeError(err),
              backendId: backend.id,
              generationId: item.id,
            })
            .catch(() => {}),
      );
      return;
    }
    // Whatever ComfyUI's own status says now — completed, failed or
    // already cancelled — the user asked to cancel this, so it finishes
    // as `cancelled` rather than falling into the normal save/fail path
    // below, whose own writes no longer match a `cancelling` row anyway.
    await finalizeCancelled(deps, detail, backend.id, item.tries, false);
    return;
  }

  if (job.status === "running") {
    // Only actually moves the row when it was still `starting` (the
    // submit landed on the Backend before the crash, but our own
    // `markRunning` write never did); already `running` is a no-op to
    // skip, not a stale write to treat as superseded.
    if (
      item.state === "starting" &&
      !(await deps.queue.markRunning(item.id, item.tries))
    ) {
      return;
    }
    deps.progress.start(
      item.id,
      ProgressTracker.keyFor(detail.modelId, detail.modeId, backend.id),
    );
    await publishChange(deps, detail, "running", item.tries, null);
    // Fire-and-forget, same as the dispatcher's own tick(): boot
    // recovery hands this try back to the normal poll loop instead of
    // blocking startup on however long it still has left to run.
    void pollUntilDone(backend, detail, item.tries, target, deps).catch((err) =>
      deps.logWriter
        .log({
          level: "error",
          source: "app",
          message: "resumed Generation run crashed",
          details: describeError(err),
          backendId: backend.id,
          generationId: item.id,
        })
        .catch(() => {}),
    );
    return;
  }

  if (job.status === "failed") {
    await reportFailure(
      deps,
      detail,
      backend.id,
      item.tries,
      "the GPU server reported an error while running this",
      job.error ?? "execution_error",
    );
    return;
  }

  // completed
  if (allOutputFiles(detail, job).length === 0) {
    await reportFailure(
      deps,
      detail,
      backend.id,
      item.tries,
      "the GPU server produced no usable output",
    );
    return;
  }

  if (item.state !== "saving") {
    if (!(await deps.queue.markSaving(item.id, item.tries))) return;
    await publishChange(deps, detail, "saving", item.tries, null);
  }

  const saved = await saveWithBackoff(target, detail, job, deps);
  if (!saved.ok) {
    await reportFailure(
      deps,
      detail,
      backend.id,
      item.tries,
      "could not save this Generation's output",
      describeError(saved.error),
    );
    return;
  }

  if (!(await deps.queue.markSucceeded(item.id, item.tries, deps.clock.now())))
    return;
  const assets = await deps.assetsRepository.listForGeneration(item.id);
  await publishChange(
    deps,
    detail,
    "succeeded",
    item.tries,
    null,
    assets.map((asset) => ({
      id: asset.id,
      nodeId: asset.nodeId,
      sortOrder: asset.sortOrder,
      kind: asset.kind,
      contentType: asset.contentType,
    })),
  );
}
