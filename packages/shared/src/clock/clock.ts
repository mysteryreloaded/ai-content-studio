/**
 * ADR 0006: every module reads time from one injected clock instead of
 * calling `Date.now()`/`setTimeout` directly, so tests can advance time
 * without sleeping and production always uses the real clock.
 */
export interface Clock {
  now(): Date;
  setTimeout(callback: () => void, ms: number): Timer;
  clearTimeout(timer: Timer): void;
}

export type Timer = ReturnType<typeof setTimeout>;

export const systemClock: Clock = {
  now: () => new Date(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};
