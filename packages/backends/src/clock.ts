// ADR 0006: every module reads time from one injected clock; production uses
// the real clock, tests advance a fake one instead of sleeping.

export interface Clock {
  now(): Date;
  /** Schedules `fn` to run every `ms`; returns a function that cancels it. */
  setInterval(fn: () => void, ms: number): () => void;
}

export function realClock(): Clock {
  return {
    now: () => new Date(),
    setInterval(fn, ms) {
      const id = setInterval(fn, ms);
      return () => clearInterval(id);
    },
  };
}

export function fakeClock(start = new Date("2026-01-01T00:00:00Z")): Clock & {
  advance(ms: number): void;
} {
  let current = start;
  const timers: { fn: () => void; interval: number; next: number }[] = [];

  return {
    now: () => current,
    setInterval(fn, ms) {
      const timer = { fn, interval: ms, next: ms };
      timers.push(timer);
      return () => {
        const i = timers.indexOf(timer);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    advance(ms: number) {
      const target = current.getTime() + ms;
      while (true) {
        let soonest = Infinity;
        for (const t of timers) if (t.next < soonest) soonest = t.next;
        if (soonest === Infinity || current.getTime() + soonest > target) break;
        current = new Date(current.getTime() + soonest);
        const due = timers.filter((t) => t.next === soonest);
        for (const t of timers) t.next -= soonest;
        for (const t of due) {
          t.next = t.interval;
          t.fn();
        }
      }
      current = new Date(target);
    },
  };
}
