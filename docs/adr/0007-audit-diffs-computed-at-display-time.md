---
status: accepted
---

# Audit diffs are computed at display time, from snapshots

Audit entries store a before and after snapshot of whatever changed, not a diff. We decided the Audit page compares those two snapshots field by field when an Admin opens it, rather than computing and storing a diff at save time. Audit entries are append-only (ADR 0005) and kept forever, so a stored diff would freeze in the renderer's shape as of the save: a later fix to how a field is shown (masking a secret, swapping a Workflow's full graph for its id and hash, adding a field to something Admins control) could only be reflected in rows written afterwards, leaving every earlier entry showing it the old way with no way to correct it short of a migration across an append-only table. Computing the diff live means one code change updates how every entry, past and future, is read.

This does mean the two snapshots must already be safe to keep: a Workflow is written by id and hash, never its full graph, because the Audit page has no original graph to redact or re-fetch later — only what the save put in the snapshot.

A secret field can't be written as just a set/cleared marker: with no value to compare, two "set" snapshots are indistinguishable, so the diff could never tell "set, unchanged" from "set, changed" — exactly the case #39's Backend credentials need (blank keeps the existing value; a non-blank save on an already-set secret is a change). So a secret field is written into the snapshot as whether it's set, plus a revision number that increments only when the value itself changes — never a hash of the secret, which the snapshot must not retain any trace of. Comparing the two snapshots' revision numbers (both set, same number → unchanged; both set, different number → changed) lets the Audit page tell the four states apart without ever holding or deriving the value.

## Considered Options

- **Precompute and store a diff at save time** (an array of `{field, before, after}`). Cheaper to render, but, being append-only, locks in whatever the renderer's field list and masking rules were on the day it was saved.
- **Compute the diff live from snapshots at display time.** Costs a per-target-type rendering table (which fields are secrets, which are a Workflow's id/hash, which — Site terms — are full text with an ask-again flag) instead of one generic JSON diff, but every entry renders under today's rules.
- **Mask a secret as a bare set/cleared flag, with no revision number.** Simplest snapshot, but can't distinguish "set, unchanged" from "set, changed", so the Audit page would show every resave of an already-set secret as unchanged even when the value was replaced.

## Consequences

- Adding a field to something Admins control needs no Audit migration: an entry saved before the field existed just shows it as not set on the earlier side.
- Code that writes a snapshot (Site settings, a Model, a Backend, a user, a Removal) must mask secrets to `{set, rev}`, bumping `rev` only when the value itself changes, and shrink a Workflow to its id and hash, before the snapshot reaches the Audit entry; the Audit page trusts the snapshot and never second-guesses it.
- The Audit page needs that per-target-type rendering table kept in step with what each target actually stores, rather than one generic differ.
