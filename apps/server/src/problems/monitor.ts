// Periodically re-derives the Problems that this codebase can currently
// detect and writes them into a ProblemsRegistry (issue #70).
//
// `model_without_backend`, `backend_failing`, `job_failed` and
// `generating_paused` aren't checked here: they need Models,
// Generations and Pause (issues #40-#58, #59), none of which exist yet.

import type { Clock, Timer } from "@ai-content-studio/shared";
import type postgres from "postgres";
import type { BackendRepository } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import { freeDiskBytes } from "./disk.js";
import type { ProblemsRegistry } from "./problems.js";

const CHECK_INTERVAL_MS = 10_000;
const DB_CHECK_TIMEOUT_MS = 2_000;
const BACKEND_UNREACHABLE_GRACE_MS = 5 * 60 * 1000;
const BYTES_PER_GB = 1024 * 1024 * 1024;

export class ProblemsMonitor {
  private timer: Timer | null = null;

  constructor(
    private readonly registry: ProblemsRegistry,
    private readonly clock: Clock,
    private readonly sql: postgres.Sql,
    private readonly backendRepository: BackendRepository,
    private readonly backendsService: BackendsService,
    private readonly dataDir: string,
    private readonly minFreeDiskGb: number,
  ) {}

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    this.timer = this.clock.setTimeout(() => {
      void this.runChecks().finally(() => this.scheduleNext());
    }, CHECK_INTERVAL_MS);
  }

  async runChecks(): Promise<void> {
    await Promise.all([
      this.checkDatabase(),
      this.checkBackends(),
      this.checkDisk(),
    ]);
  }

  private async checkDatabase(): Promise<void> {
    const reachable = await isDatabaseReachable(this.sql, this.clock);
    if (reachable) {
      this.registry.clear("db_unreachable", null);
    } else {
      this.registry.set(
        "db_unreachable",
        null,
        "The database isn't reachable.",
      );
    }
  }

  private async checkBackends(): Promise<void> {
    const backends = await this.backendRepository.list();
    const keep = new Set<string>();
    const now = this.clock.now().getTime();

    for (const backend of backends) {
      const since = this.backendsService.unreachableSince(backend.id);
      if (
        since !== null &&
        now - since.getTime() >= BACKEND_UNREACHABLE_GRACE_MS
      ) {
        keep.add(backend.id);
        this.registry.set(
          "backend_unreachable",
          backend.id,
          `Backend "${backend.name}" has been unreachable since ${since.toISOString()}.`,
        );
      } else {
        this.registry.clear("backend_unreachable", backend.id);
      }
    }

    this.registry.clearStaleTargets("backend_unreachable", keep);
  }

  private async checkDisk(): Promise<void> {
    try {
      const freeBytes = await freeDiskBytes(this.dataDir);
      const freeGb = freeBytes / BYTES_PER_GB;
      const floorGb = this.minFreeDiskGb * 2;
      if (freeGb < floorGb) {
        this.registry.set(
          "disk_low",
          this.dataDir,
          `Only ${freeGb.toFixed(1)} GB free on ${this.dataDir}, below ${floorGb} GB (2x MIN_FREE_DISK_GB).`,
        );
      } else {
        this.registry.clear("disk_low", this.dataDir);
      }
    } catch {
      // Can't stat the disk (e.g. missing in a test sandbox): leave disk_low alone.
    }
  }
}

function isDatabaseReachable(
  sql: postgres.Sql,
  clock: Clock,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = clock.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, DB_CHECK_TIMEOUT_MS);

    sql`select 1`
      .then(() => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(true);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        resolve(false);
      });
  });
}
