#!/usr/bin/env bash
# A final release (issue #82): re-tags the passing release candidate's
# digest — the vX.Y.Z-rc.N with the highest N, the one its Release issue
# was checked off against — as vX.Y.Z and `latest`, through the registry's
# manifest API. No build, no layers: the final tag points at the exact
# digest the candidate gate already ran, which is what makes "a final
# release never rebuilds" true (docs/ops/releasing.md).
#
#   TAG=1.0.0 GITHUB_TOKEN=... ./scripts/retag-final.sh
#
# In CI both are set by the workflow (GITHUB_REF_NAME supplies the tag).
# GITHUB_REPOSITORY defaults to this repo.
set -euo pipefail

tag=${TAG:-${GITHUB_REF_NAME:-}}
tag=${tag#v}
if [ -z "$tag" ]; then
  echo "retag-final: a tag is required (TAG or GITHUB_REF_NAME)" >&2
  exit 2
fi
if [[ ! "$tag" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "retag-final: TAG $tag is not X.Y.Z (a final release, not a candidate)" >&2
  exit 2
fi
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "retag-final: GITHUB_TOKEN is required" >&2
  exit 2
fi

registry=ghcr.io
name=${GITHUB_REPOSITORY:-mysteryreloaded/ai-content-studio}
name=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')
api="$registry/v2/$name"
accept="application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "retag-final: tags on $name:"
tags=$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "$api/tags/list")
jq -r '.tags[] // empty' <<<"$tags"

candidate=$(
  jq -r '.tags[] // empty' <<<"$tags" \
    | grep -F -- "${tag}-rc." \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$' \
    | sort -t. -k4 -n \
    | tail -n 1
)
if [ -z "$candidate" ]; then
  echo "retag-final: no $tag-rc.N image is published on GHCR." >&2
  echo "Cut the candidate tag (v$tag-rc.N) and let its gate pass first, then re-tag (docs/ops/releasing.md)." >&2
  exit 1
fi
echo "retag-final: the passing candidate is $candidate"

curl -fsSL \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: $accept" \
  -D "$tmp/headers" \
  -o "$tmp/manifest" \
  "$api/manifests/$candidate"

digest=$(grep -i '^docker-content-digest:' "$tmp/headers" | tr -d '\r' | awk '{print $2}')
ctype=$(grep -i '^content-type:' "$tmp/headers" | tr -d '\r' | awk '{print $2}')
if [ -z "$digest" ] || [ -z "$ctype" ]; then
  echo "retag-final: the registry gave no content digest for $candidate" >&2
  exit 1
fi

# The registry's manifest endpoint only stores on PUT (the CNCF Distribution
# spec's "PUT /v2/<name>/manifests/<reference>"); POST is for blob uploads
# and the registry answers it with 405 UNSUPPORTED.
for newtag in "$tag" latest; do
  curl -fsSL -X PUT \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: $accept" \
    -H "Content-Type: $ctype" \
    --data-binary @"$tmp/manifest" \
    -D "$tmp/put-$newtag.headers" \
    "$api/manifests/$newtag" > /dev/null
  newdigest=$(grep -i '^docker-content-digest:' "$tmp/put-$newtag.headers" | tr -d '\r' | awk '{print $2}')
  if [ "$newdigest" != "$digest" ]; then
    echo "retag-final: $name:$newtag points at $newdigest, not the candidate's $digest" >&2
    exit 1
  fi
  echo "retag-final: $name:$newtag -> $digest"
done
echo "retag-final: done — $tag and latest both point at $candidate's digest"
