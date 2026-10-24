// In-process pub/sub for a user's Generation changes (issue #43): the
// one SSE stream per tab subscribes here, and a submit (or, later, the
// dispatcher) publishes here. Nothing is persisted; a reconnect replays
// the current state from the database instead (the stream's snapshot).

import type { GenerationSummary } from "./repository.js";

/** A Generation's live progress (issue #44): kept in memory only, never persisted, so it's always a separate, higher-frequency event from "change". */
export interface GenerationProgress {
  generationId: string;
  elapsedMs: number;
  /** The median of the last 10 successes for this Model/Mode/Backend, or `null` without enough history (indeterminate). */
  estimateMs: number | null;
  step: number | null;
  totalSteps: number | null;
}

export type GenerationEvent =
  | { type: "change"; generation: GenerationSummary }
  | { type: "progress"; progress: GenerationProgress };

export class GenerationEvents {
  private readonly subscribers = new Map<
    string,
    Set<(event: GenerationEvent) => void>
  >();

  subscribe(
    userId: string,
    listener: (event: GenerationEvent) => void,
  ): () => void {
    let listeners = this.subscribers.get(userId);
    if (!listeners) {
      listeners = new Set();
      this.subscribers.set(userId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.subscribers.delete(userId);
    };
  }

  publish(userId: string, event: GenerationEvent): void {
    for (const listener of this.subscribers.get(userId) ?? []) {
      listener(event);
    }
  }
}
