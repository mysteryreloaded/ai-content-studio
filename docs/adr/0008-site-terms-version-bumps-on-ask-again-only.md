---
status: accepted
---

# Site terms version bumps only on first set, or on "ask everyone to accept again"

The Site settings keep one current Site terms text and a version number the gate checks acceptances against. A save can reword the terms for clarity (a quiet edit) or because the Operator wants every user to review and accept them again. We decided only two things bump the version: setting the Site terms for the first time, and any save that ticks "Ask everyone to accept again"; a quiet edit keeps the version number, and every acceptance already on file for it stays valid. There is no separate Site terms version-history table: the Audit entry for each save keeps the full text and the "ask again" flag inline, so past wording stays recoverable from the Audit trail, which is already append-only forever (ADR 0005), without a second table to keep in sync with it.

## Considered Options

- **A dedicated `site_terms_versions` table**, one row per version. Gives a clean list to browse, but duplicates what the Audit entry's before/after text already records on every save, and Audit entries can't be edited or deleted, so the duplication can drift in nobody's favour.
- **Version on every save, no quiet-edit distinction.** Simplest rule, but a typo fix would force every user, Admins included, to click through the gate again for wording that didn't actually change in substance.

## Consequences

- Site settings carries `terms_text`, `terms_version` (an integer; null/0 means no terms are set, so there is no gate), and `terms_version_set_at`, the date `/terms` shows.
- A user's acceptance records the version they accepted; the gate compares it to Site settings' current `terms_version`, never to the text itself.
- Blanking the Site terms removes the gate. Setting it again counts as setting it the first time: a new version, and everyone is asked again, since there is no prior version left to quietly edit.
