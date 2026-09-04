# Data pipeline — where the lot data lives

The auction data does NOT live in git. It lives in two places:

## 1. Cloudflare R2 — the store of record

Bucket **`lectr-data`** (account 5bcc5f43136c9ba6b6cb7f949813f473). Payloads
are **write-once**: every push lands under a fresh `versions/<UTC>-<sha>/`
prefix and only the tiny `latest/pointer.txt` is ever overwritten (this
sidesteps R2's GET-lag on overwritten keys — see the header of
`scripts/data-store.sh`).

| object | contents |
| --- | --- |
| `latest/pointer.txt` | names the current `versions/` prefix — the only overwritten object a pull waits on |
| `versions/<stamp>/corpus.tar` | `data/corpus/{lots,sold-archive}.json.gz` — the full v2 corpus (~76 fields/lot), engine + build only, never served |
| `versions/<stamp>/served.tar.gz` | `public/data/ray/` — the slim client payloads (shards, meta, market, backtest…) |
| `latest/meta.json` | standalone copy of the served `meta.json` — assemble's >10%-shrink **baseline**; monotone (see push) |
| `latest/segments/<house>.ndjson.gz` | per-house corpus segments (`data/corpus/segments/`) — the staged nightly's unit of crawl; `assemble.ts` reunions them into the full corpus |
| `latest/backtest.json`, `latest/backtest-state.json.gz`, `latest/calls-ledger.json.gz` | the backtest record + its accumulator + the forward-calls ledger, carried night to night |
| `snapshots/YYYYMMDD/corpus.tar` | nightly corpus snapshot, auto-expired after 30 days (lifecycle rule `expire-snapshots`) — the rollback ladder |

(The pre-migration `latest/corpus.tar` / `latest/served.tar.gz` keys are
frozen — no longer written; `pull` keeps them only as a last-resort fallback
for a pointer-less bucket.)

Moved by `scripts/data-store.sh` (`npm run data:pull` / `npm run data:push`):

- **pull** — resolves the pointer, fetches its write-once version; compares
  `meta.json` `lastCrawl` and refuses to overwrite newer local data with
  older R2 data. A pointer read that is still stale after the GET-lag poll
  window (~14 min), or whose freshness the bucket listing cannot confirm,
  **fails** (rc 75) instead of being used anyway (`DATA_FRESH_ALLOW_STALE=1`
  restores the permissive behaviour, deliberately).
- **push** — fails loud if there is nothing to push. **Freshness guard
  (Sep 2 2026):** reads the remote `latest/meta.json` fresh and **refuses**
  when R2's `lastCrawl` is newer than the local one (`DATA_PUSH_FORCE=1`
  = a deliberate, logged rollback). Writes the payloads first, the pointer
  last, plus the dated snapshot. `latest/meta.json` is **monotone**: a push
  whose `totalLots` is smaller than the remote baseline keeps the remote
  file, so the shrink gate can never be lowered by a stale or hollow push.
- **pull-meta / pull-backtest** — a miss is "first run" ONLY when the bucket
  listing confirms the key is absent (and, for `meta.json`, no pointer
  exists). A listed key that can't be read, or a listing that won't answer,
  is **fatal** — assemble never silently runs without its baseline.
- **pull-segment / push-segment** — see *Segment locks* below.
- **prune** — keeps the newest 14 `versions/` prefixes.

Auth: locally wrangler's OAuth session; in CI `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` (the token needs **Account → Workers R2 Storage →
Edit** in addition to Pages).

Flow:
- `nightly.yml` — crawl (one job per house: pull-segment → crawl →
  push-segment) → assemble (sanity gate, engine, `push`) → deploy / sync /
  backtest. Same-run artifacts carry segments and payloads between jobs;
  R2 is the recovery source and tomorrow's baseline.
- `ray-crawl.yml` (manual fallback monolith) pulls before the crawl, pushes
  after the payload builds, then builds and deploys the site itself.
- `deploy.yml` pulls the served payloads before `next build` so any code
  push bakes the freshest data — and **refuses to deploy data older than
  production** (it compares the pulled `meta.json` `lastCrawl` against
  `https://lectr.bid/data/ray/meta.json`; `DEPLOY_ALLOW_OLDER=1` repo
  variable for a deliberate rollback). It fires on every close-board bot
  commit (6×/day), which is exactly when a stale pull would otherwise
  regress prod.
- `close-board.yml` commits the intraday bid overlay to git every 4h; the
  on-push deploy ships it. The client applies an overlay entry when the
  overlay is newer than the base `upcoming.json` OR when the entry's bid /
  bid count is strictly higher than the base lot's (a bid can only rise, so
  higher is later) — a strictly-newer bid is never discarded.
- Local dev: `npm run data:pull` when your checkout's data is stale.

### Segment locks (the lost-update race)

Every writer of `latest/segments/<house>.ndjson.gz` does pull → mutate →
push. Two of them interleaving (a heal or backfill dispatched while the
nightly's crawl leg for the same house is running) silently dropped the
first writer's rows. Two defences, both required:

1. **Workflow concurrency group per house.** `nightly.yml`'s crawl matrix
   sits in `segments-<house>`. Every other workflow that pushes that
   house's segment MUST use the same group so GitHub queues them:

   ```yaml
   # gallery-heal.yml (matrix over lelands/memorylane/lotg)
   concurrency:
     group: segments-${{ matrix.house }}
     cancel-in-progress: false
   # nflauction-heal.yml, backfill-nflauction.yml
   concurrency: { group: segments-nflauction, cancel-in-progress: false }
   # backfill-mlbauction.yml
   concurrency: { group: segments-mlbauction, cancel-in-progress: false }
   # backfill-struts-wayback.yml (dispatch input picks the house)
   concurrency: { group: segments-${{ inputs.house }}, cancel-in-progress: false }
   # resolve-rrauction.yml (live segment) — and the --archive dispatch,
   # which writes rrauction-archive:
   concurrency: { group: segments-rrauction, cancel-in-progress: false }
   #   (archive runs: group: segments-rrauction-archive)
   # backfill-backtest.yml touches no segment — leave its own group.
   ```

   Group names are exactly `segments-<matrix house name>`: `segments-goldin`,
   `segments-sothebys`, `segments-christies`, `segments-bonhams`,
   `segments-phillips`, `segments-wright`, `segments-rrauction`,
   `segments-rrauction-archive`, `segments-rea`, `segments-hugginsscott`,
   `segments-scp`, `segments-hakes`, `segments-lelands`, `segments-memorylane`,
   `segments-lotg`, `segments-nflauction`, `segments-mlbauction`,
   `segments-juliens`, `segments-propstore`. Note a job-level group on a
   matrix job composes with the workflow-level group (nightly keeps its
   run-level `nightly` group).

2. **Compare-and-swap in `data-store.sh push-segment`.** `pull-segment`
   records the etag it pulled (`data/corpus/segments/.<house>.pulled-etag`);
   `push-segment` refuses when the bucket lists a different etag (another
   writer landed first — re-pull, re-merge, push again). A push with no pull
   record (e.g. `resolve-rrauction.ts --archive --push`, rebuilt from a local
   checkpoint) instead reads the true remote and refuses to replace a
   segment that has MORE rows or a NEWER max `validatedAt`/`firstSeen`.
   `SEGMENT_PUSH_FORCE=1` overrides both with a logged warning. A listing
   outage at push time refuses too (can't rule out a concurrent write).

## 2. Supabase — the query layer (not the source of truth)

Schema: `supabase/migrations/` in numeric order (see `SUPABASE_SETUP.md`).

### `lots` — the live book mirror, with a 24-month memory

`scripts/sync-lots-db.ts` (nightly sync job, needs `SUPABASE_URL` +
`SUPABASE_SERVICE_KEY`) upserts every **upcoming** lot: queryable columns
(artist / market / status / sale_date / price…) plus the full slim client
lot in the `data` jsonb column. `LotPage` uses it as the permalink fast
path: one anon-key PostgREST fetch (~1KB) resolves the certificate before
the 25MB shard stream lands; live shard data supersedes it on arrival.

**Retention contract (Sep 2 2026):** a row is NOT deleted when its lot
leaves the live book. It is refreshed from the corpus into a slim settled
row (id, status, sale_date, price_usd, data) so the permalink keeps
resolving with the outcome, and swept only once its `sale_date` (or, with
no date, its `updated_at`) is older than **24 months** — the saveable
window. The sweep refuses to run on a hollow night (0 upcoming, or under
half the table's live rows). Until this ships, `LotPage.tsx`'s "never
deleted" comment overstated the old behaviour (the old sweep deleted every
non-upcoming row nightly).

### alerts, saved searches, watchlist

`scripts/match-alerts.ts` and `scripts/match-signal-alerts.ts` read the
**live book from `public/data/ray/upcoming.json`** (every live lot with the
fields they match on), not the 1.1M-lot corpus; the corpus is loaded only as
a fallback (no `upcoming.json`) or, in the signal matcher, lazily for legacy
watched lots that settled before the `saved_artist` snapshot existed. All
three sync scripts retry PostgREST calls with bounded backoff (4 tries,
2s→8s) and **throw** on exhaustion — the nightly `sync` job's steps go red
instead of `|| echo`-ing green.

Real retention: `retention_purge()` (migration 0006) deletes seen alerts
older than 90 days and caps `collection_snapshots` at 400 rows per user,
scheduled nightly by pg_cron at 07:20 UTC (or call it via RPC with the
service key where pg_cron is off).

**NO EMAIL FEATURES** (standing law, Aug 28 2026): alerts live in-product
only. The email digest and its `emailed_at` column are gone.

## 3. Cache + version skew

Shard families (`lots-*`, `sold-archive-*`, `sold-ledger-*`) are fetched
with `?v=<lastCrawl>` and served `immutable` (`public/_headers`); the
phase-1 files (`meta`, `upcoming`, `market`, `backtest`, `receipts`,
`close-board`) revalidate. The build stamps the served `meta.json`'s
`lastCrawl` into the HTML as `NEXT_PUBLIC_DATA_VERSION` (`next.config.js`);
`useRayData` compares it with the fetched `meta.json` and, on skew,
re-fetches meta cache-busted and logs a console warning.

## History

Until Jul 2026 the corpus + served files were committed to git by the
nightly crawl (~15MB/day of churn). The git history was purged when the
store moved to R2; old data states live only in R2 snapshots from then on.
