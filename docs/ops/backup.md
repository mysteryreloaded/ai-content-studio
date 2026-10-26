# Backups, restore and the quarterly drill

Daily encrypted backups of the studio's Postgres database and its
`/data` volume (Uploads and Assets), a restore script, a storage
consistency check, and a drill that proves restore works without ever
touching a production Backend. See [deploy.md](deploy.md) for running
the stack itself.

## Files

- `ops/backup/backup.sh` — the daily backup.
- `ops/backup/restore.sh` — restores a snapshot.
- `ops/backup/backup.env.example` — settings for both scripts.
- `ops/backup/backup.service` + `ops/backup/backup.timer` — systemd
  template running `backup.sh` daily at 03:30, with up to 30 minutes of
  jitter.
- `apps/server/src/storage/check-storage.ts` — shipped in the `studio`
  image; reports (and, with `--fix`, repairs) drift between the
  database and `/data`.

## Setup

1. Copy `ops/backup/backup.env.example` to `backup.env`, next to
   `docker-compose.yml` and `.env` (not left under `ops/backup/`), and
   fill in `RESTIC_REPOSITORY` and `RESTIC_PASSWORD`. Use a real remote
   backend (`s3:...`, `sftp:...`, `b2:...`, `rest:...`) so a snapshot
   survives this host dying; a local path only makes sense if that
   path is itself synced off-host by something else. `BACKUP_PING_URL`
   is optional — a healthchecks.io-style URL backup.sh pings bare on
   success and with `/fail` appended on failure.
2. Initialize the repository once: `docker compose --profile backup run --rm backup init`.
3. Copy `ops/backup/backup.service` and `ops/backup/backup.timer` to
   `/etc/systemd/system/`, point `ExecStart` in `backup.service` at
   this host's `ops/backup/backup.sh`, then
   `systemctl daemon-reload && systemctl enable --now backup.timer`.
4. Run `ops/backup/backup.sh` by hand once to check it works before
   trusting the timer.

## What a backup does

1. `pg_dump -Fc` the database into `.backup-staging/postgres.dump`,
   aborting the whole backup (and pinging `$BACKUP_PING_URL/fail`) if
   the dump fails.
2. Copies `.env` into the same staging directory.
3. Takes one restic snapshot covering `/data` (read-only, via the
   `backup` Compose profile), that dump and `.env` together — so a
   restore never has to reconcile a database from a different moment
   than its files.
4. Prunes to 7 daily and 4 weekly snapshots (`restic forget --prune`).
5. Runs `restic check` on Sundays.

## Restoring

```
ops/backup/restore.sh [snapshot]
```

`snapshot` is a restic snapshot id, or `latest` (the default). This:

1. Stops the `studio` container.
2. Restores `/data` in place and the staged dump + `.env` via the
   `restore` Compose profile (read-write; `backup.sh`'s profile stays
   read-only).
3. Writes the restored config to `.env.restored` — review it (not
   least `BACKENDS_ENABLED`) before copying it over the real `.env`;
   restore.sh never overwrites `.env` itself outside a drill (below).
4. Drops and recreates the database, then `pg_restore`s the dump into it.
5. Starts `studio` again and runs `check-storage` inside it, reporting
   (not fixing) anything still inconsistent.

## The quarterly drill

```
ops/backup/restore.sh [snapshot] --drill
```

Run this **only on a throwaway copy of the stack** — a separate host
or a separate compose project, restoring from the same `backup.env` —
never on the production host. `--drill` forces `BACKENDS_ENABLED=false`
into `.env.restored` and, because this is a drill, copies it straight
over that copy's `.env` before starting `studio`, so the restored copy
never dispatches a Generation to a real GPU Backend. Do this quarterly
to prove the backups are actually restorable, not just that they exist.

## check-storage

```
docker compose exec studio bun run apps/server/src/storage/check-storage.ts [--fix]
```

Compares every storage key the database references (Assets' and
Uploads' `storageKey`/`posterKey`/`thumbnailKey`, and the Site
settings' logo/background) against what's actually under `/data`, and
reports:

- **missing** — the database references a file that isn't there.
- **orphaned** — a file on disk nothing references.

`--fix` deletes orphaned files and tombstones (ADR 0011) any
Generation whose Asset file is missing — the same shape a user's own
delete leaves (owner, Model, Mode, state and times kept; prompt and
Assets cleared). It never touches a missing Upload file: there's no
Tombstone-shaped fix for an Upload, so those are reported only, for a
human to look at.

Exits non-zero when anything is left unresolved, so it's safe to run
after every restore and from a monitor.
