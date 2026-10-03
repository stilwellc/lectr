# B6 — GA-readiness audit: BUILD PIPELINE & STATISTICS
Audited 2026-08-03 (ships tomorrow). Every line read: assemble.ts, build-market.ts, build-upcoming.ts, backtest-core.ts, build-backtest-incremental.ts, sub-markets.ts, repeat-sales.ts, hedonic-index.ts, lib/grade-ladder.ts, lib/corpus-normalize.ts, lib/sub-cats.ts, corpus-io.ts, compute-stats.ts, gen-redirects.ts, app/sitemap.ts, next.config.js, build-og.tsx; subject-domains.ts spot-checked; contract diffed against app/hooks/useRayData.ts + app/types.ts. Claims about served payloads verified against the actual files in public/data/ray/.

---

## BLOCKER

### B-1 · 251,866 RR Auction rows leaked into the phase-2 client shards (~290MB served payload)
`scripts/build-market.ts:911-915` vs `scripts/assemble.ts:22-26`
- assemble's archive predicate is `isGoldinSold(l) || l.archived === true` — the RR 30-yr sold archive is explicitly "kept out of the client shards so served payload stays lean" (its own comment).
- build-market §4 re-writes corpus+served LAST (it always runs after assemble, so its partition is what ships) with a predicate that **dropped the `archived === true` clause**: `l.auctionHouse === 'Goldin' && l.status === 'sold' && !CULTURE_KEEP.has(l.artist)`. RR archived rows are neither archived nor corpus-only → they land in the phase-2 `lots-*.json` shards.
- **Verified on disk**: `lots-index.json` = 16 shards, 448,370 rows, of which 251,866 are `auctionHouse:"RR Auction"` (243,144 sold). Total phase-2 payload ≈ 290MB. useRayData.ts comments still promise "~10MB across shards" (`app/hooks/useRayData.ts:195,309`); phase 2 is mounted by artist/analytics/value/profile/lot routes — a fresh session on any research surface downloads ~290MB (mobile: effectively broken; CF egress cost every session).
- Fix (1-3 lines): restore parity with assemble — add `|| l.archived === true` to build-market's isArchived predicate, and decide the tier deliberately: either phase-3 archive (still ~110MB — heavy) or, better, corpus-only à la cards with a served sample for the culture/science dossier surfaces. Then regenerate and confirm shard count returns to ~2-3.

---

## PRE-GA

### P-1 · sitemap /ref URLs use the wrong codec — 43 dead URLs
`app/sitemap.ts:27` uses `encodeURIComponent(ref)` but the actual static routes are generated with `encodeRefPath` (`app/ref/ref-path.ts:22` — '%'→'~' codec, because "%2F percent-escapes are normalized inconsistently by CDNs"). Verified: 42 refs contain '/' (`3800/1`, `5711/1a`, …) + `panthère`. Sitemap emits `/ref/patek-philippe/3800%2F1`; the real page is `/ref/patek-philippe/3800~2f1` → Googlebot gets 404s on the deepest-value watch pages.
Fix: `import { encodeRefPath } from './ref/ref-path'` and use it in refPaths(). (drillPaths verified clean: all 95 drill parts are `[a-z0-9-]`, match `/sub/[a]/[b]` generateStaticParams verbatim.)

### P-2 · build-market's private MARKETS roster omits `science-tech`
`scripts/build-market.ts:66-73` hardcodes MARKETS; `app/constants.ts:54` has `science-tech` in science. Consequences: markets.science / hedonic.science / markets.all / houseCal / seasonality / the calibration marketBySlug (line 104) all silently exclude the slug, while subMarkets, drills, stats.json, and backtest-core (which build their maps from ARTISTS) include it. A whole tracked slug is missing from the science dashboard aggregates and the two surfaces disagree on totals.
Fix: derive MARKETS from ARTISTS (`for (const a of ARTISTS) (MARKETS[a.market] ||= []).push(a.slug)`) — single source of truth.

### P-3 · hardcoded calibration block in market.json — stale numbers "shipped so the UI can cite them"
`scripts/build-market.ts:880-883`: `directional: { method: 'temporal holdout, n≈2400', … }` and fixed valueError constants. The live backtest record is n≈38.7K and re-derives calibration nightly (backtest.json). The UI citing a frozen n≈2400 table violates the "every figure names method + n" doctrine the moment the real record moved.
Fix: derive this block from backtest.json at build (or stamp an as-of date and the source so it reads as a historical validation, not a current figure).

### P-4 · stats.json read failure silently publishes market.json with empty subMarkets
`scripts/build-market.ts:846-856`: `catch → console.warn`, `subMarkets = {}` still ships. A missing/corrupt stats.json (the exact "thin nightly" failure mode) wipes the lander hero's sub-market layers and every dossier read while the build exits 0. Same pattern at 3f (828-837) — the corpus-only slugs' stats rows silently stay stale.
Fix: throw (mirror the assemble sanity-gate philosophy: last-good stays live) instead of warn-and-continue; these keys are load-bearing for the hero.

### P-5 · compute-stats quarterly bucketing is build-machine-timezone dependent
`scripts/compute-stats.ts:18,33-36`: `new Date('YYYY-MM-DD')` parses UTC midnight, then `getFullYear()/getMonth()` read LOCAL time. On any west-of-UTC machine, every lot dated the 1st day of a quarter files into the PREVIOUS quarter (and Jan-1 sales into the previous YEAR's Q4). priceHistory/appreciationRate differ between a UTC CI and a local laptop → non-deterministic published numbers. Every other quarterly bucketer in the pipeline is string-prefix or getUTC* based (repeat-sales.ts:104, hedonic-index.ts:111, sub-markets.ts:91) — this is the one straggler.
Fix: derive `q` from `l.saleDate.slice(0,7)` string math like hedonic's quarterOf.

### P-6 · appreciationRate: partial-quarter + gap-blind window math
`scripts/compute-stats.ts:71-82`: recent4 = `priceHistory.slice(-4)` INCLUDES the current stub quarter (no partial-quarter guard — the prompt's "volume yes, anywhere else?" answer is: here); `older4 = slice(-12,-8)` assumes contiguous quarters — any gap quarter (thin maker, missing house segment) silently shifts the "3 years ago" window, yet the rate is still annualized as `^(1/3)`. No n-gate on cells (a 1-sale quarter enters the mean-of-avgPrice). This number is printed on OG cards and maker pages.
Fix: exclude the current quarter, select windows by quarter ordinal (not array position), gate cells on n.

### P-7 · emitted index series include the current stub quarter (horizons guard it; series don't)
`scripts/repeat-sales.ts:346-356` and `scripts/hedonic-index.ts:596-606` both emit the in-progress quarter as the last series point (it only needs MIN_QUARTER_N_FIT/minQuarterPairs to earn a β/τ). `scripts/sub-markets.ts:274` then ships it in `indexSeries` (value+n only — the wide CI is dropped), so the hero/dossier line can terminate on a thin partial-quarter kink presented at equal visual weight. Horizons correctly refuse to END on it; the drawn line doesn't.
Fix: filter `period < currentQuarter(now)` when emitting series (or at the sub-markets slice).

### P-8 · yearlyHist publishes the current PARTIAL year
`scripts/sub-markets.ts:114-130`: histSeries (culture dossiers, "23-yr culture yearly $") includes 2026-to-date once it has ≥20 lots — a mid-year median with seasonal mix presented as the year's typical price. quarterlyVolume (86-102) got this exclusion; the yearly series didn't.
Fix: drop `String(now.getUTCFullYear())` from the emitted rows.

### P-9 · market.json ships 126KB of `hedonic` no client reads + `_card` doc contradiction
- `hedonic` key (per-market HedonicResult + composite + seriesEqualWeight, measured 126KB of the 1.3MB eager market.json) has **no field in client MarketData** (`app/hooks/useRayData.ts:83-109`) and no accessor anywhere in app/ (grepped `.hedonic` — comments only). Served-but-unread weight on the eager path. Either add the reader or stop emitting it (the consumed movement reads are makerIndex + subMarkets/drills + markets).
- `app/types.ts:271-276` documents `_card` as "PERSISTED … rides the served card sample; downstream readers may rely on it" — but `corpus-io.ts:124` STRIPs `_card` from every served row ("measured client-unread"). No client reader exists, so it's doc drift, but a future consumer following the type doc will silently get undefined.

### P-10 · idempotency clear-list misses `cardComps`
`scripts/build-market.ts:112` clears only `repeatSaleGroupId` + `value` before re-stamping. `cardComps` is stamped on UPCOMING cards only (line 699); when a card flips to sold, its last-live cardComps freezes onto the corpus row forever (the §4 write persists it). Stale exact-comp medians ride sold rows in the corpus (and the served card sample, where cardComps is NOT stripped).
Fix: add `delete lw.cardComps` to the line-112 clear pass.

### P-11 · assemble's intermediate served write lacks the corpus-only predicate
`scripts/assemble.ts:99` calls `writeCorpusAndServed(allLots, isArchiveTier)` with no third arg → its shards momentarily include all 348K sold cards (and its archive tier includes Goldin culture that build-market keeps in shards). build-market §4 re-writes correctly minutes later, but: double work on the heaviest IO, and a crash between the two writes leaves a served dir in neither valid state. Fix: pass the same predicates, or drop the served write from assemble entirely and let build-market own it (assemble only needs the corpus gz for anything downstream).

---

## POST-GA

1. `repeat-sales.ts:217-231, 359-365` — `pairsTouching` (published as series `nPairs`) and `endpointStats` (horizon gates) are counted over ALL extracted pairs, including pairs later dropped from the fit because one endpoint was pooled. Published support counts slightly overstate what the regression used; a gate can pass on pairs that contributed nothing. Compute both over `usable`.
2. `repeat-sales.ts` header vs cards keyer — the BMN doc claims "a SINGLE physical object across its OWN resales"; `sub-markets.ts:207-214` cardKey links same **product** (player|year|set|cardNo|grade), i.e., different physical copies. Statistically fine for a fungible graded card, but the method caption shown to users should say product-level repeat sales.
3. `lib/grade-ladder.ts:111-116` — all cross-grade pairs within a group share cells, so observations are correlated; `MIN_RUNG_PAIRS=30` counts correlated pairs as independent support. Point estimates fine; support gate is softer than it reads. (Also: a G-grade group emits G(G−1)/2 pairs, weighting deep groups quadratically.)
4. `backtest-core.ts:240` — beat-rate monotonicity enforced for buckets 1-4 only; bucket 5 (cr≥10) can dip below bucket 4.
5. `build-backtest-incremental.ts:100` — `saleDate > priorGeneratedAt` also skips late-PUBLISHED results (house posts results days after the sale) until the Sunday full rebuild; the drift-bound comment only documents backfilled priors. Bounded to a week; worth a line in the doc.
6. `compute-stats.ts:95` — `recordHouse: … || 'Phillips'` fabricates a house on an empty slug (honesty doctrine: abstain > wrong). Also line 87: `lastUpdated: now` is stamped even when every figure was carried from `existingStats` — a last-good-stale slug (house segment down) looks freshly measured; carry the old lastUpdated when carrying values.
7. `build-og.tsx:76-78` — "prices up X% this year" labels `appreciationRate`, which is a 3-year annualized avg-price CAGR (and mix-sensitive — the very metric the hedonic exists to replace), colored green/red. Reword ("~X%/yr, 3y avg-price") or drive from the maker hedonic where publishable.
8. `build-market.ts:894` — only `_v`/`_saleMs` are deleted pre-persist; `_pid`/`_pname`/`_card` are written into the corpus gz for ~350K rows every build (STRIPped from served, so client-safe, but real corpus-gz weight and a stale-parse risk if parseCard changes and a row is ever skipped).
9. `corpus-io.ts:225-229` — shard sizing uses `s.length` (UTF-16 units) not bytes; multi-byte titles undercount. 18MB target vs 25MiB cap leaves headroom; fine today, footgun if the target creeps.
10. `corpus-io.ts:77-86` — readAllSegments does no id-dedup; a lot crawled by the live `rrauction` crawler AND present in `rrauction-archive` would double-count silently (assemble's gate only catches shrinkage, not growth). Cheap belt: dedup by id at reunion, log the collision count.
11. `build-market.ts:419-467` — houseCal/seasonality run over engine-only `sold` (excludes sothebys-algolia backfill), so Sotheby's cells reflect the native-crawl subset only; the n≥40/n≥30 gates hold but the caption "per house×market" quietly means "excluding the discovery backfill".
12. `assemble.ts:41` — `CORPUS_FLOOR = 100_000` with comment "corpus is ~455k"; corpus is 761K. The no-baseline floor is now very loose; bump and refresh the comment.

---

## APPENDIX A — emission-contract diff (both directions)

**market.json → client `MarketData` (useRayData.ts:83-109)**
| emitted key | size | client field | status |
|---|---|---|---|
| generatedAt | 0KB | generatedAt | OK |
| markets (incl. 'all') | 169KB | markets: MarketSeriesJson | OK — method/label/n/index/volume/sellThrough/houseAccuracy/analytics all match indices.ts MarketSeries |
| **hedonic** | **126KB** | **— absent from type, no reader** | **served-but-unread (P-9)** |
| makerIndex | 186KB | makerIndex | OK (series/horizons/lastCompleteQuarter/coverageMakerLots/note) |
| subMarkets | 151KB | subMarkets: SubMarketRead[] | OK field-by-field (slug/label/vertical/readType/index/indexMethod/demandNow/demandSeries/bidCompNow/typicalUsd/record/lots/sellThroughPct/estCoverage/volSeries?/indexSeries?/histSeries?) |
| drills | 320KB | drills: (SubMarketRead & {parent})[] | OK (parent emitted) |
| makers | 323KB | makers | OK |
| houseCal | 1KB | houseCal | OK |
| seasonality | 5KB | seasonality | OK (n/hammerMedPct/allInMedPct/sellThroughPct) |
| calibration | 0KB | calibration (required) | OK shape; stale content (P-3) |
| gradeLadder | 0KB | gradeLadder | OK (base/rungs{grade,mult,fitted,pairs,old}/pairs/groups) |

**backtest.json → `Backtest`** — flagged/unflagged/above (all BacktestBucket fields incl. hammer/boughtIn extensions), flaggedTiers{main,fallback}, calibration{edges,beatRate,band,n}, series{year,flaggedMedianPct,unflaggedMedianPct,nFlagged}: exact match, both directions.

**upcoming.json → phase-1 reader** — {generatedAt, tape, demand, realized, bidComp, recentSold, lots}: exact match (generatedAt unread — fine). `signal` explicitly stamped even when null (correct: client must never recompute past a build-null); bidVelocity/soldComp/cardComps/value survive slimForClient (verified against STRIP).

**meta.json** — client reads lastCrawl/sources/totalLots/totalSold ✓; `artists`,`version` written-but-unread (harmless).

**stats.json → MarketStats** — exact match.

**STRIP list vs client readers** (corpus-io.ts:106-125) — verified safe: client price math reads `priceUsd`/`estimateLow`/`estimateHigh` aliases only (app/lib/comps.ts: 10× priceUsd, 0× realizedUsd; app/lib/value.ts + indices.ts which do read realizedUsd are build-time-only imports — no app/ importer). Kept-on-purpose fields confirmed read: formKey, reference, repeatSaleGroupId, subCat/drill/sport, cardComps, value, playerSlug. Stripped-and-unread confirmed: bidHistory (bidVelocity digest replaces it), _pid/_pname/_card, archived (NOTE: stripping `archived` means the client cannot even detect the B-1 leak), photoMatched, money twins.

---

## APPENDIX B — VERIFIED SOUND

- **assemble sanity gate**: >10% shrink refusal on lots AND sold, unparseable-present-baseline fatal (not silently skipped), absolute floor when no baseline; normalize runs after the gate, before stats/persist. Group-by refactor preserves per-slug order (byte-identical stats).
- **BMN repeat-sales core**: sparse D'WD accumulation correct (+1/-1 outer products, ridge on diag); base identification (β≡0, earliest indexable quarter); 3-stage GLS gap-weighting with variance floor; CI contrast math Var(βe−βs)=Vee+Vss−2Ves; horizon gates (min pairs/objects whole-index AND per-endpoint, CI-resolves-sign, half-width < 2×|point|); partial-quarter horizon guard (`past = quarters < currentQuarter`); same-date pair exclusion; |ln r|>3 mis-link drop; quarter math string/UTC-safe.
- **Hedonic engine**: sparse Huber IRLS with MAD scale; ridge off the intercept; quarter-dummy pooling threshold identical between buildDesign and idxQuarters (so τ=0 is only ever the true reference); density, mega-slug dominance, within-maker ref/form dominance (stable hasRefControl routing), source AND house composition-break gates (this is what protects index reads from a last-good-stale house segment: the vanished house trips the >40%/<12% break and the horizon abstains); volume-based pickLastCompleteQuarter; composite capped water-filling weights, ≥3-component/≥50%-coverage gates, independent-components variance (disjoint fits), conservative series CI.
- **grade ladder**: base rung 8 anchored at logMult 0; Gauss-Jordan solve correct; thin/non-finite rungs keep the old constant; ascending monotonicity guard falls back rather than publishing an inverted ladder; only ratios consumed.
- **corpus-normalize idempotency**: reroutes exit their own trigger sets (science slugs / SPORTS_OBJECT_SLUGS) after mutation; art category cannot oscillate (OIL_CANVAS ⊂ ORIGINAL_STRONG, so any p2o candidate was never o2p-eligible); stampSubCats deletes stale stamps on re-derive; restampIdentityKeys converges (sports shield yields stable undefined); reconcileSaleDates only ever moves dates down; playerSlug coverage <85% build canary THROWS (good gate).
- **backtest**: valueOne leak-free (strictly-earlier same-maker priors, asOf passed to resolveComps); incremental rehydrates raw accumulators, frozen nowMs (stable recency decay), scoredIds + generatedAt-cutoff dedup, weekly full backstop; conformal band clamps; shape-guarded state read falls back to full build.
- **build-upcoming**: timezone-safe day-string feed cutoff matching the client; resultsPending grace window; eager rows projected through the SAME slimForClient as shards + explicit saleDateTime keep; explicit signal:null discipline; ×5 estimate-band sanity kills bad flags at source with no client resurrect; bid-velocity midrank percentile with 20-peer floor; demand coverage (≥50% est) + staleness (≤2 quarters) suppression.
- **sub-markets**: honesty ladder (CI'd index → demand ≥60% coverage/≥6 quarters → descriptive); descriptive rows carry no movement number; quarterlyVolume excludes the partial quarter (UTC); repeat-sale fallback only when no hedonic index; drill row floor 300 sold; hammer-basis overEstPct alias-safe.
- **gen-redirects**: pin order correct (flagged static 200 self-proxies emitted ABOVE `/lot/*` catch-all); legacy 301s present (/artists, /saved, /preview/terminal, root maker slugs); well under the 2000/100 budgets.
- **sitemap /sub + /lot**: drill paths match `/sub/[a]/[b]` generateStaticParams verbatim (95 rows verified no special chars, route has its own dupe-guard); flagged-lot URLs use the same flaggedLots() + encodeURIComponent as the prerender + redirects.
- **subject-domains**: 1,500 entries, zero duplicate keys, value set exactly the 10 documented domains.
- **next.config**: output:'export' consistent with the OG prebuild + static sitemap approach; fs/path client fallbacks scoped to !isServer.
- **corpus-io**: NDJSON codecs buffer-safe both directions with legacy-array flattening; readCorpus refuses served-file fallback (fail-loud); shard cleanup removes stale shard files + legacy single file; served dir mkdir before shard write.

---

## COUNTS
- **BLOCKER: 1** · **PRE-GA: 11** · **POST-GA: 12**

## WORST 5
1. **B-1** — RR archive (251,866 rows, ~290MB) leaked into the phase-2 client shards by build-market's narrower archive predicate; every research surface pays it. One-line predicate fix + rebuild.
2. **P-2** — `science-tech` missing from build-market's hardcoded MARKETS: an entire tracked slug absent from the science dashboard/hedonic/houseCal/seasonality while subMarkets/drills include it.
3. **P-4** — a failed stats.json read publishes market.json with empty subMarkets on a green build — the lander hero's sub-market layer silently vanishes on the exact thin-nightly failure GA night is most exposed to.
4. **P-1** — sitemap /ref URLs bypass the encodeRefPath codec: 43 dead URLs on the highest-intent watch-reference pages.
5. **P-3 + P-6/P-7** — published-number honesty drift: frozen "n≈2400" calibration block cited as current, appreciationRate built on partial-quarter + gap-blind windows (and printed on OG cards as "this year"), and index series lines terminating on the un-guarded stub quarter.
