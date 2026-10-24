#!/usr/bin/env bash
# The whole upgrade path: back up, pull, up. Run from the directory that
# holds docker-compose.yml and .env.
set -euo pipefail

compose_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$compose_dir"

if [[ ! -f docker-compose.yml || ! -f .env ]]; then
	echo "run this from the directory holding docker-compose.yml and .env" >&2
	exit 1
fi

# shellcheck disable=SC1091
source .env

backup_dir="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

echo "backing up postgres to $backup_dir/postgres.sql.gz"
docker compose exec -T postgres \
	pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-ai_content_studio}" \
	| gzip > "$backup_dir/postgres.sql.gz"

echo "backing up the studio data volume to $backup_dir/studio-data.tar.gz"
docker compose run --rm --no-deps --entrypoint tar studio \
	-czf - -C /data . > "$backup_dir/studio-data.tar.gz"

echo "pulling images"
docker compose pull

echo "starting the upgraded stack"
docker compose up -d

echo "done. backup kept at $backup_dir"
