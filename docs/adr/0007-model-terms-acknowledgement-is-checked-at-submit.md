---
status: accepted
---

# Model terms acknowledgement is checked at Submission time, not on every view

A Model's terms are scoped to that one Model, unlike Site terms, which gate the whole studio. We decided a user's acknowledgement is stored as one row per user, Model and version, never overwritten or deleted, so the full history survives a later re-ask. The blocking dialog opens the first time a user opens a Model with terms and again whenever the version they last acknowledged isn't the Model's current one, but the authoritative check happens when a Submission is created: it looks up the signed-in user's latest acknowledgement for that Model and, if its version isn't current, refuses with `model_terms_required` and reopens the dialog. This closes the gap where the version changes between opening the Model and pressing Generate.

A Model's version works the way a Site terms version does: set when the terms are first written, and bumped on any save that ticks "Ask everyone to accept again"; a quiet edit (fixing a typo, swapping the license link) keeps existing acknowledgements.

The check never reaches backward. A Generation that is already queued or under way keeps running after its Model's terms gain a new version; only the next Submission is asked.

## Considered Options

- **Gate every route that touches a Model**, the way the Site terms gate covers the whole studio. Rejected: most routes (the Models home, a Backend's admin page) don't put the user in a position to use the Model, so blocking there would interrupt browsing for no reason. The one moment that matters is Generate.
- **Re-validate queued and in-flight Generations against the current Model terms version.** Rejected: a Generation runs with the Model revision current when it was submitted (see the Model revision entry in `CONTEXT.md`), and terms acknowledgement follows the same rule — what the user agreed to at submit time is what the Generation ran under.

## Consequences

- The acknowledgements table is keyed by (user, Model, version); an Admin's "Ask everyone to accept again" never deletes a row, it only moves which version is current.
- Attribution is not part of this gate: it is never acknowledged and never blocks a Submission, only shown.
