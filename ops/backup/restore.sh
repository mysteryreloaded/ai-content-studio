#!/usr/bin/env bash
# Restores from a restic snapshot (issue #77's AC): stops the studio,
# restores /data (in place) and the dump + .env (into .backup-staging),
# recreates the database from the dump, starts the studio again and
# runs check-storage.
#
# Usage: restore.sh [snapshot] [--drill]
#   snapshot  a restic snapshot id, or "latest" (the default).
#   --drill   the quarterly drill (issue #77's AC): forces
#             BACKENDS_ENABLED=false before starting the studio, so a
#             restored copy never reaches a production Backend. Only
#             makes sense on a throwaway copy of the stack, never on
#             the production host — it overwrites this copy's .env.
#
# The restored .env always lands at .env.restored for review; outside
# a drill, this script never touches the real .env itself, so recovery
# is a deliberate second step (`cp .env.restored .env`) once you've
# checked it.
set -euo pipefail

snapshot="latest"
drill=false
for arg in "$@"; do
	case "$arg" in
	--drill) drill=true ;;
	*) snapshot="$arg" ;;
	esac
done

compose_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$compose_dir"

if [[ ! -f docker-compose.yml || ! -f backup.env ]]; then
	echo "run this from the directory holding docker-compose.yml and backup.env" >&2
	exit 1
fi

# shellcheck disable=SC1091
source backup.env

echo "stopping the studio"
docker compose stop studio

staging_dir="$compose_dir/.backup-staging"
rm -rf "$staging_dir"
mkdir -p "$staging_dir"

echo "restoring snapshot $snapshot"
docker compose --profile restore run --rm restore restore "$snapshot" --target /

cp "$staging_dir/env" .env.restored
if $drill; then
	if grep -q '^BACKENDS_ENABLED=' .env.restored; then
		sed -i 's/^BACKENDS_ENABLED=.*/BACKENDS_ENABLED=false/' .env.restored
	else
		echo 'BACKENDS_ENABLED=false' >>.env.restored
	fi
	echo "drill: overwriting .env with the restored, Backend-disabled copy"
	cp .env.restored .env
fi

# shellcheck disable=SC1091
source .env

echo "recreating the database"
docker compose up -d postgres
for _ in $(seq 1 30); do
	if docker compose ps postgres --format '{{.Health}}' | grep -q healthy; then
		break
	fi
	sleep 2
done

docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d postgres \
	-c "DROP DATABASE IF EXISTS ${POSTGRES_DB:-ai_content_studio};"
docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d postgres \
	-c "CREATE DATABASE ${POSTGRES_DB:-ai_content_studio};"
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-postgres}" \
	-d "${POSTGRES_DB:-ai_content_studio}" <"$staging_dir/postgres.dump"

echo "starting the studio"
docker compose up -d studio
for _ in $(seq 1 60); do
	if docker compose ps studio --format '{{.Health}}' | grep -q healthy; then
		break
	fi
	sleep 2
done

echo "running check-storage"
docker compose exec -T studio bun run apps/server/src/storage/check-storage.ts || true

rm -rf "$staging_dir"

if $drill; then
	echo "drill restore finished; BACKENDS_ENABLED=false in .env"
else
	echo "restore finished. Review .env.restored (especially BACKENDS_ENABLED)" \
		"before copying it over .env."
fi
