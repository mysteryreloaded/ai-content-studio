---
status: accepted
---

# Caps are checked in the transaction that locks the user's row, by counting states

A Submission must be refused whole if it would push either Cap over its limit, and the check must not race another Submission from the same user. We decided both Caps are plain `COUNT(*)` queries over the Generations table, run inside the same transaction that locks the user's row to create the Submission's Generations, taking the injected clock's time as `$now` (per [0006](0006-time-is-injected.md)) rather than Postgres `now()`:

- the daily Cap counts the user's Generations with `submitted_at > $now - 24h`, excluding `failed` and excluding `cancelled` ones that never left `queued`, but including Tombstones;
- the concurrent Cap counts the user's Generations in `queued`, `starting`, `running` or `saving`.

A Generation cancelled after it started running still counts toward the daily Cap: it occupied a Backend, unlike one cancelled while still queued, which cost nothing. The Generation's `cancelled` state therefore has to remember whether it was reached from `queued` or from further along; #55 (reliable dispatch) owns recording that distinction, and the daily-Cap query reads it.

Because the count is taken under the same row lock that creates the Generations (the transaction #47 defines), no second Submission from the same user can slip in between the check and the insert, and the whole Submission is rejected together with no partial set of Generations created.

## Considered Options

- **A denormalized running-count column on the user**, incremented and decremented on every state change. Rejected: every dispatcher transition, retry, cancel and delete would also have to maintain it, and a missed decrement would wedge a user's Cap forever. A `COUNT(*)` under the row lock is one query and cannot drift.
- **Check the Caps outside the transaction, before locking the row.** Rejected: two Submissions racing each other could both pass the check and both get in, since neither held the lock yet.
- **Exclude every cancelled Generation from the daily Cap, regardless of when it was cancelled.** Rejected: a user could run a Generation to completion, decide they don't like paying for it, cancel it after it finishes running (impossible, but the rule would need a carve-out anyway), or more realistically keep resubmitting and cancelling long-running Generations near the end to dodge the Cap while still occupying GPU time.

## Consequences

- The Generations table stays the only source of truth for Caps (per [0002](0002-generations-table-is-the-queue.md)); nothing else needs to be kept in sync.
- `$now` must be passed into the daily-Cap query from the same clock as everything else in [0006](0006-time-is-injected.md), so tests can move the rolling window without sleeping.
- The per-user override (0–1,000, 0 blocks generating) lives as a nullable column on the user row, read in the same locked transaction; editing it is a [#64](https://github.com/mysteryreloaded/ai-content-studio/issues/64) concern, writing it is already covered by Audit entries recording Admin saves to a user.
- The Workbench foot's "N of M left today · K more at once" and next-slot-frees wording is pure client logic, computed from the counts and limits the submit response (and a subsequent fetch) returns; it needs no server state of its own and can be unit-tested without a database.
