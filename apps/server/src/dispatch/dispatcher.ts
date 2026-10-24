// Hands a queued Generation to a free Backend (issue #44, ADR 0002). Wakes
// on submissions, a Backend freeing/becoming reachable/becoming enabled,
// and a 10s backstop; a Postgres advisory lock (held only around the
// claim, not the run) keeps a second instance from dispatching alongside
// this one.

import type { Clock, Timer } from "@ai-content-studio/shared";
import type postgres from "postgres";
import type { LogEntryWriter } from "../backends/log-entries.js";
import type {
  BackendRecord,
  BackendRepository,
} from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import type { AssetsRepository } from "../generations/assets-repository.js";
import type { GenerationEvents } from "../generations/events.js";
import type { ModelBackendsRepository } from "../models/model-backends.js";
import type { Storage } from "../storage/storage.js";
import { ProgressTracker } from "./progress.js";
import type { DispatchQueue, QueuedGeneration } from "./queue.js";
import { runClaimedGeneration } from "./runner.js";

/** Distinct from the migration lock's key (db/migrate.ts), same lock-per-app-concern pattern (ADR 0002). */
const DISPATCH_LOCK_KEY = 72_738_292;
const BACKSTOP_INTERVAL_MS = 10_000;

export interface DispatcherDeps {
  sql: postgres.Sql;
  clock: Clock;
  logWriter: LogEntryWriter;
  backendRepository: BackendRepository;
  backendsService: BackendsService;
  modelBackendsRepository: ModelBackendsRepository;
  queue: DispatchQueue;
  assetsRepository: AssetsRepository;
  storage: Storage;
  generationEvents: GenerationEvents;
  /** Test-only: shortens the runner's `/api/jobs` poll cadence below its 1s production default. */
  pollIntervalMs?: number;
}

interface ClaimPlan {
  generation: QueuedGeneration;
  backend: BackendRecord;
}

export class Dispatcher {
  private readonly progress: ProgressTracker;
  private wakeScheduled = false;
  private ticking = false;
  private pendingWake = false;
  private backstopTimer: Timer | null = null;
  private stopped = false;

  constructor(private readonly deps: DispatcherDeps) {
    this.progress = new ProgressTracker(deps.clock);
  }

  start(): void {
    this.scheduleBackstop();
  }

  stop(): void {
    this.stopped = true;
    if (this.backstopTimer !== null)
      this.deps.clock.clearTimeout(this.backstopTimer);
  }

  private scheduleBackstop(): void {
    this.backstopTimer = this.deps.clock.setTimeout(() => {
      this.wake();
      if (!this.stopped) this.scheduleBackstop();
    }, BACKSTOP_INTERVAL_MS);
  }

  /** Call whenever something might make a Generation dispatchable: a submission, a Backend freeing, becoming reachable, or becoming enabled. */
  wake = (): void => {
    if (this.wakeScheduled) return;
    this.wakeScheduled = true;
    this.deps.clock.setTimeout(() => {
      this.wakeScheduled = false;
      void this.tick();
    }, 0);
  };

  /** Test-only: claims whatever's claimable right now and waits for every run to finish, instead of production's fire-and-forget loop. */
  async runUntilIdle(): Promise<void> {
    const claimed = await this.claimBatch();
    await Promise.all(
      claimed.map(({ generation, backend }) => this.run(generation, backend)),
    );
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      this.pendingWake = true;
      return;
    }
    this.ticking = true;
    try {
      const claimed = await this.claimBatch();
      for (const { generation, backend } of claimed) {
        void this.run(generation, backend);
      }
    } catch (err) {
      await this.deps.logWriter.log({
        level: "error",
        source: "app",
        message: "dispatcher tick failed",
        details:
          err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    } finally {
      this.ticking = false;
      if (this.pendingWake) {
        this.pendingWake = false;
        this.wake();
      }
    }
  }

  private async run(generation: QueuedGeneration, backend: BackendRecord) {
    try {
      const detail = await this.deps.queue.detailForRun(generation.id);
      if (!detail) return;
      await runClaimedGeneration(backend, detail, {
        queue: this.deps.queue,
        assetsRepository: this.deps.assetsRepository,
        storage: this.deps.storage,
        backendRepository: this.deps.backendRepository,
        generationEvents: this.deps.generationEvents,
        logWriter: this.deps.logWriter,
        clock: this.deps.clock,
        progress: this.progress,
        onFreed: this.wake,
        pollIntervalMs: this.deps.pollIntervalMs,
      });
    } catch (err) {
      await this.deps.logWriter.log({
        level: "error",
        source: "app",
        message: "Generation run crashed",
        backendId: backend.id,
        generationId: generation.id,
        details:
          err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    } finally {
      this.wake();
    }
  }

  /** Builds the match plan, then claims each pair inside one advisory-locked transaction. */
  private async claimBatch(): Promise<ClaimPlan[]> {
    const plan = await this.buildPlan();
    if (plan.length === 0) return [];

    const claimed: ClaimPlan[] = [];
    await this.deps.sql.begin(async (tx) => {
      const [row] = await tx<{ locked: boolean }[]>`
        select pg_try_advisory_xact_lock(${DISPATCH_LOCK_KEY}) as locked
      `;
      if (!row?.locked) return;

      for (const candidate of plan) {
        const rows = await tx
          .savepoint(async (sp) => {
            return sp<{ id: string }[]>`
              update generations
              set state = 'starting', backend_id = ${candidate.backend.id}, started_at = ${this.deps.clock.now().toISOString()}
              where id = ${candidate.generation.id} and state = 'queued'
              returning id
            `;
          })
          .catch((err) => {
            if (isUniqueViolation(err)) return [];
            throw err;
          });
        if (rows.length > 0) claimed.push(candidate);
      }
    });
    return claimed;
  }

  /** The greedy match: fewest-starting-or-running user first, then oldest, matched to the first eligible free Backend. */
  private async buildPlan(): Promise<ClaimPlan[]> {
    const [queued, activeCounts, busyBackendIds, allBackends] =
      await Promise.all([
        this.deps.queue.listQueued(),
        this.deps.queue.activeCountsByUser(),
        this.deps.queue.busyBackendIds(),
        this.deps.backendRepository.list(),
      ]);
    if (queued.length === 0) return [];

    const free = allBackends.filter(
      (backend) =>
        backend.enabled &&
        !busyBackendIds.has(backend.id) &&
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
