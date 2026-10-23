/**
 * The seven Problem codes from issue #70. Each one is reported by whichever
 * module owns the underlying check (DB pool, Backend monitor, dispatcher,
 * disk watcher, Pause state) — this package only tracks delay thresholds,
 * Pause suppression and self-clearing; it has no knowledge of Models,
 * Backends or Generations itself.
 */
export type ProblemCode =
  | "db_unreachable"
  | "model_without_backend"
  | "backend_unreachable"
  | "backend_failing"
  | "disk_low"
  | "job_failed"
  | "generating_paused";

/** How long a condition must hold continuously before it becomes a visible Problem. */
export const PROBLEM_DELAY_MS: Record<ProblemCode, number> = {
  db_unreachable: 0,
  model_without_backend: 5 * 60_000,
  backend_unreachable: 5 * 60_000,
  backend_failing: 0,
  disk_low: 0,
  job_failed: 0,
  generating_paused: 4 * 60 * 60_000,
};

/** Problem codes hidden from `list()` while generating is Paused. */
export const SUPPRESSED_WHILE_PAUSED: ReadonlySet<ProblemCode> = new Set([
  "db_unreachable",
  "model_without_backend",
]);

export interface Problem {
  code: ProblemCode;
  message: string;
  target: string;
  since: Date;
}
