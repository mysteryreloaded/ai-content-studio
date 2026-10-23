---
status: accepted
---

# A Removal's Audit entry points at the row; it doesn't snapshot it

Every other Audit entry stores a before/after snapshot of the thing it records, per ADR 0005. A Removal could do the same: snapshot the Generation's values, prompt and Upload links at the moment an Admin removes it, so the evidence survives even if the row later changes. We decided against that. A Removal's Audit entry holds only the Generation's id, owner, Model, Mode and the Admin's reason. The values, prompt and Upload links an Admin needs to review stay on the Generation itself, read-only, for as long as the owner's account exists.

The deciding reason is that the Generation row is not going anywhere: a Removal doesn't delete it, it marks it removed. Snapshotting the row's detail into the Audit entry would duplicate data that is still live and still correct, for no benefit, while adding a second place that detail could drift from. The one case the row's detail does disappear — the owner deletes their account — is already handled: a self-delete (ADR 0005, #63) scrubs the user's Generations and Uploads the same way any of their own deletes would, taking the Removal's evidence down with it. An Audit entry that is kept forever would then be the only place still pointing at detail nobody can see any more, which is exactly the shape ADR 0005 avoided for actors; it would be odd to reintroduce it for targets.

## Considered Options

- **Snapshot values, prompt and Upload links into the Audit entry, as other Audit entries do.** Rejected: it duplicates still-correct, still-visible data on the row, and once the owner's account is deleted it leaves a permanent, unreadable copy in an append-only table — the audit entry would outlive the thing it's evidence for having anything left to check against.
- **Keep the Audit entry minimal, but also freeze a copy of the detail elsewhere (e.g. a moderation archive) past account deletion.** Rejected for v1: no requirement calls for reviewing a Removal's detail after the owner's account is gone, and it would need its own retention and access rules.

## Consequences

- The Admin Generations page's detail view, not the Audit page, is where an Admin reviews what a removed Generation actually contained; the Audit entry only says that it happened, for whom, and why.
- Deleting the owner's account removes the detail a Removal's Audit entry points at, the same way it removes everything else that account's self-delete touches. The Audit entry itself is untouched and keeps reading "Deleted user" per ADR 0005.
- If a future requirement needs Removal evidence to outlive account deletion, it needs its own decision; this ADR only covers v1.
