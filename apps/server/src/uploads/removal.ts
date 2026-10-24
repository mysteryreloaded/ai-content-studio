// An Admin removing an Upload (issue #68, CONTEXT.md's "Removal"):
// deletes its file (and thumbnail) and fails every still-active
// Generation that used it with "an Upload was removed by an
// administrator" — a Generation that had already ended keeps its Assets
// and shows the Upload as removed (generations/repository.ts's
// `resolveSettings`, via the Upload's own `removedAt`).

import type { Clock } from "@ai-content-studio/shared";
import type { AuditActor } from "../audit/audit.js";
import type { DispatchQueue } from "../dispatch/queue.js";
import type { GenerationEvents } from "../generations/events.js";
import type { GenerationsRepository } from "../generations/repository.js";
import type { Storage } from "../storage/storage.js";
import type { UploadsRepository } from "./repository.js";
import { UploadNotFound } from "./service.js";

export class UploadAlreadyRemoved extends Error {
  constructor() {
    super("Upload already removed");
  }
}

/** Shown as this Generation's `error` once an Upload it was still using got removed (issue #68's AC, verbatim). */
export const UPLOAD_REMOVED_ERROR = "an Upload was removed by an administrator";

export interface UploadRemovalDeps {
  uploadsRepository: UploadsRepository;
  generationsRepository: GenerationsRepository;
  queue: DispatchQueue;
  generationEvents: GenerationEvents;
  storage: Storage;
  clock: Clock;
}

export interface RemovedUploadFacts {
  ownerId: string;
}

export async function removeUpload(
  uploadId: string,
  reason: string,
  actor: AuditActor,
  deps: UploadRemovalDeps,
): Promise<RemovedUploadFacts> {
  const upload = await deps.uploadsRepository.get(uploadId);
  if (!upload) throw new UploadNotFound();
  if (upload.removedAt) throw new UploadAlreadyRemoved();

  const now = deps.clock.now();

  const active =
    await deps.generationsRepository.listActiveUsingUpload(uploadId);
  for (const generation of active) {
    await deps.queue.markFailed(
      generation.id,
      generation.tries,
      UPLOAD_REMOVED_ERROR,
      now,
    );
    const summary = await deps.generationsRepository.getSummary(generation.id);
    if (summary) {
      deps.generationEvents.publish(generation.userId, {
        type: "change",
        generation: summary,
      });
    }
  }

  await deps.storage.delete(upload.storageKey);
  if (upload.thumbnailKey) await deps.storage.delete(upload.thumbnailKey);
  await deps.uploadsRepository.markRemoved(
    uploadId,
    upload.userId,
    reason,
    actor,
    deps.clock,
    now,
  );

  return { ownerId: upload.userId };
}
