import type { Clock, Timer } from "./clock.js";

interface ScheduledCallback {
  id: number;
  dueAt: number;
  callback: () => void;
}

/**
 * A clock tests advance explicitly with `advance(ms)`, firing any due
 * callbacks in the order they come due. No real time ever passes.
 */
export class FakeClock implements Clock {
  private currentMs: number;
  private scheduled: ScheduledCallback[] = [];
  private nextId = 1;

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  setTimeout(callback: () => void, ms: number): Timer {
    const id = this.nextId++;
    this.scheduled.push({ id, dueAt: this.currentMs + ms, callback });
    return id as unknown as Timer;
  }

  clearTimeout(timer: Timer): void {
    const id = timer as unknown as number;
    this.scheduled = this.scheduled.filter((entry) => entry.id !== id);
  }

  /** Moves time forward by `ms`, running any callbacks that come due. */
  advance(ms: number): void {
    const target = this.currentMs + ms;
    while (true) {
      const due = this.scheduled
        .filter((entry) => entry.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt)[0];
      if (!due) break;
      this.scheduled = this.scheduled.filter((entry) => entry.id !== due.id);
      this.currentMs = due.dueAt;
      due.callback();
    }
    this.currentMs = target;
  }
}
