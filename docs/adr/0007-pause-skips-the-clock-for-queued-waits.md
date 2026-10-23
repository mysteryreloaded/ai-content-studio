---
status: accepted
---

# A Pause skips the clock for queued waits, instead of tracking paused seconds

A queued Generation with no usable Backend for its Mode must fail after 15 minutes (#55), but a Pause must never be the reason it fails (#59): the 15-minute wait counts only unpaused time. Nothing else that is time-based needs this treatment — `starting`'s 10 minutes, a Model's max run time, and "unreachable for 2 minutes while running" all belong to a try already under way, and a Pause lets those finish rather than touching them. A try lost while Paused still goes back to the queue, still within its 2 tries; losing a try isn't time-based, so Pause changes nothing about how tries are counted.

We decided a Pause **shifts the reference time forward** rather than accumulating a separate "paused seconds" counter per Generation. On Resume, one query advances the `queued_at` (or whichever timestamp the wait is measured from, per #55's own resolution) of every still-queued Generation by the Pause's duration, for rows whose wait started before the Pause did; a Generation queued during the Pause already has a `queued_at` no earlier than the Pause, so it needs no adjustment. The 15-minute check stays the plain `$now - queued_at > 15 minutes` that ADR 0006 already calls for, with `$now` from the injected clock — no extra column to carry, read or test.

## Considered Options

- **Accumulate paused seconds.** Add a running total of time spent Paused while a Generation was queued, and subtract it from elapsed time in the 15-minute check. Correct, but means a new column, updating it live (not just at Resume) for Generations that start waiting mid-Pause, and a query that's no longer a plain timestamp comparison.
- **Exempt Generations from the wait entirely while Paused, and restart the clock on Resume.** Simpler, but throws away however much of the 15 minutes a Generation had already waited before the Pause began, so a Generation paused twice in a row could wait far longer than 15 minutes of real unpaused time before failing — the acceptance criterion asks for exactly 15 minutes of unpaused waiting, not "at least."

## Consequences

- Resume does one bulk `UPDATE` before the dispatcher wakes test and real Generations alike; a long Pause costs one write, not one per Generation per Pause.
- The 15-minute deadline, Problems (`model_without_backend`) and any future unpaused-time rule can all reuse this same shift instead of inventing their own accounting, as long as they're anchored to a stored timestamp rather than a counter.
- `starting`, `running` and `saving` timeouts are untouched by Resume's shift; only rows still `queued` move.
- The exact column the 15-minute wait reads is #55's to name; this ADR only fixes how Pause must not count against it.
