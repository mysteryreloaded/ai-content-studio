// Problems (glossary: CONTEXT.md): conditions the studio reports to
// Admins and to the Operator's outside monitor (issue #70). Held in
// memory only and self-clearing — nobody acknowledges or closes one.

/**
 * `model_without_backend`, `backend_failing`, `job_failed` and
 * `generating_paused` need Models, Generations and Pause, none of which
 * exist yet (issues #40-#58, #59). Their codes are defined here so
 * `/api/status` and the Overview already have a place to show them, but
 * nothing in this codebase raises them yet.
 */
export type ProblemCode =
  | "db_unreachable"
  | "model_without_backend"
  | "backend_unreachable"
  | "backend_failing"
  | "disk_low"
  | "job_failed"
  | "generating_paused";

export interface Problem {
  code: ProblemCode;
  message: string;
  /** What the Problem is about (a Backend id, a Model id, ...), or `null` for a studio-wide one. */
  target: string | null;
  since: Date;
}

function keyFor(code: ProblemCode, target: string | null): string {
  return `${code}:${target ?? ""}`;
}

/**
 * Tracks the Problems currently active. `set` is idempotent: calling it
 * again for the same code+target keeps the original `since`. `clear`
 * removes one the moment its condition ends.
 */
export class ProblemsRegistry {
  private readonly active = new Map<string, Problem>();

  constructor(private readonly now: () => Date) {}

  set(code: ProblemCode, target: string | null, message: string): void {
    const key = keyFor(code, target);
    const existing = this.active.get(key);
    this.active.set(key, {
      code,
      target,
      message,
      since: existing?.since ?? this.now(),
    });
  }

  clear(code: ProblemCode, target: string | null): void {
    this.active.delete(keyFor(code, target));
  }

  /** Clears every active Problem with this code whose target isn't in `keepTargets`. */
  clearStaleTargets(code: ProblemCode, keepTargets: Set<string>): void {
    const stale = [...this.active.values()].filter(
      (problem) =>
        problem.code === code &&
        problem.target !== null &&
        !keepTargets.has(problem.target),
    );
    for (const problem of stale) this.clear(code, problem.target);
  }

  list(): Problem[] {
    return [...this.active.values()].sort(
      (a, b) => a.since.getTime() - b.since.getTime(),
    );
  }
}
