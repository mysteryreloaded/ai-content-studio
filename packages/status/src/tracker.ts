import type { Clock } from "./clock";
import { PROBLEM_DELAY_MS, SUPPRESSED_WHILE_PAUSED, type Problem, type ProblemCode } from "./types";

interface Entry {
  message: string;
  trueSince: Date;
}

function key(code: ProblemCode, target: string): string {
  return `${code}\u0000${target}`;
}

/**
 * Holds Problems in memory. Callers report whichever raw condition they own
 * (backend reachability, disk free space, the last 3 finished tries, ...)
 * every time they check it; this tracker turns a continuously-true condition
 * into a Problem once it has held for that code's delay (`PROBLEM_DELAY_MS`),
 * and drops it the moment the caller reports it false — that is how Problems
 * "clear themselves" per issue #70.
 */
export class ProblemsTracker {
  private entries = new Map<string, Entry>();

  constructor(private clock: Clock) {}

  /**
   * Reports the current state of one condition identified by `code` and
   * `target` (a Mode id, Backend id, job id, disk path, ...). `active: false`
   * clears it immediately, regardless of delay.
   */
  report(code: ProblemCode, target: string, active: boolean, message: string): void {
    const k = key(code, target);
    if (!active) {
      this.entries.delete(k);
      return;
    }
    const existing = this.entries.get(k);
    if (existing) {
      existing.message = message;
    } else {
      this.entries.set(k, { message, trueSince: this.clock.now() });
    }
  }

  /** Equivalent to `report(code, target, false, "")`. */
  clear(code: ProblemCode, target: string): void {
    this.entries.delete(key(code, target));
  }

  /**
   * The Problems visible right now: past their delay, and not suppressed by
   * an active Pause. Sorted oldest-first, since that is what an Admin and
   * the status endpoint both want to show first.
   */
  list(options?: { paused?: boolean }): Problem[] {
    const now = this.clock.now();
    const paused = options?.paused ?? false;
    const result: Problem[] = [];
    for (const [k, entry] of this.entries) {
      const sep = k.indexOf("\u0000");
      const code = k.slice(0, sep) as ProblemCode;
      const target = k.slice(sep + 1);
      if (paused && SUPPRESSED_WHILE_PAUSED.has(code)) continue;
      if (now.getTime() - entry.trueSince.getTime() < PROBLEM_DELAY_MS[code]) continue;
      result.push({ code, message: entry.message, target, since: entry.trueSince });
    }
    result.sort((a, b) => a.since.getTime() - b.since.getTime());
    return result;
  }

  isHealthy(options?: { paused?: boolean }): boolean {
    return this.list(options).length === 0;
  }
}
