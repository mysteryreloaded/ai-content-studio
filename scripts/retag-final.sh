#!/usr/bin/env bash
# A final release (issue #82): re-tags the passing release candidate's
# digest — the vX.Y.Z-rc.N with the highest N, the one its Release issue
# was checked off against — as vX.Y.Z and `latest`, through the registry's
# manifest API. No build, no layers: the final tag points at the exact
# digest the candidate gate already ran, which is what makes "a final
# release never rebuilds" true (docs/ops/releasing.md).
#
#   TAG=1.0.0 GITHUB_ACTOR=you GITHUB_TOKEN=... ./scripts/retag-final.sh
#
# In CI all three are set by the workflow (GITHUB_REF_NAME supplies the
# tag). GITHUB_REPOSITORY defaults to this repo.
#
# Against a non-GHCR registry (a local registry:2 in a test) set REGISTRY
# (http://localhost:5050) and GITHUB_REPOSITORY to its repo name; an
# optional REGISTRY_TOKEN supplies a bearer. The GHCR token exchange is
# GHCR-only, so an overridden registry needs no GitHub at all; the
# gate-run check is on by default for GHCR and off otherwise, and
# CHECK_GATE_RUN=1/0 overrides it either way.
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

registry=${REGISTRY:-https://ghcr.io}
name=${GITHUB_REPOSITORY:-mysteryreloaded/ai-content-studio}
name=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')
api="$registry/v2/$name"
accept="application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json"

# The manifest API wants a Bearer token. For GHCR that is an *exchanged*
# registry token, not the raw GITHUB_TOKEN: the registry's token endpoint
# trades GITHUB_ACTOR:GITHUB_TOKEN for one (the same exchange docker
# login performs). An overridden registry either supplies its own bearer
# or needs none.
token=""
if [ "$registry" = "https://ghcr.io" ]; then
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "retag-final: GITHUB_TOKEN is required (with GITHUB_ACTOR) to exchange a GHCR registry token" >&2
    exit 2
  fi
  if [ -z "${GITHUB_ACTOR:-}" ]; then
    echo "retag-final: GITHUB_ACTOR is required to exchange a GHCR registry token" >&2
    exit 2
  fi
  token=$(
    curl -fsSL -G -u "$GITHUB_ACTOR:$GITHUB_TOKEN" \
      "$registry/token" \
      --data-urlencode "service=ghcr.io" \
      --data-urlencode "scope=repository:$name:pull,push" \
      | jq -r '.token // empty'
  )
  if [ -z "$token" ]; then
    echo "retag-final: the GHCR token exchange returned no token" >&2
    exit 1
  fi
elif [ -n "${REGISTRY_TOKEN:-}" ]; then
  token=$REGISTRY_TOKEN
fi

auth=()
if [ -n "$token" ]; then
  auth=(-H "Authorization: Bearer $token")
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "retag-final: tags on $name:"
tags=$(curl -fsSL "${auth[@]}" "$api/tags/list")
jq -r '.tags[] // empty' <<<"$tags"

# The -rc.N tags of exactly this version: the pattern is anchored, so a
# 1.0.0 final can never pick up 11.0.0's candidates.
candidate=$(
  jq -r '.tags[] // empty' <<<"$tags" \
    | grep -E -- "^${tag//./\\.}-rc\.[0-9]+$" \
    | sort -t. -k4 -n \
    | tail -n 1 \
    || true
)
if [ -z "$candidate" ]; then
  echo "retag-final: no $tag-rc.N image is published on the registry." >&2
  echo "Cut the candidate tag (v$tag-rc.N) and let its gate pass first, then re-tag (docs/ops/releasing.md)." >&2
  exit 1
fi
echo "retag-final: the passing candidate is $candidate"

# A pushed image is not a passing candidate: the candidate gate's upgrade
# check and native boots run AFTER `publish` pushes the image, so a green
# push says nothing about them. Before re-tagging, require a successful
# run of the candidate's own gate. On by default for GHCR, off by default
# for an overridden registry (a test has no gate run to check);
# CHECK_GATE_RUN=1/0 overrides either way.
if [ -z "${CHECK_GATE_RUN:-}" ]; then
  if [ "$registry" = "https://ghcr.io" ]; then
    check_gate_run=1
  else
    check_gate_run=0
  fi
else
  check_gate_run=$CHECK_GATE_RUN
fi
if [ "$check_gate_run" = "1" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "retag-final: the gh CLI is required to check the candidate's gate run (preinstalled on GitHub runners)" >&2
    exit 2
  fi
  # $candidate is the full candidate version (X.Y.Z-rc.N); its tag is
  # v$candidate, which is the branch the release-rc.yml gate ran on.
  runs=$(
    gh api "repos/$name/actions/workflows/release-rc.yml/runs?branch=v$candidate&status=success"
  )
  if [ "$(jq -r '.total_count // 0' <<<"$runs")" -eq 0 ]; then
    echo "retag-final: v$candidate has no successful release-rc.yml run yet." >&2
    echo "Wait for its gate to finish (the upgrade check and the boots run after the push), then re-tag (docs/ops/releasing.md)." >&2
    exit 1
  fi
  echo "retag-final: v$candidate's release-rc.yml run is green"
fi

curl -fsSL \
  "${auth[@]}" \
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

# The registry's manifest endpoint only stores on PUT (the CNCF
# Distribution spec's "PUT /v2/<name>/manifests/<reference>"); POST is for
# blob uploads and the registry answers it with 405 UNSUPPORTED.
for newtag in "$tag" latest; do
  curl -fsSL -X PUT \
    "${auth[@]}" \
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
