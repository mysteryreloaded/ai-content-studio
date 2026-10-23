---
status: accepted
---

# Site settings images live on local disk, not in Postgres

The Site settings' logo (also the favicon) and background image are small (≤ 1 MB, ≤ 5 MB), rare to change, and served on every page, including signed out. We decided they are written to `/data` through one `storage` module (write, read, stat, delete) rather than as Postgres `bytea` columns, and the Site settings row keeps only each image's key, content hash and size; the Audit entry for a save records the same three fields instead of the bytes.

The deciding reason is that Postgres already carries the Generations queue and must stay small enough to back up and restore quickly; bytes that never need a transaction don't belong in it. A local-disk module also matches where Uploads and Assets will live later, so the studio gets one place that knows how to write, stat and delete a file on `/data`, instead of growing a second one.

## Considered Options

- **Postgres `bytea`.** Simplest to keep transactional with the Audit entry, but bloats `pg_dump`/WAL for files that change rarely, and every request serving the logo or background would round-trip through Postgres instead of the filesystem or a static-file response.
- **Object storage (S3-compatible).** Right fit for a multi-machine deployment, wrong fit for a single self-hosted VPS: it adds a dependency, credentials and egress to configure before the studio can show its own logo.

## Consequences

- `/data` must be on a volume the Operator backs up; the docs say so next to the Postgres backup instructions.
- Saving new branding writes the file before the database row, and deletes the file the old key pointed to only after the transaction that replaces it commits, so a crash mid-save never leaves the Site settings pointing at a missing file.
- Uploads and Assets (not yet built) are expected to reuse the same `storage` module rather than invent a second way to touch `/data`.
- The old file is deleted once that commit lands, so an older Audit entry's image key may no longer resolve on disk; only its hash and size can still be trusted to describe what was there.
