// An Admin removing a Generation (issue #68, CONTEXT.md's "Removal"): if
// it's still active, cancels it first (admin-style — no ownership check,
// unlike generations/cancellation.ts), then deletes its Assets (files and
// rows, like a user delete) and marks it removed with the Admin's
// required reason. The row keeps its `builtPrompt`/`uploadIds`, so an
// Admin can still see the values, prompt and Upload links it ran with;
// only the owner-facing views hide the reason and offer no Reuse.

import type { Clock } from "@ai-content-studio/shared";
import type { AuditActor } from "../audit/audit.js";
import type { DispatchQueue } from "../dispatch/queue.js";
import type { Storage } from "../storage/storage.js";
import { deleteStorageFor } from "./deletion.js";
import type { GenerationEvents } from "./events.js";
import { ENDED_STATES, type GenerationsRepository } from "./repository.js";

export class GenerationNotFound extends Error {
  constructor() {
    super("Generation not found");
  }
}

export class GenerationAlreadyGone extends Error {
  constructor() {
    super("Generation already deleted or removed");
  }
}

export interface RemovalDeps {
  queue: DispatchQueue;
  generationsRepository: GenerationsRepository;
  generationEvents: GenerationEvents;
  storage: Storage;
  /** Wakes the dispatcher (mirrors cancellation.ts): a Backend freed by cancelling a `queued` Generation may let something else dispatch. */
  wakeDispatcher: () => void;
  clock: Clock;
}

export interface RemovedGenerationFacts {
  ownerId: string;
  modelId: string;
  modeId: string;
}

/** Removes one Generation (issue #68's AC): cancels it first if it's still active, then deletes its Assets and records the Removal. */
export async function removeGeneration(
  generationId: string,
  reason: string,
  actor: AuditActor,
  deps: RemovalDeps,
): Promise<RemovedGenerationFacts> {
  const row = await deps.generationsRepository.getForRemoval(generationId);
  if (!row) throw new GenerationNotFound();
  if (row.deletedAt || row.removedAt) throw new GenerationAlreadyGone();

  const now = deps.clock.now();
  if (!ENDED_STATES.includes(row.state)) {
    if (row.state === "queued") {
      const cancelled = await deps.queue.cancelQueued(generationId, now);
      if (!cancelled) await deps.queue.markCancelling(generationId);
    } else {
      await deps.queue.markCancelling(generationId);
    }
    deps.wakeDispatcher();
  }

  const keys = await deps.generationsRepository.markRemoved(
    generationId,
    { id: row.userId, modelId: row.modelId, modeId: row.modeId },
    reason,
    actor,
    deps.clock,
    now,
  );
  await deleteStorageFor(deps.storage, keys);

  const summary = await deps.generationsRepository.getSummary(generationId);
  if (summary) {
    deps.generationEvents.publish(row.userId, {
      type: "change",
      generation: summary,
    });
  }

  return { ownerId: row.userId, modelId: row.modelId, modeId: row.modeId };
}
