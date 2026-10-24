// Periodic retention sweep (issue #69, ADR 0006, ADR 0002): tidies old
// Assets, unused Uploads and stale Log entries away on a schedule, all
// through the injected clock. Guarded by a Postgres advisory lock the
// same single-instance-coordination pattern as the dispatcher's and the
// migration lock use, so only the instance holding it does the work on
// a given tick; the others just skip that tick.

import type { Clock, Timer } from "@ai-content-studio/shared";
import { lt } from "drizzle-orm";
import type postgres from "postgres";
import type { LogEntryWriter } from "../backends/log-entries.js";
import type { Database } from "../db/client.js";
import { logEntries } from "../db/schema.js";
import { deleteStorageFor } from "../generations/deletion.js";
import type { DeletedStorageKeys } from "../generations/repository.js";
import type { Logger } from "../logger.js";
import type { Storage } from "../storage/storage.js";
import type { UploadsRepository } from "../uploads/repository.js";

/** Distinct from the migration lock's and the dispatcher's own keys (ADR 0002's single-instance-coordination pattern). */
const RETENTION_LOCK_KEY = 72_738_293;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Issue #69's AC: an unused or incomplete Upload is swept 24 h after its last activity, not configurable. */
const UPLOAD_UNUSED_MS = DAY_MS;
/** How often this instance tries the sweep; well under a day so "LOG_RETENTION_DAYS"/"ASSET_RETENTION_DAYS" don't drift far past their own stated day. */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export interface RetentionGenerationsRepository {
  pruneOldAssets(cutoff: Date, now: Date): Promise<DeletedStorageKeys>;
}

export interface RetentionSchedulerDeps {
  sql: postgres.Sql;
  db: Database;
  clock: Clock;
  storage: Storage;
  logWriter: LogEntryWriter;
  /** Fallback for a failed job whose own Log entry write also fails (e.g. the DB is down). */
  logger: Logger;
  generationsRepository: RetentionGenerationsRepository;
  uploadsRepository: Pick<UploadsRepository, "deleteUnused">;
  /** Issue #69's AC: blank (`undefined`/`null`) keeps every Asset forever. */
  assetRetentionDays: number | null;
  logRetentionDays: number;
  /** Test-only: shortens the sweep's own interval below its 1-hour production default. */
  intervalMs?: number;
}

export class RetentionScheduler {
  private timer: Timer | null = null;
  private stopped = false;

  constructor(private readonly deps: RetentionSchedulerDeps) {}

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    this.timer = this.deps.clock.setTimeout(() => {
      void this.runOnce().finally(() => {
        if (!this.stopped) this.scheduleNext();
      });
    }, this.deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  }

  /**
   * Tries the advisory lock; runs every job only while it's held, then
   * releases it. A no-op (returns right away) when another instance
   * already holds it — that instance's own tick will get to the same
   * work.
   */
  async runOnce(): Promise<void> {
    const reserved = await this.deps.sql.reserve();
    try {
      const [row] = await reserved<{ locked: boolean }[]>`
        select pg_try_advisory_lock(${RETENTION_LOCK_KEY}) as locked
      `;
      if (!row?.locked) return;
      try {
        await this.runJobs();
      } finally {
        await reserved`select pg_advisory_unlock(${RETENTION_LOCK_KEY})`;
      }
    } finally {
      reserved.release();
    }
  }

  private async runJobs(): Promise<void> {
    const now = this.deps.clock.now();
    await this.runJob("asset retention", () => this.pruneAssets(now));
    await this.runJob("upload cleanup", () => this.pruneUploads(now));
    await this.runJob("log retention", () => this.pruneLogs(now));
  }

  /** Issue #69's AC: a failed job writes an `error` Log entry instead of taking the other jobs down with it. */
  private async runJob(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      await this.logFailure(`retention: ${name} job failed`, err);
    }
  }

  private async pruneAssets(now: Date): Promise<void> {
    if (this.deps.assetRetentionDays === null) return;
    const cutoff = new Date(
      now.getTime() - this.deps.assetRetentionDays * DAY_MS,
    );
    const keys = await this.deps.generationsRepository.pruneOldAssets(
      cutoff,
      now,
    );
    await deleteStorageFor(this.deps.storage, keys);
  }

  private async pruneUploads(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - UPLOAD_UNUSED_MS);
    const removed = await this.deps.uploadsRepository.deleteUnused(cutoff);
    for (const upload of removed) {
      await this.deps.storage.delete(upload.storageKey);
      if (upload.thumbnailKey) {
        await this.deps.storage.delete(upload.thumbnailKey);
      }
    }
  }

  private async pruneLogs(now: Date): Promise<void> {
    const cutoff = new Date(
      now.getTime() - this.deps.logRetentionDays * DAY_MS,
    );
    await this.deps.db
      .delete(logEntries)
      .where(lt(logEntries.createdAt, cutoff));
  }

  private async logFailure(message: string, err: unknown): Promise<void> {
    const details =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    try {
      await this.deps.logWriter.log({
        level: "error",
        source: "app",
        message,
        details,
      });
    } catch (logErr) {
      this.deps.logger.error(message, {
        details,
        logError: logErr instanceof Error ? logErr.message : String(logErr),
      });
    }
  }
}
