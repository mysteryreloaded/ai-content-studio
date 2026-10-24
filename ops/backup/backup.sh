#!/usr/bin/env bash
# Daily encrypted backup (issue #77's AC). Run from a host timer at
# 03:30 with jitter (ops/backup/backup.timer); can also be run by hand.
# Dumps Postgres with `pg_dump -Fc`, aborting the whole backup if the
# dump fails, then takes one restic snapshot covering `/data`, that dump
# and `.env`, via the `backup` Compose profile with `/data` mounted
# read-only. Prunes to 7 daily + 4 weekly snapshots, and runs
# `restic check` on Sundays. Settings: backup.env (see
# backup.env.example). Pings $BACKUP_PING_URL on success, and
# "$BACKUP_PING_URL/fail" if anything here fails.
set -euo pipefail

compose_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$compose_dir"

if [[ ! -f docker-compose.yml || ! -f .env || ! -f backup.env ]]; then
	echo "run this from the directory holding docker-compose.yml, .env and backup.env" >&2
	exit 1
fi

# shellcheck disable=SC1091
source .env
# shellcheck disable=SC1091
source backup.env

staging_dir="$compose_dir/.backup-staging"

ping_fail() {
	local status=$?
	if [[ -n "${BACKUP_PING_URL:-}" ]]; then
		curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_PING_URL%/}/fail" || true
	fi
	rm -rf "$staging_dir"
	exit "$status"
}
trap ping_fail ERR

rm -rf "$staging_dir"
mkdir -p "$staging_dir"

echo "dumping postgres"
docker compose exec -T postgres \
	pg_dump -Fc -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-ai_content_studio}" \
	>"$staging_dir/postgres.dump"

cp .env "$staging_dir/env"

echo "snapshotting /data, the dump and .env"
docker compose --profile backup run --rm backup \
	backup /backup/data /backup/staging --tag daily

echo "pruning old snapshots (7 daily, 4 weekly)"
docker compose --profile backup run --rm backup \
	forget --prune --keep-daily 7 --keep-weekly 4

if [[ "$(date -u +%u)" == "7" ]]; then
	echo "Sunday: checking the repository"
	docker compose --profile backup run --rm backup check
fi

rm -rf "$staging_dir"
trap - ERR

echo "backup finished"
if [[ -n "${BACKUP_PING_URL:-}" ]]; then
	curl -fsS -m 10 --retry 3 -o /dev/null "$BACKUP_PING_URL" || true
fi
