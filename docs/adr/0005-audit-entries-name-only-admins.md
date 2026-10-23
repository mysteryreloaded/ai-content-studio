---
status: accepted
---

# Audit entries name only Admins

Audit entries are append-only and kept forever, and they were first specified to record every actor and target "as it was", email included. That meant a user who deleted their account left their email behind in every Audit entry about them (approval, disable, Cap override, delete), and their IP address and user agent in the entry for the self-delete itself. It also undercut the sign-in decision to keep only a SHA-256 of a deleted, disabled user's Google `sub`. We decided Audit entries name Admins and nobody else. An entry whose target is a user who isn't an Admin keeps that user's id and only the fields Admins control (role, status, Caps, disable reason), and shows the name live from the users table, so it reads "Deleted user" once the account is gone. A self-delete by a user who isn't an Admin records the actor by id, with no IP address or user agent. Admin actors keep their email, IP address and user agent, because accountability for Admin actions is what the Audit trail is for.

## Considered Options

- **Keep the original shape and disclose it** in the Privacy policy. Simple, but "delete my account" would not be true, and the blocked-account hash would protect nothing.
- **Pseudonymise after N years** through a sanctioned exception to the append-only trigger. Adds a carve-out to the one table that must never change, for a weaker result.

## Consequences

- An Admin looking back at a deleted user sees only an id. When evidence matters, they leave the user disabled instead of deleting them.
- The blocked-accounts list on the Users page shows the id, when the account was disabled and deleted, and the Admin-written disable reason, which is kept on the deleted row. The reason field warns Admins not to put the person's name or email in it.
- A user who was once an Admin keeps their email, IP address and user agent in the entries for actions they took as an Admin. The Privacy policy says so.
