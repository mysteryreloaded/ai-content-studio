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
# Reads the tags from the checkout's git remote: git ls-remote --tags
# $REMOTE, where REMOTE defaults to origin (a URL works too; the
# workflows set it to the base repo, whose tags a fork's origin does not
# have; no token is needed for a public repo). It has no fallback: a git
# failure (offline, a bad remote, a rate limit) fails this script,
# because a silent "no previous release" would skip the upgrade check
# (docs/ops/releasing.md).
set -euo pipefail

# A git failure must fail the script, not masquerade as "no final
# release": an upgrade check skipped that way never ran.
refs=$(git ls-remote --tags "${REMOTE:-origin}")

# Final releases only: `vX.Y.Z`, never a `-rc.N` candidate. The peeled
# refs (`...^{}`) fall out of the shape match; a grep that finds nothing
# is the legitimate "no final release yet" case, not an error.
tags=$(
  sed 's/^[0-9a-f]*\trefs\/tags\///' <<<"$refs" \
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
