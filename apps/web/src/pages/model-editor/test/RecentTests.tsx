import { useState } from "react";
import {
  TEST_UNFINISHED_STATES,
  testRunStateLabel,
} from "../helpers/testRuns.js";
import type { TestRun } from "../types.js";

/** Inline progress for one Test, with Cancel while it's still under way (issue #74's AC). */
export function TestRunRow({ run }: { run: TestRun }) {
  const [cancelling, setCancelling] = useState(false);
  const unfinished = TEST_UNFINISHED_STATES.has(run.state);

  async function handleCancel() {
    setCancelling(true);
    try {
      await fetch(`/api/submissions/${run.submissionId}/cancel`, {
        method: "POST",
      });
    } finally {
      setCancelling(false);
    }
  }

  return (
    <li>
      {run.modeName}: {testRunStateLabel(run)}
      {run.state === "failed" && run.error && <span> — {run.error}</span>}
      {run.state === "succeeded" && run.assets.length > 0 && (
        <a href={`/api/assets/${run.assets[0]?.id}`}> View</a>
      )}
      {unfinished && (
        <button
          type="button"
          disabled={cancelling || run.state === "cancelling"}
          onClick={() => void handleCancel()}
        >
          Cancel
        </button>
      )}
    </li>
  );
}

/** The last 5 Tests (issue #74's AC), newest first; persisted server-side, so they're here on return too. */
export function RecentTests({ runs }: { runs: TestRun[] }) {
  return (
    <section aria-label="Recent tests">
      <h4>Last 5 tests</h4>
      <ul>
        {runs.map((run) => (
          <TestRunRow key={run.id} run={run} />
        ))}
      </ul>
    </section>
  );
}
