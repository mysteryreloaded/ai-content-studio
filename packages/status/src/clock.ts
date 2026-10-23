// ADR 0006: every module reads time from one injected clock; production uses
// the real clock, tests advance a fake one instead of sleeping.

export interface Clock {
  now(): Date;
}

export function realClock(): Clock {
  return { now: () => new Date() };
}

export function fakeClock(start = new Date("2026-01-01T00:00:00Z")): Clock & {
  advance(ms: number): void;
} {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}
