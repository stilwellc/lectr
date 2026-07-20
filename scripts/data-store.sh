#!/usr/bin/env bash
# lectr data store — the corpus + served payloads live in Cloudflare R2
# (bucket: lectr-data), not git. See docs/data-pipeline.md.
#
#   scripts/data-store.sh pull   # fetch latest data from R2 (if newer than local)
#   scripts/data-store.sh push   # publish local data to R2 + a dated snapshot
#
# Objects:
#   latest/corpus.tar      data/corpus/*.json.gz (source of truth, engine-only)
#   latest/served.tar.gz   public/data/ray/ (the client payloads, whole dir)
#   snapshots/YYYYMMDD/corpus.tar   daily corpus snapshot (30-day lifecycle)
#
# Freshness guard: pull compares meta.json lastCrawl and refuses to overwrite
# newer local data with older R2 data (protects the dual-write transition,
# where a git checkout can be ahead of R2 if a push failed).
#
# Auth: local = wrangler OAuth; CI = CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
# (the token needs Account → Workers R2 Storage → Edit).
set -euo pipefail
BUCKET=lectr-data
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

stamp_of() { # lastCrawl out of a meta.json, empty if unreadable
  python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('lastCrawl',''))" "$1" 2>/dev/null || true
}

pull() {
  if ! npx wrangler r2 object get "$BUCKET/latest/served.tar.gz" --file "$TMP/served.tar.gz" --remote 2>/dev/null; then
    echo "[data-store] no served payloads in R2 (or no access) — keeping local copy"
    return 0
  fi
  mkdir -p "$TMP/served" && tar -xzf "$TMP/served.tar.gz" -C "$TMP/served"
  remote=$(stamp_of "$TMP/served/meta.json")
  local_stamp=$(stamp_of public/data/ray/meta.json)
  if [ -n "$local_stamp" ] && [ -n "$remote" ] && [[ "$remote" < "$local_stamp" ]]; then
    echo "[data-store] R2 data ($remote) is OLDER than local ($local_stamp) — keeping local"
    return 0
  fi
  rm -rf public/data/ray && mkdir -p public/data/ray
  cp -R "$TMP/served/." public/data/ray/
  echo "[data-store] served payloads pulled from R2 (lastCrawl $remote)"
  if npx wrangler r2 object get "$BUCKET/latest/corpus.tar" --file "$TMP/corpus.tar" --remote 2>/dev/null; then
    mkdir -p data/corpus
    tar -xf "$TMP/corpus.tar" -C data/corpus
    echo "[data-store] corpus pulled from R2"
  else
    echo "[data-store] WARNING: served pulled but corpus missing in R2"
  fi
}

push() {
  test -f data/corpus/lots.json.gz || { echo "[data-store] no corpus to push"; exit 1; }
  test -f public/data/ray/meta.json || { echo "[data-store] no served meta to push"; exit 1; }
  # corpus members are already gzipped — plain tar, no double compression
  (cd data/corpus && tar -cf "$TMP/corpus.tar" ./*.json.gz)
  (cd public/data/ray && tar -czf "$TMP/served.tar.gz" .)
  npx wrangler r2 object put "$BUCKET/latest/corpus.tar" --file "$TMP/corpus.tar" --remote
  npx wrangler r2 object put "$BUCKET/latest/served.tar.gz" --file "$TMP/served.tar.gz" --remote
  # dated corpus snapshot — the rollback ladder (replaces git history for data)
  day=$(stamp_of public/data/ray/meta.json | cut -c1-10 | tr -d '-')
  [ -n "$day" ] || day=$(date -u +%Y%m%d)
  npx wrangler r2 object put "$BUCKET/snapshots/$day/corpus.tar" --file "$TMP/corpus.tar" --remote
  echo "[data-store] pushed latest + snapshot $day"
}

case "${1:-}" in
  pull) pull ;;
  push) push ;;
  *) echo "usage: $0 pull|push"; exit 1 ;;
esac
