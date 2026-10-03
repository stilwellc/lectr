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
| `segment-versions/<house>/<YYYYMMDDTHHMMSSZ>.ndjson.gz` | **write-once copy of every segment push** (Oct 3 2026) — the per-house rollback ladder (`list-segment-versions`, `restore-segment`, the quarterly restore drill). Pruned to 30 days, newest 3 per house always kept. Not under `versions/` on purpose: `prune` counts every `versions/<x>/` prefix as a corpus version |
| `latest/house-ledger.json` | the per-house crawl ledger (`scripts/lib/house-status.ts`): last OK crawl, fail streak, reason — written every night, publish or not; drives the stale-house rule and `status.json` |
| `qa/validate-engine/<UTC>-<run>.json` | every night's engine-gate report, kept (KBs) — `scripts/ci/gate-replay.ts` replays them |
| `drill/<run_id>/…` | the restore drill's scratch prefix — deleted by the drill itself |
| `api/current.json`, `api/v/<version>/…` | the lot API's precomputed objects (§3) — write-once versions (~525MB, 12 objects), only the pointer is overwritten; read by the `/api/*` Pages Functions through the `CORPUS` binding |

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
- **list-segment-versions `<house>`** / **restore-segment `<house>` `<date>`** /
  **prune-segment-versions [days=30] [keep=3]** / **restore-drill `<house>` [date]**
  — the per-house rollback ladder (docs/RUNBOOK.md "Roll a house back").
- **pull-ledger / push-ledger** — the per-house crawl ledger.
- **put-gate-report / pull-gate-reports** — the archived engine-gate reports.

Auth: locally wrangler's OAuth session; in CI the variable is always
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, but each workflow step now
fills it from the narrowest secret for its job — `CF_R2_READ_TOKEN` (pulls),
`CF_R2_WRITE_TOKEN` (pushes), `CF_PAGES_TOKEN` (Pages deploys, in the
`production` environment) — each falling back to the legacy all-powerful
`CLOUDFLARE_API_TOKEN` until it exists. docs/RUNBOOK.md "Tokens".

Flow:
- `nightly.yml` — dispatched ON TIME at 04:17 UTC by the Cloudflare Worker
  `workers/cron-trigger` (`trigger=cron-worker`); the GitHub cron `37 4 * * *`
  is the fallback and skips itself when a Worker run already started
  (`scripts/ci/run-guard.mjs`). plan (guard) → crawl (one job per house,
  `continue-on-error`: pull-segment → crawl → push-segment [per-house gate +
  segment version] → handoff-put) → assemble (unit tests, `assemble-segments`,
  house ledger, sanity gate + stale-house rule, engine, gate report → R2,
  `status.json`, `push`, ledger → R2) → deploy / sync / backtest (all read
  assemble's exact version via `pull-version`) → health (warn-only) →
  verdict (names the night; publish-missed + per-house issues) →
  handoff-cleanup. R2 `latest/` is the recovery source and tomorrow's
  baseline. What each colour means: docs/RUNBOOK.md.
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
- `close-board.yml` (every 4h at :43 via the Worker; GitHub cron at :03 as
  the guarded fallback) builds the intraday bid overlay and
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

### Nightly checks that never block the publish

Since Oct 3 2026 the RUN's red means **the night did not publish** (or the
record/sync failed); house health is a separate signal. docs/RUNBOOK.md.

- **crawl legs** — `continue-on-error`: a crashed leg, or one whose segment
  the per-house gate refused, rides its R2 last-good and shows as a failed
  job inside a green run.
- **health** — aggregates each crawl leg's `leg-health.json`
  (`{house, ok, fetched, parsed, settled, reason}`, uploaded as artifact
  `health-<house>` from `leg-health.json` or `data/qa/leg-health*.json` — the
  shrink gate's `leg-health-gate.json` merges in) into the run summary and
  annotates every `ok=false` leg as a warning (`--strict` restores the old
  exit 1). Nothing depends on it.
- **verdict** — its job name is the night's state (`night - published` /
  `night - published, DEGRADED (N house(s) down)` / `night - PUBLISH MISSED`);
  opens/updates/closes the `lectr: publish missed` issue (scheduled nights
  only) and the rolling `lectr: house <h> unhealthy` issues. `issues: write`
  is scoped to this job.
- **stale-house rule** — a house with no successful crawl in >48h (ledger)
  has its live lots demoted to `unknown-result` + `staleHidden: true`
  (`hideStaleHouseLive`, corpus-normalize) — never deleted; lifts itself the
  first night the house crawls OK.
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
baseline FAILS. Re-baseline entirely in CI (Linux fonts; no local R2 token):

```
gh workflow run ui-shots.yml -f pin_fixture=true -f approve=true   # move data + re-approve
gh workflow run ui-shots.yml -f approve=true                       # code-only re-approve
# → the `propose` job opens a PR from ui-shots/rebaseline-<run_id>; review the frames, merge
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

3. **Per-house shrink + price gate (Oct 3 2026, `scripts/ci/segment-gate.ts`).**
   `pull-segment` records the pulled segment's stats
   (`.<house>.pulled-stats.json`); `push-segment` refuses (exit 3) a segment
   whose settled (non-upcoming) rows dropped >5%, that lost >200 sold rows,
   that emptied, or whose sold price shape moved (median outside ×0.67–×1.5,
   p90 outside ×0.5–×2, one price gaining >5pt of all sold rows). The house
   keeps its last-good, `data/qa/leg-health-gate.json` records why, and the
   rest of the night publishes. `SEGMENT_SHRINK_OK=1` = a deliberate shrink
   (a dedupe heal). Every accepted push also writes a write-once
   `segment-versions/<house>/<UTC>.ndjson.gz` first (the rollback ladder).

## 2. Supabase — the query layer (not the source of truth)

Schema: `supabase/migrations/` in numeric order (see `SUPABASE_SETUP.md`).

### `lots` — the live book mirror, with a 24-month memory

`scripts/sync-lots-db.ts` (nightly sync job, needs `SUPABASE_URL` +
`SUPABASE_SERVICE_KEY`) upserts every **upcoming** lot: queryable columns
(artist / market / status / sale_date / price…) plus the full slim client
lot in the `data` jsonb column. `LotPage` uses it as the permalink fast
path: one anon-key PostgREST fetch (~1KB) resolves the certificate; the lot
API (`/api/lot/:id`, §3) resolves whatever it misses.

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

## 3. The lot API — lot-level history without the corpus (Oct 2026)

The browser **never downloads the served corpus** (`lots-*.json`,
`sold-archive-*.json`, `pages/maker-*`, `pages/lot-idx-*`) any more. Every
surface that read lot-level history asks a small read-only API instead:
Cloudflare **Pages Functions** under `/api/*` (`functions/api/[[path]].ts` →
`functions/_lib/api.ts`), reading R2 through the binding **`CORPUS` →
`lectr-data`**. Per-lot static files are impossible on Pages (20,000 files per
deploy, 25 MiB per file).

**Built for the Workers FREE plan (10ms CPU per request).** Every answer is
precomputed nightly by `scripts/emit-r2-index.ts`; a request maps a key to a
byte range and hands the stored bytes back. The edge never computes a comp,
sorts a table or scans a pool. The only JSON the edge parses is one
plain-JSON id bucket or location shard (≤6KB), plus a 60s pointer and a
manifest once per isolate. Lot rows are plain JSON spliced into the response
unparsed. Comps answers, table pages, summaries and settled flags are stored
gzip and served as-is (`Content-Encoding: gzip`).

| endpoint | answers | used by |
| --- | --- | --- |
| `GET /api/version` | `{ version, lastCrawl, generatedAt, compsWindow }`; `{ version: null, available: false }` (200) before any index is published | `app/lib/api.ts apiAvailable()` — checked once per session before any API-backed section loads |
| `GET /api/lot/:id` | one lot (the served row: main, archive and corpus-only tiers) | `/lot` permalinks the eager tape, prerender and Supabase all missed |
| `GET /api/lots?ids=a,b,…` | ≤12 lots by id (missing ids omitted) | the profile desk (every alias of every saved id, batched) |
| `GET /api/comps?lot=:id` | the precomputed comp reads, a superset of the build-time `LotPack`: engine pool resolved to rows (`c`), client read + its signal (`c`, `sig`), sports/science realized band (`b`), appraisal (`a`, `ap`), science/culture reference band (`r`), maker reference band (`mr`), provenance (`p`), modal context rows (`ctx`), exact-item repeat sale (`exact`). `{ np: true }` = sold before the precompute window | `LotPage` (via `loadLotPackStrict` when the build packed nothing), `ComparableModal`, `/value` (pack fallback), the profile desk |
| `GET /api/maker/:slug?view=summary` | the maker's book in columns (status, price, date, category, estimates, house, sport, player) + the 60 top-priced rows whole; main + archive tier for sports/science (main wins); **minus the eager lots** (the page lays those on top) | `/makers/[slug]` hero, price chart, decade band, player strip |
| `GET /api/maker/:slug?sort=date\|price&cat=&sport=&page=` | the maker's sold table, 20 rows a page | `PastResults` remote mode on maker pages |
| `GET /api/archive?market=&sort=&cat=&sport=&page=` | the market's sold-and-priced table, 20 rows a page; sports/science include the archive tier | home "Show the archive" |
| `GET /api/market/:key?view=summary` | a market's concluded rows in columns | `/analytics` deep pools |
| `GET /api/ref/:maker/:ref?page=` | one watch reference's sold rows, newest first, 50 a page | (available; `/ref` pages still read `refs.json` + search shards) |
| `GET /api/settled-flags?market=` | the 50 latest stamped Below Market lots that have since priced, with their flag | `/receipts` |

**Tables** are materialized nightly for every sort (`date` = newest first,
round-robined across houses in order of first appearance, exactly as
`PastResults` ordered it; `price` = highest first) × every category chip ×
every sport chip (sports scopes). Each table stores its first **25 pages (500
rows)**; deeper pages answer `{ rows: [], capped: true }` and the table says
"Showing the first 500 of N — filter by category or sort by price to reach
the rest". There is no title search on the tables; the static search index
(`/data/ray/search/`) remains the search path.

**Comps coverage (measured, then decided).** With the comp pools partitioned
(`scripts/r2/pools.ts`) and memoized title/dims/scorer parsing, one answer
costs 0.1ms (culture), 1ms (Rolex) and up to 35ms (Picasso prints, a 26.6k-row
pool), about 180ms at worst. Precomputing all 583k sold lots would take about 45
minutes for Picasso alone. So the nightly computes **the live book (eager
lots) + every lot sold or bought in within the last 730 days + the settled
flags**: 97k lots, 34k answers + 63k "nothing to print", about 2.8 minutes on an
M-series laptop. Older lots answer `np: true`, and the certificate and the
modal say so ("Comparable sales are precomputed for lots sold in the last two
years and for the live book — this lot sold before that window"). They never
say "no comps". `compsDays` widens the window if nightly time allows.

**Honesty + safety.** Every comp read is computed with the SAME `app/lib`
functions over candidate partitions proven to be supersets of what each
function can admit (`scripts/r2/pools.ts` documents the proof). The tests
(`scripts/__tests__/api-routes.test.ts`) check stored answers against
whole-pool answers. Read-only (GET/HEAD; 405 otherwise), inputs validated
(lot ids `^[A-Za-z0-9][A-Za-z0-9._:~+-]{0,199}$`, slugs and markets against
the roster, fixed page size, `page ≤ 5000`, `ids ≤ 12`). User input never
becomes an R2 key; it only looks up entries in location tables. No PII exists
in the rows. Same-origin only (no CORS headers; `Sec-Fetch-Site: cross-site` →
403), `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy:
same-origin`. The site CSP's `connect-src 'self'` already covers `/api`.

**Caching.** Every answer carries `ETag: "<version>"` (304 on
`If-None-Match`), `Cache-Control: public, max-age=300,
stale-while-revalidate=3600` and `Server-Timing: api;dur=…`. The Function also
stores 200s in the edge Cache API under a key that includes the corpus
version, so a new nightly is a new key and nothing is purged by hand. Failures
are `no-store` 503 (`Retry-After: 30`), never an empty 200.

**CPU, measured** (`npx tsx scripts/r2/bench-api.ts <out-dir>` runs the
same handler in Node over the real emitted index, `process.cpuUsage()` per
request, R2 = in-memory ranges; Miniflare doesn't enforce CPU limits and
Workers freeze timers during compute). On the Oct 2 book, worst **cold**
(fresh isolate: pointer + manifest + dir.bin) is 1.6ms, with an occasional GC
spike to 4.3ms. Worst **warm** is 0.6ms (`/api/market/all?view=summary`, a
1.2MB pass-through). Picasso-print comps: 0.3ms cold, 0.1ms warm. The deepest
archive page: 0.2ms. The game-used maker summary (230KB): 0.3ms.

**Free-plan request budget.** 100,000 Function requests a day. A session
spends one `/api/version` check plus what it opens: an archive page or a
comps modal is 1 request, a maker page 2 (summary + first table page), a
saved desk 1 + ⌈ids/12⌉ + one per resolved save. So it fits about 30–40k
API-backed page views a day. Static pages and the eager payload cost no
Function requests (`_routes.json` limits Functions to `/api/*`). R2 Class B
reads: about 2 per uncached request (id bucket or location shard + object),
against 10M/month free.

### R2 layout (`api/` prefix of `lectr-data`)

| object | contents |
| --- | --- |
| `api/current.json` | `{ version, prefix }` — the ONE overwritten object (read via the binding, which is strongly consistent; memoized 60s per isolate) |
| `api/v/<version>/manifest.json` | version, crawl stamp, blob names, row/comps counts, comps window |
| `api/v/<version>/dir.bin` | Uint32 triples `[blob, offset, length]`: 8,192 id buckets then 128 location shards (100KB, read once per isolate as a typed view) |
| `api/v/<version>/blob-<n>.bin` | ≤64MB each: plain-JSON lot rows, gzip comps answers, gzip table/ref pages, gzip summaries, plain-JSON id buckets + location shards |

Id bucket entry (`functions/_lib/format.ts`): `[rowBlob, rowOff, rowLen]` (no
comps precomputed), `+ [-1]` (computed, nothing to print), or
`+ [cBlob, cOff, cLen]` (the gzip answer). Location keys: `s:` summaries,
`t:<scope>|<sort>|<cat>|<sport>` tables (`[blob, start, total, …pageLens]`,
pages consecutive), `f:<scope>` chip facets (inline), `r:<maker>|<ref>` ref
ledgers, `z:<market>` settled flags.

Tonight's real book (lastCrawl 2026-10-02) has 609,815 rows, 34,129 comps
answers, 900 table combos (10,034 pages) and 9,932 ref ledgers. That's **12
objects, 523MB** (the plain-JSON rows are 335MB of it, the price of zero-parse
lot reads), emitted in about 3 minutes locally. The upload is 12 PUTs.

### Nightly: emit + upload (after assemble's R2 push)

`scripts/emit-r2-index.ts` writes everything into a LOCAL directory
(`data/r2-api/`, gitignored) from the served payload assemble just built
(+ `data/corpus/*.json.gz`, optional, to resolve engine pool ids that never
ship on the wire). `scripts/r2-api-push.sh` uploads it in
`api/UPLOAD_ORDER.txt` order — payloads first, `api/current.json` LAST —
verifying every PUT's etag against the local md5, 3 tries each. A failure
leaves the pointer on the previous version (the API keeps answering).

Add to `.github/workflows/nightly.yml`, job `assemble`, right after the
`Push corpus + served to R2` step (`id: push`):

```yaml
      # THE LOT API (docs/data-pipeline.md §3): everything the /api/* Pages
      # Functions serve, precomputed (Free plan: no compute at the edge).
      # Emitted from tonight's served payload, uploaded write-once under
      # api/v/<version>/, pointer flipped LAST. Best-effort: a failure keeps
      # the API on the previous version.
      - name: Emit + push the lot-API index → R2
        if: ${{ steps.push.outcome == 'success' }}
        continue-on-error: true
        timeout-minutes: 25
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_R2_WRITE_TOKEN || secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          NODE_OPTIONS=--max-old-space-size=12288 npx tsx scripts/emit-r2-index.ts --served public/data/ray --corpus data/corpus --out data/r2-api
          bash scripts/r2-api-push.sh data/r2-api
```

Retention: each version is about 525MB. Add an R2 lifecycle rule (Collin, once):
`npx wrangler r2 bucket lifecycle add lectr-data api-versions api/v/ --expire-days 5`.
That keeps about 2.6GB, inside the free 10GB. The pointer always names the
newest version. To roll back, point `api/current.json` at an older
`api/v/<version>/`.

### Turning it on (one time)

Nothing breaks before step 2: `/api/version` answers `available: false`, and
every API-backed section says so. The archive table, the maker's sold record,
the deep pools and the settled flags all print "isn't available yet — it
opens once tonight's index is published". A sold-lot permalink reads "This
lot's record isn't available yet". Saved settled lots fall back to the
sold-outcomes ledger.

1. **R2 binding.** `wrangler.toml` (repo root) declares the Pages project
   `collectr` with `pages_build_output_dir = "out"` and
   `[[r2_buckets]] binding = "CORPUS", bucket_name = "lectr-data"`.
   `wrangler pages deploy out` (deploy.yml / nightly deploy job) uploads
   `functions/` and applies that binding with the deployment. The deploy
   token needs **Account → Cloudflare Pages → Edit** (CF_PAGES_TOKEN has
   it). If the deploy rejects the binding (token scope), set it by hand:
   Dashboard → Workers & Pages → `collectr` → Settings → Bindings → Add →
   R2 bucket, variable name **`CORPUS`**, bucket **`lectr-data`**, for
   Production (and Preview). Note: once `wrangler.toml` exists it is the
   source of truth for the project's Functions config.
2. **Data.** Run the nightly step above once (or locally:
   `npx tsx scripts/emit-r2-index.ts` + `CLOUDFLARE_API_TOKEN=… bash
   scripts/r2-api-push.sh`).
3. **Routing.** Pages generates `_routes.json` so only `/api/*` invokes a
   Function; static files stay free static requests.

### Local development

```bash
npx tsx scripts/emit-r2-index.ts --out data/r2-api        # from public/data/ray
R2_LOCAL=1 bash scripts/r2-api-push.sh data/r2-api         # → .wrangler/state
npx tsx scripts/r2/bench-api.ts data/r2-api                # per-route CPU
npm run build
npx wrangler@4.120.1 pages dev out --persist-to .wrangler/state   # site + /api on :8788
```

## 4. Cache + version skew

Shard families (`sold-ledger-*`, `pages/lot-pack-*`; the client no longer
fetches `lots-*` / `sold-archive-*`) are fetched
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
