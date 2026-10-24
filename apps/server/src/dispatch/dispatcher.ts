// Hands a queued Generation to a free Backend (issue #44, ADR 0002). Wakes
// on submissions, a Backend freeing/becoming reachable/becoming enabled,
// and a 10s backstop; a Postgres advisory lock (held only around the
// claim, not the run) keeps a second instance from dispatching alongside
// this one.
//
// Issue #55 (reliable dispatch) adds the watchdog sweep: a periodic
// safety net for tries no in-process runner is still polling — a
// `starting` try stuck past its 10-minute cap, or a `queued` Generation
// that's gone 15 minutes without a usable Backend for its Model. A
// `running` try's own max-run-time timeout and "unreachable for > 2
// min" check live in the runner instead, since that's where the active
// poll loop already is.

import type { Clock, Timer } from "@ai-content-studio/shared";
import type postgres from "postgres";
import { comfyUiTarget } from "../backends/client.js";
import type { LogEntryWriter } from "../backends/log-entries.js";
import type {
  BackendRecord,
  BackendRepository,
} from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import { cancelJob } from "../comfyui/client.js";
import type { AssetsRepository } from "../generations/assets-repository.js";
import type { GenerationEvents } from "../generations/events.js";
import type { Logger } from "../logger.js";
import type { C2paSignerConfig } from "../media/c2pa.js";
import type { MediaRunner } from "../media/media.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import type { Storage } from "../storage/storage.js";
import { reportFailure, reportLostTry } from "./outcomes.js";
import { ProgressTracker } from "./progress.js";
import type { DispatchQueue, QueuedGeneration } from "./queue.js";
import { recoverInFlightGenerations } from "./recovery.js";
import { runClaimedGeneration } from "./runner.js";
import type { RunnerDeps } from "./runner.js";

/** Distinct from the migration lock's key (db/migrate.ts), same lock-per-app-concern pattern (ADR 0002). */
const DISPATCH_LOCK_KEY = 72_738_292;
const BACKSTOP_INTERVAL_MS = 10_000;
const WATCHDOG_INTERVAL_MS = 30_000;

/** Issue #55's AC: a `starting` try past this cap is a lost try. */
const STARTING_TIMEOUT_MS = 10 * 60_000;
/** Issue #55's AC: a `queued` Generation without a usable Backend for this long fails outright. */
const WAITING_FOR_BACKEND_TIMEOUT_MS = 15 * 60_000;

export interface DispatcherDeps {
  sql: postgres.Sql;
  clock: Clock;
  logWriter: LogEntryWriter;
  /** Fallback for a tick/run failure Log entry that itself can't be written (e.g. the DB is down). */
  logger: Logger;
  backendRepository: BackendRepository;
  backendsService: BackendsService;
  modelBackendsRepository: ModelBackendsRepository;
  queue: DispatchQueue;
  assetsRepository: AssetsRepository;
  storage: Storage;
  generationEvents: GenerationEvents;
  /** Issue #45: runs ffmpeg/ffprobe for Asset finishing. */
  media: MediaRunner;
  /** Issue #45: named in a finished video's "AI-generated" comment tag. */
  siteName: string;
  /** Issue #75: set only when the Operator configured a certificate and key. */
  c2pa: C2paSignerConfig | null;
  /** Issue #75: reads the Site title live, for the C2PA manifest. */
  getSiteTitle: () => Promise<string>;
  /** Test-only: shortens the runner's `/api/jobs` poll cadence below its 1s production default. */
  pollIntervalMs?: number;
  /** Test-only: shortens the runner's saving-retry budget below its 15-minute production default. */
  savingBackoffBudgetMs?: number;
  savingBackoffBaseMs?: number;
  /** Test-only: shortens the watchdog's own timeouts below their production defaults. */
  startingTimeoutMs?: number;
  waitingForBackendTimeoutMs?: number;
  /** Issue #59: whether generating is currently Paused. Defaults to never paused, so existing callers need no change. */
  isPaused?: () => Promise<boolean>;
}

interface ClaimPlan {
  generation: QueuedGeneration;
  backend: BackendRecord;
}

function isUniqueViolation(err: unknown): boolean {
  const cause =
    err && typeof err === "object" && "cause" in err ? err.cause : err;
  return Boolean(
    cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505",
  );
}

export class Dispatcher {
  private readonly progress: ProgressTracker;
  private wakeScheduled = false;
  private ticking = false;
  private pendingWake = false;
  private backstopTimer: Timer | null = null;
  private watchdogTimer: Timer | null = null;
  private stopped = false;
  /** Test-only: while `runUntilIdle`'s own loop is driving, `wake()` just flags it instead of also racing a real background tick against it. */
  private manualDriveActive = false;
  /**
   * Generation id -> when `failLongQueuedWithoutBackend` first found it
   * with no usable Backend at all, continuously (issue #55's AC), and
   * how much of the dispatcher's own Paused time (issue #59) had
   * already piled up at that moment. The 15-minute wait counts unpaused
   * time only, so elapsed time is `(now - since) - (pausedTotal(now) -
   * pausedBaseline)`: while a Pause that started before `since` is still
   * going, `pausedTotal(now)` grows in lockstep with `now - since`,
   * freezing the elapsed figure exactly for its duration.
   */
  private readonly noUsableBackendSince = new Map<
    string,
    { sinceMs: number; pausedBaselineMs: number }
  >();
  private pausedMsTotal = 0;
  private pausedSinceMs: number | null = null;

  constructor(private readonly deps: DispatcherDeps) {
    this.progress = new ProgressTracker(deps.clock);
  }

  start(): void {
    this.scheduleBackstop();
    this.scheduleWatchdog();
  }

  stop(): void {
    this.stopped = true;
    if (this.backstopTimer !== null)
      this.deps.clock.clearTimeout(this.backstopTimer);
    if (this.watchdogTimer !== null)
      this.deps.clock.clearTimeout(this.watchdogTimer);
  }

  private scheduleBackstop(): void {
    this.backstopTimer = this.deps.clock.setTimeout(() => {
      this.wake();
      if (!this.stopped) this.scheduleBackstop();
    }, BACKSTOP_INTERVAL_MS);
  }

  private scheduleWatchdog(): void {
    this.watchdogTimer = this.deps.clock.setTimeout(() => {
      void this.watchdogTick();
      if (!this.stopped) this.scheduleWatchdog();
    }, WATCHDOG_INTERVAL_MS);
  }

  /** Call whenever something might make a Generation dispatchable: a submission, a Backend freeing, becoming reachable, or becoming enabled. */
  wake = (): void => {
    if (this.wakeScheduled) return;
    this.wakeScheduled = true;
    // `runUntilIdle`'s own loop below will notice the flag itself on its
    // next iteration; scheduling a real timer too would let that
    // background tick fire mid-loop and race it for the same claim.
    if (this.manualDriveActive) return;
    this.deps.clock.setTimeout(() => {
      this.wakeScheduled = false;
      void this.tick();
    }, 0);
  };

  /**
   * Test-only: claims and runs everything claimable, synchronously
   * looping on any wake a run triggers (e.g. a lost try requeuing, or a
   * Backend freeing) until nothing's left to do — instead of production's
   * fire-and-forget loop, where that next round comes back through a
   * real (uncancellable) `setTimeout(0)` that would otherwise race a
   * test's own next assertion.
   */
  async runUntilIdle(): Promise<void> {
    this.manualDriveActive = true;
    try {
      while (true) {
        this.wakeScheduled = false;
        await this.retryPendingCancels();
        const claimed = await this.claimBatch();
        await Promise.all(
          claimed.map(({ generation, backend, tries }) =>
            this.run(generation, backend, tries),
          ),
        );
        if (claimed.length === 0 && !this.wakeScheduled) break;
      }
    } finally {
      this.manualDriveActive = false;
    }
  }

  /** Test-only: runs one watchdog sweep synchronously instead of waiting for its interval. */
  async runWatchdogOnce(): Promise<void> {
    this.manualDriveActive = true;
    try {
      await this.watchdogTick();
    } finally {
      this.manualDriveActive = false;
    }
  }

  /** Boot recovery (issue #55's AC): reattaches every Generation left `starting`/`running`/`saving` from a previous process. Call once, before `start()`. */
  async recover(): Promise<void> {
    await recoverInFlightGenerations({
      ...this.runnerDeps(),
      backendRepository: this.deps.backendRepository,
    });
  }

  private runnerDeps(): RunnerDeps {
    return {
      queue: this.deps.queue,
      assetsRepository: this.deps.assetsRepository,
      storage: this.deps.storage,
      backendRepository: this.deps.backendRepository,
      backendsService: this.deps.backendsService,
      generationEvents: this.deps.generationEvents,
      logWriter: this.deps.logWriter,
      clock: this.deps.clock,
      progress: this.progress,
      onFreed: this.wake,
      pollIntervalMs: this.deps.pollIntervalMs,
      savingBackoffBudgetMs: this.deps.savingBackoffBudgetMs,
      savingBackoffBaseMs: this.deps.savingBackoffBaseMs,
      media: this.deps.media,
      siteName: this.deps.siteName,
      c2pa: this.deps.c2pa,
      getSiteTitle: this.deps.getSiteTitle,
    };
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      this.pendingWake = true;
      return;
    }
    this.ticking = true;
    try {
      await this.retryPendingCancels();
      const claimed = await this.claimBatch();
      for (const { generation, backend, tries } of claimed) {
        void this.run(generation, backend, tries);
      }
    } catch (err) {
      await this.logFailure("dispatcher tick failed", err, {});
    } finally {
      this.ticking = false;
      if (this.pendingWake) {
        this.pendingWake = false;
        this.wake();
      }
    }
  }

  private async run(
    generation: QueuedGeneration,
    backend: BackendRecord,
    tries: number,
  ) {
    try {
      const detail = await this.deps.queue.detailForRun(generation.id);
      if (!detail) return;
      await runClaimedGeneration(backend, detail, tries, this.runnerDeps());
    } catch (err) {
      await this.logFailure("Generation run crashed", err, {
        backendId: backend.id,
        generationId: generation.id,
      });
    } finally {
      this.wake();
    }
  }

  /**
   * Writes a failure Log entry, falling back to stdout when that write
   * itself fails (e.g. the DB `logWriter` writes to is down) — the same
   * swallow-and-fall-back error-logging.ts does for an unhandled route
   * error. Never throws: a tick()/run()/watchdogTick() failure must
   * never become an unhandled rejection that kills the process.
   */
  private async logFailure(
    message: string,
    err: unknown,
    fields: { backendId?: string; generationId?: string },
  ): Promise<void> {
    const details =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    try {
      await this.deps.logWriter.log({
        level: "error",
        source: "app",
        message,
        details,
        ...fields,
      });
    } catch (logErr) {
      this.deps.logger.error(message, {
        details,
        ...fields,
        logError: logErr instanceof Error ? logErr.message : String(logErr),
      });
    }
  }

  private async isPaused(): Promise<boolean> {
    return (await this.deps.isPaused?.()) ?? false;
  }

  /**
   * Updates the Paused-time bookkeeping for this tick and returns
   * whether generating is currently Paused. Called once per watchdog
   * sweep (issue #59): a 30s granularity is already how this sweep
   * tracks everything else, so it's plenty for a 15-minute threshold.
   */
  private async trackPaused(nowMs: number): Promise<boolean> {
    const paused = await this.isPaused();
    if (paused && this.pausedSinceMs === null) {
      this.pausedSinceMs = nowMs;
    } else if (!paused && this.pausedSinceMs !== null) {
      this.pausedMsTotal += nowMs - this.pausedSinceMs;
      this.pausedSinceMs = null;
    }
    return paused;
  }

  private pausedTotalMsAt(nowMs: number): number {
    return (
      this.pausedMsTotal +
      (this.pausedSinceMs !== null ? nowMs - this.pausedSinceMs : 0)
    );
  }

  /** Builds the match plan, then claims each pair inside one advisory-locked transaction. */
  private async claimBatch(): Promise<(ClaimPlan & { tries: number })[]> {
    // A Pause refuses every new claim outright (issue #59's AC): queued
    // Generations wait untouched, while anything already `starting`/
    // `running`/`saving` keeps going in the runner, which this never
    // touches. `&&` short-circuits past the `await` entirely when no
    // `isPaused` dep is wired (every production caller wires one; a few
    // tests construct a bare DispatcherDeps and rely on tick()'s claim
    // happening fully synchronously under a stubbed clock).
    if (this.deps.isPaused && (await this.isPaused())) return [];

    const plan = await this.buildPlan();
    if (plan.length === 0) return [];

    const claimed: (ClaimPlan & { tries: number })[] = [];
    await this.deps.sql.begin(async (tx) => {
      const [row] = await tx<{ locked: boolean }[]>`
        select pg_try_advisory_xact_lock(${DISPATCH_LOCK_KEY}) as locked
      `;
      if (!row?.locked) return;

      for (const candidate of plan) {
        const rows = await tx
          .savepoint(async (sp) => {
            return sp<{ id: string; tries: number }[]>`
              update generations
              set state = 'starting', backend_id = ${candidate.backend.id}, started_at = ${this.deps.clock.now().toISOString()}, tries = tries + 1
              where id = ${candidate.generation.id} and state = 'queued'
              returning id, tries
            `;
          })
          .catch((err) => {
            if (isUniqueViolation(err)) return [];
            throw err;
          });
        const claimedRow = rows[0];
        if (claimedRow) claimed.push({ ...candidate, tries: claimedRow.tries });
      }
    });
    return claimed;
  }

  /**
   * Re-sends a cancel's interrupt to a Backend that couldn't be reached
   * last time (issue #54's AC): the Generation it belonged to is already
   * `cancelled`, this just makes sure the Backend itself heard about it
   * before `buildPlan` can match it to new work. Skips any Backend the
   * health monitor hasn't confirmed reachable (`unreachable` or still
   * `unknown`, e.g. right after boot) instead of waiting out `cancelJob`'s
   * own 15s timeout for it on every tick — `buildPlan` excludes it from
   * new work regardless, by the same `pendingBackendCancel` row this
   * leaves untouched.
   */
  private async retryPendingCancels(): Promise<void> {
    const pending = await this.deps.queue.pendingBackendCancels();
    for (const { generationId, backendId } of pending) {
      const backend = await this.deps.backendRepository.get(backendId);
      if (!backend) {
        // The Backend itself is gone; nothing left to tell.
        await this.deps.queue.clearPendingBackendCancel(generationId);
        continue;
      }
      if (
        this.deps.backendsService.healthFor(backendId).reachability !==
        "reachable"
      ) {
        // Also skips `unknown` (e.g. right after boot, before the health
        // monitor's first poll lands): no point waiting out `cancelJob`'s
        // own 15s timeout for a Backend that hasn't even been confirmed
        // reachable yet.
        continue;
      }
      try {
        const target = await comfyUiTarget(
          backend,
          this.deps.backendRepository,
        );
        await cancelJob(target, generationId);
        await this.deps.queue.clearPendingBackendCancel(generationId);
      } catch {
        // Still unreachable: leave it pending, and buildPlan below keeps
        // excluding this Backend from new work until it clears.
      }
    }
  }

  /** The greedy match: fewest-starting-or-running user first, then oldest, matched to the first eligible free Backend. */
  private async buildPlan(): Promise<ClaimPlan[]> {
    const [
      queued,
      activeCounts,
      busyBackendIds,
      pendingCancelBackendIds,
      allBackends,
    ] = await Promise.all([
      this.deps.queue.listQueued(),
      this.deps.queue.activeCountsByUser(),
      this.deps.queue.busyBackendIds(),
      this.deps.queue.pendingCancelBackendIds(),
      this.deps.backendRepository.list(),
    ]);
    if (queued.length === 0) return [];

    const free = allBackends.filter(
      (backend) =>
        backend.enabled &&
        !backend.draining &&
        !busyBackendIds.has(backend.id) &&
        !pendingCancelBackendIds.has(backend.id) &&
        this.deps.backendsService.healthFor(backend.id).reachability ===
          "reachable",
    );
    if (free.length === 0) return [];
    const freeById = new Map(free.map((backend) => [backend.id, backend]));

    const ordered = [...queued].sort(
      (a, b) =>
        (activeCounts.get(a.userId) ?? 0) - (activeCounts.get(b.userId) ?? 0),
    );

    const attachedCache = new Map<string, BackendRecord[]>();
    const plan: ClaimPlan[] = [];
    for (const generation of ordered) {
      if (freeById.size === 0) break;

      let attached = attachedCache.get(generation.modelId);
      if (!attached) {
        attached = await this.deps.modelBackendsRepository.listForModel(
          generation.modelId,
        );
        attachedCache.set(generation.modelId, attached);
      }

      for (const backend of attached) {
        const candidate = freeById.get(backend.id);
        if (!candidate) continue;
        const nodeTypes =
          await this.deps.backendsService.nodeTypesFor(candidate);
        if (!nodeTypes) continue;
        if (!generation.nodeTypes.every((type) => nodeTypes.has(type))) {
          continue;
        }
        plan.push({ generation, backend: candidate });
        freeById.delete(backend.id);
        break;
      }
    }
    return plan;
  }

  /**
   * Whether any Backend attached to `modelId` could soon take a
   * Generation needing `nodeTypes` — enabled, not draining, and not
   * confirmed unreachable. "Unknown" reachability (not yet health-
   * checked, e.g. right after boot) isn't proof a Backend can't run
   * this, so it counts as usable here (issue #55's AC) the same as a
   * reachable-but-busy one does; only a Backend the health monitor has
   * actually confirmed unreachable, or whose known node types actually
   * don't match, counts against it.
   */
  private async hasUsableBackend(
    modelId: string,
    nodeTypes: readonly string[],
  ): Promise<boolean> {
    const attached =
      await this.deps.modelBackendsRepository.listForModel(modelId);
    for (const backend of attached) {
      if (!backend.enabled || backend.draining) continue;
      if (
        this.deps.backendsService.healthFor(backend.id).reachability ===
        "unreachable"
      ) {
        continue;
      }
      const knownTypes = await this.deps.backendsService.nodeTypesFor(backend);
      if (knownTypes && !nodeTypes.every((type) => knownTypes.has(type))) {
        continue;
      }
      return true;
    }
    return false;
  }

  /** The periodic safety-net sweep (issue #55's AC): a stuck `starting` try, and a `queued` Generation that's run out of patience waiting for a usable Backend. */
  private async watchdogTick(): Promise<void> {
    try {
      await this.recoverStuckStarting();
      await this.failLongQueuedWithoutBackend();
    } catch (err) {
      await this.logFailure("dispatcher watchdog failed", err, {});
    }
  }

  private async recoverStuckStarting(): Promise<void> {
    const stuck = await this.deps.queue.listStuckStarting(
      this.deps.startingTimeoutMs ?? STARTING_TIMEOUT_MS,
      this.deps.clock.now(),
    );
    for (const stuckGeneration of stuck) {
      const detail = await this.deps.queue.detailForRun(stuckGeneration.id);
      if (!detail) continue;
      await reportLostTry(
        this.deps,
        detail,
        stuckGeneration.backendId,
        stuckGeneration.tries,
        "the Backend never confirmed it started this try",
        "the GPU server couldn't run this",
      );
    }
    if (stuck.length > 0) this.wake();
  }

  /**
   * Fails a `queued` Generation once it's gone 15 minutes with no
   * usable Backend at all for its Model — tracked per Generation in
   * `noUsableBackendSince`, from when that became true, not from
   * `queuedAt` (issue #55's AC): a Generation queued a while behind a
   * busy-but-usable Backend doesn't fail the instant that Backend is
   * drained, rebooted, or still "unknown" right after boot.
   */
  private async failLongQueuedWithoutBackend(): Promise<void> {
    const queued = await this.deps.queue.listQueued();
    const queuedIds = new Set(queued.map((candidate) => candidate.id));
    for (const id of this.noUsableBackendSince.keys()) {
      if (!queuedIds.has(id)) this.noUsableBackendSince.delete(id);
    }

    const thresholdMs =
      this.deps.waitingForBackendTimeoutMs ?? WAITING_FOR_BACKEND_TIMEOUT_MS;
    const nowMs = this.deps.clock.now().getTime();
    await this.trackPaused(nowMs);

    for (const candidate of queued) {
      if (await this.hasUsableBackend(candidate.modelId, candidate.nodeTypes)) {
        this.noUsableBackendSince.delete(candidate.id);
        continue;
      }
      const entry = this.noUsableBackendSince.get(candidate.id);
      if (entry === undefined) {
        this.noUsableBackendSince.set(candidate.id, {
          sinceMs: nowMs,
          pausedBaselineMs: this.pausedTotalMsAt(nowMs),
        });
        continue;
      }
      const elapsedMs =
        nowMs -
        entry.sinceMs -
        (this.pausedTotalMsAt(nowMs) - entry.pausedBaselineMs);
      if (elapsedMs < thresholdMs) continue;

      const detail = await this.deps.queue.detailForRun(candidate.id);
      if (!detail) continue;
      await reportFailure(
        this.deps,
        detail,
        null,
        candidate.tries,
        "no server available for this Model",
      );
      this.noUsableBackendSince.delete(candidate.id);
    }
  }
}
