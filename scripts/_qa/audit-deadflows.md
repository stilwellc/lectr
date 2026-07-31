# Audit — dead & legacy data flows on the client
2026-07-31 · sweep of `app/` (components, hooks, lib, pages) against the live engine/build-time sources.
Every claim below was verified by reading the code AND checking field presence in the served payloads
(`public/data/ray/upcoming.json`, `lots-0.json`, `sold-archive-0.json`) against the `corpus-io.ts` STRIP blocklist.

Served-payload ground truth (measured today):
- `upcoming.json` (4,549 lots): `subCat` 4,549 · `drill` 3,777 · `sport` 1,958 · `playerSlug` 2,844 · `formKey` 4,549 · `signal` 4,549 (incl. explicit nulls) · `value` 1,791 · `cardComps` 452 · `hammerUsd` 0 · `realizedUsd` 0 · `sizeClass` 0
- sports-slug upcoming lots (3,513): `drill` 2,869 (82%) vs `sport` 1,958 (56%) — **drill is the richer stamp** (corpus-normalize recovers sport by player-vote; the `sport` field is the same title-regex the client runs)
- `sold-archive-0.json` (17,034): `formKey` 100% but on `game-used` rows the values are generic/wrong (`unknown`, `wristwatch`, `mineral`…) — formKey is NOT sports-aware; see F3.

## Findings table

| # | File:line | What it does today | Live replacement | Risk of switching | Effort |
|---|---|---|---|---|---|
| F1 | `app/preview/terminal/TerminalHome.tsx:420` | Feed sport lens filters via `sportOf(l.title)` regex on every lot, every feed recompute | Stamped `l.drill` (slug, via `subCatLabel`) — 82% coverage vs 56%; or `l.sport` for a behavior-identical swap | Must switch atomically with F2 (pill values and filter values must agree). `drill` is a slug (`boxing-mma`) while pills show labels (`Boxing / MMA`) — map through `app/lib/subcat-labels.ts`. "Other" bucket shrinks ~26% (an improvement, but a visible change) | small |
| F2 | `app/components/FeedToolbar.tsx:111` | Sport pill counts from `sportOf(l.title) \|\| 'Other'` | Same swap as F1 — `subCatLabel(l.drill)` / `l.sport` | Same atomic-pair constraint as F1; `FeedFilters.sport` string values change if moving to slugs (saved searches via `SaveSearch` persist filter objects — check stored filters won't silently mismatch) | small |
| F3 | `app/components/PastResults.tsx:26` | `formBadge` derives form via `sportsForm(lot) ?? classifyForm(lot)` (title parse) though every served lot carries `formKey` | **Cannot switch yet.** Verified: on served `game-used` archive rows `formKey` = `classifyForm` output and is generic/wrong (`unknown`, `wristwatch`, `mineral`, `tech`, `clock` on jerseys). The stamped field must first be fixed upstream (stamp `sportsForm ?? classifyForm`, i.e. `compFormKey`, not bare `classifyForm`) | Switching today would break every sports badge. Fix is a build-side change + restamp, then a trivial client swap | medium |
| F4 | `app/preview/terminal/TerminalHome.tsx:493–504` + `:962` | `soldMedianPct` computes `((priceUsd − estMid)/estMid)·100` — realized (premium-inclusive) vs hammer-basis estimate, RAW — then prints it as **"Median hammer vs estimate"** on the all-market Settlement slip. Overstates by ~25 pts | `overEstimatePct(l)` from `app/utils.ts:166` (the /1.25 discipline every other surface uses: saved:240, ArtistRankingsTable:88, PastResults:438, PortfolioHeader:42, ArtistSparklines:279) | The printed number drops ~25 pts — visually a "regression" but it's the honest figure; the label finally matches the math | trivial |
| F5 | `app/preview/terminal/TerminalHome.tsx:478–535` | **Dead memos on the homepage**, computed every render, rendered nowhere: `soldMedian12` (:478), `recordSale` (:485), `totalRealized` (:520), `topArtist` (:525), `hammerWeek` (:531). These are exactly the "computeStats client copies" — they re-derive `stats.json` aggregates (recordPrice, totalAuctionRevenue) from the served sample | Delete all five (each has exactly 1 occurrence — the declaration). Removing `hammerWeek` also kills the now-unused `weekDaysFor` import (:38) | None — verified zero render/JSX references. Pure win: 5 O(n) passes off every homepage render | trivial |
| F6 | `app/preview/terminal/Tape.tsx` | Whole component file, **zero importers** (checked static + `dynamic(import())` forms). Retired terminal ticker | Delete the file | None | trivial |
| F7 | `app/components/Terminal.tsx:325–334` | `Colophon` declares `lotCount`/`houseCount` props but destructures only `record` — the 15 call sites' `lotCount={meta.totalLots} houseCount={meta.sources.length}` are dead data. (Comment says intentional, but it keeps 7 build-time meta.json imports alive — see F8) | Drop the two props from the signature and all 15 call sites | TS will flag every call site (good — that's the sweep). Enables F8 | small |
| F8 | Build-time `import meta from '…/public/data/ray/meta.json'` ×10: `saved/page.tsx:20`, `value/page.tsx:28`, `about/page.tsx:7`, `blog/page.tsx:7`, `blog/how-we-built…/page.tsx:4`, `components/blog/QuarterInsight.tsx:6`, `components/analytics/PortfolioHeader.tsx:9`, `[artist]/page.tsx:21`, `analytics/page.tsx:23`, `artists/page.tsx:19` | Bakes crawl-day counts into the static JS bundle. Data now ships via R2 (`scripts/data-store.sh`) **independently of site deploys**, so these numbers go stale between code deploys. Where it *displays*: `about:115–120` (serial + totalLots + houses), `blog/how-we-built:311` (totalLots + houses), `PortfolioHeader:82` ("Total lots" card on /analytics), `blog/page:126` + `analytics/page:131` (masthead serial fallback). The other 5 files feed only Colophon's ignored props (dead — F7) | `useRayData()` already returns fetched-fresh `totalLots`, `totalSold`, `lastCrawl`, `sources` (phase-1 eager, `hooks/useRayData.ts:283`) | Pre-data-arrival these pages briefly have no number (loading gate already exists on all of them); PortfolioHeader needs `totalLots` passed as a prop or the hook mounted. `about`/blog pages are otherwise static — mounting the hook adds a fetch they didn't have (they already mount it for nav counts, so in practice zero cost) | small |
| F9 | `app/opengraph-image.tsx:4–5` | Build-time `stats.json` + `backtest.json` imports for the OG share card. Legitimately build-time (static export renders the PNG at build) — but the doc comment "each daily crawl commit redeploys" is stale: post-R2, data no longer rides git commits, so OG totals freeze until the next *code* deploy | Accept (an OG image can't fetch), but fix the comment; optionally have the deploy pipeline pull fresh R2 data before `next build` (data-store.sh pull) so each deploy bakes the newest numbers | None if accepted | trivial |
| F10 | `app/artists/page.tsx:46` | `demandSeries(marketLots)` recomputed client-side over the served subset for the masthead "market demand" figure | `ray.demand[activeKey]` — already returned by the same `useFullLots()` call (:31). Build version (`build-upcoming.ts:190–226`) runs over the FULL corpus with the `MIN_EST_COVERAGE` (0.5) and 2-quarter staleness gates the client copy lacks — the client number can diverge from every other surface reading the served series (MarketSwitch tiles, IndexHero) | `demand[key]` can be `[]` where gated (sports) — the existing `marketNow !== null` guard already handles empty; behavior improves (the gated markets stop showing an ungated number) | trivial |
| F11 | `app/components/analytics/ArtistSparklines.tsx:254`, `ArtistRankingsTable.tsx:103`, `ArtistHero.tsx:88` | Per-MAKER `demandSeries(artistLots)` computed client-side | **No live replacement exists** — market.json `makers` carries index/volume/houseAccuracy but not a per-maker demand series; `subMarkets`/`drills` cover only tracked slugs. Sanctioned client compute for now. If per-maker demand ever lands in market.json, these three are the migration sites | n/a | n/a (documented) |
| F12 | `app/utils.ts:171` (`overEstimatePct` hammerUsd branch) | Reads `l.hammerUsd` — **stripped** from every served payload (`corpus-io.ts` STRIP:112, measured 0/4,549 upcoming). On the client the branch never fires; every call lands on `priceUsd/1.25` | **Keep as-is** — the branch is LIVE at build time (`scripts/build-market.ts:22` imports `overEstimatePct` and runs it on the full corpus where `hammerUsd` exists). Dual-context function; do not "clean it up" | Removing it would silently degrade build-side house-accuracy numbers | n/a (keep) |
| F13 | `app/lib/demand.ts:37–38` | `l.estLowUsd ?? l.estimateLow` — `estLowUsd`/`estHighUsd` stripped from served payloads; the canonical branch never fires client-side, only in `build-upcoming` | Keep — same dual-context pattern as F12 | — | n/a (keep) |
| F14 | `app/hooks/useRayData.ts:229–234` | `parseStats` legacy "old single-artist format" branch keyed on `statsData.lastUpdated` — verified `stats.json` is the multi-artist map (no top-level `lastUpdated`), so the branch is dead against current data | Delete the branch (or keep as a cheap guard — it costs one property check) | None against current data; only a years-old cached stats.json could hit it | trivial |
| F15 | `app/lib/{normalize,cards,indices,validate}.ts` | Four modules living under `app/lib` with **zero app-side importers** — consumed only by `scripts/` (ray-crawl, resolvers, build-market, corpus-normalize). Not bundled (tree-shaken/unimported), but they read corpus-only fields (`realizedUsd`, `estLowUsd`, `sizeClass`) that would silently be undefined if anyone ever imported them client-side | Optionally relocate to `scripts/lib/` to make the boundary structural instead of conventional; at minimum they carry no client risk today | Import-path churn across ~12 scripts | medium (optional) |
| F16 | `scripts/build-market.ts:173–175, 208–210` | (Build-side, honorable mention) `sportOfCached` still title-parses `sportOf(l.title)` for comp-pool sport restriction and `sportBreakdown`, though the corpus now carries the richer `drill` stamp from corpus-normalize | `l.drill` (with `sportOf` fallback) at build — would align build analytics with the taxonomy | Comp-pool membership shifts for the ~26% of sports lots drill attributes but title-regex misses — backtest deltas should be checked before/after | medium |

## Notes

**Signal discipline is healthy.** The sanctioned chain holds everywhere it matters:
`lotSignal` (`LotCard.tsx:44`) returns the stamped `lot.signal` whenever defined (including explicit
build-stamped `null` — "the build looked and declined", never recomputed past it) and falls to
`computeDeepSignal` only for `undefined` (lots outside the eager payload). `ComparableModal.tsx:439–465`
and `LotPage.tsx:345–363` both render the ENGINE's value (`lot.value`, poolIds resolved) with the ×5
compRatio sanity guard mirrored from `build-upcoming.ts:102`, falling to `signalWithPool` only for
engine-declined lots. `build-upcoming.ts:143–147` stamps `signal` explicitly even when null for exactly
this contract. No violations found.

**Premium/estimate basis is disciplined everywhere except F4.** All other realized-vs-estimate sites go
through `overEstimatePct` or an explicit `/1.25`: `saved/page.tsx:240`, `ArtistRankingsTable.tsx:88`,
`PastResults.tsx:438`, `TopSales.tsx:35`, `PortfolioHeader.tsx:42`, `ArtistSparklines.tsx:279`,
`lib/indices.ts:99–101` (build). `demandSeries`' all-in basis is consistent between build and client and
is labeled "demand", never "hammer" — acceptable by its own doctrine (leading-indicator read).

**Stamped-field adoption is good in the new surfaces, absent in the oldest one.** `TopSales.tsx:35` reads
`l.sport`; `SportBreakdown.tsx:60–66` prefers build `analytics.sportBreakdown` and falls back to `l.sport`
(not the regex); `PlayerPage.tsx:94` matches on stamped `playerSlug`; `RefPage.tsx:86` on stamped
`reference`; `cardComps`/`_card` ride the lot per the build contract. The only client title-parsing left is
the F1/F2 feed-lens pair and the F3 form badge (blocked upstream).

**Dead-component sweep:** `Tape.tsx` is the only fully dead file. `PriceChart.tsx` and
`analytics/Distributions.tsx` LOOK dead to a `from '…'` grep but are alive via `dynamic(() => import(…))`
(`[artist]/page.tsx:23`, `analytics/page.tsx:25`) — do not delete. `components/Terminal.tsx` is already
trimmed to the four sanctioned exports (`pickCall`/`CallPlate`/`Colophon`/`daysWord`), all mounted; its
only rot is the ignored Colophon props (F7).

**Suggested sequencing:** F4 (one-line honesty fix) → F5+F6 (pure deletions) → F7+F8 together (props +
meta imports, one TS-guided sweep) → F10 → F1+F2 (atomic pair, with saved-search filter compat check) →
F3/F16 upstream formKey/drill work as a build-side follow-up.
