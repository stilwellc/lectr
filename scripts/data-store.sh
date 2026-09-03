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
  # The intraday close-board overlay is committed to git every 4h, but the R2
  # served tarball only carries the copy from the last NIGHTLY — replacing the
  # dir wholesale froze the overlay at ~1x/day (up to ~28h stale). Keep
  # whichever generatedAt is newer.
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
  (cd data/corpus && tar -cf "$TMP/corpus.tar" ./*.json.gz)
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
SEGMENTS="goldin sothebys christies bonhams phillips wright rrauction rrauction-archive other"
seg_etag_file() { echo "data/corpus/segments/.$1.pulled-etag"; }
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
    else
      echo "[data-store] WARNING: push-segment $name: no pull record, SEGMENT_PUSH_FORCE=1 — overwriting unverified"
    fi
  fi
  obj_put "$key" "$f"
  # the etag we just stored is the new CAS baseline (etag == md5, single-part)
  { md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1; } > "$(seg_etag_file "$name")"
}
pull_segment() {
  # A failed GET must distinguish "not in R2 yet" (bootstrap — fine, crawl
  # seeds it) from "in R2 but unreachable" (transient — must go RED). The old
  # blanket `|| echo fresh` swallowed 5xx/network failures and left a
  # zero-byte .ndjson.gz behind; readSegment throws on that, ray-crawl catches
  # and proceeds seedless, and the 0-length floor bypasses the collapse guard —
  # one flaky GET could overwrite a house's last-good segment with a
  # fresh-only subset. The bucket LISTING is the authority on existence.
  local name="$1" key="latest/segments/$1.ndjson.gz" f="data/corpus/segments/$1.ndjson.gz"
  mkdir -p data/corpus/segments
  rm -f "$(seg_etag_file "$name")"
  if obj_get_fresh "$key" "$f"; then
    # CAS record for push_segment: what we pulled IS the etag (etag == md5 for
    # single-part uploads, and obj_get_fresh only returns 0 on a verified read)
    { md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1; } > "$(seg_etag_file "$name")"
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

case "${1:-}" in
  pull) pull ;;
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
    ;;
  push-backtest)
    test -f public/data/ray/backtest.json && obj_put "latest/backtest.json" "public/data/ray/backtest.json" || echo "[data-store] no backtest.json to push"
    test -f data/corpus/backtest-state.json.gz && obj_put "latest/backtest-state.json.gz" "data/corpus/backtest-state.json.gz" || echo "[data-store] no backtest state to push"
    ;;
  prune) prune "${2:-14}" ;;
  *) echo "usage: $0 pull|push|push-segment <name>|pull-segment <name>|pull-segments|pull-meta|pull-backtest|push-backtest|prune [keep=14]  (env: DATA_PUSH_FORCE=1, SEGMENT_PUSH_FORCE=1, DATA_FRESH_ALLOW_STALE=1)"; exit 1 ;;
esac
