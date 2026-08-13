#!/usr/bin/env bash
# One-shot LOCAL gallery heal — CreateAuction trio. Why local: the auction-
# switcher postback gets re-challenged by Cloudflare from GitHub datacenter
# IPs (CI run 31662850740 crawled 106 auctions → 0 sold), but survives from a
# residential IP. Run AFTER a nightly completes so the heal layers on fresh
# segments instead of racing the matrix jobs' pushes.
#   bash scripts/_qa/heal-local.sh 2>&1 | tee /tmp/heal-local.log
set -uo pipefail
cd "$(dirname "$0")/../.."
for h in lelands memorylane lotg; do
  echo "══ [$h] $(date -u +%H:%M:%SZ) pull last-good segment"
  if ! bash scripts/data-store.sh pull-segment "$h"; then
    echo "══ [$h] PULL FAILED — skipping house (segment untouched)"; continue
  fi
  echo "══ [$h] re-crawl all settled auctions (fixed extractor)"
  if RAY_SKIP_MAIN=1 npx tsx scripts/crawl-lelands-gallery.ts --house "$h" --write; then
    echo "══ [$h] push healed segment"
    bash scripts/data-store.sh push-segment "$h" || echo "══ [$h] PUSH FAILED — segment healed locally only"
  else
    echo "══ [$h] CRAWL FAILED — not pushing"
  fi
done
echo "══ heal complete $(date -u +%H:%M:%SZ)"
