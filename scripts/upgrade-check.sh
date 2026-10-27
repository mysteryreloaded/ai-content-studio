#!/usr/bin/env bash
# The upgrade check (issue #82): "an upgrade never breaks what was already
# installed". Boots the previous release against a fresh Postgres and a fresh
# /data volume, seeds it through its own API (scripts/seed.ts, over the
# in-repo mock OIDC issuer), stops it, then boots the candidate image on the
# same database and the same /data and checks that the candidate is:
#
#   - healthy: /healthz answers 200. Migrations run before the server serves
#     (apps/server/src/index.ts), so a broken migration kills the boot.
#   - migrated: the database's drizzle.__drizzle_migrations rows match the
#     candidate's
#     migration files (counted in this checkout, which the caller keeps in
#     lockstep with the candidate image).
#   - intact: check-storage (issue #77) reports nothing missing or orphaned.
#
# The fake ComfyUI runs as a container on the check's own network, so the
# studio reaches it at a stable name without any fixed subnet.
#
#   PREVIOUS_IMAGE=ghcr.io/mysteryreloaded/ai-content-studio:1.0.0 \
#   CANDIDATE_IMAGE=ghcr.io/mysteryreloaded/ai-content-studio:1.1.0-rc.1 \
#   ./scripts/upgrade-check.sh
#
# The studio container is always published on host port 3000: the server
# listens on 3000 inside the container, and the mock OIDC issuer is
# mounted on that server's own loopback, so the host-side seed and the
# in-container server reach it at the one address they share —
# http://localhost:3000 — which only holds while the published port is
# 3000. CI runs on a clean runner where 3000 is free; running this locally
# next to a dev studio on 3000, stop that first.
#
# Environment (all optional except the two images):
#   POSTGRES_IMAGE the Postgres image (postgres:17)
#   FAKE_IMAGE     image that runs the in-repo fake ComfyUI
#                  (oven/bun:1.4.4-slim, matching the Dockerfile)
#   FAKE_DIR       the fake ComfyUI package, mounted read-write into the
#                  fake container (apps/fake-comfyui)
#   SECRET_KEY     32 bytes in base64 (a fixed test key by default; the
#                  check is a throwaway lab, never a real deployment)
#
# Requires: docker, curl, bun (for scripts/seed.ts).
set -euo pipefail

if [ -z "${PREVIOUS_IMAGE:-}" ] || [ -z "${CANDIDATE_IMAGE:-}" ]; then
  echo "usage: PREVIOUS_IMAGE=<image> CANDIDATE_IMAGE=<image> $0" >&2
  exit 2
fi

POSTGRES_IMAGE=${POSTGRES_IMAGE:-postgres:17}
FAKE_IMAGE=${FAKE_IMAGE:-oven/bun:1.4.4-slim}
FAKE_DIR=${FAKE_DIR:-apps/fake-comfyui}
SECRET_KEY=${SECRET_KEY:-4FRG13w9RuN5CeV10Lzfxl78MY+AJRJtGuKrBdYzgCY=}

NET=uc-upgrade-check-net
PG=uc-upgrade-check-postgres
FAKE=uc-upgrade-check-fake
STUDIO=uc-upgrade-check-studio
DATA_VOL=uc-upgrade-check-data
PG_VOL=uc-upgrade-check-pg

cleanup() {
  docker rm -f "$STUDIO" "$PG" "$FAKE" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "$DATA_VOL" "$PG_VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for tool in docker curl bun; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "upgrade-check: needs $tool on the PATH" >&2
    exit 2
  fi
done
docker image inspect "$PREVIOUS_IMAGE" >/dev/null 2>&1 || {
  echo "upgrade-check: $PREVIOUS_IMAGE is not present locally; pull or build it first" >&2
  exit 1
}
docker image inspect "$CANDIDATE_IMAGE" >/dev/null 2>&1 || {
  echo "upgrade-check: $CANDIDATE_IMAGE is not present locally; pull or build it first" >&2
  exit 1
}
[ -f "$FAKE_DIR/src/server.ts" ] || {
  echo "upgrade-check: $FAKE_DIR/src/server.ts not found (run from the repo root)" >&2
  exit 1
}

wait_health() {
  local name=$1
  local _
  for _ in $(seq 1 180); do
    if curl -sf "http://localhost:3000/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "upgrade-check: $name never became healthy:" >&2
  docker logs "$name" 2>&1 | tail -n 60 >&2
  return 1
}

echo "upgrade-check: network + fresh Postgres"
docker network create --driver bridge "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ai_content_studio \
  -v "$PG_VOL":/var/lib/postgresql/data \
  "$POSTGRES_IMAGE" >/dev/null
for _ in $(seq 1 120); do
  if docker exec "$PG" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$PG" pg_isready -U postgres >/dev/null

echo "upgrade-check: fake ComfyUI (in-repo, in a container on the network)"
docker run -d --name "$FAKE" --network "$NET" \
  -v "$PWD/$FAKE_DIR":/app -w /app \
  "$FAKE_IMAGE" bun run src/server.ts >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$FAKE" bun -e '
    const res = await fetch("http://localhost:8188/system_stats");
    process.exit(res.ok ? 0 : 1);
  ' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$FAKE" bun -e '
  const res = await fetch("http://localhost:8188/system_stats");
  if (!res.ok) process.exit(1);
' >/dev/null

# Everything both boots share. The fake's name is the Backend's address as
# seen from inside the studio container, so the seed points the Backend at
# it and the later candidate boot keeps resolving the same name. (The mock
# OIDC issuer is mounted on the studio server itself, so PUBLIC_URL and
# OIDC_ISSUER are the server's own loopback, 3000 both inside the container
# and on the host — see the note in the header.)
studio_env=(
  -e "DATABASE_URL=postgres://postgres:postgres@$PG:5432/ai_content_studio"
  -e "PORT=3000"
  -e "PUBLIC_URL=http://localhost:3000"
  -e "OIDC_ISSUER=http://localhost:3000/mock-auth"
  -e "GOOGLE_CLIENT_ID=upgrade-check"
  -e "GOOGLE_CLIENT_SECRET=upgrade-check"
  -e "ADMIN_EMAILS=admin@example.com"
  -e "SECRET_KEY=$SECRET_KEY"
  -e "LOG_LEVEL=info"
)

echo "upgrade-check: boot the previous release: $PREVIOUS_IMAGE"
docker run -d --name "$STUDIO" --network "$NET" \
  -p 3000:3000 \
  -v "$DATA_VOL":/data \
  "${studio_env[@]}" \
  "$PREVIOUS_IMAGE" >/dev/null
wait_health "$STUDIO"

echo "upgrade-check: seed the previous release through its own API"
SEED_BASE_URL="http://localhost:3000" \
  SEED_ADMIN_EMAIL=admin@example.com \
  SEED_BACKEND_URL="http://$FAKE:8188" \
  bun run scripts/seed.ts

echo "upgrade-check: stop the previous release, boot the candidate on the same database and /data"
docker rm -f "$STUDIO" >/dev/null
docker run -d --name "$STUDIO" --network "$NET" \
  -p 3000:3000 \
  -v "$DATA_VOL":/data \
  "${studio_env[@]}" \
  "$CANDIDATE_IMAGE" >/dev/null
wait_health "$STUDIO"

expected=$(find apps/server/drizzle/migrations -maxdepth 1 -name "*.sql" | wc -l | tr -d "[:space:]")
actual=$(docker exec "$PG" psql -U postgres -d ai_content_studio \
  -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations;")
echo "upgrade-check: migrations $actual (the candidate ships $expected)"
if [ "$actual" -ne "$expected" ]; then
  echo "upgrade-check: the candidate did not migrate to its own schema" >&2
  exit 1
fi

echo "upgrade-check: check-storage"
docker exec "$STUDIO" bun run apps/server/src/storage/check-storage.ts

echo "upgrade-check: OK — $PREVIOUS_IMAGE -> $CANDIDATE_IMAGE (healthy, migrated, storage intact)"
