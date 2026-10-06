#!/usr/bin/env bash
# r2-api-push.sh — upload the lot-API objects scripts/emit-r2-index.ts wrote
# (docs/data-pipeline.md "The lot API").
#
#   scripts/r2-api-push.sh [out-dir=data/r2-api]            # → R2 bucket lectr-data
#   R2_LOCAL=1 scripts/r2-api-push.sh [out-dir]             # → local wrangler state
#                                                           #   (.wrangler/state) for `wrangler pages dev`
#
# Order comes from <out>/api/UPLOAD_ORDER.txt: the write-once payloads
# (api/v/<version>/blob-N.bin, loc-NN.json, manifest.json) first, the pointer
# api/current.json LAST — so the API can never read a version whose objects
# are not all up. Payloads go up R2_PUT_PARALLEL (default 6) at a time (blobs
# are ≤8MB since Oct 6). Every PUT is verified (R2 etag == local md5 for a
# single-part upload) and retried 3×, like scripts/data-store.sh.
#
# Auth (remote): CLOUDFLARE_API_TOKEN (Workers R2 Storage → Edit; CI passes
# CF_R2_WRITE_TOKEN) + CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
OUT=${1:-data/r2-api}
BUCKET=lectr-data
ORDER="$OUT/api/UPLOAD_ORDER.txt"
[ -f "$ORDER" ] || { echo "[r2-api] $ORDER missing — run scripts/emit-r2-index.ts first"; exit 1; }
n=$(grep -c . "$ORDER")
echo "[r2-api] uploading $n objects from $OUT"

if [ "${R2_LOCAL:-0}" = "1" ]; then
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    npx --yes wrangler@4.120.1 r2 object put "$BUCKET/$key" --file "$OUT/$key" --local --persist-to .wrangler/state >/dev/null
    echo "[r2-api] local $key ✓"
  done < "$ORDER"
  exit 0
fi

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (R2 write)}"
ACCOUNT=${CLOUDFLARE_ACCOUNT_ID:-5bcc5f43136c9ba6b6cb7f949813f473}
API=${R2_OBJECTS_API:-"https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/r2/buckets/$BUCKET/objects"}  # override: local test double

put_once() { # key file
  local key="$1" file="$2" enc resp up etag
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$key")
  resp=$(curl -sf -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary "@$file" "$API/$enc") || { echo "[r2-api] PUT $key failed"; return 1; }
  echo "$resp" | grep -q '"success": *true' || { echo "[r2-api] PUT $key rejected: $(echo "$resp" | head -c 200)"; return 1; }
  up=$(md5 -q "$file" 2>/dev/null || md5sum "$file" | cut -d' ' -f1)
  etag=$(echo "$resp" | python3 -c "import json,sys;print(json.load(sys.stdin).get('result',{}).get('etag','').strip('\"'))" 2>/dev/null || true)
  if [ -n "$etag" ] && [ "$etag" != "$up" ]; then echo "[r2-api] ETAG MISMATCH on $key (local $up, stored $etag)"; return 1; fi
  echo "[r2-api] $key ✓ ($(wc -c < "$file" | tr -d ' ') bytes)"
}

put_retry() { # key — 3 attempts with backoff
  local key="$1" attempt
  for attempt in 1 2 3; do
    if put_once "$key" "$OUT/$key"; then return 0; fi
    [ "$attempt" -lt 3 ] && sleep $((attempt * 15))
  done
  echo "[r2-api] giving up on $key"
  return 1
}
export -f put_once put_retry
export OUT API CLOUDFLARE_API_TOKEN

# payloads (write-once, small blobs) in parallel; the pointer strictly after
# every payload is verified up
PAR=${R2_PUT_PARALLEL:-6}
if ! grep -v '^api/current\.json$' "$ORDER" | grep . | xargs -P "$PAR" -I{} bash -c 'put_retry "$1"' _ {}; then
  echo "[r2-api] a payload failed — pointer NOT moved, the API keeps serving the previous version"; exit 1
fi
grep -qx 'api/current.json' "$ORDER" || { echo "[r2-api] UPLOAD_ORDER has no pointer"; exit 1; }
put_retry api/current.json || { echo "[r2-api] pointer PUT failed — the API keeps serving the previous version"; exit 1; }
echo "[r2-api] done — api/current.json now names $(python3 -c "import json;print(json.load(open('$OUT/api/current.json'))['version'])")"
