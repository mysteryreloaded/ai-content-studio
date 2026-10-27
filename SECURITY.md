# Security policy

## Supported versions

The current `main` branch and the latest published release (on GHCR,
`ghcr.io/mysteryreloaded/ai-content-studio` — the package page on the
[repository](https://github.com/mysteryreloaded/ai-content-studio) lists
every published version) are supported. Older published versions are not — but a vulnerability
that affects them is still worth reporting, and a fixed release will be
cut when it matters.

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Use GitHub's
private vulnerability reporting instead:

<https://github.com/mysteryreloaded/ai-content-studio/security/advisories/new>

If private reporting is not enabled for this repository yet, email the
maintainers through the [contact in the repository
description](https://github.com/mysteryreloaded/ai-content-studio) and
mark the subject `Security:`; we will move the discussion to a private
channel.

A useful report says:

- the version (or commit) affected,
- which of the app's surfaces is involved (the API, the admin panel,
  Uploads/Assets, the Backend connection, the Compose/Caddy layer),
- the shortest path from an action a user or Admin can take to the
  impact, and
- whether a signed-in user, an Admin or a signed-out visitor can reach it.

We aim to acknowledge a report within a few working days and to fix and
publish a release within a reasonable time after that, with a public
advisory that credits the reporter when they want one.

## What counts (and what doesn't)

Count: a way to read or change data that isn't yours (another user's
Uploads, Assets, prompts, Audit or Log entries), to break the app's
authorization boundaries (a non-Admin acting on an admin route, a pending
or disabled user acting as active), to forge or escape a session, to
bypass the validation that keeps a prompt or a file out of a Workflow, or
to reach a Backend or the database directly from outside the private
network.

Doesn't count: content a user chose to submit (the app shows users their
own prompts and files by design), an Operator misconfiguring their own
instance (a public ComfyUI, a shared `SECRET_KEY`, a `STATUS_TOKEN`
leaked), or a limit the spec lists as out of scope — there is no rate
limiting and no studio-side classifier by design.

## The surfaces an Operator should protect themselves

The app is deliberately plain about where trust lives, and the list below
is what [docs/ops/deploy.md](docs/ops/deploy.md) and
[docs/ops/backend-kit.md](docs/ops/backend-kit.md) build around:

- `SECRET_KEY` signs the session cookie and encrypts stored Backend
  credentials — it must stay out of every file, image and log.
- Backends live on a private network and are never exposed; ComfyUI's
  own HTTP has no auth, so the network in front of it (or a proxy that
  adds one) is the boundary.
- The session cookie is `__Host-session`: `HttpOnly`, `Secure`,
  `SameSite=Lax`, and every non-GET/HEAD request must be
  same-origin — there is no second line of defence against a stolen
  cookie, only against a cross-site one.
- Everything a user uploads or a Generation produces is stored on the
  Operator's own volume, encrypted only as far as the Operator's backups
  and disks are.
