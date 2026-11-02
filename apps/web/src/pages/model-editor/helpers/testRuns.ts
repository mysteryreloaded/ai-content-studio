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
