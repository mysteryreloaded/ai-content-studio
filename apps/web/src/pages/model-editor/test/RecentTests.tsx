import { Link } from "react-router-dom";
import { ago } from "../../../components/generations/stateLabel.js";
import { Pill } from "../../../components/ui/pill.js";
import { testRunPillTone, testRunStateLabel } from "../helpers/testRuns.js";
import type { TestRun } from "../types.js";

/** The last 5 Tests (issue #74/#259's AC), newest first; persisted server-side, so they're here on return too. */
export function RecentTests({ runs }: { runs: TestRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground">No tests run yet for this Model.</p>
    );
  }

  const now = new Date();

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Last 5 tests
      </h3>
      <ul className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        {runs.map((run) => (
          <li
            key={run.id}
            className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
          >
            <span className="font-medium">{run.modeName}</span>
            <Pill tone={testRunPillTone(run)}>{testRunStateLabel(run)}</Pill>
            <span className="text-muted-foreground">
              {ago(run.submittedAt, now)}
            </span>
            <span className="min-w-0 flex-1" />
            <Link
              to={`/admin/generations/${run.id}`}
              className="text-primary underline"
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
