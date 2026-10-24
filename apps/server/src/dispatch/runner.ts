// Runs one claimed try of a Generation to completion (issue #44, #55):
// submits to its Backend, follows `/ws` and polls `/api/jobs/:id` for
// progress and the terminal state, then saves its output files as
// Assets. Doesn't hold the dispatcher's advisory lock — several runs go
// concurrently, one per Backend.
//
// Every write below passes `tries`, the try number this run claimed
// (queue.ts's own concurrency token): if a watchdog sweep or boot
// recovery has already moved the row on, the write no-ops and this run
// quietly stops instead of clobbering whatever decided it.
//
// Issue #54 adds a second way a poll loop ends early: a `cancelling`
// Generation (set by a user's own request, outside this loop) gets its
// Backend's interrupt sent here, once, then waits for that to be
// confirmed (the job's `cancelled` or gone) before finalizing as
// `cancelled` — unless the Backend can't even be reached for the
// interrupt, in which case it's cancelled anyway, `pendingBackendCancel`
// set for the dispatcher to re-send that interrupt later.

import type { Clock } from "@ai-content-studio/shared";
import { comfyUiTarget } from "../backends/client.js";
import type { LogEntryWriter } from "../backends/log-entries.js";
import type {
  BackendRecord,
  BackendRepository,
} from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import {
  BackendUnreachable,
  ComfyUiSocket,
  type Job,
  type JobFile,
  PayloadTooLarge,
  PromptRejected,
  cancelJob,
  fetchView,
  headInputFile,
  interruptJob,
  isMissingNodeError,
  readJob,
  submitPrompt,
  uploadInputImage,
} from "../comfyui/client.js";
import type { AssetsRepository } from "../generations/assets-repository.js";
import type { GenerationEvents } from "../generations/events.js";
import type { GenerationSummary } from "../generations/repository.js";
import type { C2paSignerConfig } from "../media/c2pa.js";
import { finishAsset } from "../media/finish.js";
import type { MediaRunner } from "../media/media.js";
import type { Storage } from "../storage/storage.js";
import { publishChange, reportFailure, reportLostTry } from "./outcomes.js";
import { ProgressTracker } from "./progress.js";
import type { DispatchQueue, RunDetail } from "./queue.js";

const POLL_INTERVAL_MS = 1_000;
/** A Backend's copy of an Upload this old is sent again (issue #50), in case the Backend's own cleanup is about to remove it. */
const UPLOAD_FRESH_MS = 12 * 60 * 60 * 1000;
const UPLOAD_SUBFOLDER = "studio";
/** Issue #55's AC: unreachable for more than this long while running is a lost try, not a wait-it-out. */
const RUNNING_UNREACHABLE_LOST_MS = 2 * 60_000;
/** Issue #55's AC: saving retries with backoff for this long before giving up for good. */
const SAVING_BACKOFF_BUDGET_MS = 15 * 60_000;
const SAVING_BACKOFF_BASE_MS = 2_000;
const SAVING_BACKOFF_MAX_MS = 30_000;

export interface RunnerDeps {
  queue: DispatchQueue;
  assetsRepository: AssetsRepository;
  storage: Storage;
  backendRepository: Pick<BackendRepository, "decryptedCredentials">;
  backendsService: Pick<
    BackendsService,
    "healthFor" | "unreachableSince" | "invalidateNodeKnowledge"
  >;
  generationEvents: GenerationEvents;
  logWriter: LogEntryWriter;
  clock: Clock;
  progress: ProgressTracker;
  /** Wakes the dispatcher: the Backend just freed, or this run ended. */
  onFreed: () => void;
  pollIntervalMs?: number;
  /** Test-only: shortens the saving backoff's own total budget below its 15-minute production default. */
  savingBackoffBudgetMs?: number;
  savingBackoffBaseMs?: number;
  /** Issue #45: runs ffmpeg/ffprobe for Asset finishing. */
  media: MediaRunner;
  /** Issue #45: named in a finished video's "AI-generated" comment tag, alongside the Model and Generation id. */
  siteName: string;
  /** Issue #75: set only when the Operator configured a certificate and key. */
  c2pa: C2paSignerConfig | null;
  /** Issue #75: reads the Site title live, for the C2PA manifest's `title` and custom assertion. */
  getSiteTitle: () => Promise<string>;
}

export function describeError(err: unknown): string {
  if (err instanceof PromptRejected) {
    return `${err.message}${err.nodeErrors ? `: ${JSON.stringify(err.nodeErrors)}` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function delay(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => clock.setTimeout(resolve, ms));
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

export function allOutputFiles(detail: RunDetail, job: Job): JobFile[] {
  return detail.outputNodes.flatMap((node) => outputFilesFor(job, node.nodeId));
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

/** Retries `saveAssets` with backoff for up to the saving budget (issue #55's AC: 15 minutes), then gives up. */
export async function saveWithBackoff(
  target: Awaited<ReturnType<typeof comfyUiTarget>>,
  detail: RunDetail,
  job: Job,
  deps: RunnerDeps,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const budgetMs = deps.savingBackoffBudgetMs ?? SAVING_BACKOFF_BUDGET_MS;
  const deadline = deps.clock.now().getTime() + budgetMs;
  let delayMs = deps.savingBackoffBaseMs ?? SAVING_BACKOFF_BASE_MS;
  let lastError: unknown;
  while (true) {
    try {
      await saveAssets(target, detail, job, deps);
      return { ok: true };
    } catch (err) {
      lastError = err;
    }
    if (deps.clock.now().getTime() + delayMs > deadline) {
      return { ok: false, error: lastError };
    }
    await delay(deps.clock, delayMs);
    delayMs = Math.min(delayMs * 2, SAVING_BACKOFF_MAX_MS);
  }
}

/**
 * Finalizes a cancel (issue #54): confirmed by the Backend (its
 * interrupt was reported, or the job's gone), or marked anyway when the
 * Backend couldn't be reached — `pendingBackendCancel` then has the
 * dispatcher re-send that interrupt before the Backend gets new work.
 * Shared by `pollUntilDone` and boot recovery, the same way `reportFailure`
 * and `reportLostTry` are.
 */
export async function finalizeCancelled(
  deps: RunnerDeps,
  detail: RunDetail,
  backendId: string,
  tries: number,
  pendingBackendCancel: boolean,
): Promise<boolean> {
  const ok = await deps.queue.markCancelled(
    detail.id,
    tries,
    { pendingBackendCancel },
    deps.clock.now(),
  );
  if (!ok) return false;
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
  await publishChange(deps, detail, "cancelled", tries, null);
  return true;
}

/**
 * Catches a cancel that raced a terminal write and lost (issue #54): the
 * row moved to `cancelling` between this run's last look and the write
 * that just no-op'd, so nothing else is coming to finish it — without
 * this, it would sit `cancelling` with its Backend counted busy until a
 * restart's boot recovery notices. Sends the Backend's own interrupt
 * first when a target is given (the prompt was actually submitted;
 * `null` means it never was, so there's nothing to interrupt), then
 * finalizes the same way `pollUntilDone`'s own cancel path does. A
 * no-op when the row moved on for any other reason (a watchdog sweep,
 * a later try already claimed it).
 */
async function reconcileIfCancelling(
  deps: RunnerDeps,
  detail: RunDetail,
  backendId: string,
  tries: number,
  target: Awaited<ReturnType<typeof comfyUiTarget>> | null,
): Promise<boolean> {
  const state = await deps.queue.currentState(detail.id);
  if (state !== "cancelling") return false;
  let pendingBackendCancel = false;
  if (target) {
    try {
      await cancelJob(target, detail.id);
    } catch {
      pendingBackendCancel = true;
    }
  } else {
    pendingBackendCancel = true;
  }
  await finalizeCancelled(deps, detail, backendId, tries, pendingBackendCancel);
  return true;
}

export async function runClaimedGeneration(
  backend: BackendRecord,
  detail: RunDetail,
  tries: number,
  deps: RunnerDeps,
): Promise<void> {
  const generationId = detail.id;
  deps.progress.start(
    generationId,
    ProgressTracker.keyFor(detail.modelId, detail.modeId, backend.id),
  );
  await publishChange(deps, detail, "starting", tries, null);

  // Unreachable while starting (issue #55's AC): checked up front so an
  // already-known-down Backend doesn't even get a submit attempt.
  if (
    deps.backendsService.healthFor(backend.id).reachability === "unreachable"
  ) {
    deps.progress.discard(generationId);
    await reportLostTry(
      deps,
      detail,
      backend.id,
      tries,
      "the Backend was unreachable",
      "the GPU server couldn't run this",
    );
    deps.onFreed();
    return;
  }

  let target: Awaited<ReturnType<typeof comfyUiTarget>>;
  try {
    target = await comfyUiTarget(backend, deps.backendRepository);
    await sendUploads(target, detail, deps);
    await submitPrompt(target, generationId, detail.builtPrompt);
  } catch (err) {
    deps.progress.discard(generationId);
    let stale = false;
    if (err instanceof BackendUnreachable) {
      stale =
        (await reportLostTry(
          deps,
          detail,
          backend.id,
          tries,
          err.message,
          "the GPU server couldn't run this",
        )) === "stale";
    } else if (
      err instanceof PromptRejected &&
      isMissingNodeError(err.nodeErrors)
    ) {
      deps.backendsService.invalidateNodeKnowledge(backend.id);
      stale =
        (await reportLostTry(
          deps,
          detail,
          backend.id,
          tries,
          describeError(err),
          "the GPU server couldn't run this",
        )) === "stale";
    } else if (err instanceof PayloadTooLarge) {
      stale = !(await reportFailure(
        deps,
        detail,
        backend.id,
        tries,
        err.message,
        err.message,
      ));
    } else {
      stale = !(await reportFailure(
        deps,
        detail,
        backend.id,
        tries,
        "the GPU server rejected this Generation",
        describeError(err),
      ));
    }
    if (stale) {
      // Raced a cancel (issue #54): the submit itself never landed, so
      // there's nothing on the Backend to interrupt.
      await reconcileIfCancelling(deps, detail, backend.id, tries, null);
    }
    deps.onFreed();
    return;
  }

  if (!(await deps.queue.markRunning(generationId, tries))) {
    // Superseded between submit and here: either a watchdog sweep (the
    // prompt may still run on the Backend; nothing more to do from this
    // side), or a cancel that raced in right here (issue #54) — the
    // prompt *is* running, so reconcile sends its interrupt instead of
    // leaving it `cancelling` with the Backend counted busy forever.
    deps.progress.discard(generationId);
    if (await reconcileIfCancelling(deps, detail, backend.id, tries, target)) {
      deps.onFreed();
    }
    return;
  }
  await publishChange(deps, detail, "running", tries, null);

  await pollUntilDone(backend, detail, tries, target, deps);
}

/**
 * Reads a job's status, tolerating a poll blip (a timeout, a 5xx) the
 * same way `pollUntilDone`'s own loop does: retries instead of losing
 * the try at once, giving up only after `RUNNING_UNREACHABLE_LOST_MS`
 * of continuous failure. Boot recovery's AC (issue #55): reattaching
 * to a Backend that's briefly unreachable at startup resumes polling
 * the same way, instead of marking the try lost on the first attempt.
 */
export async function readJobWithGrace(
  target: Awaited<ReturnType<typeof comfyUiTarget>>,
  generationId: string,
  deps: Pick<RunnerDeps, "clock" | "pollIntervalMs">,
): ReturnType<typeof readJob> {
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const deadlineMs = deps.clock.now().getTime() + RUNNING_UNREACHABLE_LOST_MS;
  while (true) {
    try {
      return await readJob(target, generationId);
    } catch (err) {
      if (deps.clock.now().getTime() > deadlineMs) throw err;
      await delay(deps.clock, pollIntervalMs);
    }
  }
}

/**
 * Follows `/ws` and polls `/api/jobs/:id` for a Generation already
 * `running` on `backend`, through to saving and succeeded/failed.
 * Shared by the normal dispatch path (right after `markRunning`) and
 * boot recovery (issue #55's AC: reattaching to a job still running
 * resumes tracking it the same way, instead of treating the restart as
 * a lost try).
 */
export async function pollUntilDone(
  backend: BackendRecord,
  detail: RunDetail,
  tries: number,
  target: Awaited<ReturnType<typeof comfyUiTarget>>,
  deps: RunnerDeps,
): Promise<void> {
  const generationId = detail.id;
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const socket = new ComfyUiSocket(target, generationId);
  const unsubscribe = socket.onMessage((event) => {
    if (event.promptId !== generationId) return;
    if (event.type === "progress") {
      deps.progress.updateStep(generationId, event.step, event.totalSteps);
      publishProgress(deps, detail.userId, generationId);
    }
  });

  type Outcome =
    | { kind: "completed"; job: Job }
    | { kind: "executionError"; message: string }
    | { kind: "lost"; reason: string }
    | { kind: "timedOut" }
    | { kind: "cancelled"; pendingBackendCancel: boolean };

  const deadlineMs =
    deps.clock.now().getTime() + detail.maxRunTimeMinutes * 60_000;
  // A poll blip (a timeout, a 5xx) shouldn't lose the try at once: the
  // GPU keeps running it regardless. Only continuous failure for as
  // long as the health monitor's own "unreachable" grace gives up
  // (issue #55's AC).
  let pollFailureSinceMs: number | null = null;
  // Issue #54: set once this loop has sent the Backend a cancel's own
  // interrupt (the row moved to `cancelling` outside this loop, noticed
  // and acted on here, once).
  let cancelSent = false;
  let outcome: Outcome;
  try {
    while (true) {
      if (!cancelSent) {
        const state = await deps.queue.currentState(generationId);
        if (state === "cancelling") {
          cancelSent = true;
          try {
            await cancelJob(target, generationId);
          } catch {
            outcome = { kind: "cancelled", pendingBackendCancel: true };
            break;
          }
        }
      }

      const sinceUnreachable = deps.backendsService.unreachableSince(
        backend.id,
      );
      if (
        sinceUnreachable &&
        deps.clock.now().getTime() - sinceUnreachable.getTime() >
          RUNNING_UNREACHABLE_LOST_MS
      ) {
        outcome = cancelSent
          ? { kind: "cancelled", pendingBackendCancel: true }
          : { kind: "lost", reason: "the Backend was unreachable" };
        break;
      }

      let job: Job | null;
      try {
        job = await readJob(target, generationId);
      } catch (err) {
        // A poll failure while cancelling is also a Backend
        // reachability problem, not a run failure (issue #54's AC):
        // cancel anyway rather than failing a Generation its own user
        // asked to stop.
        if (cancelSent) {
          outcome = { kind: "cancelled", pendingBackendCancel: true };
          break;
        }
        const nowMs = deps.clock.now().getTime();
        if (pollFailureSinceMs === null) pollFailureSinceMs = nowMs;
        if (nowMs - pollFailureSinceMs > RUNNING_UNREACHABLE_LOST_MS) {
          outcome = { kind: "lost", reason: describeError(err) };
          break;
        }
        await delay(deps.clock, pollIntervalMs);
        continue;
      }
      pollFailureSinceMs = null;

      if (job === null) {
        outcome = cancelSent
          ? { kind: "cancelled", pendingBackendCancel: false }
          : { kind: "lost", reason: "the Backend no longer knew this job" };
        break;
      }
      publishProgress(deps, detail.userId, generationId);
      if (job.status === "completed") {
        outcome = { kind: "completed", job };
        break;
      }
      if (job.status === "failed") {
        outcome = {
          kind: "executionError",
          message: job.error ?? "execution_error",
        };
        break;
      }
      if (job.status === "cancelled") {
        outcome = { kind: "cancelled", pendingBackendCancel: false };
        break;
      }
      if (deps.clock.now().getTime() > deadlineMs) {
        if (cancelSent) {
          // The earlier `cancelJob` landed but the Backend never actually
          // stopped the run: a best-effort hard interrupt, and
          // `pendingBackendCancel` so the dispatcher keeps re-sending the
          // cancel until it's confirmed, instead of assuming it worked.
          await interruptJob(target, generationId);
          outcome = { kind: "cancelled", pendingBackendCancel: true };
        } else {
          outcome = { kind: "timedOut" };
        }
        break;
      }
      await delay(deps.clock, pollIntervalMs);
    }
  } catch (err) {
    outcome = { kind: "lost", reason: describeError(err) };
  } finally {
    unsubscribe();
    socket.close();
  }

  if (outcome.kind === "timedOut") {
    await interruptJob(target, generationId);
    deps.progress.discard(generationId);
    if (!(await reportFailure(deps, detail, backend.id, tries, "timed out"))) {
      await reconcileIfCancelling(deps, detail, backend.id, tries, target);
    }
    deps.onFreed();
    return;
  }
  if (outcome.kind === "cancelled") {
    deps.progress.discard(generationId);
    await finalizeCancelled(
      deps,
      detail,
      backend.id,
      tries,
      outcome.pendingBackendCancel,
    );
    deps.onFreed();
    return;
  }
  if (outcome.kind === "lost") {
    deps.progress.discard(generationId);
    const result = await reportLostTry(
      deps,
      detail,
      backend.id,
      tries,
      outcome.reason,
      "the GPU server couldn't run this",
    );
    if (result === "stale") {
      await reconcileIfCancelling(deps, detail, backend.id, tries, target);
    }
    deps.onFreed();
    return;
  }
  if (outcome.kind === "executionError") {
    deps.progress.discard(generationId);
    const ok = await reportFailure(
      deps,
      detail,
      backend.id,
      tries,
      "the GPU server reported an error while running this",
      outcome.message,
    );
    if (!ok) {
      await reconcileIfCancelling(deps, detail, backend.id, tries, target);
    }
    deps.onFreed();
    return;
  }

  const completedJob = outcome.job;
  if (allOutputFiles(detail, completedJob).length === 0) {
    deps.progress.discard(generationId);
    const ok = await reportFailure(
      deps,
      detail,
      backend.id,
      tries,
      "the GPU server produced no usable output",
    );
    if (!ok) {
      await reconcileIfCancelling(deps, detail, backend.id, tries, target);
    }
    deps.onFreed();
    return;
  }

  // The run itself ended: free the Backend for the next start right away
  // (ADR: "saving overlaps the next start"), before touching any files.
  if (!(await deps.queue.markSaving(generationId, tries))) {
    deps.progress.discard(generationId);
    // Raced a cancel landing right here (issue #54): the job already
    // finished on the Backend, so its own `/cancel` just 404s — treated
    // as confirmed the same way an already-gone job always is.
    await reconcileIfCancelling(deps, detail, backend.id, tries, target);
    deps.onFreed();
    return;
  }
  deps.progress.finish(generationId);
  await publishChange(deps, detail, "saving", tries, null);
  deps.onFreed();

  const saved = await saveWithBackoff(target, detail, completedJob, deps);
  if (!saved.ok) {
    await reportFailure(
      deps,
      detail,
      backend.id,
      tries,
      "could not save this Generation's output",
      describeError(saved.error),
    );
    return;
  }

  if (!(await deps.queue.markSucceeded(generationId, tries, deps.clock.now())))
    return;
  const assets = await deps.assetsRepository.listForGeneration(generationId);
  await publishChange(
    deps,
    detail,
    "succeeded",
    tries,
    null,
    assets.map((asset): GenerationSummary["assets"][number] => ({
      id: asset.id,
      nodeId: asset.nodeId,
      sortOrder: asset.sortOrder,
      kind: asset.kind,
      contentType: asset.contentType,
    })),
  );
}
