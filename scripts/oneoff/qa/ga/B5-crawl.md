# B5 — GA-READINESS AUDIT: CRAWL PIPELINE & OPS
Audited 2026-08-03 (ships tomorrow). Every line read of: ray-crawl.ts (3,996), resolve-{sothebys,christies,bonhams,phillips,wright,rrauction}.ts, rr-auction.ts, lib/skip-set.ts, lib/fetch-retry.ts, data-store.sh, corpus-io.ts, assemble.ts, nightly.yml, deploy.yml, ray-crawl.yml, sync-lots-db.ts, match-alerts.ts, send-digest.ts. Cross-checked against app/lib/validate.ts and app/types.ts (PriceBasis).

Verdict: the core merge/eviction/promotion design is defensively sound (see VERIFIED-SOUND), but there is **one end-to-end data-loss chain that ships (B1)**, the **known deploy concurrency race (B2, fix specced in Appendix A)**, and the **alerts/DB sync leg is silently dead on every normal night (B3)**.

---

## BLOCKERS

### B1 · Transient R2 segment-pull failure → last-good segment overwritten with a fresh-only subset — and it PUBLISHES
- `scripts/data-store.sh:285-290` — `pull_segment` runs `obj_get_fresh … || echo "segment not in R2 yet (fresh) — crawl will seed it"`. **Any** failure (5xx, network, expired token — not just 404) is swallowed, and `curl -sf -o file` leaves a **zero-byte** `data/corpus/segments/<house>.ndjson.gz` behind.
- `scripts/corpus-io.ts:63-67` — `readSegment` sees the file exists → `gunzipSync(empty)` **throws**.
- `scripts/ray-crawl.ts:3131-3146` — that throw is caught and logged (`Could not read corpus`) and the run proceeds with `existingLots = []`: the merge has **no seed**, incremental skip-set is empty (full crawl, but only of *currently discoverable* sales), carry-forward is gone.
- `scripts/ray-crawl.ts:3902` — the segment-collapse guard is `existingLots.length > 200 && segLots.length < existingLots.length * 0.7`. With `existingLots.length === 0` the floor **bypasses the guard entirely** → `writeSegment` writes the fresh-only subset, and `nightly.yml:120-121` `push-segment` **overwrites the intact last-good segment in R2**.
- Downstream backstop fails for mid-size houses: `assemble.ts:51-61` gates only **total** corpus/sold at 10%. Losing e.g. the christies segment (~25k lots ≈ 3% of 761k) sails through and **ships**; house-level tripwires (`ray-crawl.ts:3881-3888`) are warn-only, and assemble has no house-count check (the monolith's houses-vanished gate at `ray-crawl.ts:3946-3950` does not run in the segmented path). For goldin (~40% of corpus) assemble goes red — but the R2 segment is *already* overwritten, wedging every subsequent night on a truncated baseline until a manual `versions/` restore.
- **Failure scenario:** one flaky R2 GET during the 06:00 UTC pull on launch week → permanent loss of a house's non-rediscoverable history (artist-page lots, resolver-recovered results, firstSeen/bidHistory) in prod.
- **Fix (3 parts, ~10 lines):**
  1. `pull_segment`: capture the HTTP code (`curl -w '%{http_code}'`); on 404 `rm -f` the empty file and continue (bootstrap path — `readSegment` returns `[]` for a *missing* file); on anything else `rm -f` and `return 1` so the matrix leg goes red (assemble then falls back to the intact R2 last-good).
  2. `ray-crawl.ts` corpus-load catch: when `CRAWL_HOUSE` is set and `segments/<house>.ndjson.gz` exists on disk but failed to parse, **rethrow** (abort the run) instead of proceeding empty.
  3. Belt-and-braces at `ray-crawl.ts:3902`: also refuse the write when `existingLots.length === 0` while the segment file exists.

### B2 · nightly deploy job vs deploy.yml concurrency race (known, unfixed) — exact fix in Appendix A
- `.github/workflows/nightly.yml:285-332` (deploy job, concurrency group `nightly` inherited from the run) vs `.github/workflows/deploy.yml:14-16` (group `deploy-collectr`) — **different groups, both run `wrangler pages deploy out --project-name collectr`**. `ray-crawl.yml:116-122` (manual monolith) is a third racer with **no group at all**.
- **Failure scenario:** a code push to main lands while the nightly deploy leg is running (or vice-versa). Two wrangler deploys interleave; whichever *finishes last* wins Cloudflare Pages production. The nightly leg checked out main at run start — if the push deploy finishes first, the nightly leg then re-publishes the **older** commit's build over it. Launch-week hotfix silently reverted.
- **Fix:** put all three deploy-bearing jobs in the single `deploy-collectr` group (Appendix A), plus the optional hardening that closes the queued-stale-checkout tail.

### B3 · sync job never receives the corpus — sync-lots-db + match-alerts silently dead every normal night
- `.github/workflows/nightly.yml:334-372` — the sync job downloads only the **served-payload** artifact (`public/data/ray`); the R2 fallback (`data-store.sh pull`, which *would* fetch `data/corpus/`) is skipped whenever `public/data/ray/meta.json` exists — i.e. **every night assemble succeeds**. Only the backtest job downloads `corpus-payload` (`nightly.yml:253-258`).
- `scripts/sync-lots-db.ts:22` and `scripts/match-alerts.ts:71` both call `readCorpus()` → `corpus-io.ts:174` **throws** (`lots.json(.gz) not found … refusing to read the stripped served files`). The step-level `|| echo "… failed (non-fatal)"` (`nightly.yml:365-367`) masks it green.
- **Failure scenario:** Supabase `lots` mirror goes stale (permalink fast-path + ⌘K search layer degrade), zero alert rows are written, digests have nothing to send — from GA day one, with an all-green Actions page.
- **Fix:** add the `corpus-payload` artifact download to the sync job (same block as the backtest job), and extend the fallback condition to `[ -f public/data/ray/meta.json ] && [ -f data/corpus/lots.json.gz ]` (as the backtest job already does at `nightly.yml:260-265`).

---

## PRE-GA

### P1 · sync-lots-db sweep can delete the entire live book on a hollow run
- `scripts/sync-lots-db.ts:79-84` — the sweep `DELETE …?updated_at=lt.<now>` runs after the upsert loop. If `rows.length === 0` (corpus readable but zero upcoming — e.g. a status-mangling crawler bug that passes assemble's *total*-count gate) the loop no-ops cleanly and the sweep **deletes every row in `public.lots`**. Header comment ("rows are upserted, never deleted") also contradicts the sweep — permalinks to sold lots are already being deleted by design; confirm that's intended.
- **Fix:** refuse the sweep when `rows.length === 0` or when `rows.length` < ~50% of the current table count (one `HEAD` with `Prefer: count=exact`); log loudly and skip.

### P2 · RR live segment is a wholesale replace — sold results of de-listed sales are dropped nightly
- `scripts/resolve-rrauction.ts:454-463` — `--write` replaces `rrauction` with **only this run's discovered sales**. A closed sale that falls off `/auctions/` discovery (`discoverSaleIds`, :242-258) takes its **sold rows** with it; nothing archives post-backfill sales (747+) into `rrauction-archive` (the archive was a one-time harvest, :311-406). Partial discovery (markup drift showing 3 of 5 sales) silently halves the segment the same way — the refuse-empty guards (:425-430, :457-461) only catch *zero*.
- **Fix:** merge-carry-forward: read the prior segment, keep every prior lot whose `saleId` was **not** crawled this run (or whose status is sold), then write; alternatively move a sale's rows to `rrauction-archive` when it disappears from discovery. Also add a >30% shrink guard mirroring `ray-crawl.ts:3902`.

### P3 · RR rows stamped with an invalid priceBasis `'premium'`
- `scripts/resolve-rrauction.ts:301` — `priceBasis: realizedUsd != null ? 'premium' : undefined`, but `app/types.ts:16-18` defines `PriceBasis = 'realized' | 'hammer-only' | 'final-bid-plus-bp' | 'last-tracked-bid' | 'hammer' | 'goldin-final-bid'` — `'premium'` is not a member (hidden by the `as AuctionLot` cast). All RR rows **including the 252K sold archive** carry an unknown basis; any consumer branching on basis (dual-basis backtest, basis captions) misclassifies them. `assertInvariants` passes it (truthy).
- **Fix:** stamp `'realized'` (the value *is* premium-inclusive, :293-295); one-time re-stamp of the archive segment.

### P4 · Goldin: a 200-with-empty-page mid-pagination marks the feed complete → zero-bid live lots mass-evicted
- `scripts/ray-crawl.ts:2224-2227` (facet pass; same shape at :2247-2251 Sport, :2272-2277 Culture) — `if (!lots.length) break;` exits the while loop **without** setting `goldinFeedComplete = false`; only a thrown error or `total > CAP` does. A transient empty-array response at `from=500/3000` yields a partial `freshGoldinIds` that the merge treats as fully enumerated.
- `scripts/ray-crawl.ts:3391-3402` — absence from a "complete" feed then evicts every zero-bid lot with an `auctionId` (and stale no-auctionId lots) via `badIds`. Recovered lots re-ingest next run with a **fresh `firstSeen`** (false "New today") and lose `bidHistory`; bid-carrying lots are held (good).
- **Fix:** after each pass, `if (from < Math.min(total, CAP)) goldinFeedComplete = false;` — mirrors the CAP check one line below.

### P5 · Two unbounded enrichment passes can blow the 60-minute crawl job
- `scripts/ray-crawl.ts:1456-1484` (`enrichSothebysCloseTimes`: CAP 1000, CONC 6, 20s timeout → worst ≈55 min) and `:3492-3522` (Christie's onlineonly rescue: CAP 1500, CONC 6, 20s → worst ≈83 min) have **no wall-clock budget**, unlike `enrichLots` (`ENRICH_TIME_BUDGET_MS`, :2965). A stalled host walks the leg into the `nightly.yml:83` 60-min kill → segment never written → the night is lost for that house (last-good survives, so no corruption).
- **Fix:** add the same `Date.now() - start > BUDGET` break (e.g. 8 min each) to both loops.

### P6 · pull-meta / pull-backtest failure poisons with zero-byte files
- `scripts/data-store.sh:310, 316-320` — a failed `obj_get` leaves empty `public/data/ray/meta.json` / `backtest.json` / `backtest-state.json.gz`. Empty meta → `assemble.ts:44-49` treats present-but-unparseable as **fatal** → the whole night dies on a transient blip on a 1KB GET (fail-closed, but fragile). Empty `backtest.json` is worse: it rides into the served-payload artifact and gets **baked into the deploy** — the client's eager backtest read hits a JSON parse error.
- **Fix:** on `obj_get` failure `rm -f` the target file (missing ⇒ first-run paths engage correctly); add one retry.

### P7 · assemble's sanity gate has no per-house dimension
- `scripts/assemble.ts:51-68` — only total lots / total sold at 10% + first-run floor. A single small-to-mid segment wiped (B1's aftermath, or a bad resolver write) publishes; the monolith's houses-vanished check (`ray-crawl.ts:3946-3950`) has no assemble equivalent.
- **Fix:** persist per-segment counts in `meta.json` (`{ segments: { goldin: N, … } }`) and refuse when any segment with ≥1k prior lots shrinks >30% or vanishes.

### P8 · send-digest re-emails on same-day reruns
- `scripts/send-digest.ts:21, 74-77` — the cadence guard is purely `created_at ≥ now-26h`; alerts carry no emailed marker. A rerun of the sync job (manual dispatch, rerun after a flake — `nightly.yml` sync is `if: always()`) re-selects the same alerts and **sends duplicate digests**.
- **Fix:** add `emailed_at` to `alerts`; select `emailed_at=is.null&created_at=gte.<since>`, PATCH after a successful send.

### P9 · send-digest / match-alerts unpaginated Supabase reads
- `scripts/send-digest.ts:75` (`alerts?…`), `:79` (`saved_searches`), `scripts/match-alerts.ts:67` — PostgREST default caps responses at 1,000 rows; a big night silently truncates (some users get no digest; some searches never match). **Fix:** paginate with `Range` headers or `limit=…&offset=…` loops.

### P10 · W11 zombie-reconcile can withdraw a live lot after a per-artist page failure
- `scripts/ray-crawl.ts:3410-3431` — the guard is house-level (`houseOk` = house returned ≥1 lot anywhere) + artist-level (`crawledArtists` = artist produced a lot from **any** house). If `crawlSothebys` for artist X returns `[]` on an HTTP error (:608-610) while other artists succeeded, X's past-sale-day Sotheby's upcoming lots are marked withdrawn/unknown-result. The sanitize net re-holds them only within the 14-day window (:3468). The in-code comment accepts this; tightening is cheap.
- **Fix:** key reconcile authority on (artist × house) pairs actually present in `freshLots`, not the two independent sets.

---

## POST-GA

- **G1** `ray-crawl.ts:1603, 1869` — sold lots with a missing `endDate` get `saleDate = now` (fabricated date on a real sale; violates the honesty doctrine at the margin). Prefer prior `saleDate` carry or hold pending.
- **G2** `ray-crawl.ts:3286-3302` — merge carries medium/dims/year/image/estimates/firstSeen but **not** `description`/`saleDateTime`: a fresh copy from a path lacking them (Sotheby's artist page, Wright basic) wipes enriched values.
- **G3** `scripts/lib/fetch-retry.ts:74-81` — a 429 sleeps its rate-limit backoff *and* the top-of-loop 5xx backoff on the next iteration (double sleep). Harmless, just slower.
- **G4** `ray-crawl.ts:2106-2107` — Goldin `ingest` drops lots with no end timestamp silently (not routed through `parseDrop`); invisible to the health line.
- **G5** `resolve-phillips.ts:82-97` — maker-id map is regex-parsed out of ray-crawl.ts source; a refactor of `ARTISTS` silently empties it (fails safe to untouched, but the resolver quietly stops resolving). Export the table instead.
- **G6** `ray-crawl.ts:1423-1447` (`sothebysAuctionLots`) — `res.json()` without `res.ok`; a final-attempt 5xx HTML body throws → silent `break` → truncated sale (prior copies carry forward, so bounded).
- **G7** `ray-crawl.yml` — documented KNOWN GAP: a monolith fallback run's data is reverted by the next segmented nightly unless bootstrap-segments is run. Keep dispatch-only; consider adding the bootstrap step to the workflow itself.
- **G8** `send-digest.ts:112` — sort comparator never returns 0 for equal keys (stable-sort nit only).

---

## VERIFIED-SOUND

1. **fetch-retry never-retry-4xx** (`lib/fetch-retry.ts:74-89`): only 429 and ≥500 retry; 404/403 return immediately; final failed response is *returned* so `!res.ok` call sites work; fresh `AbortSignal.timeout` per attempt; Retry-After honored, clamped to 30s.
2. **skip-set fail-open** (`lib/skip-set.ts` + `ray-crawl.ts:1557-1561, 1821-1826`): segment-read error → `skippable.clear()` → full crawl. Predicate is conservative (all-terminal ∧ not pending ∧ not online-only ∧ datable ∧ older than 14d; empty group can never skip; saleName superset keying only adds strictness); discovery-resurfaced sales always re-fetched (:1552-1556, 1816-1820).
3. **Goldin promotion/eviction gating** (`ray-crawl.ts:2059-2068, 2380-2390, 3366, 3391`): promotion requires a *verified* auctions-status fetch (`goldinStatusOk`); eviction additionally requires a fully-enumerated live feed (`goldinFeedComplete`); a transient API failure defers everything to the next run — no mass-evict from an empty Completed set (modulo P4's empty-page edge). Bid-carrying lots absent from a complete feed are held, never evicted (:3398-3399).
4. **Completed-flip promotion money** (:3369-3387): full stampMoney block, byte-identical shape to `ingestSold`; sold-index rows win over promotion (byId precedence :2162).
5. **Merge carry-forward** (:3282-3303): medium, dimensions, year, imageUrl, all six estimate fields (null-checked, fresh-wins-when-present), `firstSeen` (never re-stamped, never fabricated for pre-feature rows), Goldin `bidHistory` (59-snap cap, change-only appends).
6. **Refuse-empty guards**: RR throws on 0 discovered sales (:425-430) and 0 extracted lots (:457-461); assemble throws on 0 segments (`assemble.ts:31`); `readCorpus` refuses the stripped served fallback (`corpus-io.ts:165-179`); monolith publish gate 3% shrink + sold shrink + houses-vanished, with the swallow-proof NDJSON read (`ray-crawl.ts:3920-3957`); segment gate 30%/200-floor (:3896-3904, B1 caveat).
7. **Invariant write-gate** (:3775-3812): pure report; >30 fatals aborts with JSON untouched; ≤30 dropped + recheck; runs on the full corpus before the payload split.
8. **Coverage + house tripwires** (:3814-3888): pre-crawl baseline snapshotted *before* in-place status mutation (:3227-3238); greppable `[coverage]`/`[health]`/tripwire lines.
9. **R2 write-once discipline** (`data-store.sh:217-249`): unique `versions/<UTC>-<sha>` prefixes; payloads PUT and etag-verified **before** the pointer flips; only the tiny pointer is ever overwritten (GET-lag confined to a few bytes); dated snapshot ladder + prune keep-14.
10. **PUT retry idempotency** (:90-117): 3 attempts, same-key re-PUT atomic; every PUT's returned etag compared to local md5 — a silent store corruption cannot pass. Write-once GETs verified once against the listed etag, refusing a mismatched read (:119-133).
11. **Freshness guard** (:154-176): pull refuses to overwrite newer local data with older R2 data (lastCrawl compare).
12. **Secrets hygiene**: no `set -x` anywhere; `SOTHEBYS_COOKIE` only ever enters request headers (`ray-crawl.ts:1323-1324`); token never echoed (PUT-reject logs truncated API JSON only); Supabase/Resend keys only in headers; workflow secrets referenced via `secrets.*` with `permissions: contents: read`.
13. **Resolvers** (sothebys/christies/bonhams/phillips/wright): positive-signal-only adjudication; exact identity matching (URL-tail; Bonhams sale+lot+suffix cross-check :123-131); fetch failure / ambiguity → untouched, never guessed; dry-run default; non-fatal in the nightly (`nightly.yml:117-119`); segment length unchanged by writes.
14. **match-alerts cap/dup**: `MAX_PER_SEARCH = 50` (:19, :78); `on_conflict=search_id,lot_id` + `ignore-duplicates` (:81-84) → one alert per (search, lot) ever; the 40h window's overnight overlap is safely absorbed by the conflict key.
15. **Workflow structure**: matrix `fail-fast: false`; assemble `if: always()` with artifact-first + R2-last-good fallback per segment; deploy gated on assemble success; backtest `continue-on-error` off the critical path; artifact retention/if-no-files-found correct; a crawl step failure correctly suppresses that leg's push + artifact (assemble then uses last-good).
16. **Deploy guards**: build self-consistency (chunk existence) + post-deploy live-JS probe in both deploy paths (`deploy.yml:62-115`, `nightly.yml:319-332`).
17. **NDJSON corpus codecs** (`corpus-io.ts:48-144`): buffer-safe past V8's 512MB string limit; distinct `.ndjson.gz` key avoids the observed R2 overwrite-lag misparse; defensive array-line flattening.

---

## APPENDIX A — ready-to-apply concurrency-group fix (B2)

**1. `.github/workflows/nightly.yml` — add a job-level concurrency block to the deploy job** (job-level groups compose with the run-level `nightly` group; the run keeps its own group, the deploy *job* additionally serializes against deploy.yml):

```yaml
  deploy:
    needs: assemble
    # run whenever assemble succeeded — even in skip_crawl mode, where the
    # skipped crawl would otherwise skip this whole downstream job.
    if: ${{ !cancelled() && needs.assemble.result == 'success' }}
    # ONE production-deploy lane shared with deploy.yml (and ray-crawl.yml):
    # never two wranglers racing pages production. Queue, don't cancel — a
    # nightly data deploy must not kill an in-flight code deploy or vice versa.
    concurrency:
      group: deploy-collectr
      cancel-in-progress: false
    runs-on: ubuntu-latest
    timeout-minutes: 20
```

**2. `.github/workflows/deploy.yml` — keep the group, stop cancelling cross-workflow runs** (cancel-in-progress from a push run would kill the nightly's deploy leg mid-upload; queueing is strictly safer and pushes are rare):

```yaml
concurrency:
  group: deploy-collectr
  cancel-in-progress: false
```

**3. `.github/workflows/ray-crawl.yml` — the manual monolith also deploys; give its job the same lane:**

```yaml
jobs:
  crawl:
    runs-on: ubuntu-latest
    concurrency:
      group: deploy-collectr
      cancel-in-progress: false
    timeout-minutes: 90
```

**Residual tail + optional hardening:** serialization fixes interleaving but not staleness — a queued nightly deploy leg still ships the commit checked out at *run start*, which can post-date-revert a push that deployed while it was queued. Close it with one step at the top of the nightly deploy job (after checkout):

```yaml
      - name: Fast-forward to origin/main (never deploy a stale checkout)
        run: |
          git fetch --depth=1 origin main
          git checkout --force origin/main
          echo "deploying $(git rev-parse --short HEAD)"
```

(The cleaner long-term shape: nightly's deploy job becomes `gh workflow run deploy.yml` — a single deploy pipeline, always HEAD + freshest R2 — but that adds `actions: write` and run-watch plumbing; the block above is sufficient for GA.)

---

## COUNTS

- **BLOCKER: 3** (B1 segment-pull fail-open data-loss chain · B2 deploy concurrency race · B3 sync job corpus-starved)
- **PRE-GA: 10** (P1–P10)
- **POST-GA: 8** (G1–G8)
- **Verified-sound: 17** subsystems

## WORST 5

1. **B1** — one transient R2 GET failure overwrites a house's last-good segment with a fresh-only subset, and for mid-size houses it publishes (permanent history loss on launch week). Three small fixes; do before GA.
2. **B2** — dual-workflow wrangler race can revert a launch-week hotfix in production. Appendix A is copy-paste ready.
3. **B3** — alerts/permalink pipeline silently dead every normal night (`readCorpus` throws, masked by `|| echo`); one artifact-download block fixes it.
4. **P2** — RR live segment wholesale replace drops sold results of every sale that leaves discovery; nothing archives post-backfill closed sales — ongoing nightly data loss.
5. **P4** — a single 200-with-empty-body Goldin page marks the feed "complete" and mass-evicts zero-bid live lots (firstSeen/bidHistory destroyed, false "New today" on return). One-line fix.
