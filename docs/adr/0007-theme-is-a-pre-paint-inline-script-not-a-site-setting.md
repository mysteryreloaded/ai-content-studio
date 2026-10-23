---
status: accepted
---

# Theme is a pre-paint inline script reading local storage, not a Site setting or a cookie

The Theme (System / Light / Dark) is a per-browser display preference, distinct from the Operator's accent colour in Site settings, which every visitor sees the same. We decided the studio's HTML shell inlines a small script, before any stylesheet or framework code loads, that reads the choice from `localStorage`, falls back to the OS preference (`prefers-color-scheme`) when nothing is stored or the choice is "System", and sets a `data-theme` attribute (or class) on the root element synchronously. CSS keys off that attribute. Nothing about the Theme reaches the server: it is not a cookie, not a query parameter, and not part of Site settings or the user's account.

Google's "Sign in with Google" button asset is chosen client-side from the same attribute, so it matches without a server round-trip.

## Considered Options

- **A theme cookie read on the server, so the first response is already themed.** Rejected: it adds a cookie purely for display, which the Privacy policy and "no cookie banner" promise (#25) would then have to explain, for a preference that changes zero behaviour the server cares about.
- **Apply the theme after the page's own script bundle loads.** Rejected: that paints Light first and flips to Dark a moment later, a visible flash, on every navigation.
- **Store the Theme in the account for signed-in users, synced across devices.** Rejected: out of scope for v1, and it would turn a display preference into state the server must serve, migrate and export.

## Consequences

- The Theme is lost if a visitor clears site data or switches browsers; this is accepted, matching how the browser Notifications opt-in and dismissed Notices already behave (local, per-browser).
- The inline script is small enough to repeat on `/`, `/privacy`, `/terms` and the app shell alike, each of which may render independently.
- The Privacy policy's generated section lists "the light/dark choice, dismissed Notices and whether notifications are on" as local storage (already decided for Notifications in #32); this ADR is what makes the Theme part of that same list rather than a server-known setting.
