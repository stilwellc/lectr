#!/usr/bin/env bash
# ship.sh — the ONE way to push + deploy lectr code. Exists because the manual
# flow silently failed twice (Aug 24 2026): the close-board bot pushes every
# 4h, a raced `git push` gets rejected, and `push 2>&1 | tail -1` MASKS the
# non-zero exit — the deploy then builds the bot's commit with old code while
# reporting success. This script encodes the ship-tooling rules:
#   1. rebase over the bots, push, and VERIFY origin/main == HEAD
#   2. dispatch the deploy and resolve the run BY SHA (never "latest")
#   3. watch that run to conclusion
# Usage: bash scripts/ship.sh            (after committing)
set -euo pipefail

REPO="stilwellc/lectr"

if ! git diff --cached --quiet || ! git diff --quiet -- ':!public'; then
  echo "ship: uncommitted changes outside public/ — commit first." >&2
  git status --porcelain | grep -v '^ M public/' | head -10 >&2 || true
fi

echo "ship: rebasing over origin/main (bots push every 4h)…"
git pull --rebase --autostash origin main

echo "ship: pushing…"
git push origin main
SHA=$(git rev-parse HEAD)
REMOTE=$(git ls-remote origin -h refs/heads/main | cut -f1)
if [ "$SHA" != "$REMOTE" ]; then
  echo "ship: FAILED — origin/main is $REMOTE, local HEAD is $SHA. Push did not land." >&2
  exit 1
fi
echo "ship: origin/main == $SHA ✓"

echo "ship: dispatching deploy…"
gh workflow run deploy.yml -R "$REPO"

echo "ship: resolving the run for ${SHA}…"
RID=""
for _ in $(seq 1 15); do
  sleep 8
  RID=$(gh run list -R "$REPO" --workflow=deploy.yml -L 6 \
    --json databaseId,headSha -q ".[] | select(.headSha==\"$SHA\") | .databaseId" | head -1)
  [ -n "$RID" ] && break
done
if [ -z "$RID" ]; then
  echo "ship: FAILED — no deploy run appeared for $SHA (check Actions)." >&2
  exit 1
fi
echo "ship: watching run ${RID}…"
if gh run watch "$RID" -R "$REPO" --exit-status > /dev/null 2>&1; then
  echo "ship: deploy-success ($SHA via run $RID)"
else
  echo "ship: DEPLOY FAILED — run $RID" >&2
  exit 1
fi
