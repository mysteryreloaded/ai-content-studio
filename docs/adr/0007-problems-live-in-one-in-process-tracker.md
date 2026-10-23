---
status: accepted
---

# Problems live in one in-process tracker, not Postgres

The Overview and `GET /api/status` (issue #70) both need the same list of
current Problems. Problems are inherently transient — they describe *now*,
not history — and the glossary already says they "clear themselves" and that
"nobody acknowledges or closes" one.

We decided to hold them in a single `ProblemsTracker` per process
(`packages/status`), keyed by `(code, target)`, fed by whichever module owns
the underlying check (the DB pool, each Backend's monitor, the dispatcher,
the disk watcher, the Pause state). Each delayed code's threshold
(`model_without_backend` and `backend_unreachable` at 5 min,
`generating_paused` at 4 h) is read from the clock injected per ADR 0006, not
`setTimeout`, so tests advance it instead of sleeping. A Problem is simply
absent from `list()` the instant the owning module reports its condition
false — there is no row to delete and no history to prune.

## Considered Options

- **A `problems` Postgres table**, upserted and deleted by the owning
  modules. Rejected: it adds a durability guarantee ("Problems survive a
  restart") that the glossary never asks for, and every reader would need to
  filter out rows whose condition has since cleared but whose delete raced
  behind — the in-memory tracker has no such race because report and read go
  through the same object.
- **Each module exposing its own `/health`-style check, combined only at the
  HTTP layer.** Rejected: the 5-minute and 4-hour delays, and the Pause
  suppression of `db_unreachable` / `model_without_backend`, are shared rules
  that would otherwise be duplicated per module.

## Consequences

- A multi-process deployment (more than one app server) would need each
  instance's `/api/status` checked, or the tracker moved behind a shared
  store — out of scope for v1's single Bun process.
- `/api/status` and the Overview's polling both read the same tracker
  instance; nothing re-derives Problems independently.
- `GET /api/status` accepts an Admin session or `Bearer $STATUS_TOKEN`
  (constant-time compared) — the Operator's outside monitor has no Admin
  session, so the token is its only way in. Missing or wrong on both counts
  is a 401, independent of whether there are any Problems.
