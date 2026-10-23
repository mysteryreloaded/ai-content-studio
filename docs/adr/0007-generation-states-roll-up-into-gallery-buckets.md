---
status: accepted
---

# Generation states roll up into the Gallery's three state buckets

The Gallery filters by state as one of four choices: All, Under way, Finished, Failed or cancelled. We decided a Generation's own state is one of six values — `queued`, `starting`, `running`, `succeeded`, `failed`, `cancelled` — and the Gallery filter groups them without a separate rollup column: Under way is `queued`, `starting` or `running`; Finished is `succeeded`; Failed or cancelled is `failed` or `cancelled`. Per #56, a Submission matches a state filter when any of its Generations does, so no Submission-level state is stored or computed server-side beyond the Generations themselves.

## Considered Options

- **A stored Submission-level status column**, recomputed on every Generation state change. Rejected: it duplicates the Generations table (the queue, per ADR 0002) and needs updating on every transition, for a value the Gallery can derive with a join.
- **Collapsing to three Generation states** (under way / finished / failed-or-cancelled) instead of six. Rejected: the dispatcher (ADR 0002) and the "lost try" and "starting" timeouts (ADR 0006) need the finer states; the Gallery is the only place that buckets them this way.

## Consequences

- The Gallery's query filters Generations by the chosen bucket's states and groups by `submission_id`, rather than filtering a Submission table directly.
- A later feature needing a Submission-level state (for example a Workbench summary) defines its own rollup rule; this ADR only settles the Gallery's.
