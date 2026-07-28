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
| `latest/segments/<house>.ndjson.gz` | per-house corpus segments (`data/corpus/segments/`) — the staged nightly's unit of crawl; `assemble.ts` reunions them into the full corpus |
| `snapshots/YYYYMMDD/corpus.tar` | nightly corpus snapshot, auto-expired after 30 days (lifecycle rule `expire-snapshots`) — the rollback ladder |

(The pre-migration `latest/corpus.tar` / `latest/served.tar.gz` keys are
frozen — no longer written; `pull` keeps them only as a last-resort fallback
for a pointer-less bucket.)

Moved by `scripts/data-store.sh` (`npm run data:pull` / `npm run data:push`):

- **pull** — resolves the pointer, fetches its write-once version; compares
  `meta.json` `lastCrawl` and refuses to overwrite newer local data with
  older R2 data.
- **push** — fails loud if there is nothing to push; writes the payloads
  first, the pointer last, plus the dated snapshot.
- **prune** — keeps the newest 14 `versions/` prefixes.

Auth: locally wrangler's OAuth session; in CI `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` (the token needs **Account → Workers R2 Storage →
Edit** in addition to Pages).

Flow:
- `ray-crawl.yml` pulls before the crawl (enrichment / firstSeen / bid
  history carry forward), pushes after the sanity gate + payload builds,
  then builds and deploys the site itself.
- `deploy.yml` pulls the served payloads before `next build` so any code
  push bakes the freshest data.
- Local dev: `npm run data:pull` when your checkout's data is stale.

## 2. Supabase `lots` table — the query layer (not the source of truth)

`scripts/sync-lots-db.ts` (end of the nightly crawl, needs `SUPABASE_URL` +
`SUPABASE_SERVICE_KEY`) upserts every corpus lot: queryable columns
(artist / market / status / sale_date / price…) plus the full slim client
lot in the `data` jsonb column.

Rows are **never deleted** — a permalink keeps resolving after the lot
rolls off the tape. `LotPage` uses it as the permalink fast path: one
anon-key PostgREST fetch (~1KB) resolves the certificate before the 25MB
shard stream lands; live shard data supersedes it on arrival.

## History

Until Jul 2026 the corpus + served files were committed to git by the
nightly crawl (~15MB/day of churn). The git history was purged when the
store moved to R2; old data states live only in R2 snapshots from then on.
