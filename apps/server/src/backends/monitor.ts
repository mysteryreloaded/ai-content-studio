// One monitor per Backend, polling /system_stats every 30s. Unreachable
// after 3 consecutive failures, reachable again after 1 success. Health,
// version and VRAM live only in memory (issue #39).

import type { Clock, Timer } from "@ai-content-studio/shared";
import type { LogEntryWriter } from "./log-entries.js";

const POLL_INTERVAL_MS = 30_000;
const FAILURE_THRESHOLD = 3;
const SUCCESS_THRESHOLD = 1;

export type Reachability = "unknown" | "reachable" | "unreachable";

export interface BackendHealth {
  reachability: Reachability;
  comfyuiVersion: string | null;
  vramTotal: number | null;
  vramFree: number | null;
  /** Set when the last decrypt of this Backend's credentials failed. */
  credentialsError: boolean;
}

export interface SystemStats {
  comfyuiVersion: string;
  vramTotal: number;
  vramFree: number;
}

export interface BackendTarget {
  id: string;
  name: string;
  baseUrl: string;
  fetchSystemStats(): Promise<SystemStats>;
}

/** Thrown by a BackendTarget when the stored credentials can't be decrypted. */
export class CredentialsNeedReentry extends Error {
  constructor() {
    super("re-enter credentials");
  }
}

const BLANK_HEALTH: BackendHealth = {
  reachability: "unknown",
  comfyuiVersion: null,
  vramTotal: null,
  vramFree: null,
  credentialsError: false,
};

export class BackendMonitor {
  private readonly health = new Map<string, BackendHealth>();
  private readonly consecutiveFailures = new Map<string, number>();
  private readonly consecutiveSuccesses = new Map<string, number>();
  private readonly unreachableSince = new Map<string, Date>();
  private readonly timers = new Map<string, Timer>();
  /**
   * One token per active watch. A poll started before an unwatch+watch
   * (e.g. an edit) completes after the new watch has already replaced it;
   * comparing against the current token drops that stale result instead
   * of letting it reschedule a second, unclearable loop.
   */
  private readonly watchTokens = new Map<string, symbol>();

  constructor(
    private readonly clock: Clock,
    private readonly logger: LogEntryWriter,
  ) {}

  healthFor(backendId: string): BackendHealth {
    return this.health.get(backendId) ?? BLANK_HEALTH;
  }

  watch(target: BackendTarget): void {
    const token = Symbol(target.id);
    this.watchTokens.set(target.id, token);
    this.health.set(target.id, { ...BLANK_HEALTH });
    this.consecutiveFailures.delete(target.id);
    this.consecutiveSuccesses.delete(target.id);
    this.unreachableSince.delete(target.id);
    this.scheduleNextPoll(target, token);
  }

  unwatch(backendId: string): void {
    this.watchTokens.delete(backendId);
    const timer = this.timers.get(backendId);
    if (timer !== undefined) this.clock.clearTimeout(timer);
    this.timers.delete(backendId);
    this.health.delete(backendId);
    this.consecutiveFailures.delete(backendId);
    this.consecutiveSuccesses.delete(backendId);
    this.unreachableSince.delete(backendId);
  }

  stopAll(): void {
    this.watchTokens.clear();
    for (const timer of this.timers.values()) this.clock.clearTimeout(timer);
    this.timers.clear();
  }

  private scheduleNextPoll(target: BackendTarget, token: symbol): void {
    const timer = this.clock.setTimeout(() => {
      void this.pollTracked(target, token);
    }, POLL_INTERVAL_MS);
    this.timers.set(target.id, timer);
  }

  private async pollTracked(
    target: BackendTarget,
    token: symbol,
  ): Promise<void> {
    await this.poll(target, token);
    if (this.watchTokens.get(target.id) === token) {
      this.scheduleNextPoll(target, token);
    }
  }

  /**
   * Runs one poll. `token`, when given, must still be this Backend's
   * current watch token for the result to be applied — a stale result
   * from a watch that's since been replaced is silently dropped. Tests
   * call this without a token to apply a manual poll unconditionally.
   */
  async poll(target: BackendTarget, token?: symbol): Promise<void> {
    try {
      const stats = await target.fetchSystemStats();
      if (token !== undefined && this.watchTokens.get(target.id) !== token)
        return;
      await this.recordSuccess(target, stats);
    } catch (err) {
      if (token !== undefined && this.watchTokens.get(target.id) !== token)
        return;
      await this.recordFailure(target, err);
    }
  }

  private async recordSuccess(
    target: BackendTarget,
    stats: SystemStats,
  ): Promise<void> {
    this.consecutiveFailures.set(target.id, 0);
    const successes = (this.consecutiveSuccesses.get(target.id) ?? 0) + 1;
    this.consecutiveSuccesses.set(target.id, successes);

    const current = this.healthFor(target.id);
    const wasUnreachable = current.reachability === "unreachable";
    const becameReachable = successes >= SUCCESS_THRESHOLD && wasUnreachable;

    this.health.set(target.id, {
      reachability:
        successes >= SUCCESS_THRESHOLD ? "reachable" : current.reachability,
      comfyuiVersion: stats.comfyuiVersion,
      vramTotal: stats.vramTotal,
      vramFree: stats.vramFree,
      credentialsError: false,
    });

    if (becameReachable) {
      const since = this.unreachableSince.get(target.id);
      const downtimeMs = since
        ? this.clock.now().getTime() - since.getTime()
        : null;
      this.unreachableSince.delete(target.id);
      await this.logger.log({
        level: "info",
        source: "backend",
        message: `Backend "${target.name}" is reachable again`,
        details: downtimeMs !== null ? `downtime_ms=${downtimeMs}` : undefined,
        backendId: target.id,
      });
    }
  }

  private async recordFailure(
    target: BackendTarget,
    err: unknown,
  ): Promise<void> {
    this.consecutiveSuccesses.set(target.id, 0);
    const failures = (this.consecutiveFailures.get(target.id) ?? 0) + 1;
    this.consecutiveFailures.set(target.id, failures);

    const current = this.healthFor(target.id);
    const wasReachable = current.reachability !== "unreachable";
    const becameUnreachable = failures >= FAILURE_THRESHOLD && wasReachable;
    const credentialsError = err instanceof CredentialsNeedReentry;

    this.health.set(target.id, {
      ...current,
      reachability:
        credentialsError || failures >= FAILURE_THRESHOLD
          ? "unreachable"
          : current.reachability,
      credentialsError: credentialsError || current.credentialsError,
    });

    if (credentialsError && !current.credentialsError) {
      await this.logger.log({
        level: "error",
        source: "backend",
        message: `Backend "${target.name}": re-enter credentials`,
        details: err instanceof Error ? err.message : String(err),
        backendId: target.id,
      });
    }

    if (becameUnreachable) {
      this.unreachableSince.set(target.id, this.clock.now());
      await this.logger.log({
        level: "warning",
        source: "backend",
        message: `Backend "${target.name}" became unreachable`,
        details: err instanceof Error ? err.message : String(err),
        backendId: target.id,
      });
    }
  }
}
