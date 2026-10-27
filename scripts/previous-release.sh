#!/usr/bin/env bash
# Find the previous final release (issue #82): the highest vX.Y.Z tag that
# the release gate upgrades *from* — everything below the given version, or
# the most recent final release overall when no version is given (a pull
# request checks against whatever is currently live).
#
# Prints the tag (without its leading "v") to stdout, or nothing at all
# when there is no final release to upgrade from (v1.0.0 is the first
# release, so its upgrade check skips).
#
#   scripts/previous-release.sh 1.2.0    # for a v1.2.0-rc.N candidate
#   scripts/previous-release.sh          # for a pull request
#
# Reads the tags from the public GitHub REST API (no token needed for a
# public repo); override the repo with GITHUB_REPOSITORY.
set -euo pipefail

repo=${GITHUB_REPOSITORY:-mysteryreloaded/ai-content-studio}

# Final releases only: `vX.Y.Z`, never a `-rc.N` candidate.
tags=$(
  curl -fsSL "https://api.github.com/repos/$repo/tags?per_page=100" \
    | jq -r '.[].name // empty' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true
)

if [ -z "${1:-}" ]; then
  if [ -n "$tags" ]; then
    echo "$tags" | sort -V | tail -n 1 | sed 's/^v//'
  fi
else
  target="v$1"
  # The tag just below `target` in version order: feed the target itself
  # into the sort and stop at it.
  {
    echo "$tags"
    echo "$target"
  } | sort -V \
    | awk -v target="$target" '$0 == target { exit } { last = $0 } END { print last }' \
    | sed 's/^v//'
fi
