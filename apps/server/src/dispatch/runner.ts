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
  cancelJob,
  fetchView,
  readJob,
  submitPrompt,
} from "../comfyui/client.js";
import type { AssetsRepository } from "../generations/assets-repository.js";
import type { GenerationEvents } from "../generations/events.js";
import type {
  GenerationState,
  GenerationSummary,
} from "../generations/repository.js";
import type { C2paSignerConfig } from "../media/c2pa.js";
import { finishAsset } from "../media/finish.js";
import type { MediaRunner } from "../media/media.js";
import type { Storage } from "../storage/storage.js";
import { ProgressTracker } from "./progress.js";
import type { DispatchQueue, RunDetail } from "./queue.js";

const POLL_INTERVAL_MS = 1_000;

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
  /** Issue #45: runs ffmpeg/ffprobe for Asset finishing. */
  media: MediaRunner;
  /** Issue #45: named in a finished video's "AI-generated" comment tag, alongside the Model and Generation id. */
  siteName: string;
  /** Issue #75: set only when the Operator configured a certificate and key. */
  c2pa: C2paSignerConfig | null;
  /** Issue #75: reads the Site title live, for the C2PA manifest's `title` and custom assertion. */
  getSiteTitle: () => Promise<string>;
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

/**
 * Finalizes a cancel (issue #54): confirmed by the Backend (its interrupt
 * was reported, or the job's gone), or marked anyway when the Backend
 * couldn't be reached — `pendingBackendCancel` then has the dispatcher
 * re-send that interrupt before the Backend gets new work.
 */
async function cancel(
  deps: RunnerDeps,
  detail: RunDetail,
  backendId: string,
  pendingBackendCancel: boolean,
): Promise<void> {
  deps.progress.discard(detail.id);
  await deps.queue.markCancelled(detail.id, { pendingBackendCancel });
  if (pendingBackendCancel) {
    await deps.logWriter.log({
      level: "warning",
      source: "backend",
      message:
        "Cancelled, but the Backend was unreachable; it'll be re-cancelled before it gets new work",
      backendId,
      userId: detail.userId,
      modelId: detail.modelId,
      generationId: detail.id,
    });
  }
  await publishChange(deps, detail, backendId, "cancelled", null);
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
  const comment = `AI-generated with ${detail.modelName} on ${deps.siteName}, Generation ${detail.id}`;
  // Fetched once per Generation rather than per Asset: the Site title
  // could change mid-run, but every Asset of one Generation should
  // carry the same manifest.
  const c2pa = deps.c2pa
    ? {
        modelName: detail.modelName,
        siteTitle: await deps.getSiteTitle(),
        generationId: detail.id,
      }
    : undefined;

  for (const [index, outputNode] of detail.outputNodes.entries()) {
    for (const file of outputFilesFor(job, outputNode.nodeId)) {
      const storageKey = `assets/${detail.id}/${outputNode.nodeId}/${file.filename}`;
      const response = await fetchView(target, file);
      const contentType =
        response.headers.get("content-type") ?? "application/octet-stream";
      const size = await deps.storage.writeResponseBody(storageKey, response);
      const kind = outputNode.kind ?? "image";

      const facts = await finishAsset(
        {
          media: deps.media,
          absolutePath: (key) => deps.storage.absolutePath(key),
          write: (key, data) => deps.storage.write(key, data),
          onWarning: (message) => {
            void deps.logWriter
              .log({
                level: "warning",
                source: "app",
                message: `Asset finishing: ${message}`,
                userId: detail.userId,
                modelId: detail.modelId,
                generationId: detail.id,
              })
              .catch(() => {});
          },
          c2pa: deps.c2pa,
        },
        kind,
        storageKey,
        comment,
        c2pa,
      );

      await deps.assetsRepository.createIfAbsent({
        generationId: detail.id,
        nodeId: outputNode.nodeId,
        sortOrder: index,
        kind,
        comfyuiFilename: file.filename,
        contentType,
        size: facts.size,
        storageKey,
        posterKey: facts.posterKey,
        thumbnailKey: facts.thumbnailKey,
        width: facts.width,
        height: facts.height,
        durationMs: facts.durationMs,
        fps: facts.fps,
      });
    }
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
  // Set once a cancel's own interrupt has been sent to the Backend (issue
  // #54); `cancelUnreachable` short-circuits to a confirmed cancel right
  // away rather than waiting on a Backend that can't be reached.
  let cancelSent = false;
  let cancelUnreachable = false;
  let cancelConfirmed = false;
  try {
    while (true) {
      if (!cancelSent) {
        const state = await deps.queue.currentState(generationId);
        if (state === "cancelling") {
          cancelSent = true;
          try {
            await cancelJob(target, generationId);
          } catch {
            cancelUnreachable = true;
            break;
          }
        }
      }

      try {
        job = await readJob(target, generationId);
      } catch (err) {
        // A poll failure while cancelling is also a Backend reachability
        // problem, not a run failure (issue #54's AC): cancel anyway
        // rather than failing a Generation its own user asked to stop.
        if (
          cancelSent ||
          (await deps.queue.currentState(generationId)) === "cancelling"
        ) {
          cancelUnreachable = true;
          break;
        }
        throw err;
      }
      publishProgress(deps, detail.userId, generationId);
      if (cancelSent && (job === null || job.status === "cancelled")) {
        cancelConfirmed = true;
        break;
      }
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

  if (cancelUnreachable) {
    await cancel(deps, detail, backend.id, true);
    return;
  }
  if (cancelConfirmed) {
    await cancel(deps, detail, backend.id, false);
    return;
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
