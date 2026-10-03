# lectr runbook — what red means, and how to recover

The nightly (`.github/workflows/nightly.yml`) crawls 16 houses, assembles the
corpus, runs the engine gate, publishes to R2 and deploys Cloudflare Pages.
Since Oct 3 2026, **publish status and house health are separate signals.**
Data layout and job-by-job mechanics: `docs/data-pipeline.md`.

## 1. What each state means

| You see | It means | Site | Do |
| --- | --- | --- | --- |
| Run **green**, verdict job `night - published` | Every house crawled fresh, the night published | fresh | nothing |
| Run **green**, verdict `night - published, DEGRADED (N house(s) down)` + ⚠ annotations | Published. N houses did not crawl (crashed, refused by the shrink gate, or stale). They serve their last-good segment; each has an open issue `lectr: house <h> unhealthy` | fresh except those houses | §3 |
| Issue `lectr: house <h> unhealthy` open | That house has failed ≥1 night. The body shows the reason, the fail streak and the last OK crawl. It updates nightly and closes itself when the house crawls OK | that house ages | §3 |
| `status.json` house `staleHidden: true` | No successful crawl for that house in **>48h** — its live lots are hidden from the live book (demoted to `unknown-result`, `staleHidden: true`). Nothing is deleted | its live lots are gone from the live book | §3, then §4 if the data is bad |
| Run **red**, verdict `night - PUBLISH MISSED` | assemble or deploy failed. **Production still serves the last good publish.** A scheduled night also opens/comments the issue `lectr: publish missed`; the next successful publish closes it | yesterday's data | §2 |
| Run red, only `backtest` / `sync` / `social` red | Published fine; the record, the Supabase sync or the social post failed | fresh | §6 |
| Run **skipped** (`Skipped (double-run guard)`) | The GitHub fallback cron found a Worker-triggered run already started in the last 20h | — | nothing |
| `/status` page shows "missed" | `status.json` `publish.lastPublishedAt` is more than 30h old (a missed night cannot write the file, so the page infers it from age) | stale | §2 |

`status.json` (`public/data/ray/status.json`, served at
`lectr.bid/data/ray/status.json`) is the same truth for the site. Shape and
field meanings: `scripts/lib/house-status.ts` (`StatusJson`) — additive
changes only. `publish.signal` is `ok` (every house fresh and the engine
validated) or `degraded` (published, but a house is down/stale or the engine
signal is degraded).

## 2. Publish missed

Open the failed run and find the first red step in **assemble** or **deploy**.

| Red step | Cause | Recovery |
| --- | --- | --- |
| `Segments — this run's crawl handoff, else R2 last-good` | R2 outage / a segment unreadable | `gh workflow run nightly.yml -f skip_crawl=true` (assemble-only, from the last-good segments) |
| `Assemble + engine` → `corpus shrank … (>10%)` | a segment came back near-empty | find the house (the per-house gate should have caught it — check its `push-segment` log), roll it back (§4), then `gh workflow run nightly.yml -f skip_crawl=true` |
| `Assemble + engine` → `SENTINEL ABORT` | a NEW repeated-price cluster (a stamped feed, e.g. the $10,050 ×3,622 NFL bleed) | inspect the `::warning title=sentinel price bleed` annotations. Real bleed: roll that house back (§4). False alarm after inspection: `gh workflow run nightly.yml -f skip_crawl=true -f sentinel_warn_only=true` |
| `Validate engine` | an engine gate failed (G1–G5) | read `data/qa/validate-engine.json` (artifact `validate-engine`). Do **not** loosen a threshold to get green — follow §5 |
| `Push corpus + served to R2` → `push REFUSED — R2 data … is NEWER` | a later run already published | nothing to do (the newer data is live) |
| `Deploy to Cloudflare Pages` | token missing/expired, Pages outage | data is already in R2: `gh workflow run deploy.yml` |
| job timed out | runner/corpus growth | re-run: `gh run rerun <run-id> --failed` (handoffs are kept for failed runs) |

After any recovery the next successful publish closes `lectr: publish missed`
by itself (also when it was a manual run).

## 3. A house is down

The issue body carries the reason; the run's `crawl (<house>)` job log has the detail.

| Reason starts with | Meaning | Do |
| --- | --- | --- |
| `per-house shrink gate:` | the crawl produced a segment that shrank (>5% settled rows, >200 sold rows, emptied) or whose sold-price shape moved — refused, last-good kept | look at the crawl log. Crawler bug → fix the crawler. A **deliberate** shrink (a dedupe heal) → push it with `SEGMENT_SHRINK_OK=1` (heal workflows: set it as a step env for that run) |
| `crawl leg crashed or timed out` | no health record and no segment | open the leg log; re-run just that leg: `gh run rerun <run-id> --failed` then `gh workflow run nightly.yml -f skip_crawl=true` |
| `crawl ok but its segment did not land` | the crawl was healthy but `push-segment` refused (CAS: another writer landed first, or the gate) | read the `push-segment` step; usually the next night resolves it |
| anything else (`200 grid, 0 parsed`, `login wall`…) | the crawler's own health check (scripts/lib/leg-health.ts) | fix the crawler; the house self-heals the first night it crawls OK |

After 48h without a good crawl the house's live lots are hidden automatically,
and un-hidden automatically the first night it crawls OK. To force a fresh
publish once fixed: `gh workflow run nightly.yml` (full) or wait for tonight.

## 4. Roll a house back (segment restore)

Every segment push first writes a write-once copy to
`segment-versions/<house>/<UTC>.ndjson.gz` (kept 30 days, newest 3 per house
always kept). Versions start with the first nightly after Oct 3 2026.

```bash
bash scripts/data-store.sh list-segment-versions hakes          # what is on the ladder
# preferred: under the house's segment lock, then publish
gh workflow run segment-restore.yml -f house=hakes -f date=2026-10-01 -f publish=true
# by hand (no nightly/heal writing that house at the time):
bash scripts/data-store.sh restore-segment hakes 2026-10-01     # newest version of that day
bash scripts/data-store.sh restore-segment hakes 20261001T041733Z  # an exact stamp
gh workflow run nightly.yml -f skip_crawl=true                   # publish it now
```

The restore versions the segment it replaces first (`…-prerestore`), so
`restore-segment hakes <that stamp>` undoes it. Whole-corpus rollback (the
served payload) is still `versions/` + `DATA_PUSH_FORCE=1` / `DEPLOY_ALLOW_OLDER=1`
(docs/data-pipeline.md).

**Restore drill** — `.github/workflows/restore-drill.yml` runs quarterly
(Jan/Apr/Jul/Oct 2, house rotates) and on demand
(`gh workflow run restore-drill.yml -f house=rea`). It restores into
`drill/<run_id>/` (never `latest/`), verifies the bytes match the version's
etag, the gzip and NDJSON parse, prints a stats diff against the live segment,
and deletes the scratch prefix. Red = the ladder is broken; fix before you need it.

## 5. Engine-gate policy

G1 flipped between blocking and warning **3× in 23 days** (Sep 2–27 2026),
each time on one night's evidence. From Oct 3 2026:

1. The thresholds live in `scripts/validate-engine.ts` **and** are mirrored in
   `scripts/ci/gate-thresholds.ts`. `npm test` has a tripwire
   (`scripts/__tests__/ops.test.ts`) that fails when the two disagree — so a
   threshold change cannot land without touching the mirror.
2. Every threshold change ships with a **replay of the last 30 nights**:
   ```bash
   npx tsx scripts/ci/gate-replay.ts --r2 --gh --set g1.spreadMin=8 --set g2.dipBlocks=false
   # or in CI (summary + artifact):
   gh workflow run engine-gate-replay.yml -f set="g1.spreadMin=8 g2.dipBlocks=false"
   ```
   It recomputes G1–G4 from each archived report's raw buckets under the
   current and the proposed thresholds and lists every night that would flip
   (G5 is carried from the record — its raw data is not in the report). Paste
   the table into the commit/PR. `⚠drift` marks reports written by an older
   gate version. Pushes/PRs touching the gate run the replay automatically.
3. Reports are archived nightly to R2 `qa/validate-engine/` (kept) — the
   `validate-engine` Actions artifact expires after 14 days.

Example (Oct 3 2026, 16 nights available): making the G1 dip blocking again
(`--set g1.dipBlocks=true`) would have failed **6** of them.

## 6. Non-publish failures

- **backtest red** — the record did not refresh (stale >3d, an empty market,
  or a Sunday replay not on the current engine). The site still published.
  Re-run: `gh run rerun <run-id> --failed`.
- **sync red** — Supabase lots/alerts. Re-run the job; it retries internally.
- **social** — missing/expired `X_*`/`IG_*` secrets run dry with a warning;
  IG token refresh: `.github/workflows/social.yml`.

## 7. On-time nightly (the cron-trigger Worker)

GitHub's `schedule:` runs hours late. `workers/cron-trigger` is a Cloudflare
Worker whose Cron Triggers call the GitHub `workflow_dispatch` API on the
minute: `nightly.yml` at **04:17 UTC**, `close-board.yml` at **:43 every 4h**
(`trigger=cron-worker`). The GitHub crons stay as fallbacks (nightly 04:37,
close-board :03) and skip themselves when a Worker run already started
(`scripts/ci/run-guard.mjs`; window 20h nightly / 3h close-board). Manual
dispatches are never skipped. Until the Worker is deployed, the fallback
crons simply ARE the schedule.

Deploy: `.github/workflows/cron-trigger-deploy.yml` (on push to
`workers/cron-trigger/**`, or `gh workflow run cron-trigger-deploy.yml`).
Check it: `curl https://lectr-cron-trigger.<your-subdomain>.workers.dev`
(prints the schedule); the Worker's Cron Events log in the Cloudflare
dashboard shows each dispatch (a failed dispatch is an error there, and the
GitHub fallback covers the night). Change the times in BOTH
`wrangler.toml` `crons` and `src/index.ts` `SCHEDULE` (a test checks they match).

## 8. Tokens and secrets

Every workflow fills the env var `CLOUDFLARE_API_TOKEN` from the narrowest
secret for its step, **falling back to the legacy all-powerful
`CLOUDFLARE_API_TOKEN` secret** until the split ones exist — nothing breaks
before you create them.

| Secret | Where | Cloudflare permissions | Used by |
| --- | --- | --- | --- |
| `CF_R2_READ_TOKEN` | repo secret | Account → **Workers R2 Storage → Read** (bucket `lectr-data`) | every pull: nightly deploy/sync/backtest pulls, deploy.yml, ui-shots, gate replay, restore-drill listing |
| `CF_R2_WRITE_TOKEN` | repo secret | Account → **Workers R2 Storage → Edit** (bucket `lectr-data`) | every R2 write: assemble's push/prune/ledger/gate report, crawl legs' push-segment + handoffs, heals/backfills, social ledger, pin-fixture, restores |
| `CF_PAGES_TOKEN` | **`production` environment** | Account → **Cloudflare Pages → Edit** | the Pages deploy steps (nightly deploy job, deploy.yml, ray-crawl.yml) |
| `CF_WORKERS_TOKEN` | `production` environment | Account → **Workers Scripts → Edit** | cron-trigger-deploy.yml only (falls back to `CF_PAGES_TOKEN`, then `CLOUDFLARE_API_TOKEN`) |
| `LECTR_DISPATCH_PAT` *(optional)* | `production` environment | — (GitHub PAT, below) | cron-trigger-deploy.yml copies it into the Worker as `GITHUB_DISPATCH_TOKEN` |

R2 tokens can be scoped to the bucket but not to a key prefix, so "write"
covers every writer of `lectr-data` — the crawl legs must write their own
segments, which is why `CF_R2_WRITE_TOKEN` is a **repo** secret (the 16 crawl
legs are not deploy jobs and do not name the environment). The deploy
credentials (Pages, Workers, the dispatch PAT) are **environment** secrets:
only jobs that name `production` can read them.
`ops-numbers.yml` (zone analytics) still reads `CLOUDFLARE_API_TOKEN`
directly — give it its own Analytics-read token before retiring the legacy one.

**The `production` environment** is referenced by every job that deploys
(nightly `deploy`, deploy.yml, ray-crawl.yml, cron-trigger-deploy, ui-shots
`pin`, restore-drill, segment-restore). GitHub creates it on first use;
create it explicitly to add secrets: Settings → Environments → New
environment → `production`. Do **not** add required reviewers (it would hold
every nightly deploy for approval); optionally restrict it to branch `main`.

Once all four Cloudflare tokens exist and a nightly is green on them, revoke
the legacy `CLOUDFLARE_API_TOKEN` (after giving ops-numbers its own token).

## 9. UI-shots re-baseline

No local token needed — all in CI:

```bash
gh workflow run ui-shots.yml -f pin_fixture=true -f approve=true   # move the data fixture + re-approve
gh workflow run ui-shots.yml -f approve=true                       # code changed pixels, same data
```

`pin` copies the current published payload to `fixtures/ui-shots/<version>/`,
`shots` renders against it with `--approve`, `propose` pushes
`tests/ui-baseline/` (+ `FIXTURE`) to `ui-shots/rebaseline-<run_id>` and opens
a PR. Review the frames in the PR, merge. If the repo forbids Actions from
creating PRs (Settings → Actions → General → "Allow GitHub Actions to create
and approve pull requests"), the branch is still pushed and the job prints the
compare URL.

## 10. R2 retention and cost

| Prefix | Retention | Size |
| --- | --- | --- |
| `versions/` (corpus + served) | newest 14 (`prune 14`, nightly) | ~176MB each → ~2.5GB |
| `snapshots/` | 30 days (R2 lifecycle `expire-snapshots`) | ~140MB/day → ~4.2GB |
| `segment-versions/` | 30 days, newest 3 per house kept (`prune-segment-versions 30 3`, nightly) | ~255MB/night (Goldin alone 154MB) → ~7.6GB |
| `qa/validate-engine/` | kept | ~10KB/night |
| `ci-handoff/` | 2 days (`handoff-prune`) | transient |

Total ≈ 15GB. R2 storage is $0.015/GB-month after the free 10GB → about
**$0.08/month** for the rollback ladder; writes (~20 extra Class A ops/night)
and egress are effectively free. Optional backstop lifecycle rule (note it
ignores the keep-3 floor): `npx wrangler r2 bucket lifecycle add lectr-data
expire-segment-versions segment-versions/ --expire-days 45`.

## 11. One-time setup (Collin)

1. **Environment**: Settings → Environments → `production` (no reviewers).
2. **Cloudflare tokens** (dash.cloudflare.com → My Profile → API Tokens →
   Create Custom Token, account 5bcc5f43…f473):
   - `CF_R2_READ_TOKEN` — Workers R2 Storage: Read → `gh secret set CF_R2_READ_TOKEN`
   - `CF_R2_WRITE_TOKEN` — Workers R2 Storage: Edit → `gh secret set CF_R2_WRITE_TOKEN`
   - `CF_PAGES_TOKEN` — Cloudflare Pages: Edit → `gh secret set CF_PAGES_TOKEN --env production`
   - `CF_WORKERS_TOKEN` — Workers Scripts: Edit → `gh secret set CF_WORKERS_TOKEN --env production`
3. **GitHub fine-grained PAT** for the Worker: github.com → Settings →
   Developer settings → Fine-grained tokens → Generate. Resource owner
   `stilwellc`, Repository access **Only select repositories → lectr**,
   Repository permissions **Actions: Read and write** (Metadata: Read is
   implied), nothing else; expiry ≤ 1 year (calendar the renewal). Then either
   `gh secret set LECTR_DISPATCH_PAT --env production` (the deploy workflow
   installs it) or `cd workers/cron-trigger && npx wrangler secret put GITHUB_DISPATCH_TOKEN`.
4. **Deploy the Worker**: `gh workflow run cron-trigger-deploy.yml`, then
   confirm the next 04:17 UTC run is titled `Nightly · cron-worker` and the
   04:37 one is skipped.
5. **Allow Actions to open PRs** (for ui-shots re-baseline), optional.
6. After a green night on the new tokens: revoke `CLOUDFLARE_API_TOKEN`
   (see §8 about ops-numbers first).
