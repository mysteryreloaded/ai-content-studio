---
status: accepted
---

# Site settings carries a version; a stale save is refused, not merged

The Site settings are a single row that more than one Admin session can have open for editing at once. We decided the row carries an integer version, the edit form sends back the version it loaded, and a save updates the row only `WHERE version = $loaded`; no match means someone else saved first, so the request gets 409 with "changed by someone else, reload" instead of being applied.

The deciding reason is that Site settings fields (branding, Caps, blocked words, footer links) aren't independently mergeable: an Admin who reloads after a 409 sees the other Admin's whole save, including fields they didn't mean to touch, rather than a silent partial overwrite of fields they did.

## Considered Options

- **Last-write-wins (no version check).** Simplest, but a second Admin's save can silently discard the first Admin's changes to fields neither of them was looking at in that moment.
- **A Postgres row lock held for the edit session.** Needs a held connection or a lease to expire, and blocks a second Admin from even opening the form.
- **Field-by-field merge.** Would need a merge rule per field (lists, images, booleans) for a form small enough that reloading and reapplying is cheap.

## Consequences

- The version bumps on every successful save and is returned with the row, so the edit form always has the version it rendered from.
- The 409 response carries no partial state; the client's only recovery is to reload and reapply its own edits on top of the current row.
- The same `WHERE version = $loaded` pattern is the one to reach for if another admin-edited singleton row needs the same guard later.
