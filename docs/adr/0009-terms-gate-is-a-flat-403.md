---
status: accepted
---

# The Site terms gate is a flat 403 `terms_required`, with a short, explicit exemption list

Every route already declares an access level, one of which is "active with Site terms accepted". We decided that level is enforced as a flat `403 { "error": "terms_required" }` from the same middleware that resolves session role and status, on every route except a short, explicit exemption list: reading and accepting the current Site terms, the current user, sign-out, account delete, `/privacy`, `/terms`, and the public landing data. Admins are not exempt: an Admin who hasn't accepted the current version, including right after a re-ask, gets the same 403 on everything else, admin panel included, until they accept.

The guard test's matrix gains a fourth caller alongside anonymous, Admin and (now renamed for clarity) active-with-terms: **active without terms**, an active user signed in but not yet accepting the current version. A route that isn't on the exemption list and doesn't 403 that caller fails the test, the same way a route with no declared access level already fails it.

## Considered Options

- **Redirect (302) to a terms page.** Works for full-page navigation, but the SPA's API calls and fetches aren't navigations; a redirect response to `fetch` doesn't show the user anything, so the gate would need a second, client-side mechanism anyway.
- **Enforce the gate only in the SPA router, client-side.** The server routes stay reachable directly, and the gate is a trust boundary that must hold even without the SPA in front of it.

## Consequences

- The exemption list is a short, explicit set of routes in code, not a path prefix; a new route defaults to gated, and a reviewer must opt it out deliberately.
- `/terms` and `/privacy` must render fully signed out, so neither can depend on session-derived data beyond what the public landing endpoint already exposes.
- Account delete and sign-out stay reachable without accepting a changed version, so a user who refuses new terms can still leave.
- The client treats `terms_required` as a global interrupt, the same shape as a pending or disabled response, and shows the gate instead of whatever page was requested.
