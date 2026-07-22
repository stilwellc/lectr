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
# Talks to the R2 REST API directly with curl — NOT `wrangler r2 object`,
# which was observed (wrangler 4.112) serving stale reads on overwritten
# keys. Every PUT is verified by comparing the etag the API returns against
# the local md5 (etag == md5 for single-part uploads), so a silent store
# failure cannot pass. NOTE: the GET endpoint can lag a write by a few
# minutes on overwritten keys — harmless at nightly cadence, and the pull
# freshness guard keeps a stale read from ever regressing local data.
#
# Freshness guard: pull compares meta.json lastCrawl and refuses to
# overwrite newer local data with older R2 data.
#
# Auth: CI = CLOUDFLARE_API_TOKEN (needs Account → Workers R2 Storage → Edit);
# local = wrangler's OAuth token read from its config (refresh with any
# wrangler command, e.g. `npx wrangler whoami`, if it has gone stale).
set -euo pipefail
BUCKET=lectr-data
ACCOUNT=${CLOUDFLARE_ACCOUNT_ID:-5bcc5f43136c9ba6b6cb7f949813f473}
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/r2/buckets/$BUCKET/objects"
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

token() {
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then echo "$CLOUDFLARE_API_TOKEN"; return; fi
  python3 - <<'EOF'
import re, glob, os
home = os.path.expanduser('~')
for p in glob.glob(home+'/Library/Preferences/.wrangler/config/*.toml') + glob.glob(home+'/.wrangler/config/*.toml') + glob.glob(home+'/.config/.wrangler/config/*.toml'):
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', open(p).read())
    if m: print(m.group(1)); raise SystemExit
raise SystemExit('no Cloudflare credentials: set CLOUDFLARE_API_TOKEN or log in with `npx wrangler login`')
EOF
}
TOKEN=$(token)

obj_get() { # key -> file; returns curl's exit, 404 leaves empty file + rc 22
  curl -sf -H "Authorization: Bearer $TOKEN" "$API/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1")" -o "$2"
}
listed_etag() { # authoritative etag from the bucket listing (fresh even when GET lags)
  curl -sf -H "Authorization: Bearer $TOKEN" "$API?prefix=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1")" \
    | python3 -c "import json,sys;objs=json.load(sys.stdin).get('result',[]);print(next((o['etag'].strip('\"') for o in objs if o.get('key')==sys.argv[1]),''))" "$1" 2>/dev/null || true
}
obj_get_fresh() { # key file — GET, and WAIT OUT the GET-lag against the listed etag.
  # The R2 API GET path was observed serving a pre-overwrite object for 10-15+
  # minutes after a same-key overwrite while the bucket LISTING etag flips
  # immediately. A CI deploy that pulls during that window bakes STALE data and
  # silently regresses production (observed: a deploy shipped a pre-culture
  # payload while the fresh one sat in the bucket). The listing etag is the
  # source of truth, so poll GET until it matches — up to DATA_FRESH_TRIES×20s
  # (default ~14min, covering the worst lag seen). Only then bake.
  local key="$1" file="$2" want have tries=${DATA_FRESH_TRIES:-42}
  want=$(listed_etag "$key")
  local attempt=1
  while :; do
    obj_get "$key" "$file" || return $?
    have=$(md5 -q "$file" 2>/dev/null || md5sum "$file" | cut -d' ' -f1)
    { [ -z "$want" ] || [ "$have" = "$want" ]; } && { [ "$attempt" -gt 1 ] && echo "[data-store] $key fresh after $attempt reads (GET caught up to listed etag)"; return 0; }
    if [ "$attempt" -ge "$tries" ]; then
      echo "[data-store] WARNING: read of $key STILL STALE after $attempt reads (etag $have, bucket says $want) — using it anyway; freshness guard decides"
      return 0
    fi
    [ "$attempt" -eq 1 ] && echo "[data-store] $key GET lags bucket (have $have, want $want) — waiting for propagation…"
    attempt=$((attempt + 1))
    sleep 20
  done
}
obj_put() { # key file — upload, then verify the returned etag against local md5
  local key="$1" file="$2" enc
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$key")
  local resp
  resp=$(curl -sf -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/octet-stream" --data-binary "@$file" "$API/$enc") \
    || { echo "[data-store] PUT $key failed"; return 1; }
  echo "$resp" | grep -q '"success": *true' || { echo "[data-store] PUT $key rejected: $(echo "$resp" | head -c 200)"; return 1; }
  local up etag
  up=$(md5 -q "$file" 2>/dev/null || md5sum "$file" | cut -d' ' -f1)
  etag=$(echo "$resp" | python3 -c "import json,sys;print(json.load(sys.stdin).get('result',{}).get('etag','').strip('\"'))" 2>/dev/null || true)
  if [ -n "$etag" ] && [ "$etag" != "$up" ]; then
    echo "[data-store] ETAG MISMATCH on $key (local $up, stored $etag) — store is inconsistent"; return 1
  fi
  echo "[data-store] $key ✓ ($(wc -c < "$file" | tr -d ' ') bytes, etag ${etag:-unverified})"
}

stamp_of() { # lastCrawl out of a meta.json, empty if unreadable
  python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('lastCrawl',''))" "$1" 2>/dev/null || true
}

pull() {
  if ! obj_get_fresh "latest/served.tar.gz" "$TMP/served.tar.gz"; then
    if [ -f public/data/ray/meta.json ]; then
      echo "[data-store] R2 unreachable — keeping local copy"
      return 0
    fi
    # data is not in git: with no R2 and no local copy there is nothing to
    # build from — fail here, loudly, instead of exporting an empty site
    echo "[data-store] FATAL: no data in R2 and no local copy"
    exit 1
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
  if obj_get_fresh "latest/corpus.tar" "$TMP/corpus.tar"; then
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
  obj_put "latest/corpus.tar" "$TMP/corpus.tar"
  obj_put "latest/served.tar.gz" "$TMP/served.tar.gz"
  # dated corpus snapshot — the rollback ladder (replaces git history for data)
  day=$(stamp_of public/data/ray/meta.json | cut -c1-10 | tr -d '-')
  [ -n "$day" ] || day=$(date -u +%Y%m%d)
  obj_put "snapshots/$day/corpus.tar" "$TMP/corpus.tar"
  echo "[data-store] pushed latest + snapshot $day"
}

# ── SEGMENTS: per-house corpus slices for the staged nightly. Each crawl job
# pull/push-es ONE segment (isolated); assemble pulls them all. R2 key:
# latest/segments/<name>.json.gz. A pull miss (new segment) is non-fatal.
SEGMENTS="goldin sothebys christies bonhams phillips wright other"
push_segment() {
  local name="$1" f="data/corpus/segments/$1.json.gz"
  test -f "$f" || { echo "[data-store] no segment $name to push — skipping"; return 0; }
  obj_put "latest/segments/$name.json.gz" "$f"
}
pull_segment() {
  local name="$1"
  mkdir -p data/corpus/segments
  obj_get_fresh "latest/segments/$name.json.gz" "data/corpus/segments/$name.json.gz" \
    || echo "[data-store] segment $name not in R2 yet (fresh) — crawl will seed it"
}
# Pull every segment IN PARALLEL. Serial pulls each wait out R2 GET-lag (up to
# ~14min via obj_get_fresh); 6 in a row blew the assemble timeout. Parallel →
# worst case is one lag window, not six.
pull_all_segments() {
  mkdir -p data/corpus/segments
  local pids="" rc=0
  for s in $SEGMENTS; do pull_segment "$s" & pids="$pids $!"; done
  for p in $pids; do wait "$p" || rc=1; done
  return $rc
}

case "${1:-}" in
  pull) pull ;;
  push) push ;;
  push-segment) push_segment "$2" ;;
  pull-segment) pull_segment "$2" ;;
  pull-segments) pull_all_segments ;;
  *) echo "usage: $0 pull|push|push-segment <name>|pull-segment <name>|pull-segments"; exit 1 ;;
esac
