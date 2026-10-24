// A Generation's live progress (issue #44's AC): elapsed time against the
// median of the last 10 successes for that Model, Mode and Backend
// (capped at 99%), plus a step counter. Kept in memory only.

import type { Clock } from "@ai-content-studio/shared";

const HISTORY_LIMIT = 10;

interface Active {
  key: string;
  startedAtMs: number;
  step: number | null;
  totalSteps: number | null;
}

export interface ProgressSnapshot {
  elapsedMs: number;
  estimateMs: number | null;
  step: number | null;
  totalSteps: number | null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

export class ProgressTracker {
  private readonly active = new Map<string, Active>();
  private readonly history = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  static keyFor(modelId: string, modeId: string, backendId: string): string {
    return `${modelId}:${modeId}:${backendId}`;
  }

  start(generationId: string, key: string): void {
    this.active.set(generationId, {
      key,
      startedAtMs: this.clock.now().getTime(),
      step: null,
      totalSteps: null,
    });
  }

  updateStep(generationId: string, step: number, totalSteps: number): void {
    const entry = this.active.get(generationId);
    if (!entry) return;
    entry.step = step;
    entry.totalSteps = totalSteps;
  }

  /** Records this run's duration into its key's history and stops tracking it. */
  finish(generationId: string): void {
    const entry = this.active.get(generationId);
    if (!entry) return;
    const durationMs = this.clock.now().getTime() - entry.startedAtMs;
    const list = this.history.get(entry.key) ?? [];
    list.push(durationMs);
    if (list.length > HISTORY_LIMIT) list.shift();
    this.history.set(entry.key, list);
    this.active.delete(generationId);
  }

  /** Stops tracking a failed run without recording a (misleading) duration. */
  discard(generationId: string): void {
    this.active.delete(generationId);
  }

  snapshot(generationId: string): ProgressSnapshot | null {
    const entry = this.active.get(generationId);
    if (!entry) return null;
    const history = this.history.get(entry.key) ?? [];
    return {
      elapsedMs: this.clock.now().getTime() - entry.startedAtMs,
      estimateMs: history.length > 0 ? median(history) : null,
      step: entry.step,
      totalSteps: entry.totalSteps,
    };
  }
}
