---
status: proposed
---

# Generation detail needs an `endedAt` column, and a tombstone needs a `deletedAt` flag rather than nulling frozen columns

Issue #57 (the Generation detail dialog, "Reuse these settings" and delete) needs two facts the `generations` table doesn't carry yet.

**Run time.** The AC asks the detail dialog to show "submitted time and run time." `generations` (db/schema.ts) has `submittedAt`, `queuedAt` and `startedAt`, but nothing for when a Generation *ended* — `succeeded`, `failed` or `cancelled` is a state transition recorded nowhere with a timestamp. We'll add `endedAt` (nullable timestamp), written once, by whichever code moves a Generation into one of those three terminal states (today that's `dispatch/` and `generations/cancellation.ts`). Run time is `endedAt - startedAt` when both are set, blank otherwise (a Generation that failed before starting has no run time).

**Tombstones.** A Tombstone (CONTEXT.md) keeps "the owner, Model, Mode, state and times" after a user deletes a Generation or Submission, and still counts toward the daily Cap. `generations.builtPrompt` and `nodeTypes` are `NOT NULL` (builtPrompt is the frozen prompt; nodeTypes its distinct node classes), and `uploadIds` defaults to `'{}'` but is also `NOT NULL`. A Tombstone has none of these left to show, so rather than relax three columns' nullability and teach every reader of `generations` to handle null `builtPrompt`, we add a single `deletedAt` (nullable timestamp) and, once set, clear `builtPrompt` to `{}`, `nodeTypes` to `[]` and `uploadIds` to `[]` in the same statement — the columns stay `NOT NULL`, and "is this a Tombstone" is one `deletedAt is not null` check, the same shape as `models.deletedAt`. `assets` rows for a deleted Generation are deleted outright (cascade already exists via `onDelete: "cascade"` on `assets.generationId`); an Upload is deleted only once no other, non-deleted Generation of this user still references its id in `uploadIds` — checked before clearing, not after, since clearing is what would make it look unused.

Caps (`generations/caps.ts`) already counts by `generations` rows filtered on state and `submittedAt`/`queuedAt`, not by the presence of `builtPrompt` or assets, so a Tombstone keeps counting toward the daily Cap for free once `deletedAt` is added — no change needed there.

## Considered Options

- **A separate `generation_tombstones` table**, written at delete time and read back by the Gallery/caps instead of `generations`. Rejected: it would duplicate the owner/Model/Mode/state/time columns `generations` already has, and every query that currently reads `generations` (Gallery, caps, the SSE stream) would need a second table unioned in.
- **Soft-deleting by nulling `builtPrompt`/`nodeTypes` without a dedicated flag**, treating "null builtPrompt" as the Tombstone marker. Rejected: `builtPrompt` is `NOT NULL` today for a reason (it's always written at insert, same transaction as the row), and reusing its nullability as the delete flag conflates "never had a prompt" (can't happen) with "had one, now gone," which is harder to reason about than one boolean-shaped timestamp column.

## Consequences

- A migration adds `generations.ended_at timestamp with time zone` and `generations.deleted_at timestamp with time zone`, both nullable.
- `dispatch/` and `generations/cancellation.ts` gain one more column to set alongside each terminal-state write; `toRecord`/`GenerationRecord` (repository.ts) gain `endedAt` and `deletedAt`.
- The Gallery and detail queries filter or display around `deletedAt` the same way they already do around `models.deletedAt`.
- `GenerationsRepository` gains the delete methods (`deleteGeneration`, `deleteSubmission`, a Workbench "delete all") that set `deletedAt` and clear `builtPrompt`/`nodeTypes`/`uploadIds` in one update, then sweep now-unreferenced Uploads.
