---
status: accepted
---

# Pending is a route guard like the terms gate; one guard rule covers self and pinned Admins

#62 asks for pending sign-up, a Users page and three role/status actions (approve, promote, demote), each hidden for pinned Admins and for the acting Admin's own row, with nobody changing their own role or status. #60 (Site terms gate, still open) already adds a guard that returns everything except a short allowlist of routes until the user accepts the current Site terms. We decided pending reuses that shape instead of inventing a second one: a middleware guard that, for a pending user, serves the waiting page (contact, sign-out) for every route except the same allowlist #60 defines for "terms required" — the current user, sign-out, account delete, `/privacy`, `/terms` and the public landing data — plus terms acceptance itself, since a user must pass the terms gate before the pending guard is reached. The route access matrix gets a new row, "pending", next to "active without terms"; #64 adds "disabled" the same way.

Approve, promote and demote are three separate writes, not one "set role and status" endpoint: approve moves `status` from `pending` to `active`; promote moves `role` from `user` to `admin` (only available once `status` is `active` — a pending user is approved before they can be promoted, two clicks and two Audit entries, not one); demote moves `role` from `admin` back to `user`. Each is its own route, its own Audit entry (ADR 0005's shape: role, status, before and after), and its own guard check, so the three don't share a brittle combined precondition.

That guard check is one function, not three copies: an action on a target user is refused (404, not 403, so the row's existence isn't leaked past what the page already shows) when the target is the acting Admin themselves, or when the target is pinned (listed in `ADMIN_EMAILS`). The admin panel calls the same function to decide whether to render the button at all, so "hidden" and "refused" can't drift apart. Unpinning on an `ADMIN_EMAILS` edit is a read-time fact, not a write: pinned is "is this user's email in the current `ADMIN_EMAILS`", computed fresh on every page load and every guard check, never stored. Removing an email from the list makes that Admin unpinned immediately, with no Audit entry of its own (nothing changed about the user, only about the Operator's configuration, which Audit entries don't cover) and no change to their `role`; they stay an Admin until a (now-possible) demote.

## Considered Options

- **A `role`/`status` combined "set user state" endpoint.** Fewer routes, but it needs a transition table to reject invalid combinations (pending Admin, promote-and-demote-at-once) and blurs the one-action-one-Audit-entry rule ADR 0005 relies on.
- **Store `pinned` as a column, set on the promote that creates an Admin named in `ADMIN_EMAILS`.** Avoids recomputing it on every request, but it would go stale the moment an Operator edits the env var without a deploy that re-syncs it, which is exactly the bug #62 calls out ("removing an email unpins without demoting").
- **403 for pending, matching #60's terms gate exactly.** Consistent with the existing contract, but the issue asks for a waiting page a pending user actually reads (contact, sign-out), not an error response; a 403 would need a client-side page anyway, so the guard renders the waiting page directly instead of round-tripping through an error.

## Consequences

- The route access matrix (started by #60, extended here and by #64) is the one place that lists every guard row; a new user state means a new row there before it means new middleware.
- A pinned Admin who is also the only Admin left can still sign out or delete their own account (those are on the "self" allowlist every user has, not an admin-panel action), so pinning never locks an Operator out of their own instance.
- Promote requires `active`, so the Users page shows Promote only once a pending user has been approved; there's no path from pending straight to Admin.
- Because pinned is read live from `ADMIN_EMAILS`, an Operator who wants to retire an Admin fully still takes two steps on purpose: edit the env var (unpin), then demote (or disable) from the now-unlocked Users page.
