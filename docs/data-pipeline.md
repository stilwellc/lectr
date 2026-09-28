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
| `ci-handoff/<run_id>/<name>/a<attempt>-<UTC>.{bin,tar}` | same-run job→job handoffs of the nightly (crawl segments, backtest leg states) — write-once, deleted at the end of the run (see *CI handoff* below) |
| `fixtures/ui-shots/<stamp>/served.tar.gz` | the frozen served payload the ui-shots rig builds against (key committed in `tests/ui-baseline/FIXTURE`); never pruned |

The bucket is **private**: its `r2.dev` URL is disabled and it has no custom
domain (verified Sep 27 2026) — only the API token can read it.

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
- **pull-segment / push-segment** — see *Segment locks* below. `pull-segment`
  retries 3× (20s/40s backoff) on a transient failure; a read still stale
  after the full GET-lag window (rc 75) is not retried.
- **pull-version `<versions/…>` [served-only]** — installs exactly that
  write-once version (no pointer read, no freshness compare). `push` prints
  the version it wrote as the step output `version` in CI.
- **handoff-put / handoff-get / handoff-clean / handoff-prune [days]** and
  **assemble-segments `<house…>`** — the nightly's CI handoff (below).
- **pin-fixture / pull-fixture** — the ui-shots data fixture (below).
- **prune** — keeps the newest 14 `versions/` prefixes.

Auth: locally wrangler's OAuth session; in CI `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` (the token needs **Account → Workers R2 Storage →
Edit** in addition to Pages).

Flow:
- `nightly.yml` (cron `17 4 * * *` UTC — off the top of the hour, which
  GitHub delays by hours; publishes ~1–2am ET) — plan → crawl (one job per
  house: pull-segment → crawl → push-segment → handoff-put) → assemble
  (unit tests, `assemble-segments`, sanity gate, engine, `push`) → deploy /
  sync / backtest (all read assemble's exact version via `pull-version`) →
  health (non-blocking) → handoff-cleanup. R2 `latest/` is the recovery
  source and tomorrow's baseline.
- `ray-crawl.yml` (manual fallback monolith) pulls before the crawl, pushes
  after the payload builds, then builds and deploys the site itself.
- `deploy.yml` (push to main, dispatch, and `workflow_call`) pulls the served
  payloads, seeds the freshest close-board overlay, runs **typecheck + unit
  tests + lint** (lint is a notice-only no-op until an `eslint.config.*`
  exists), builds, and ships — and **refuses to deploy data older than
  production** (it compares the pulled `meta.json` `lastCrawl` against
  `https://lectr.bid/data/ray/meta.json`; `DEPLOY_ALLOW_OLDER=1` repo
  variable for a deliberate rollback). Every production deploy (this,
  nightly's `deploy` job, ray-crawl) shares the job-level concurrency group
  `deploy-collectr` (queue, never cancel).
- `close-board.yml` (every 4h at :43) builds the intraday bid overlay and
  **deploys it directly** by calling `deploy.yml` as a reusable workflow
  (the overlay rides as a tiny same-run artifact). It no longer commits to
  git: a `GITHUB_TOKEN` push can never trigger `on: push`, so from Sep 19 the
  overlay only shipped with the next nightly. Every deploy bakes the newest
  of {the caller's overlay, production's live copy, the nightly's served
  copy} via `scripts/ci/seed-close-board.mjs`, so a code-push deploy between
  boards never regresses it. The client applies an overlay entry when the
  overlay is newer than the base `upcoming.json` OR when the entry's bid /
  bid count is strictly higher than the base lot's (a bid can only rise, so
  higher is later) — a strictly-newer bid is never discarded.
- Local dev: `npm run data:pull` when your checkout's data is stale.

### CI handoff (no corpus in GitHub artifacts)

The repo is **public**, so any GitHub user can download a run's Actions
artifacts. Until Sep 27 2026 the nightly handed the whole corpus between jobs
that way (`corpus-payload` ~215MB, `served-payload` ~64MB, one
`segment-<house>` per leg). Now:

- **crawl → assemble**: each leg `handoff-put segment-<house>` to
  `ci-handoff/<run_id>/segment-<house>/a<attempt>-<UTC>.bin` — a NEW key per
  write, so reads are immediately consistent (no overwrite GET-lag), and a
  re-run attempt writes beside, never over, the first. `assemble-segments`
  reads the newest key per house and falls back to the R2 last-good
  (`latest/segments/…`) for `other`, `rrauction-archive`, a failed leg, or
  `skip_crawl`.
- **assemble → deploy / sync / backtest(-leg)**: no upload at all. assemble's
  `push` already writes the payloads to a write-once `versions/<UTC>-<sha>/`
  prefix; the job output `version` names it and every consumer runs
  `data-store.sh pull-version <version>` (deploy: `served-only`).
- **backtest-leg → backtest**: `ci-handoff/<run_id>/backtest-leg-<market>/…tar`.
- **Cleanup**: the last job, `handoff-cleanup` (`if: always()`), runs
  `handoff-clean` (deletes `ci-handoff/<run_id>/`) when no job failed or was
  cancelled — a failed run keeps its prefix so *Re-run failed jobs* still
  finds it — and always runs `handoff-prune 2` (deletes any `ci-handoff/`
  object older than 2 days, by `last_modified`). Recommended backstop, **not
  yet configured** (the bucket's rules are `expire-snapshots` + the default
  multipart abort): an R2 lifecycle rule `expire-ci-handoff` on prefix
  `ci-handoff/`, delete after 3 days —
  `npx wrangler r2 bucket lifecycle add lectr-data expire-ci-handoff ci-handoff/ --expire-days 3`.

Artifacts that remain are small and non-sensitive: `validate-engine`
(the holdout report), `health-<house>` (leg-health.json counts),
`social-cards` (the public JPEGs), `close-board-overlay` (the public
overlay), `ui-drift` / `ui-baseline` (screenshots of the public site).

### Nightly checks that go red without blocking the publish

- **health** — aggregates each crawl leg's `leg-health.json`
  (`{house, ok, fetched, parsed, settled, reason}`, uploaded as artifact
  `health-<house>` from `leg-health.json` or `data/qa/leg-health*.json`) into
  the run summary and fails when any leg reported `ok=false`. Nothing
  depends on it.
- **backtest** — Sunday full replay: a market with no targets is
  legitimately empty for ANY market (tcg: Pokémon lots carry no estimate).
  `scripts/ci/backtest-leg.sh` exits 0 with an `EMPTY.<market>` marker for
  both engine behaviours (throw "no targets", or an explicit empty record);
  `scripts/ci/backtest-merge.sh` merges exactly the markets that carry state
  (`--markets`), refuses if any leg's output is missing or a roster market
  has no leg, and the n=0 check exempts the empty markets. After the push,
  a Sunday record with `rowsOnVersionPct < 90` fails the job (the record
  still publishes; deploy never depends on it).
- **resolver / prune** — a failed Christie's/Sotheby's gated-results
  resolver or R2 prune is a `::warning::` + job-summary line, not a silent
  `|| echo`.
- **social** — missing `X_*` / `IG_*` secrets → the desk runs dry with a
  `::warning::` (scripts/ci/social-desk-check.sh).

### Code checks (`npm test`, `npm run typecheck`, `npm run lint`)

`npm test` runs every `*.test.ts` under `scripts/__tests__/` and
`app/**/__tests__/` with `node --test` via tsx (`scripts/ci/run-tests.mjs`,
`RAY_SKIP_MAIN=1`). `npm run typecheck` is `tsc --noEmit` — it needs the
served JSON the app imports (`public/data/ray/*.json`), so CI runs it after
the R2 pull (deploy.yml). `npm run lint` runs ESLint only once a flat config
(`eslint.config.*`) exists; until then it prints a notice and passes.

### ui-shots (visual regression on pinned data)

`ui-shots.yml` builds the site from the frozen payload named in
`tests/ui-baseline/FIXTURE` (`data-store.sh pull-fixture`), serves `out/`
with `wrangler pages dev`, freezes the page clock at the fixture's
`lastCrawl` + 1h, stubs external images, masks `[data-volatile]` /
`[data-shot-mask]`, and diffs against `tests/ui-baseline/`. A missing
baseline FAILS. Re-baseline (Linux fonts — approve in CI, not on a Mac):

```
bash scripts/data-store.sh pin-fixture          # only to move the pinned data (R2 write)
gh workflow run ui-shots.yml -f approve=true
gh run download <run-id> -n ui-baseline -D tests/ui-baseline
git add tests/ui-baseline && git commit -m "ui-shots: re-baseline"
```

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
