---
status: accepted
---

# A Submission's Generations share one random seed run, made in one locked transaction

A Submission makes 1–4 Generations that differ only by seed. We decided a random seed is one number `s`, drawn below 2^53 (the largest integer JavaScript represents exactly) and no larger than the smallest `max` among the bound Seed field's own bounds, and the Generations take `s, s+1, … s+count-1`. A user-supplied seed is validated the same way: a seed is refused if `s + count - 1` would exceed those bounds. One run of consecutive seeds, rather than `count` independent random draws, is what lets a user reproduce a whole Submission from the one seed shown on its first card.

Creating the Generations happens inside one transaction that locks the submitting user's row (`SELECT … FOR UPDATE`) before inserting all `count` rows with a shared `submission_id` and `submitted_at`. Two presses of Generate from the same user, from two tabs, would otherwise interleave their cap checks and seed draws; locking the user's own row serialises a user's own Submissions without touching any other user's row.

## Considered Options

- **`count` independent random seeds.** Simpler, but a saved seed would reproduce only one card of a Submission, not the whole batch.
- **A Postgres advisory lock keyed by user id**, as the dispatcher already uses for its own singleton lock (ADR 0002). Rejected: it manages a lock Postgres doesn't tie to a visible row, for no benefit over locking the row already being read for Caps.
- **Optimistic insert, then re-check and roll back.** Rejected: more code for a race that a row lock removes outright, and Submissions are rare enough that lock wait time never matters.

## Consequences

- A Model with a Seed Input must give that field a `max` so the studio has a bound to draw under; the Model editor should refuse to enable a Model whose Seed field has no `max`.
- Every Submission insert briefly locks the submitting user's row; this is the natural place to also read and enforce Caps (#53) in the same transaction.
