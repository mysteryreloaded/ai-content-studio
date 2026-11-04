import type { PillTone } from "../../../components/generations/stateLabel.js";
import type { TestRun } from "../types.js";
export function sortedTestRuns(runs: TestRun[]): TestRun[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  return [...byId.values()]
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
    .slice(0, 5);
}
export function testRunStateLabel(run: TestRun): string {
  switch (run.state) {
    case "queued":
      return "Queued";
    case "starting":
      return "Starting…";
    case "running":
      return "Running…";
    case "saving":
      return "Saving…";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelling":
      return "Cancelling…";
    case "cancelled":
      return "Cancelled";
    default:
      return run.state;
  }
}
export const TEST_UNFINISHED_STATES = new Set([
  "queued",
  "starting",
  "running",
  "saving",
  "cancelling",
]);

/** The state pill's tone (issue #259), alongside `testRunStateLabel`'s own wording. */
export function testRunPillTone(run: TestRun): PillTone {
  switch (run.state) {
    case "succeeded":
      return "ok";
    case "failed":
      return "err";
    case "cancelling":
    case "cancelled":
      return "warn";
    case "starting":
    case "running":
    case "saving":
      return "accent";
    default:
      return "neutral";
  }
}
