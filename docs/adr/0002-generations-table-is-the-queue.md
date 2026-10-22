# The Generations table is the queue

The studio does not do generation work itself; Backends do, one Generation at a time. So instead of a job-queue library, the Generations table is the queue: its states are the queue states, and a single dispatcher in the one Bun process claims work with one query that joins queued Generations to free Backends of their Model while honouring the per-user caps. A Postgres advisory lock keeps a second instance from dispatching.

## Considered Options

- **pg-boss** (the only Postgres-only queue with CI-tested Bun support): rejected because it has no notion of Backends. Handlers would have to lease a Backend from inside a job, per-user cap overrides would need tiers fixed at `work()` time or an extra app-level gate, and adding a Backend in the admin panel would mean restarting workers with new concurrency. A Generation's state would then live in two places, the job and the row.
- **A separate worker process**: rejected for v1. It needs NOTIFY fan-out for progress, and one process comfortably handles ~10k web requests a day.

## Consequences

Retries, lost-try detection, cancellation and restart recovery are studio code, reconciled against each Backend's `/api/jobs`.
