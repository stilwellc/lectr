# Serving-Layer Audit — Consistency & Waste

Date: 2026-07-31 · Lens: is the pipeline delivering exactly what surfaces need, one source of truth per number?
Method: read code both sides (writer + reader) and measured the ACTUAL served files
(`public/data/ray/`: 17 lots shards + 2 sold-archive shards = **468,767 served rows, ~335MB raw JSON**;
upcoming.json 8.9MB; market.json 1.2MB; stats.json 0.6MB). All byte figures below are measured
(full 19-file field census), not extrapolated.

---

## 1 · DOUBLE SOURCES OF TRUTH

### 1.1 Artist page: hero counts/records from stats.json vs PriceChart table recomputed from loaded lots — MEDIUM
- Writer A: `scripts/compute-stats.ts:88-97` — `totalLotsTracked`, `recordPrice`, `medianPriceLast12Months` computed over the **full corpus** (incl. corpus-only card lots) at assemble time (`scripts/assemble.ts:86-96`).
- Reader A: `app/components/ArtistHero.tsx:171` (`stats?.totalLotsTracked ?? lots.length`), `:198-199, :234-235, :276-279` (`stats.recordPrice`), `:149-150` (`stats.medianPriceLast12Months`).
- Reader B, same screen: `app/components/PriceChart.tsx:146` → `:418` shows `(allLots || lots).length` (the **loaded** subset), and `:128` → `:466` shows per-category `recordPrice = max(...)` over loaded lots only.
- Disagreement: for makers whose sold history is corpus-only or archive-tier (sports-cards, culture, any Goldin maker before phase 3 loads), the hero says e.g. "433k lots tracked / $2.93M record" while the category table two scrolls down totals the loaded sample and can show a smaller max — both on screen at once, neither labeled with its base in the table.
- Fix: pass `stats` into PriceChart and use `totalLotsTracked` for the "All" row (or caption the table "loaded sample"); optionally take the "All" record from `stats.recordPrice`.
- Risk: low (display only). Effort: **small**.

### 1.2 PortfolioHeader "Sold lots" card counts NON-sold lots — MEDIUM (mislabeled number)
- Writer: `scripts/compute-stats.ts:88` — `totalLotsTracked: lots.length` counts **every status** (upcoming, withdrawn, bought-in included).
- Reader: `app/components/analytics/PortfolioHeader.tsx:104-111` — the fallback card labeled **"Sold lots"** prints `Σ totalLotsTracked` ("sold · no-reserve market, every lot concludes").
- Disagreement: on the sports tab this number includes live/upcoming Goldin lots (thousands on any night) and is shown as a sold count. `meta.totalSold` exists (assemble.ts:108) and is already plumbed into `useRayData` (`totalSold`, useRayData.ts:284) but PortfolioHeader never receives it — it imports meta statically for `totalLots` only (:9, :82).
- Fix: either add per-slug `totalSoldTracked` to MarketStats (compute-stats one-liner: `sold.length`), or relabel the card "Lots tracked".
- Risk: low. Effort: **trivial** (relabel) / **small** (new stats field).

### 1.3 ArtistRankingsTable sports lenses: stats.json vs loaded-sample recompute one toggle apart — SMALL
- Reader A: `app/components/analytics/ArtistRankingsTable.tsx:119-134` — 'collection' lens reads authoritative `statsByArtist` (revenue/median/record from full corpus).
- Reader B: `:139-174` — 'sport' lens recomputes revenue/record/median from the loaded `allLots` (the ~38k archive **sample**), same column headers, no basis caption. Code comment (:136-138) admits it: "this view still aggregates the loaded lots (a sample)".
- Disagreement: flipping the lens swaps the magnitude of "Record"/"Revenue" for overlapping content (cards record $2.93M in collection lens vs sample-max in sport lens).
- Fix: caption the by-sport lens ("over the loaded archive sample") or build per-sport rows into stats/market.json at assemble (per-sport aggregation already exists in build-market's sportBreakdown analytics — reuse it).
- Risk: low. Effort: **small** (caption) / **medium** (pipeline rows).

### 1.4 meta.totalLots: build-time import vs runtime fetch — LOW (invariant-dependent)
- Writer: `scripts/assemble.ts:103-110` (also `scripts/ray-crawl.ts:3968-3975` on manual full crawls).
- Reader A (baked at `next build`): `import meta from '…/public/data/ray/meta.json'` — `app/about/page.tsx:7,118`, `app/saved/page.tsx:20`, `app/value/page.tsx:28`, `app/blog/page.tsx:7`, `app/components/analytics/PortfolioHeader.tsx:9,82`, `app/[artist]/page.tsx:21`, `app/artists/page.tsx:19`, `app/analytics/page.tsx:23`, `app/components/blog/QuarterInsight.tsx:6`.
- Reader B (fetched at runtime): `app/hooks/useRayData.ts:250,283-284` → `app/preview/terminal/TerminalHome.tsx:256-257,941`, `app/components/RefPage.tsx:107`, `app/components/PlayerPage.tsx:116`, `app/components/LotPage.tsx:758`.
- Today these agree because nightly.yml always rebuilds the site with the fresh data present (`nightly.yml:301-318` pulls served payload before `npm run build`). The seam opens the day data is pushed to Pages/R2 **without** a site rebuild (e.g. a manual `data-store.sh push`): home hero says N lots (fetched, new) while /about's colophon says M (baked, old), simultaneously.
- Fix: none required now; either document the invariant next to the static imports, or convert the client-component importers (PortfolioHeader) to the fetched `totalLots` already in useRayData.
- Risk: low. Effort: **trivial** (comment) / **small** (unify client components).

### 1.5 ArtistHero record-lot join by float equality — cosmetic
- `app/components/ArtistHero.tsx:197-200` joins stats.json's `recordPrice` against loaded lots via `l.priceUsd === stats.recordPrice`. Cross-source exact-equality join: if the record sale is corpus-only/archive-tier, or rounding ever differs, the framed plate silently doesn't hang (benign — certificate still renders). No fix needed; noting the pattern.

### 1.6 `value` verdict double-shipped: upcoming.json AND the shards — WASTE-flavored duplicate (see §2.3)
- Writer: `scripts/build-market.ts:705-760` stamps `value` (with up to 10 `poolIds`) on upcoming lots; the same lot objects are then written to BOTH `upcoming.json` (4.42MB of value across 1,791 lots) and the served shards (4.43MB across 1,811 rows).
- Reader: `app/components/ComparableModal.tsx:440-450`, `app/components/LotPage.tsx:358` — read `lot.value` off whichever copy of the lot they hold.
- Both copies come from the same build so they can't disagree **within a deploy** — but `useRayData.ts:320-330` already re-attaches `signal`/`soldComp` from the eager payload onto phase-2 rows by id; `value` could ride the same path and be stripped from the shards. Same-number-two-copies is the only reason this isn't a pure waste line.

---

## 2 · PAYLOAD WASTE (fields served that NO client surface reads)

`scripts/corpus-io.ts:106-120` STRIP is a blocklist; everything not listed ships via `slimForClient` (:141-151).
Confirmed-unread = zero hits in `app/` outside `app/types.ts` and `app/lib/validate.ts`
(validate.ts runs **crawl-side only** — dynamically imported at `scripts/ray-crawl.ts:3786` against the pre-slim corpus; no app import exists).

Measured across all 19 served files (468,767 rows):

| field | rows | raw MB | writer | client reader | verdict |
|---|---|---|---|---|---|
| `subCat` | 465,668 | **8.71** | `scripts/lib/corpus-normalize.ts:252-289` (stampSubCats) | none — `app/lib/subcat-labels.ts` labels slugs that arrive via **market.json** `drills`/`subMarkets` rows (`app/components/SubMarketDirectory.tsx:115-126`), never `lot.subCat` | STRIP |
| `premiumPrice` | 449,311 | **8.47** | crawlers (alias money block) | none — every surface reads the `priceUsd` alias | STRIP |
| `photoMatched: false` | 214,517 | **4.30** | crawl (`app/lib/normalize.ts:607` stamps boolean) | truthy-only reads (`app/lib/similarity.ts:193` — and similarity runs server-side anyway) | omit falsy in slimForClient |
| `drill` | 228,288 | **4.22** | corpus-normalize stampSubCats | none — drills UI reads market.json rows, not lot.drill | STRIP |
| `archived` | 250,907 | **3.83** | `scripts/resolve-rrauction.ts:305` | none in app/ (not even typed in AuctionLot); it's assemble's routing flag (`scripts/assemble.ts:26`), which reads the CORPUS gz, not served | STRIP |
| `auctionId` | 33,094 | **2.15** | Goldin crawler (completion detection, types.ts:140-143) | none (types.ts only) | STRIP |
| `_pid` + `_pname` | 39,034 | **1.92** | `scripts/build-market.ts:541-546` | none — `playerSlug`/`playerName` are the served twins the UI reads | STRIP |
| `resultsPending: false` | 53,505 of 53,581 | **~1.17** | crawlers | truthy-only reads (LotCard/LotPage/PastResults) | omit falsy |
| `hammerPrice` | 52,660 | **0.93** | crawlers | none (see §5.1 — client wants `hammerUsd`, which IS stripped) | strip OR convert to hammerUsd |
| `buyerPremium` | 33,094 | **0.57** | Goldin crawler (promotion math, crawl-side) | none | STRIP |
| `saleName: ''` | 28,972 | **0.41** | crawlers | readers null-check anyway (`LotPage.tsx:454`) | omit empty strings |
| `_card` | 2,015 | **0.39** | `scripts/build-market.ts:534-548` | none — types.ts:266-282 claims "downstream readers may rely on it" but the only downstream is the pipeline, which reads the corpus gz | STRIP + fix the types comment |

**Total confirmed-strippable: ≈37.1MB raw (~11% of the 335MB phase-2+3 payload).**

### 2.3 Optional dedupe: strip `value` from shards, re-attach from upcoming (like `signal`/`soldComp`)
- 4.43MB more (shards), reusing the exact merge at `useRayData.ts:320-330`. Both files are written by the same build, so the id sets match; the only risk window is a client holding cached shards from crawl N with upcoming from crawl N — same N, safe. Effort: **small-medium**, risk: medium (verify permalink lots that carry value but rolled off upcoming — by construction value is stamped per-build on upcoming lots only, so the sets coincide).

**Grand total with §2.3: ≈41.5MB raw (~12%) — roughly two whole shards.** Post-gzip wire savings smaller (short repetitive keys compress well; expect ~25-35% of raw, i.e. ~10-13MB/cold session) but JSON.parse time + client heap save the full 41MB.

Kept-on-purpose fields verified as genuinely read (do NOT strip): `subjectKeys`/`itemClass`/`catReclass`/`objectClass` (`app/lib/comps.ts:688,1175-1182,320-360`), `entity`/`objectType`/`eventKey`/`sportYear` (comps/similarity client paths), `source` (`comps.ts:568,1153` sothebys-algolia gate), `sport` (sports page/rankings/drills), `firstSeen` (LotCard:126), `cardComps`, `flown`, `repeatSaleGroupId` (LotPage:376-378), `reference` (RefPage:86), `formKey` (documented, corpus-io.ts:102-105), `bidCount`/`currentBid`, `currency` (utils.ts:260), `dimensions`+`heightCm/widthCm/depthCm` (ComparableModal:296-297, similarity:83-84), `year` (ComparableModal:313,866-868), `priceBasis` (PastResults/ArtistSparklines), `value.poolIds` (ComparableModal:450, LotPage:358).

---

## 3 · FETCH DISCIPLINE

Mostly clean — phases 2/3 are opt-in and every consumer justifies itself:
- Phase 2 (`useFullLots`): saved (:82), value (:42), LotPage (:265), [artist] (:146), analytics (:92), artists (:31), ComparableModal (:363, modal-gated), TerminalHome via IntersectionObserver sentinel (:131-135). None fires phase 2 gratuitously.
- Phase 3 (`useSoldArchive`): archive-market surfaces only ([artist]:321, analytics:210, TerminalHome:95 behind "Show the archive", LotPage:200, ComparableModal:333). Correct.
- `players.json` (2.2MB) / `refs.json` (1.9MB): fetched lazily per page (`PlayerPage.tsx:48`, `RefPage.tsx:41`), not eagerly. Correct.

Findings:
1. **Phase 1 is 11.6MB, not "small"** — every first visit fetches upcoming.json (8.9MB) + market.json (1.2MB) + stats.json (0.6MB) + backtest + meta (`useRayData.ts:248-254`). upcoming.json's `lots` array is 8.41MB, of which **4.42MB is the `value` field (1,791 lots × ~2.5KB, dominated by 10 long `poolIds` each)**. The poolIds are useless until phase 2 loads (they resolve against the full corpus — ComparableModal.tsx:357 knows this). Capping poolIds at build (build-market.ts:705-760 already caps "for shard size" — cap harder), or shipping value-sans-poolIds eagerly and poolIds in shards, halves the eager payload. Effort: **medium**. Risk: medium (ComparableModal pool rendering).
2. **Version-busting is sound where it matters**: lots/sold-archive shards + indexes are `?v=meta.lastCrawl` + `force-cache` first try, `reload` on retries (useRayData.ts:301-317, 422-430), matched by immutable `public/_headers` rules. Phase-1 files and players/refs are un-busted but deliberately NOT immutable (documented in `_headers`) — they revalidate on CF Pages defaults. **No cache-poisoning path found**, contingent on the `_headers` globs staying name-prefixed (a future `/data/ray/*.json` broadening would poison phase 1 after a nightly).
3. Dead fallback: `useRayData.ts:432-434` fetches legacy `/data/ray/sold-archive.json` on index failure — that file is deleted by every assemble (`corpus-io.ts:227-228`), so the fallback is a guaranteed 404 that burns one retry cycle. Remove after the transition window. Effort: **trivial**.

---

## 4 · STALENESS SEAMS

1. **/about's pipeline diagram is factually stale** — `app/about/page.tsx:247`: "Phase 1 — first paint: upcoming.json (+ meta / stats / demand) **~400 KB**". Actual: upcoming.json alone is **8.9MB** (the `value` stamp grew it). A marketing surface describing the architecture wrongly by 22×. Fix the copy (or fix the payload per §3.1 and then the copy). Effort: **trivial**.
2. **backtest.json is one cycle behind by design, unlabeled** — writer `scripts/build-backtest-incremental.ts:62-69,108` (scores targets strictly after prior `generatedAt`; carries `generatedAt`). The client `Backtest` interface (`useRayData.ts:20-34`) omits `generatedAt`, and the /value backtest band (`app/value/page.tsx:298-330`) prints n-counts with **no as-of date**. Honest fix: type + display `generatedAt` ("record through YYYY-MM-DD"). Effort: **small**.
3. **meta.lastCrawl predates the shard bytes it cache-keys** — assemble writes meta (`assemble.ts:103`) BEFORE `runMarketBuild()` (:112) re-writes the shards ~45min later (observed mtimes: meta 13:21, shards 14:07). Within a deploy this is safe **only because** wrangler Pages deploys atomically and the ?v value still changes nightly; but any future incremental/partial upload of `public/data/ray` (e.g. R2-direct serving) breaks the pairing: clients with new meta + immutable-cached old-URL shards can never fetch content newer than the ?v they hold, or conversely R2 could serve new shards under an old key. Cheap hardening: have assemble write meta LAST (after runMarketBuild returns) — it's a two-line move. Effort: **trivial**. Risk of current code: low today, latent.
4. `assemble.ts` sanity gate compares against served meta.json (:42-61) which manual `ray-crawl.ts` also writes (:3968) with a differently-scoped corpus — two writers of the baseline. Benign today (both write full-corpus counts), worth a comment.

---

## 5 · TYPE DRIFT

### 5.1 Client reads a STRIPPED field while its unread twin ships — the one live bug-shaped drift
- `app/utils.ts:166-172` `overEstimatePct` reads `l.hammerUsd`; STRIP removes `hammerUsd` (`corpus-io.ts:111`), so on served data the branch **never** fires and every hammer figure is `priceUsd / 1.25` — while actual `hammerPrice` (unread, 0.93MB, 52,660 rows) ships uselessly. Same story acknowledged by hand at `PortfolioHeader.tsx:36-42` ("Served lots don't carry hammerUsd, so divide by the measured flat premium factor").
- Consumers of the /1.25 approximation on screen: PortfolioHeader:40-42, ArtistRankingsTable:86-95 (overEstimate column), anything calling overEstimatePct.
- Fix (pick one): (a) un-strip `hammerUsd` on sold rows (+~1MB, replacing hammerPrice) and let overEstimatePct be exact where the house published a hammer; or (b) strip `hammerPrice` too and delete the dead `hammerUsd` branch. (a) improves a displayed number; (b) saves bytes. Effort: **small** either way.

### 5.2 Pipeline writes fields the types don't know (written-not-typed)
- `archived` — written by resolve-rrauction.ts:305, served on 250,907 rows, absent from `AuctionLot` (app/types.ts) entirely. Add to STRIP (§2) and it stays a pipeline-private field.
- `_pid`/`_pname` — written by build-market.ts:541-546, served, untyped (only `scripts/audit-data-quality.ts:37` mentions them). Strip.
- backtest `generatedAt` — written, not in `Backtest` (useRayData.ts:20-34). Type it (§4.2).

### 5.3 Typed-but-misdocumented
- `app/types.ts:266-271` on `_card`: "rides the served card sample … downstream readers may rely on it being on the row" — no app reader exists; the real downstream (repeat-sales, card comps) reads the corpus gz. Correct the comment when stripping.
- `AuctionLot` carries ~30 corpus-only optional fields (titleTokens, mediumCanon, serialNo, edition*, sizeClass, entityClass, estLowUsd/estHighUsd, realizedUsd…) that are STRIPPED yet read by `app/lib/{similarity,indices,value}.ts` — this is fine **because those modules only execute server-side** (indices/value imported solely by scripts: build-market.ts:18-19, backtest-core.ts:21, gate-ab.ts:16, validate-engine.ts:19; similarity only via value.ts) — but nothing enforces it. A future client import of lib/value would silently produce estimate-less, token-less appraisals. Consider a `import 'server-only'`-style guard comment at the top of those three files. Effort: **trivial**.

### 5.4 SubMarketRead: scripts vs client — clean
Field-by-field diff of `scripts/sub-markets.ts:28-51` vs `app/hooks/useRayData.ts:106-129`: identical field sets (slug, label, vertical, readType, index, indexMethod, demandNow, demandSeries, bidCompNow, typicalUsd, record, lots, sellThroughPct, estCoverage). Only drift: scripts requires `indexMethod`/`bidCompNow` while the client marks them optional (`?`) — deliberate backward-compat with older market.json. No action.

---

## Priority queue

| # | finding | savings / risk fixed | effort |
|---|---|---|---|
| 1 | STRIP additions: subCat, drill, premiumPrice, archived, auctionId, buyerPremium, _pid, _pname, _card (+ omit false/'' in slimForClient) | **~37MB raw / 11% of served** | small (one list edit + 2-line slimForClient change, then one assemble run) |
| 2 | overEstimatePct hammerUsd dead branch (§5.1) | correctness of every "hammer vs estimate" figure | small |
| 3 | PortfolioHeader "Sold lots" mislabel (§1.2) | wrong number on analytics | trivial |
| 4 | /about "~400 KB" claim (§4.1) | public honesty | trivial |
| 5 | Artist page hero-vs-PriceChart base mismatch (§1.1) | on-screen disagreement | small |
| 6 | meta write ordering in assemble (§4.3) + legacy sold-archive.json fallback (§3.3) | latent cache seam, dead 404 | trivial |
| 7 | value/poolIds eager-payload diet (§3.1) + shard dedupe (§2.3) | ~4.4MB off first paint + 4.4MB off phase 2 | medium |
| 8 | backtest as-of label + generatedAt typing (§4.2) | staleness honesty | small |
