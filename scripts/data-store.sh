#!/usr/bin/env bash
# lectr data store — the corpus + served payloads live in Cloudflare R2
# (bucket: lectr-data), not git. See docs/data-pipeline.md.
#
#   scripts/data-store.sh pull   # fetch latest data from R2 (if newer than local)
#   scripts/data-store.sh push   # publish local data to R2 + a dated snapshot
#
# Objects:
#   versions/<UTC>-<sha>/corpus.tar     WRITE-ONCE corpus (data/corpus/*.json.gz)
#   versions/<UTC>-<sha>/served.tar.gz  WRITE-ONCE served payloads (public/data/ray/)
#   latest/pointer.txt     tiny pointer to the current versions/ prefix — the
#                          ONLY overwritten object a pull ever has to wait on
#   latest/corpus.tar      FROZEN legacy keys from before the pointer migration
#   latest/served.tar.gz   (no longer written; pull() keeps them as a last-resort
#                          fallback for a pointer-less bucket)
#   snapshots/YYYYMMDD/corpus.tar   daily corpus snapshot (30-day lifecycle)
#   latest/segments/<house>.ndjson.gz             the LAST-GOOD per-house segment
#   segment-versions/<house>/<UTC>.ndjson.gz      WRITE-ONCE copy of every segment
#                          push (rollback ladder: `list-segment-versions`,
#                          `restore-segment`; `prune-segment-versions` drops
#                          versions > 30 days old, always keeping 3 per house)
#   latest/house-ledger.json      per-house crawl ledger (scripts/emit-status.ts)
#   qa/validate-engine/<UTC>-<run>.json   every night's engine-gate report
#                          (scripts/ci/gate-replay.ts replays them)
#
# Retention: versions/ accumulates ~176MB/day (corpus.tar + served.tar.gz per
# push). Prefer an R2 lifecycle rule on the versions/ prefix; until one is
# configured, `data-store.sh prune` deletes all but the newest 14 versions.
#
# Talks to the R2 REST API directly with curl — NOT `wrangler r2 object`,
# which was observed (wrangler 4.112) serving stale reads on overwritten
# keys. Every PUT is verified by comparing the etag the API returns against
# the local md5 (etag == md5 for single-part uploads), so a silent store
# failure cannot pass. NOTE: the GET endpoint can lag a write by 10-15min on
# OVERWRITTEN keys — never on brand-new ones. That is WHY payloads live under
# write-once versions/ keys and only the tiny pointer is overwritten: the lag
# wait shrinks from "poll an 18MB tarball for up to ~14min" to "poll a few
# bytes", and the payload reads themselves are authoritative on the first GET.
#
# Freshness guards: pull compares meta.json lastCrawl and refuses to
# overwrite newer local data with older R2 data; push does the SAME in the
# other direction (refuses to overwrite newer R2 data with older local data
# unless DATA_PUSH_FORCE=1) and never lowers the shrink baseline in
# latest/meta.json. push-segment refuses to replace a segment another writer
# changed since it was pulled (etag compare-and-swap; SEGMENT_PUSH_FORCE=1).
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
obj_exists() { # key → 0 listed, 1 absent (listing ANSWERED), 2 listing failed.
  # The bucket listing is the authority on existence — a GET 404 alone can't
  # separate "not there" from "auth/network outage". Three tries absorb a blip.
  local key="$1" enc listing attempt
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$key")
  for attempt in 1 2 3; do
    listing=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API?prefix=$enc" 2>/dev/null) || listing=""
    if echo "$listing" | grep -q '"success": *true'; then
      echo "$listing" | grep -q "\"key\": *\"$key\"" && return 0
      return 1
    fi
    sleep 3
  done
  return 2
}
obj_get_fresh() { # key file — GET, and WAIT OUT the GET-lag against the listed etag.
  # The R2 API GET path was observed serving a pre-overwrite object for 10-15+
  # minutes after a same-key overwrite while the bucket LISTING etag flips
  # immediately. A CI deploy that pulls during that window bakes STALE data and
  # silently regresses production (observed: a deploy shipped a pre-culture
  # payload while the fresh one sat in the bucket). The listing etag is the
  # source of truth, so poll GET until it matches — up to DATA_FRESH_TRIES×20s
  # (default ~14min, covering the worst lag seen). Only then bake.
  #
  # Sep 2 2026: a read that is STILL stale after the window, or one whose
  # freshness cannot be verified (listing failed while the GET succeeded),
  # now FAILS (rc 75) instead of "using it anyway" — a stale pointer here
  # was exactly how a deploy could bake yesterday's payload with a green
  # log. Callers that can tolerate it decide explicitly; set
  # DATA_FRESH_ALLOW_STALE=1 to restore the old permissive behaviour.
  local key="$1" file="$2" want have tries=${DATA_FRESH_TRIES:-42} rc
  want=$(listed_etag "$key")
  if [ -z "$want" ]; then
    # '' is ambiguous: absent key, OR the listing call failed. Re-ask.
    rc=0; obj_exists "$key" || rc=$?   # (never bare: set -e would abort on rc 1/2)
    if [ "$rc" -eq 1 ]; then obj_get "$key" "$file"; return $?; fi   # absent → plain 404 path
    if [ "$rc" -eq 2 ]; then
      if [ "${DATA_FRESH_ALLOW_STALE:-0}" = "1" ]; then
        echo "[data-store] WARNING: listing unavailable for $key — freshness UNVERIFIED (DATA_FRESH_ALLOW_STALE=1)"
        obj_get "$key" "$file"; return $?
      fi
      echo "[data-store] ERROR: bucket listing unavailable for $key — cannot verify freshness; refusing the read"
      return 75
    fi
    want=$(listed_etag "$key")
  fi
  local attempt=1
  while :; do
    obj_get "$key" "$file" || return $?
    have=$(md5 -q "$file" 2>/dev/null || md5sum "$file" | cut -d' ' -f1)
    { [ -z "$want" ] || [ "$have" = "$want" ]; } && { [ "$attempt" -gt 1 ] && echo "[data-store] $key fresh after $attempt reads (GET caught up to listed etag)"; return 0; }
    if [ "$attempt" -ge "$tries" ]; then
      if [ "${DATA_FRESH_ALLOW_STALE:-0}" = "1" ]; then
        echo "[data-store] WARNING: read of $key STILL STALE after $attempt reads (etag $have, bucket says $want) — using it anyway (DATA_FRESH_ALLOW_STALE=1)"
        return 0
      fi
      echo "[data-store] ERROR: read of $key STILL STALE after $attempt reads (etag $have, bucket says $want) — refusing a stale read"
      rm -f "$file"
      return 75
    fi
    [ "$attempt" -eq 1 ] && echo "[data-store] $key GET lags bucket (have $have, want $want) — waiting for propagation…"
    attempt=$((attempt + 1))
    sleep 20
  done
}
obj_put() { # key file — upload w/ retry (a transient blip on a 130MB segment
  # PUT must not redden a whole crawl leg — seen live on goldin Jul 31 2026),
  # then verify the returned etag against local md5. Retry is safe: R2 PUTs
  # are atomic (no partial objects) and same-key re-PUT is idempotent.
  local key="$1" file="$2" attempt
  for attempt in 1 2 3; do
    if obj_put_once "$key" "$file"; then return 0; fi
    [ "$attempt" -lt 3 ] && { echo "[data-store] PUT $key attempt $attempt failed — retrying in $((attempt*15))s"; sleep $((attempt*15)); }
  done
  echo "[data-store] PUT $key failed after 3 attempts"
  return 1
}

obj_put_once() { # key file — single upload + etag verify
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

obj_get_once() { # key file — single GET for WRITE-ONCE keys (versions/…).
  # The GET-lag only afflicts same-key overwrites; a never-overwritten object
  # reads fresh on the first GET, so no poll loop here. Still verify the md5
  # against the listed etag ONCE and fail loud on mismatch — a bad read of a
  # payload would bake corrupt data, and on a write-once key a mismatch means
  # something is genuinely broken, not merely lagging.
  local key="$1" file="$2" want have
  obj_get "$key" "$file" || return $?
  want=$(listed_etag "$key")
  have=$(md5 -q "$file" 2>/dev/null || md5sum "$file" | cut -d' ' -f1)
  if [ -n "$want" ] && [ "$have" != "$want" ]; then
    echo "[data-store] ERROR: write-once $key read etag $have but bucket lists $want — refusing the read"
    return 1
  fi
}
obj_delete() { # key — prune only; a failed delete is loud but the caller decides
  curl -sf -X DELETE -H "Authorization: Bearer $TOKEN" "$API/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1")" -o /dev/null \
    || { echo "[data-store] DELETE $1 failed"; return 1; }
  echo "[data-store] deleted $1"
}
list_keys() { # prefix -> matching keys, one per line (paginates: versions/ grows daily)
  local enc cursor="" page
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1")
  while :; do
    page=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API?prefix=$enc&per_page=1000${cursor:+&cursor=$cursor}") || return 1
    echo "$page" | python3 -c "import json,sys;[print(o['key']) for o in json.load(sys.stdin).get('result',[])]"
    cursor=$(echo "$page" | python3 -c "import json,sys;print(json.load(sys.stdin).get('result_info',{}).get('cursor') or '')" 2>/dev/null || true)
    [ -n "$cursor" ] || break
  done
}

stamp_of() { # lastCrawl out of a meta.json, empty if unreadable
  python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('lastCrawl',''))" "$1" 2>/dev/null || true
}

apply_pulled() { # corpus_key getter — shared tail of pull(): extract, guard, install.
  # $TMP/served.tar.gz is already fetched; the corpus is fetched here with the
  # getter matching its key class (obj_get_once for write-once versions/,
  # obj_get_fresh for the overwritten legacy latest/).
  local corpus_key="$1" getter="$2"
  mkdir -p "$TMP/served" && tar -xzf "$TMP/served.tar.gz" -C "$TMP/served"
  remote=$(stamp_of "$TMP/served/meta.json")
  local_stamp=$(stamp_of public/data/ray/meta.json)
  if [ -n "$local_stamp" ] && [ -n "$remote" ] && [[ "$remote" < "$local_stamp" ]]; then
    echo "[data-store] R2 data ($remote) is OLDER than local ($local_stamp) — keeping local"
    return 0
  fi
  # The R2 served tarball only carries the close-board overlay from the last
  # NIGHTLY; a fresher local copy (a dev checkout, or one seeded before the
  # pull) must survive the wholesale replace. Keep whichever generatedAt is
  # newer. (Since Sep 27 2026 the overlay is not in git; CI deploys seed it
  # AFTER the pull with scripts/ci/seed-close-board.mjs.)
  if [ -f public/data/ray/close-board.json ]; then cp public/data/ray/close-board.json "$TMP/cb-checkout.json"; fi
  rm -rf public/data/ray && mkdir -p public/data/ray
  cp -R "$TMP/served/." public/data/ray/
  if [ -f "$TMP/cb-checkout.json" ]; then
    cb_l=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('generatedAt',''))" "$TMP/cb-checkout.json" 2>/dev/null || echo "")
    cb_r=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('generatedAt',''))" public/data/ray/close-board.json 2>/dev/null || echo "")
    if [ -n "$cb_l" ] && [[ "$cb_l" > "$cb_r" ]]; then
      cp "$TMP/cb-checkout.json" public/data/ray/close-board.json
      echo "[data-store] kept fresher checked-out close-board.json ($cb_l > ${cb_r:-none})"
    fi
  fi
  echo "[data-store] served payloads pulled from R2 (lastCrawl $remote)"
  if "$getter" "$corpus_key" "$TMP/corpus.tar"; then
    mkdir -p data/corpus
    tar -xf "$TMP/corpus.tar" -C data/corpus
    echo "[data-store] corpus pulled from R2"
  else
    echo "[data-store] WARNING: served pulled but corpus missing in R2"
  fi
}

pull() {
  # Route 1 — pointer → write-once version (the fast path). The pointer is the
  # ONLY overwritten object read here, so it alone gets the freshness poll (it
  # is a few bytes; even a full lag window costs pennies of bandwidth). The
  # versioned payloads it names are write-once: first GET is authoritative.
  local ver=""
  if obj_get_fresh "latest/pointer.txt" "$TMP/pointer.txt" && [ -s "$TMP/pointer.txt" ]; then
    ver=$(tr -d '[:space:]' < "$TMP/pointer.txt")
    case "$ver" in
      versions/*) ;;
      *) echo "[data-store] pointer content looks wrong ('$ver') — falling back to legacy keys"; ver="" ;;
    esac
  fi
  if [ -n "$ver" ]; then
    if obj_get_once "$ver/served.tar.gz" "$TMP/served.tar.gz"; then
      echo "[data-store] pulling $ver (write-once keys — no GET-lag wait)"
      apply_pulled "$ver/corpus.tar" obj_get_once
      return
    fi
    # A pointer naming an unreadable version should never happen (push writes
    # the payloads BEFORE the pointer) — the frozen legacy keys still resolve
    # (stale, from before the pointer migration); the freshness guard decides.
    echo "[data-store] WARNING: pointer names $ver but its payload is unreadable — falling back to legacy keys"
  fi
  # Route 2 — LEGACY latest/ keys: pre-migration bucket (no pointer yet) or a
  # broken versioned read. Overwritten keys → the full GET-lag poll applies.
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
  apply_pulled "latest/corpus.tar" obj_get_fresh
}

total_lots_of() { # meta.json → totalLots (0 if unreadable)
  python3 -c "import json,sys;print(int(json.load(open(sys.argv[1])).get('totalLots') or 0))" "$1" 2>/dev/null || echo 0
}

push_guard() { # refuse to overwrite NEWER remote data; keep the shrink baseline monotone.
  # Before Sep 2 2026 push checked only that local files EXISTED: a rerun of a
  # stale checkout (or a fallback monolith run finishing after the nightly)
  # would overwrite the pointer with OLDER data AND write its smaller totals
  # into latest/meta.json — lowering assemble's >10%-shrink baseline to the
  # stale number, so the next night's gate compared against a hollow prior.
  # Now: read the remote baseline (obj_get_fresh on the tiny meta.json — its
  # own lag poll, capped short via DATA_PUSH_META_TRIES), refuse if remote
  # lastCrawl > local lastCrawl, and export the remote totals so the meta
  # write below can keep the larger baseline. DATA_PUSH_FORCE=1 overrides
  # (an explicit, logged rollback — never the default).
  REMOTE_META="$TMP/remote-meta.json"; REMOTE_TOTAL=0
  local rc
  if obj_exists "latest/pointer.txt"; then :; else
    rc=$?
    if [ "$rc" -eq 1 ]; then echo "[data-store] push: no remote pointer yet (first push) — no freshness baseline"; return 0; fi
    [ "${DATA_PUSH_FORCE:-0}" = "1" ] || { echo "[data-store] ERROR: push: bucket listing unavailable — cannot verify remote freshness (DATA_PUSH_FORCE=1 to override)"; return 1; }
    echo "[data-store] WARNING: push: listing unavailable, DATA_PUSH_FORCE=1 — pushing unverified"; return 0
  fi
  rc=0; DATA_FRESH_TRIES=${DATA_PUSH_META_TRIES:-9} obj_get_fresh "latest/meta.json" "$REMOTE_META" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 22 ]; then echo "[data-store] push: pointer present but no latest/meta.json (pre-meta bucket) — no freshness baseline"; return 0; fi
    [ "${DATA_PUSH_FORCE:-0}" = "1" ] || { echo "[data-store] ERROR: push: could not read a FRESH latest/meta.json (rc $rc) — refusing to push blind (DATA_PUSH_FORCE=1 to override)"; return 1; }
    echo "[data-store] WARNING: push: remote meta unreadable, DATA_PUSH_FORCE=1 — pushing unverified"; return 0
  fi
  local remote local_stamp
  remote=$(stamp_of "$REMOTE_META"); local_stamp=$(stamp_of public/data/ray/meta.json)
  REMOTE_TOTAL=$(total_lots_of "$REMOTE_META")
  if [ -n "$remote" ] && [ -n "$local_stamp" ] && [[ "$remote" > "$local_stamp" ]]; then
    if [ "${DATA_PUSH_FORCE:-0}" = "1" ]; then
      echo "[data-store] WARNING: push: R2 data ($remote) is NEWER than local ($local_stamp) — DATA_PUSH_FORCE=1, overwriting anyway (this is a rollback)"
      return 0
    fi
    echo "[data-store] ERROR: push REFUSED — R2 data ($remote) is NEWER than local ($local_stamp); a push now would regress prod. DATA_PUSH_FORCE=1 to roll back deliberately."
    return 1
  fi
  echo "[data-store] push: local $local_stamp ≥ remote ${remote:-none} (remote totalLots $REMOTE_TOTAL) — proceeding"
}

push() {
  test -f data/corpus/lots.json.gz || { echo "[data-store] no corpus to push"; exit 1; }
  test -f public/data/ray/meta.json || { echo "[data-store] no served meta to push"; exit 1; }
  push_guard || exit 1
  # corpus members are already gzipped — plain tar, no double compression
  # + the columnar twin (corpus.parquet, scripts/lib/corpus-parquet.ts) when
  # tonight's build wrote one — pull/pull-version extract it beside the gz
  # NDJSON untouched (the tar is unpacked whole). Already zstd: plain tar.
  # corpus.parquet stays local: nothing reads it from R2 yet, and it would add
  # ~250MB to every write-once version (set CORPUS_TAR_PARQUET=1 to archive it)
  (cd data/corpus && if [ "${CORPUS_TAR_PARQUET:-0}" = 1 ] && [ -f corpus.parquet ]; then tar -cf "$TMP/corpus.tar" ./*.json.gz ./corpus.parquet; else tar -cf "$TMP/corpus.tar" ./*.json.gz; fi)
  (cd public/data/ray && tar -czf "$TMP/served.tar.gz" .)
  # WRITE-ONCE versioned keys — kills the GET-lag at the root. The lag only
  # afflicts same-key overwrites; a fresh key reads true on the first GET. So
  # every push lands under a unique versions/ prefix and only the tiny pointer
  # below is ever overwritten. Prefix: UTC stamp (sorts chronologically, prune
  # relies on it) + short sha (or run id / random) for uniqueness within a second.
  local sha ver
  sha=$(git rev-parse --short HEAD 2>/dev/null || echo "${GITHUB_RUN_ID:-$RANDOM$RANDOM}")
  ver="versions/$(date -u +%Y%m%dT%H%M%SZ)-$sha"
  obj_put "$ver/corpus.tar" "$TMP/corpus.tar"
  obj_put "$ver/served.tar.gz" "$TMP/served.tar.gz"
  # Pointer LAST — a reader can only ever see a version whose payloads are
  # already fully stored and etag-verified above.
  printf '%s' "$ver" > "$TMP/pointer.txt"
  obj_put "latest/pointer.txt" "$TMP/pointer.txt"
  # Same-run handoff (nightly.yml): downstream jobs read EXACTLY this version
  # via `pull-version`, never the pointer (which a later push could move).
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "version=$ver" >> "$GITHUB_OUTPUT"; fi
  # standalone meta.json — a tiny object so assemble can read the PREVIOUS
  # totals for its sanity gate without unpacking the 18MB served tarball.
  # MONOTONE BASELINE: never write a SMALLER totalLots over a larger one —
  # the shrink gate compares against this file, and lowering it lets a
  # series of "small" shrinks pass what one big shrink would have caught.
  # A legitimately smaller corpus (a dedupe pass) keeps the older, larger
  # baseline until DATA_PUSH_FORCE=1 resets it deliberately.
  local local_total; local_total=$(total_lots_of public/data/ray/meta.json)
  if [ "${DATA_PUSH_FORCE:-0}" != "1" ] && [ "${REMOTE_TOTAL:-0}" -gt "$local_total" ]; then
    echo "[data-store] latest/meta.json KEPT at remote baseline (totalLots $REMOTE_TOTAL > local $local_total) — the shrink baseline never lowers without DATA_PUSH_FORCE=1"
  else
    obj_put "latest/meta.json" "public/data/ray/meta.json"
  fi
  # standalone backtest.json — the heavy point-in-time replay runs in its OWN
  # parallel job (off the assemble critical path); assemble pulls the previous
  # one so the served payload always carries a backtest (one cycle behind, and
  # the record barely moves night to night).
  test -f public/data/ray/backtest.json && obj_put "latest/backtest.json" "public/data/ray/backtest.json"
  # standalone calls ledger — the forward-call record MUST persist across
  # nights (assemble rebuilds data/corpus from segments, never from the
  # corpus tar, so anything only inside corpus.tar is reborn empty — the
  # ledger silently reset nightly from Aug 14–24 2026 because of exactly
  # this; grading always saw zero rows).
  test -f data/corpus/calls-ledger.json.gz && obj_put "latest/calls-ledger.json.gz" "data/corpus/calls-ledger.json.gz" || echo "[data-store] no calls ledger to push"
  # the VALUE TAPE (first value every upcoming lot was served — G5's live
  # forward check) persists the same way: it too lived only inside the corpus
  # tar, so the segments rebuild reset it every night and G5 never graded a row
  test -f data/corpus/value-tape.json.gz && obj_put "latest/value-tape.json.gz" "data/corpus/value-tape.json.gz" || echo "[data-store] no value tape to push"
  # the LLM extraction cache (scripts/lib/extract) persists the same way —
  # paid-for results must survive the segments rebuild. Absent until the
  # extraction layer is switched on (ANTHROPIC_API_KEY); then written nightly.
  test -f data/corpus/extract-cache.json.gz && ! test -f data/corpus/.extract-cache-unreadable && obj_put "latest/extract-cache.json.gz" "data/corpus/extract-cache.json.gz" || true
  # dated corpus snapshot — the rollback ladder (replaces git history for data)
  day=$(stamp_of public/data/ray/meta.json | cut -c1-10 | tr -d '-')
  [ -n "$day" ] || day=$(date -u +%Y%m%d)
  obj_put "snapshots/$day/corpus.tar" "$TMP/corpus.tar"
  echo "[data-store] pushed $ver + snapshot $day"
}

prune() { # keep the newest N versions/ prefixes (default 14), delete the rest.
  # versions/ accumulates ~176MB/day; at 14 kept that caps ~2.5GB of history —
  # two weeks of manual rollback ladder. An R2 lifecycle rule on the versions/
  # prefix would make this command unnecessary; until then run it after green
  # nightlies (or on a weekly dispatch). Prefixes start with a UTC timestamp,
  # so plain lexicographic sort IS chronological order.
  local keep="${1:-14}" keys dirs total doomed d k
  keys=$(list_keys "versions/") || { echo "[data-store] prune: listing failed"; exit 1; }
  [ -n "$keys" ] || { echo "[data-store] prune: nothing under versions/ yet"; return 0; }
  dirs=$(echo "$keys" | awk -F/ 'NF>=3{print $1"/"$2}' | sort -u)
  total=$(echo "$dirs" | wc -l | tr -d ' ')
  if [ "$total" -le "$keep" ]; then
    echo "[data-store] prune: $total version(s) ≤ keep=$keep — nothing to do"
    return 0
  fi
  doomed=$(echo "$dirs" | head -n $((total - keep)))
  echo "[data-store] prune: $total versions, keeping newest $keep, deleting $((total - keep))"
  for d in $doomed; do
    for k in $(echo "$keys" | grep "^$d/"); do
      obj_delete "$k"   # a failed delete aborts (set -e): better loud than a silent half-prune
    done
  done
}

# ── SEGMENTS: per-house corpus slices for the staged nightly. Each crawl job
# pull/push-es ONE segment (isolated); assemble pulls them all. R2 key:
# latest/segments/<name>.ndjson.gz. A pull miss (new segment) is non-fatal.
SEGMENTS="goldin sothebys christies bonhams phillips wright rrauction rrauction-archive other juliens propstore"
seg_etag_file() { echo "data/corpus/segments/.$1.pulled-etag"; }
seg_stats_file() { echo "data/corpus/segments/.$1.pulled-stats.json"; }
seg_gate() { # stats <file> | check <house> <prev-stats> <file>  (scripts/ci/segment-gate.ts)
  npx --no-install tsx scripts/ci/segment-gate.ts "$@"
}
seg_version_key() { echo "segment-versions/$1/$(date -u +%Y%m%dT%H%M%SZ).ndjson.gz"; }
seg_stats() { # gz-ndjson file → "<rows> <max stamp>" (validatedAt, else firstSeen, else '')
  python3 - "$1" <<'EOF'
import gzip, json, sys
n = 0; mx = ''
with gzip.open(sys.argv[1], 'rt', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        n += 1
        try: d = json.loads(line)
        except Exception: continue
        v = d.get('validatedAt') or d.get('firstSeen') or ''
        if isinstance(v, str) and v > mx: mx = v
print(n, mx)
EOF
}
push_segment() {
  # LOST-UPDATE GUARD (Sep 2 2026). Every segment writer does pull → mutate →
  # push on the SAME latest/segments/<house> key: the nightly leg, the heal
  # workflows, the backfills, resolve-rrauction. Two of them interleaving
  # meant the second push silently dropped the first one's rows. Now:
  #   1. compare-and-swap — pull_segment records the etag it pulled; if the
  #      bucket lists a DIFFERENT etag at push time, someone else wrote the
  #      segment since we read it → refuse.
  #   2. no recorded etag (a push without a prior pull — e.g. an archive
  #      rebuilt from a local checkpoint) → fetch the true remote (fresh
  #      read) and refuse to replace one that is LARGER (more rows) or NEWER
  #      (later max validatedAt/firstSeen) than what we hold.
  # SEGMENT_PUSH_FORCE=1 overrides both — a deliberate, logged overwrite.
  local name="$1" f="data/corpus/segments/$1.ndjson.gz" key="latest/segments/$1.ndjson.gz"
  test -f "$f" || { echo "[data-store] no segment $name to push — skipping"; return 0; }
  local force="${SEGMENT_PUSH_FORCE:-0}" rc remote_etag pulled_etag
  rc=0; obj_exists "$key" || rc=$?   # (never bare: set -e would abort on rc 1/2)
  if [ "$rc" -eq 1 ]; then
    echo "[data-store] segment $name not in R2 yet — first push"
  elif [ "$rc" -eq 2 ]; then
    [ "$force" = "1" ] || { echo "[data-store] ERROR: push-segment $name: bucket listing unavailable — cannot rule out a concurrent write; refusing (SEGMENT_PUSH_FORCE=1 to override)"; return 1; }
    echo "[data-store] WARNING: push-segment $name: listing unavailable, SEGMENT_PUSH_FORCE=1 — pushing unverified"
  else
    remote_etag=$(listed_etag "$key")
    pulled_etag=$(cat "$(seg_etag_file "$name")" 2>/dev/null || true)
    if [ -n "$pulled_etag" ]; then
      if [ "$remote_etag" != "$pulled_etag" ]; then
        if [ "$force" = "1" ]; then
          echo "[data-store] WARNING: segment $name changed in R2 since it was pulled (etag $pulled_etag → $remote_etag) — SEGMENT_PUSH_FORCE=1, overwriting anyway"
        else
          echo "[data-store] ERROR: push-segment $name REFUSED — R2 segment changed since our pull (etag $pulled_etag → $remote_etag): another writer landed first; re-pull, re-merge, then push (SEGMENT_PUSH_FORCE=1 to overwrite)"
          return 1
        fi
      else
        echo "[data-store] segment $name: R2 unchanged since pull (etag $remote_etag) — safe to replace"
      fi
    elif [ "$force" != "1" ]; then
      # no CAS record → newer/larger check against the TRUE remote
      local remote_f="$TMP/remote-$name.ndjson.gz" lst rst
      if ! obj_get_fresh "$key" "$remote_f"; then
        echo "[data-store] ERROR: push-segment $name: no pull record and the remote could not be read fresh — refusing (SEGMENT_PUSH_FORCE=1 to override)"; return 1
      fi
      lst=$(seg_stats "$f"); rst=$(seg_stats "$remote_f")
      local lrows=${lst%% *} lstamp=${lst#* } rrows=${rst%% *} rstamp=${rst#* }
      [ "$lstamp" = "$lst" ] && lstamp=""; [ "$rstamp" = "$rst" ] && rstamp=""
      if [ "$rrows" -gt "$lrows" ] || { [ -n "$rstamp" ] && [[ "$rstamp" > "$lstamp" ]]; }; then
        echo "[data-store] ERROR: push-segment $name REFUSED — R2 holds a larger/newer segment (remote ${rrows} rows, stamp ${rstamp:-none}; local ${lrows} rows, stamp ${lstamp:-none}). Pull + merge first (SEGMENT_PUSH_FORCE=1 to overwrite)"
        return 1
      fi
      echo "[data-store] segment $name: local ${lrows} rows/${lstamp:-none} ≥ remote ${rrows} rows/${rstamp:-none} — safe to replace"
      [ -s "$(seg_stats_file "$name")" ] || seg_gate stats "$remote_f" > "$(seg_stats_file "$name")" 2>/dev/null || rm -f "$(seg_stats_file "$name")"
    else
      echo "[data-store] WARNING: push-segment $name: no pull record, SEGMENT_PUSH_FORCE=1 — overwriting unverified"
    fi
  fi
  # PER-HOUSE SHRINK + PRICE GATE (Oct 3 2026, scripts/ci/segment-gate.ts):
  # a collapsed or price-poisoned segment must not replace this house's
  # last-good. rc 3 = BLOCKED → the caller's step fails, this house rides its
  # R2 last-good tonight, every other house (and the publish) proceeds.
  # A gate TOOL failure (rc ≠ 0/3) warns and proceeds: the CAS above still holds.
  local stats; stats="$(seg_stats_file "$name")"
  if [ "${SEGMENT_SHRINK_OK:-0}" = "1" ]; then
    echo "[data-store] WARNING: push-segment $name: SEGMENT_SHRINK_OK=1 — per-house shrink gate skipped (deliberate)"
  elif [ -s "$stats" ]; then
    rc=0; seg_gate check "$name" "$stats" "$f" || rc=$?
    if [ "$rc" -eq 3 ]; then
      echo "[data-store] ERROR: push-segment $name BLOCKED by the per-house shrink gate — last-good kept (SEGMENT_SHRINK_OK=1 to override a deliberate shrink)"
      return 3
    elif [ "$rc" -ne 0 ]; then
      echo "::warning title=segment gate unavailable ($name)::gate tool failed (rc $rc) — pushing on the CAS guard alone"
    fi
  else
    echo "[data-store] push-segment $name: no gate baseline (first write, or no prior pull) — shrink gate skipped"
  fi
  # WRITE-ONCE VERSION FIRST (the rollback ladder): segment-versions/<house>/<UTC>.
  # Non-fatal — a failed version write must never cost the night's crawl.
  local vkey; vkey=$(seg_version_key "$name")
  obj_put "$vkey" "$f" || echo "::warning title=segment version not written ($name)::$vkey failed — no rollback copy of tonight's $name"
  obj_put "$key" "$f"
  # the etag we just stored is the new CAS baseline (etag == md5, single-part)
  { md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1; } > "$(seg_etag_file "$name")"
}
pull_segment() {
  # RETRY (Sep 27 2026): a transient 5xx / reset on one segment GET used to
  # redden the whole leg (and every backfill). Three tries with 20s/40s
  # backoff. rc 75 (still stale after the full ~14min GET-lag poll) is NOT
  # retried — a retry would only re-wait the same window.
  local attempt rc=1
  for attempt in 1 2 3; do
    rc=0; pull_segment_once "$1" || rc=$?
    [ "$rc" -eq 0 ] && return 0
    [ "$rc" -eq 75 ] && return 75
    if [ "$attempt" -lt 3 ]; then
      echo "[data-store] pull-segment $1 attempt $attempt failed (rc $rc) — retrying in $((attempt * 20))s"
      sleep $((attempt * 20))
    fi
  done
  echo "[data-store] pull-segment $1 failed after 3 attempts"
  return "$rc"
}
pull_segment_once() {
  # A failed GET must distinguish "not in R2 yet" (bootstrap — fine, crawl
  # seeds it) from "in R2 but unreachable" (transient — must go RED). The old
  # blanket `|| echo fresh` swallowed 5xx/network failures and left a
  # zero-byte .ndjson.gz behind; readSegment throws on that, ray-crawl catches
  # and proceeds seedless, and the 0-length floor bypasses the collapse guard —
  # one flaky GET could overwrite a house's last-good segment with a
  # fresh-only subset. The bucket LISTING is the authority on existence.
  local name="$1" key="latest/segments/$1.ndjson.gz" f="data/corpus/segments/$1.ndjson.gz" grc=0
  mkdir -p data/corpus/segments
  rm -f "$(seg_etag_file "$name")" "$(seg_stats_file "$name")"
  obj_get_fresh "$key" "$f" || grc=$?
  if [ "$grc" -eq 0 ]; then
    # CAS record for push_segment: what we pulled IS the etag (etag == md5 for
    # single-part uploads, and obj_get_fresh only returns 0 on a verified read)
    { md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1; } > "$(seg_etag_file "$name")"
    # shrink-gate BASELINE for push_segment (assemble never pushes: it skips this)
    if [ "${SEGMENT_STATS:-1}" = "1" ]; then
      seg_gate stats "$f" > "$(seg_stats_file "$name")" 2>/dev/null \
        || { rm -f "$(seg_stats_file "$name")"; echo "[data-store] WARNING: could not compute gate stats for $name — its push will run without the shrink gate"; }
    fi
    return 0
  fi
  rm -f "$f"   # never leave a zero-byte gz — missing reads as [], empty THROWS
  # "absent" must come from a LISTING THAT ANSWERED — listed_etag swallows
  # errors into '', so an auth/network outage would otherwise read as "not in
  # R2 yet" and open the seedless path (observed live: a stale local OAuth
  # token made every segment look fresh). Demand a successful list call.
  local listing
  listing=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API?prefix=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$key")" || true)
  if echo "$listing" | grep -q '"success": *true'; then
    if ! echo "$listing" | grep -q "\"key\": *\"$key\""; then
      echo "[data-store] segment $name not in R2 yet (fresh) — crawl will seed it"
      return 0
    fi
  fi
  echo "[data-store] ERROR: segment $name pull failed and R2 does not confirm it absent — refusing a seedless crawl (would overwrite last-good)"
  [ "$grc" -eq 75 ] && return 75
  return 1
}
# Small-file GET (meta/backtest) that can never poison with a zero-byte file:
# an empty meta.json is FATAL in assemble (present-but-unparseable), and an
# empty backtest.json rides into the served artifact and BAKES INTO THE DEPLOY.
# One retry absorbs a transient blip on a 1KB GET; after that the file is
# removed so the first-run paths engage correctly (missing, never empty).
# Sep 2 2026: the old version printed the first-run message on ANY failure,
# so a transient R2 outage degraded assemble to "no baseline" (the shrink
# gate falls back to the absolute floor) and the backtest to "full rebuild"
# with a green log. Now a miss is first-run ONLY when the bucket listing
# confirms the key is absent; a listed key that can't be read — or a listing
# that won't answer — is FATAL (rc 1). For latest/meta.json the pointer is
# the extra tell: a pointer means a push happened, and every push writes meta.
obj_get_clean() { # key file first-run-message [require-if-pointer]
  local key="$1" f="$2" msg="$3" pointer_implies="${4:-}" rc
  obj_get "$key" "$f" && return 0
  rm -f "$f"; sleep 3
  obj_get "$key" "$f" && return 0
  rm -f "$f"
  rc=0; obj_exists "$key" || rc=$?   # (never bare: set -e would abort on rc 1/2)
  if [ "$rc" -eq 0 ]; then echo "[data-store] ERROR: $key is in R2 but could not be read — refusing to degrade to first-run"; return 1; fi
  if [ "$rc" -eq 2 ]; then echo "[data-store] ERROR: $key unreadable and the bucket listing won't answer — refusing to degrade to first-run"; return 1; fi
  if [ -n "$pointer_implies" ]; then
    rc=0; obj_exists "latest/pointer.txt" || rc=$?
    if [ "$rc" -eq 0 ]; then echo "[data-store] ERROR: $key absent but latest/pointer.txt exists — a prior push must have written it; refusing first-run"; return 1; fi
    if [ "$rc" -eq 2 ]; then echo "[data-store] ERROR: cannot confirm $key is a first run (listing failed)"; return 1; fi
  fi
  echo "$msg"
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

# ── PINNED VERSION READ (nightly handoff) ────────────────────────────────────
# assemble's `push` emits the exact versions/<stamp>-<sha> prefix it wrote
# (step output `version`); deploy / sync / backtest read THAT version, never
# the pointer. Write-once keys: the first GET is authoritative, so no lag
# wait, and a later push moving the pointer cannot change what this run
# consumes. Replaces the served-payload / corpus-payload Actions artifacts
# (Sep 27 2026 — the repo is public, so artifacts were downloadable by any
# GitHub user). Installs exactly what it names: no freshness compare.
with_retry() { # cmd… — 3 tries, 10s/20s backoff (transient R2 blips)
  local attempt
  for attempt in 1 2 3; do
    "$@" && return 0
    [ "$attempt" -lt 3 ] && { echo "[data-store] $1 attempt $attempt failed — retrying in $((attempt * 10))s"; sleep $((attempt * 10)); }
  done
  return 1
}
pull_version() { # versions/<…> [served-only]
  local ver="${1:-}" mode="${2:-all}"
  case "$ver" in
    versions/*) ;;
    *) echo "[data-store] ERROR: pull-version needs a versions/<stamp>-<sha> prefix, got '$ver'"; return 1 ;;
  esac
  with_retry obj_get_once "$ver/served.tar.gz" "$TMP/served.tar.gz" \
    || { echo "[data-store] ERROR: $ver/served.tar.gz unreadable"; return 1; }
  rm -rf public/data/ray && mkdir -p public/data/ray
  tar -xzf "$TMP/served.tar.gz" -C public/data/ray
  echo "[data-store] served payloads installed from $ver (lastCrawl $(stamp_of public/data/ray/meta.json))"
  [ "$mode" = "served-only" ] && return 0
  with_retry obj_get_once "$ver/corpus.tar" "$TMP/corpus.tar" \
    || { echo "[data-store] ERROR: $ver/corpus.tar unreadable"; return 1; }
  mkdir -p data/corpus && tar -xf "$TMP/corpus.tar" -C data/corpus
  echo "[data-store] corpus installed from $ver"
}

# ── CI HANDOFF (same-run, job → job) ─────────────────────────────────────────
# Keys: ci-handoff/<GITHUB_RUN_ID>/<name>/a<attempt>-<UTC>.{bin,tar}
#   * run-scoped + write-once: every put lands on a NEW key (attempt + stamp),
#     so reads never hit the overwrite GET-lag and a re-run of a failed job
#     (same run id, next attempt) finds the newest copy — readers take the
#     lexicographically last key under <name>/.
#   * private: lectr-data has no public domain (r2.dev disabled, no custom
#     domain); only the API token can read it.
#   * cleanup: nightly's final `handoff-cleanup` job runs `handoff-clean`
#     (this run's prefix) + `handoff-prune 2` (any run's prefix older than
#     2 days — cancelled runs whose cleanup never ran). Belt-and-braces: an
#     R2 lifecycle rule on prefix ci-handoff/ (see docs/data-pipeline.md).
# A directory is put as a tar and extracted back into the destination dir.
handoff_root() {
  [ -n "${GITHUB_RUN_ID:-}" ] || { echo "[data-store] ERROR: handoff needs GITHUB_RUN_ID (CI only)" >&2; return 1; }
  echo "ci-handoff/$GITHUB_RUN_ID"
}
list_keys_retry() { # prefix — list_keys with 3 tries (a listing blip must not read as "absent")
  local attempt out
  for attempt in 1 2 3; do
    if out=$(list_keys "$1"); then printf '%s' "$out"; return 0; fi
    sleep $((attempt * 5))
  done
  return 1
}
handoff_put() { # name path(file|dir)
  local name="$1" src="$2" root key tmpf
  root=$(handoff_root) || return 1
  [ -e "$src" ] || { echo "[data-store] ERROR: handoff-put $name: $src does not exist"; return 1; }
  key="$root/$name/$(printf 'a%03d' "${GITHUB_RUN_ATTEMPT:-1}")-$(date -u +%Y%m%dT%H%M%SZ)"
  if [ -d "$src" ]; then
    tmpf=$(mktemp "$TMP/hput.XXXXXX")
    tar -cf "$tmpf" -C "$src" .
    obj_put "$key.tar" "$tmpf"
  else
    obj_put "$key.bin" "$src"
  fi
}
handoff_get() { # name dest(file|dir) → 0 ok · 3 none in this run · 2 listing failed · 1 read failed
  local name="$1" dest="$2" root keys key tmpf
  root=$(handoff_root) || return 2
  keys=$(list_keys_retry "$root/$name/") || { echo "[data-store] handoff $name: listing failed"; return 2; }
  [ -n "$keys" ] || { echo "[data-store] handoff $name: none in this run"; return 3; }
  key=$(printf '%s\n' "$keys" | sort | tail -n 1)
  tmpf=$(mktemp "$TMP/hget.XXXXXX")
  with_retry obj_get_once "$key" "$tmpf" || { echo "[data-store] handoff $name: read of $key failed"; return 1; }
  case "$key" in
    *.tar) mkdir -p "$dest" && tar -xf "$tmpf" -C "$dest" ;;
    *) mkdir -p "$(dirname "$dest")" && mv "$tmpf" "$dest" ;;
  esac
  echo "[data-store] handoff $name ← $key"
}
handoff_clean() { # delete this run's whole prefix
  local root keys k n=0
  root=$(handoff_root) || return 1
  keys=$(list_keys_retry "$root/") || { echo "[data-store] handoff-clean: listing failed"; return 1; }
  for k in $keys; do obj_delete "$k"; n=$((n + 1)); done
  echo "[data-store] handoff-clean: deleted $n object(s) under $root/"
}
handoff_prune() { # days — delete ci-handoff/ objects older than N days (any run)
  local days="${1:-2}" enc cursor="" page doomed k n=0
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "ci-handoff/")
  doomed=""
  while :; do
    page=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API?prefix=$enc&per_page=1000${cursor:+&cursor=$cursor}") \
      || { echo "[data-store] handoff-prune: listing failed"; return 1; }
    # objects without a parseable last_modified are never deleted
    doomed="$doomed $(echo "$page" | python3 -c "
import json, sys, datetime
cut = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=float(sys.argv[1]))
for o in json.load(sys.stdin).get('result', []):
    lm = o.get('last_modified') or ''
    try: t = datetime.datetime.fromisoformat(lm.replace('Z', '+00:00'))
    except Exception: continue
    if t < cut: print(o['key'])
" "$days")"
    cursor=$(echo "$page" | python3 -c "import json,sys;print(json.load(sys.stdin).get('result_info',{}).get('cursor') or '')" 2>/dev/null || true)
    [ -n "$cursor" ] || break
  done
  for k in $doomed; do obj_delete "$k"; n=$((n + 1)); done
  echo "[data-store] handoff-prune: deleted $n ci-handoff object(s) older than ${days}d"
}
# assemble's segment intake: this run's crawl handoff first (immediately
# consistent), else the R2 last-good (`other`, rrauction-archive, a failed
# or skipped leg). Parallel: worst case is one GET-lag window, not N.
#
#   assemble-segments <crawl house…> [--archive <archive segment…>]
#
# ARCHIVE-ONLY SEGMENTS (Oct 5 2026 — juliens, propstore; the list lives in
# nightly.yml and scripts/lib/house-status.ts ARCHIVE_SOURCES, kept in step by
# scripts/__tests__/archive-segments.test.ts; rrauction-archive + other ride
# the same path):
# sold-only history written by a backfill (backfill-struts-wayback.yml). No
# crawl leg, so no handoff is looked for. Present in R2 → assembled as
# last-good. CONFIRMED ABSENT (the bucket listing answered and the key is not
# there, e.g. before the first backfill push) → logged and skipped, rc 0: an
# archive that does not exist yet must never cost the night's publish.
# UNREACHABLE (listed but unreadable, or a listing that will not answer) stays
# FATAL exactly as for a crawl house — silently dropping a house's whole
# history is the failure the bucket-listing authority exists to prevent.
#
# Crawl houses keep their rc semantics unchanged (pull_segment's rules: an
# unreachable segment fails, a confirmed-absent one has always passed with no
# rows). Only the .source marker is now honest — 'absent' (was mislabelled
# 'last-good') vs 'unavailable' (was mislabelled 'absent') — and a crawl house
# that contributes no segment at all now raises a ::warning.
assemble_segments() { # houses… [--archive archives…]
  mkdir -p data/corpus/segments
  local h pids="" rc=0 p kind=crawl
  for h in "$@"; do
    if [ "$h" = "--archive" ]; then kind=archive; continue; fi
    (
      # .<house>.source records WHERE tonight's segment came from — the house
      # ledger (scripts/emit-status.ts) counts only a 'handoff' as a fresh crawl
      hrc=3; src="data/corpus/segments/.$h.source"; f="data/corpus/segments/$h.ndjson.gz"
      if [ "$kind" = crawl ]; then
        if [ -n "${GITHUB_RUN_ID:-}" ]; then hrc=0; handoff_get "segment-$h" "$f" || hrc=$?; fi
        if [ "$hrc" -eq 0 ]; then echo "[data-store] segment $h fresh from this run's crawl"; echo handoff > "$src"; exit 0; fi
        [ "$hrc" -ne 3 ] && echo "[data-store] WARNING: segment $h handoff unreadable (rc $hrc) — falling back to R2 last-good"
      fi
      SEGMENT_STATS=0   # subshell-local: assemble never pushes, skip the gate baseline
      if pull_segment "$h"; then
        if [ -s "$f" ]; then echo last-good > "$src"; exit 0; fi
        # pull_segment returns 0 on a CONFIRMED-absent key (listing answered)
        echo absent > "$src"
        if [ "$kind" = archive ]; then
          echo "[data-store] archive segment $h absent in R2 — skipped tonight (nothing pushed to it yet)"
        else
          echo "::warning title=segment $h absent::no handoff and no R2 segment for crawl house $h — it contributes no rows tonight"
        fi
        exit 0
      fi
      echo unavailable > "$src"
      if [ "$kind" = archive ]; then echo "[data-store] ERROR: archive segment $h is in R2 but could not be read — refusing to assemble without it"; fi
      exit 1
    ) & pids="$pids $!"
  done
  for p in $pids; do wait "$p" || rc=1; done
  return $rc
}

# ── SEGMENT ROLLBACK LADDER (Oct 3 2026) ─────────────────────────────────────
# Every push_segment first writes a WRITE-ONCE copy to
# segment-versions/<house>/<YYYYMMDDTHHMMSSZ>.ndjson.gz, then replaces
# latest/segments/<house>.ndjson.gz. (Not under versions/: `prune` treats
# every versions/<x>/ prefix as a corpus version and would count these.)
list_objects() { # prefix → "key<TAB>size<TAB>last_modified" per object (paginated)
  local enc cursor="" page
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1")
  while :; do
    page=$(curl -sf -H "Authorization: Bearer $TOKEN" "$API?prefix=$enc&per_page=1000${cursor:+&cursor=$cursor}") || return 1
    echo "$page" | python3 -c "import json,sys;[print(f\"{o['key']}\t{o.get('size','')}\t{o.get('last_modified','')}\") for o in json.load(sys.stdin).get('result',[])]"
    cursor=$(echo "$page" | python3 -c "import json,sys;print(json.load(sys.stdin).get('result_info',{}).get('cursor') or '')" 2>/dev/null || true)
    [ -n "$cursor" ] || break
  done
}
list_segment_versions() { # house
  local house="${1:?usage: list-segment-versions <house>}" rows
  rows=$(list_objects "segment-versions/$house/") || { echo "[data-store] list-segment-versions: listing failed"; return 1; }
  if [ -z "$rows" ]; then echo "[data-store] no versions of $house yet (versions start with the first push after Oct 3 2026)"; return 0; fi
  echo "$rows" | sort | awk -F'\t' '{ k=$1; sub(".*/", "", k); sub(/\.ndjson\.gz$/, "", k); printf "%-22s %10.1f MB  %s\n", k, $2/1048576, $3 }'
}
pick_segment_version() { # house date|stamp → the newest version key on/at that date (stdout)
  local house="$1" want keys key
  want=$(echo "${2:?date (YYYY-MM-DD, YYYYMMDD or a full stamp) required}" | tr -d ':-')
  keys=$(list_keys_retry "segment-versions/$house/") || { echo "[data-store] listing failed" >&2; return 1; }
  key=$(printf '%s\n' "$keys" | grep -F "segment-versions/$house/$want" | sort | tail -n 1 || true)
  [ -n "$key" ] || { echo "[data-store] ERROR: no version of $house matches '$2' — see: bash scripts/data-store.sh list-segment-versions $house" >&2; return 1; }
  echo "$key"
}
restore_segment() { # house date|stamp — copy that version back over the target (latest/ by default)
  # RESTORE_PREFIX (default 'latest/') redirects the write — the restore drill
  # restores into drill/<run>/ and never touches latest/. Restoring latest/
  # takes effect at the NEXT assemble: publish it now with
  #   gh workflow run nightly.yml -f skip_crawl=true
  # Run it under the house's segment lock (the segment-restore workflow does),
  # or when no nightly/heal is writing that house: in-flight writers are then
  # refused by the CAS guard (their pulled etag no longer matches).
  local house="${1:?usage: restore-segment <house> <date>}" key prefix target cur rc
  prefix="${RESTORE_PREFIX:-latest/}"
  key=$(pick_segment_version "$house" "${2:-}") || return 1
  target="${prefix}segments/$house.ndjson.gz"
  with_retry obj_get_once "$key" "$TMP/restore.ndjson.gz" || { echo "[data-store] ERROR: $key unreadable"; return 1; }
  gzip -t "$TMP/restore.ndjson.gz" || { echo "[data-store] ERROR: $key is not a valid gzip — refusing to restore it"; return 1; }
  echo "[data-store] restore $house ← $key → $target"
  seg_gate stats "$TMP/restore.ndjson.gz" 2>/dev/null | sed 's/^/[data-store]   restored stats: /' || true
  if [ "$prefix" = "latest/" ]; then
    # the restore is itself reversible: version the segment it replaces
    rc=0; obj_exists "$target" || rc=$?
    if [ "$rc" -eq 0 ]; then
      obj_get_fresh "$target" "$TMP/current.ndjson.gz" || { echo "[data-store] ERROR: cannot read the current $target to version it first — refusing"; return 1; }
      cur="segment-versions/$house/$(date -u +%Y%m%dT%H%M%SZ)-prerestore.ndjson.gz"
      obj_put "$cur" "$TMP/current.ndjson.gz"
      echo "[data-store] current $house saved as $cur (undo: restore-segment $house ${cur##*/})"
    elif [ "$rc" -eq 2 ]; then echo "[data-store] ERROR: listing unavailable — refusing to restore blind"; return 1; fi
  fi
  obj_put "$target" "$TMP/restore.ndjson.gz"
  echo "[data-store] restored. $([ "$prefix" = "latest/" ] && echo "Publish it: gh workflow run nightly.yml -f skip_crawl=true")"
}
prune_segment_versions() { # [days=30] [keep_min=3] — age-based, newest keep_min per house always kept
  local days="${1:-30}" keep="${2:-3}" keys doomed k n=0
  keys=$(list_keys_retry "segment-versions/") || { echo "[data-store] prune-segment-versions: listing failed"; return 1; }
  [ -n "$keys" ] || { echo "[data-store] prune-segment-versions: no versions yet"; return 0; }
  doomed=$(printf '%s\n' "$keys" | python3 -c "
import sys, datetime, collections, re
days, keep = float(sys.argv[1]), int(sys.argv[2])
cut = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)).strftime('%Y%m%dT%H%M%SZ')
by = collections.defaultdict(list)
for k in sys.stdin.read().split():
    p = k.split('/')
    if len(p) == 3 and re.match(r'^\d{8}T\d{6}Z', p[2]): by[p[1]].append(k)
for h, ks in by.items():
    ks.sort()
    for k in ks[:-keep] if keep else ks:
        if k.split('/')[2][:16] < cut: print(k)
" "$days" "$keep")
  for k in $doomed; do obj_delete "$k"; n=$((n + 1)); done
  echo "[data-store] prune-segment-versions: deleted $n version(s) older than ${days}d (newest $keep per house always kept)"
}
drill_segment() { # house [date] — RESTORE DRILL: restore into a scratch prefix, verify, diff, clean up
  local house="${1:?usage: restore-drill <house> [date]}" when="${2:-}" key prefix want have keys rc=0
  if [ -z "$when" ]; then
    keys=$(list_keys_retry "segment-versions/$house/") || { echo "[drill] listing failed"; return 1; }
    key=$(printf '%s\n' "$keys" | grep -v prerestore | sort | tail -n 1 || true)
    [ -n "$key" ] || { echo "[drill] FAIL: no versions of $house exist — the rollback ladder is empty"; return 1; }
    when=$(basename "$key" .ndjson.gz)
  fi
  prefix="drill/${GITHUB_RUN_ID:-local-$(date -u +%Y%m%dT%H%M%SZ)}/"
  echo "[drill] restoring $house @ $when into $prefix (latest/ untouched)"
  RESTORE_PREFIX="$prefix" restore_segment "$house" "$when" || return 1
  key=$(pick_segment_version "$house" "$when") || return 1
  want=$(listed_etag "$key")
  with_retry obj_get_once "${prefix}segments/$house.ndjson.gz" "$TMP/drill.ndjson.gz" || { echo "[drill] FAIL: restored copy unreadable"; rc=1; }
  if [ "$rc" -eq 0 ]; then
    have=$(md5 -q "$TMP/drill.ndjson.gz" 2>/dev/null || md5sum "$TMP/drill.ndjson.gz" | cut -d' ' -f1)
    if [ -n "$want" ] && [ "$have" != "$want" ]; then echo "[drill] FAIL: restored md5 $have ≠ version etag $want"; rc=1; else echo "[drill] ✓ restored bytes match the version (md5 $have)"; fi
    if gzip -t "$TMP/drill.ndjson.gz"; then echo "[drill] ✓ gzip intact"; else echo "[drill] FAIL: restored copy is not valid gzip"; rc=1; fi
    seg_gate stats "$TMP/drill.ndjson.gz" > "$TMP/drill-stats.json" || { echo "[drill] FAIL: restored segment does not parse as NDJSON lots"; rc=1; }
    if obj_get_fresh "latest/segments/$house.ndjson.gz" "$TMP/live.ndjson.gz"; then
      echo "[drill] diff vs live latest/segments/$house (restored → live):"
      seg_gate check "$house" "$TMP/drill-stats.json" "$TMP/live.ndjson.gz" || true
    fi
  fi
  for k in $(list_keys_retry "$prefix" || true); do obj_delete "$k" || true; done
  [ "$rc" -eq 0 ] && echo "[drill] PASS: $house restorable from $when" || echo "[drill] FAILED"
  return "$rc"
}

# ── NIGHT STATE: house ledger + engine-gate reports ──────────────────────────
put_gate_report() { # file — every night's validate-engine.json, write-once, kept (KBs)
  local f="${1:-data/qa/validate-engine.json}"
  [ -s "$f" ] || { echo "[data-store] no gate report at $f"; return 0; }
  obj_put "qa/validate-engine/$(date -u +%Y%m%dT%H%M%SZ)-${GITHUB_RUN_ID:-local}.json" "$f"
}
pull_gate_reports() { # dir [n=30] — the newest n archived reports (scripts/ci/gate-replay.ts)
  local dir="${1:-data/qa/gate-reports}" n="${2:-30}" keys k
  mkdir -p "$dir"
  keys=$(list_keys_retry "qa/validate-engine/") || { echo "[data-store] pull-gate-reports: listing failed"; return 1; }
  for k in $(printf '%s\n' "$keys" | sort | tail -n "$n"); do
    with_retry obj_get_once "$k" "$dir/$(basename "$k")" || echo "[data-store] WARNING: $k unreadable"
  done
  echo "[data-store] pulled $(find "$dir" -name '*.json' | wc -l | tr -d ' ') gate report(s) into $dir"
}

# ── UI-SHOTS FIXTURE (a pinned served payload the visual rig renders) ────────
# The rig used to screenshot PROD, so every nightly's data drifted the frames
# (red 28/28 days). Now it builds the site from a FROZEN served payload whose
# R2 key is committed in tests/ui-baseline/FIXTURE, so only code moves pixels.
# `pin-fixture` (run by a human, with R2 write access) copies the CURRENT
# version's served.tar.gz to a write-once fixtures/ key (prune never touches
# fixtures/) and records it; commit FIXTURE with the re-approved baselines.
FIXTURE_FILE=tests/ui-baseline/FIXTURE
pin_fixture() {
  local ver key
  obj_get_fresh "latest/pointer.txt" "$TMP/pointer.txt" || { echo "[data-store] pin-fixture: pointer unreadable"; return 1; }
  ver=$(tr -d '[:space:]' < "$TMP/pointer.txt")
  case "$ver" in versions/*) ;; *) echo "[data-store] pin-fixture: bad pointer '$ver'"; return 1 ;; esac
  obj_get_once "$ver/served.tar.gz" "$TMP/served.tar.gz" || return 1
  key="fixtures/ui-shots/${ver#versions/}/served.tar.gz"
  obj_put "$key" "$TMP/served.tar.gz"
  mkdir -p "$(dirname "$FIXTURE_FILE")"
  printf '%s\n' "$key" > "$FIXTURE_FILE"
  echo "[data-store] pinned $key → $FIXTURE_FILE (commit it with the re-approved baselines)"
}
pull_fixture() { # [key] — default: the key committed in tests/ui-baseline/FIXTURE
  local key="${1:-}"
  [ -n "$key" ] || key=$( { tr -d '[:space:]' < "$FIXTURE_FILE"; } 2>/dev/null || true)
  [ -n "$key" ] || { echo "[data-store] ERROR: no UI fixture pinned ($FIXTURE_FILE missing) — run: bash scripts/data-store.sh pin-fixture"; return 1; }
  with_retry obj_get_once "$key" "$TMP/fixture.tar.gz" || { echo "[data-store] ERROR: fixture $key unreadable"; return 1; }
  rm -rf public/data/ray && mkdir -p public/data/ray
  tar -xzf "$TMP/fixture.tar.gz" -C public/data/ray
  echo "[data-store] UI fixture installed from $key (lastCrawl $(stamp_of public/data/ray/meta.json))"
}

case "${1:-}" in
  pull) pull ;;
  pull-version) pull_version "${2:-}" "${3:-all}" ;;
  handoff-put) handoff_put "$2" "$3" ;;
  handoff-get) handoff_get "$2" "$3" ;;
  handoff-clean) handoff_clean ;;
  handoff-prune) handoff_prune "${2:-2}" ;;
  assemble-segments) shift; assemble_segments "$@" ;;
  pin-fixture) pin_fixture ;;
  pull-fixture) pull_fixture "${2:-}" ;;
  push) push ;;
  push-segment) push_segment "$2" ;;
  pull-segment) pull_segment "$2" ;;
  pull-segments) pull_all_segments ;;
  # previous totals for assemble's sanity gate — a plain (non-fresh) GET is fine;
  # a slightly-stale baseline still catches a catastrophic shrink.
  pull-meta) mkdir -p public/data/ray; obj_get_clean "latest/meta.json" "public/data/ray/meta.json" "[data-store] no prior meta.json yet (first run)" require-if-pointer ;;
  # backtest.json (the published record) + its sidecar accumulator state
  # (data/corpus/backtest-state.json.gz — the raw per-observation arrays the
  # NIGHTLY incremental rehydrates to append new lots). Both carry forward so the
  # incremental has a prior to append to; a missing state is non-fatal (the
  # incremental self-falls-back to a full build, which reseeds the state).
  pull-backtest)
    mkdir -p public/data/ray data/corpus
    obj_get_clean "latest/backtest.json" "public/data/ray/backtest.json" "[data-store] no prior backtest.json yet (first run)"
    obj_get_clean "latest/backtest-state.json.gz" "data/corpus/backtest-state.json.gz" "[data-store] no prior backtest state yet (incremental will full-build)"
    obj_get_clean "latest/calls-ledger.json.gz" "data/corpus/calls-ledger.json.gz" "[data-store] no prior calls ledger yet (accrual starts tonight)"
    obj_get_clean "latest/value-tape.json.gz" "data/corpus/value-tape.json.gz" "[data-store] no prior value tape yet (accrual starts tonight)"
    # advisory: an unreadable cache must never cost a night (it only re-spends)
    obj_get_clean "latest/extract-cache.json.gz" "data/corpus/extract-cache.json.gz" "[data-store] no extraction cache yet (LLM extraction off, or its first night)" || { rm -f data/corpus/extract-cache.json.gz; touch data/corpus/.extract-cache-unreadable; echo "[data-store] WARNING: extraction cache unreadable — running without it, and tonight will NOT overwrite it in R2"; }
    ;;
  push-backtest)
    test -f public/data/ray/backtest.json && obj_put "latest/backtest.json" "public/data/ray/backtest.json" || echo "[data-store] no backtest.json to push"
    test -f data/corpus/backtest-state.json.gz && obj_put "latest/backtest-state.json.gz" "data/corpus/backtest-state.json.gz" || echo "[data-store] no backtest state to push"
    ;;
  prune) prune "${2:-14}" ;;
  list-segment-versions) list_segment_versions "${2:-}" ;;
  restore-segment) restore_segment "${2:-}" "${3:-}" ;;
  prune-segment-versions) prune_segment_versions "${2:-30}" "${3:-3}" ;;
  restore-drill) drill_segment "${2:-}" "${3:-}" ;;
  # the per-house crawl ledger (scripts/emit-status.ts): pulled to .prev, the
  # updated one pushed back EVERY night — publish or not (crawl truth)
  pull-ledger) mkdir -p data/qa; obj_get_clean "latest/house-ledger.json" "data/qa/house-ledger.prev.json" "[data-store] no house ledger yet (first night — bootstrap)" ;;
  push-ledger) test -s data/qa/house-ledger.json && obj_put "latest/house-ledger.json" "data/qa/house-ledger.json" || echo "[data-store] no house ledger to push" ;;
  put-gate-report) put_gate_report "${2:-data/qa/validate-engine.json}" ;;
  pull-gate-reports) pull_gate_reports "${2:-data/qa/gate-reports}" "${3:-30}" ;;
  *) echo "usage: $0 pull|push|pull-version <versions/…> [served-only]|push-segment <name>|pull-segment <name>|pull-segments|assemble-segments <house…> [--archive <segment…>]|pull-meta|pull-backtest|push-backtest|prune [keep=14]|handoff-put <name> <path>|handoff-get <name> <dest>|handoff-clean|handoff-prune [days=2]|pin-fixture|pull-fixture [key]|list-segment-versions <house>|restore-segment <house> <date>|prune-segment-versions [days=30] [keep=3]|restore-drill <house> [date]|pull-ledger|push-ledger|put-gate-report [file]|pull-gate-reports [dir] [n=30]  (env: DATA_PUSH_FORCE=1, SEGMENT_PUSH_FORCE=1, SEGMENT_SHRINK_OK=1, DATA_FRESH_ALLOW_STALE=1, RESTORE_PREFIX=)"; exit 1 ;;
esac
