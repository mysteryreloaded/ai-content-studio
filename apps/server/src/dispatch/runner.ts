// Runs one claimed Generation to completion (issue #44): submits to its
// Backend, follows `/ws` and polls `/api/jobs/:id` for progress and the
// terminal state, then saves its output files as Assets. Doesn't hold the
// dispatcher's advisory lock — several runs go concurrently, one per
// Backend.

import type { Clock } from "@ai-content-studio/shared";
import { comfyUiTarget } from "../backends/client.js";
import type { LogEntryWriter } from "../backends/log-entries.js";
import type {
  BackendRecord,
  BackendRepository,
} from "../backends/repository.js";
import {
  ComfyUiSocket,
  type Job,
  type JobFile,
  PromptRejected,
  fetchView,
  headInputFile,
  readJob,
  submitPrompt,
  uploadInputImage,
} from "../comfyui/client.js";
import type { AssetsRepository } from "../generations/assets-repository.js";
import type { GenerationEvents } from "../generations/events.js";
import type {
  GenerationState,
  GenerationSummary,
} from "../generations/repository.js";
import type { Storage } from "../storage/storage.js";
import { ProgressTracker } from "./progress.js";
import type { DispatchQueue, RunDetail } from "./queue.js";

const POLL_INTERVAL_MS = 1_000;
/** A Backend's copy of an Upload this old is sent again (issue #50), in case the Backend's own cleanup is about to remove it. */
const UPLOAD_FRESH_MS = 12 * 60 * 60 * 1000;
const UPLOAD_SUBFOLDER = "studio";

export interface RunnerDeps {
  queue: DispatchQueue;
  assetsRepository: AssetsRepository;
  storage: Storage;
  backendRepository: Pick<BackendRepository, "decryptedCredentials">;
  generationEvents: GenerationEvents;
  logWriter: LogEntryWriter;
  clock: Clock;
  progress: ProgressTracker;
  /** Wakes the dispatcher: the Backend just freed, or this run ended. */
  onFreed: () => void;
  pollIntervalMs?: number;
}

function describeError(err: unknown): string {
  if (err instanceof PromptRejected) {
    return `${err.message}${err.nodeErrors ? `: ${JSON.stringify(err.nodeErrors)}` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function delay(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
}

function toSummary(
  detail: RunDetail,
  backendId: string,
  state: GenerationState,
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
    error,
    submittedAt: detail.submittedAt,
    modelSlug: detail.modelSlug,
    modelName: detail.modelName,
    assets,
  };
}

async function publishChange(
  deps: RunnerDeps,
  detail: RunDetail,
  backendId: string,
  state: GenerationState,
  error: string | null,
  assets?: GenerationSummary["assets"],
): Promise<void> {
  deps.generationEvents.publish(detail.userId, {
    type: "change",
    generation: toSummary(detail, backendId, state, error, assets),
  });
}

function publishProgress(
  deps: RunnerDeps,
  userId: string,
  generationId: string,
): void {
  const snapshot = deps.progress.snapshot(generationId);
  if (!snapshot) return;
  deps.generationEvents.publish(userId, {
    type: "progress",
    progress: { generationId, ...snapshot },
  });
}

async function fail(
  deps: RunnerDeps,
  detail: RunDetail,
  backendId: string,
  message: string,
): Promise<void> {
  deps.progress.discard(detail.id);
  await deps.queue.markFailed(detail.id, message);
  await deps.logWriter.log({
    level: "error",
    source: "backend",
    message: `Generation failed: ${message}`,
    backendId,
    userId: detail.userId,
    modelId: detail.modelId,
    generationId: detail.id,
  });
  await publishChange(deps, detail, backendId, "failed", message);
  deps.onFreed();
}

/** Only an output node's files whose ComfyUI `type` is `"output"` are kept (issue #44's AC). ComfyUI splits them across `images`/`gifs`/`audio`, not one `files` list. */
function outputFilesFor(job: Job, nodeId: string): JobFile[] {
  const output = job.outputs?.[nodeId];
  if (!output) return [];
  const files = [
    ...(output.images ?? []),
    ...(output.gifs ?? []),
    ...(output.audio ?? []),
  ];
  return files.filter((file) => file.type === "output");
}

async function saveAssets(
  target: Awaited<ReturnType<typeof comfyUiTarget>>,
  detail: RunDetail,
  job: Job,
  deps: RunnerDeps,
): Promise<void> {
  for (const [index, outputNode] of detail.outputNodes.entries()) {
    for (const file of outputFilesFor(job, outputNode.nodeId)) {
      const storageKey = `assets/${detail.id}/${outputNode.nodeId}/${file.filename}`;
      const response = await fetchView(target, file);
      const contentType =
        response.headers.get("content-type") ?? "application/octet-stream";
      const size = await deps.storage.writeResponseBody(storageKey, response);

      await deps.assetsRepository.createIfAbsent({
        generationId: detail.id,
        nodeId: outputNode.nodeId,
        sortOrder: index,
        kind: outputNode.kind ?? "image",
        comfyuiFilename: file.filename,
        contentType,
        size,
        storageKey,
      });
    }
  }
}

/**
 * Makes sure the Backend has every Upload the prompt names (issue #50):
 * one it already holds with the same size and under 12 h old is skipped;
 * any other is sent to `/upload/image`, overwriting.
 */
async function sendUploads(
  target: Awaited<ReturnType<typeof comfyUiTarget>>,
  detail: RunDetail,
  deps: RunnerDeps,
): Promise<void> {
  for (const upload of detail.uploads) {
    const filename = `${upload.id}.${upload.extension}`;
    const existing = await headInputFile(target, UPLOAD_SUBFOLDER, filename);
    if (
      existing &&
      existing.size === upload.size &&
      existing.lastModified !== null &&
      deps.clock.now().getTime() - existing.lastModified.getTime() <
        UPLOAD_FRESH_MS
    ) {
      continue;
    }
    const file = Bun.file(deps.storage.absolutePath(upload.storageKey));
    if (!(await file.exists())) {
      throw new Error(`Upload ${upload.id} is no longer stored`);
    }
    await uploadInputImage(target, UPLOAD_SUBFOLDER, filename, file);
  }
}

export async function runClaimedGeneration(
  backend: BackendRecord,
  detail: RunDetail,
  deps: RunnerDeps,
): Promise<void> {
  const generationId = detail.id;
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  deps.progress.start(
    generationId,
    ProgressTracker.keyFor(detail.modelId, detail.modeId, backend.id),
  );
  await publishChange(deps, detail, backend.id, "starting", null);

  let target: Awaited<ReturnType<typeof comfyUiTarget>>;
  try {
    target = await comfyUiTarget(backend, deps.backendRepository);
    await sendUploads(target, detail, deps);
    await submitPrompt(target, generationId, detail.builtPrompt);
  } catch (err) {
    await fail(deps, detail, backend.id, describeError(err));
    return;
  }

  await deps.queue.markRunning(generationId);
  await publishChange(deps, detail, backend.id, "running", null);

  const socket = new ComfyUiSocket(target, generationId);
  const unsubscribe = socket.onMessage((event) => {
    if (event.promptId !== generationId) return;
    if (event.type === "progress") {
      deps.progress.updateStep(generationId, event.step, event.totalSteps);
      publishProgress(deps, detail.userId, generationId);
    }
  });

  const deadlineMs =
    deps.clock.now().getTime() + detail.maxRunTimeMinutes * 60_000;
  let job: Job | null = null;
  let runError: string | null = null;
  try {
    while (true) {
      job = await readJob(target, generationId);
      publishProgress(deps, detail.userId, generationId);
      if (job?.status === "completed" || job?.status === "failed") break;
      if (deps.clock.now().getTime() > deadlineMs) {
        runError = "Generation exceeded its Model's max run time";
        break;
      }
      await delay(deps.clock, pollIntervalMs);
    }
  } catch (err) {
    runError = describeError(err);
  } finally {
    unsubscribe();
    socket.close();
  }

  if (runError || job?.status === "failed") {
    await fail(
      deps,
      detail,
      backend.id,
      runError ?? job?.error ?? "the Backend reported failure",
    );
    return;
  }
  const completedJob = job as Job;

  // The run itself ended: free the Backend for the next start right away
  // (ADR: "saving overlaps the next start"), before touching any files.
  await deps.queue.markSaving(generationId);
  deps.progress.finish(generationId);
  await publishChange(deps, detail, backend.id, "saving", null);
  deps.onFreed();

  try {
    await saveAssets(target, detail, completedJob, deps);
  } catch (err) {
    await fail(deps, detail, backend.id, describeError(err));
    return;
  }

  await deps.queue.markSucceeded(generationId);
  const assets = await deps.assetsRepository.listForGeneration(generationId);
  await publishChange(
    deps,
    detail,
    backend.id,
    "succeeded",
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
