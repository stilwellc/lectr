# Data Inventory → Data-Science Opportunity Audit
2026-07-31 · lectr / Ray · method: 20K-row random samples of both corpus files (`scripts/_qa/audit-datasci-sample.js` → `audit-datasci-sample.json`) + a 1-in-3 full scan of lots.json.gz for house-level splits, cross-read against build emitters and every client consumer.

## 0 · Corpus scale (measured)

| file | rows | notes |
|---|---|---|
| `data/corpus/lots.json.gz` | **449,389** | all houses; 95.5% sold, ~4,600 upcoming, ~15k bought_in |
| `data/corpus/sold-archive.json.gz` | **311,583** | 100% Goldin sold; 94% sports-cards (~293k), rest game-used/tickets/trophies |
| total | **~761k lots** | |

House mix of the main corpus (1-in-3 scan, ×3): RR Auction **~252k (56%)**, Christie's ~86k, Sotheby's ~59k, Bonhams ~19k, Goldin ~13k, Phillips ~10.5k, Wright/Rago ~10k.

Estimate coverage on sold lots by house: Christie's/Phillips/Wright/Bonhams ≈100%, Sotheby's 89.8%, **RR Auction 41.7%** (≈105k estimate-bearing sold lots), Goldin 0% (bid-only by design).

## 1 · Field inventory (measured presence, main / archive)

Presence % = non-null in the 20K samples. "Served" = survives the `STRIP` list in `scripts/corpus-io.ts`.

### Money & outcome
| field | main | archive | served | consumed by | verdict |
|---|---|---|---|---|---|
| realizedUsd / priceUsd | 95.5% | 100% | alias only (priceUsd) | everything | core, used |
| estLow/HighUsd | 62% / 40% | 0% | aliases | demand, houseCal, backtest | used |
| hammerUsd | 7.3% | 100% | stripped | houseCal dual-basis (build) | used at build; the /1.25 fallback covers the 93% |
| **buyerPremiumPct** | 8.1% | **100%** | stripped | promote-bid-to-realized only | **UNDER-USED** — BP-schedule drift over time never analyzed; low value though |
| priceBasis | 95.5% | 100% | served | LotPage provenance | used |
| **bidCount** | 3.1% (Goldin only) | **100%** | **served** | bidComp series, LotCard, demand.ts | used (bidComp quarterly) — but only as ONE quarterly median; per-sub-market bidCompNow exists; percentile-vs-peers unused |
| currentBid | 3.1% | 100% | served | LotCard, card vsBid | used |
| **bidHistory** (nightly snapshots) | 0.6% (~2,800 lots) | 0.54% (~1,700 CLOSED trajectories) | corpus-only (STRIP) | **NOTHING** | **UNUSED — accruing**. Measured: **78.5% of live Goldin lots** carry it; span 2026-07-16→now (~2 wks); median 2 snapshots/lot, max 8, crawler retains last 59. Shape `{d,b,n}` = date, bid, bidCount. |

### Identity & structure
| field | main | archive | served | consumed by | verdict |
|---|---|---|---|---|---|
| _card (player/year/set/no/grade) | 0.2% | **94.1%** | on card sample + live | cardComps, repeat-sale index, players.json | used — but **`_card.year` era split never built** (85.6% of parsed cards carry a year: pre-1980 11.2%, 1980–99 16.9%, 2000–09 8.7%, 2010+ 48.9%, unparsed 14.4%) |
| _card.gradeNum | — | **65.8% of cards** (~190k graded sales) | rides _card | grade ladder display; tier-2 grade-adjust | **UNDER-USED — tier-2 uses a HARDCODED multiplier curve** (raw 1 / 9→1.6 / 9.5→3 / 10→7), never estimated from the 190k observed graded sales |
| gradeLabel | 0.04% | 2.4% | stripped | nothing | redundant with _card.gradeNum |
| **editionOf/Total** | 4.1% (~18k prints) | **27.5%** (~86k serial-#'d cards) | stripped | physical-match discriminator only | UNDER-USED — serial-scarcity premium (/10 vs /99) never measured |
| serialNo | 8.6% | 0.04% | stripped | repeat-sale blocking | used (engine) |
| reference (watch ref) | 10.9% | — | **served** | refs.json, /ref pages | used well |
| repeatSaleGroupId | 0.1% (~450) | 0 | served | LotPage provenance timeline | used (thin by design) |
| **authCert** | 2.4% | **89%** (~277k) | stripped | similarity only | UNUSED analytically — auth-body premium never measured (confounded; low priority) |
| photoMatched | 43.6% keyed (mostly false) | 100% keyed | served | similarity physical-match | used (engine) |
| heightCm/widthCm | **1.6%** | 0 | served | hedonic size dummies | too thin to build on |
| description | 25.2% | 0 | corpus-only | nothing | UNUSED — condition-language parsing possible but unvalidated |
| **subjectKeys** | **49%** (82% of RR) | 0 | **served** | comps.ts tier-R ONLY | **UNDER-USED** — no subject browse/series surface despite ~207k subject-keyed lots |
| **itemClass** | **53%** (87% of RR) | 0 | **served** | comps.ts tier-R only | UNDER-USED — the per-kind price-ladder axis for culture |
| subCat / drill / flown | 99% / 46% / 0.3% | 100% / 74% / 0 | served | drills rows (analytics, artists, home) | used (new) |
| sport | 2.4% | 39.8% | served | breakdowns, player pool gating | used |
| firstSeen | 2.8% (all 2026-07; ~12.8k/mo accruing) | 3.6% | served | "New" badge (FeedToolbar/LotCard/Terminal) | used minimally — no freshness analytics |
| saleName | 100% | 100% | served | display only | UNUSED analytically — marquee-sale vs various-owner premium never measured |
| saleDateTime | 34% | 100% | eager only | trueSaleDay | used |

### RR Auction archive (the long-horizon asset)
Measured: **~252k lots, 96.5% sold, saleDates DENSE 2003→2026** (sample: ~400–800/yr scaled ≈ 4–18k lots/yr each year since 2003). Pre-2003 is negligible (~80 lots total 1996–2001) — the honest claim is a **23-year** continuous series, not 30. Vertical mix: entertainment-memorabilia ~219k, space-exploration ~14k, sports-memorabilia ~13k. 41.7% of sold RR lots carry estimates (≈105k), 87% itemClass, 82% subjectKeys. **Currently every culture read in market.json is `descriptive`** (single typical/record number) — the 23-year time dimension is never surfaced.

## 2 · Build artifacts vs client consumption (the delta)

| artifact | emitted by | consumed? |
|---|---|---|
| market.json `markets.*` (index/volume/sellThrough/houseAccuracy/analytics) | build-market §3 | YES — analytics, heroes, rankings |
| `hedonic`, `makerIndex`, composite | build-market | YES — verified.ts, blog; per-maker series lightly surfaced |
| `subMarkets` | sub-markets.ts | YES — TerminalHome (the live home), SubMarketBoard, IndexHero |
| `drills` (69 rows across 6 verticals) | buildDrillRows | YES — SubMarketDrills, artists page. NOTE: cards drills publish per-SPORT repeat-sale indexes (soccer/basketball/baseball/football all `index`) — **no era drill** |
| `houseCal` (house×market, n≥40) | build-market §3b | **LotPage one-liner only** — no house-comparison surface anywhere |
| `seasonality` (month cells, n≥30) | §3c | YES — MarketIntelligence |
| `calibration` block | §3 + backtest | YES — CalibrationCurve, LotPage, value.ts |
| refs.json (watch refs, yearly medians) | §3d | YES — /ref |
| players.json (≥25-sale athletes) | §3e | YES — /player, alerts |
| stats.json | compute-stats | YES |
| backtest.json (buckets, series, calibration) | build-backtest(-incremental) | YES — analytics, gate |
| upcoming.json (tape/demand/realized/bidComp/recentSold) | build-upcoming | YES — realized only for tickets-passes cohort; bidComp only sports-cards |

**The goldmine deltas:** (a) bidHistory — collected, stripped, read by nothing; (b) `_card.year` — parsed on 246k sold cards, never aggregated into era indexes; (c) `_card.gradeNum` on 190k sales vs a hardcoded grade curve; (d) the RR 23-year × subjectKeys/itemClass axes — served to the client, used only as a comp-pool tiebreak; (e) editionTotal on 86k serial-numbered cards.

## 3 · Ranked data-science features (honest support × user value ÷ effort)

### R1 · Vintage vs Modern card era indexes (repeat-sale)
- **Data:** `_card.year` on 85.6% of ~293k sold Goldin cards → pre-1980 ≈33k, 1980–99 ≈49k, 2000–09 ≈25k, 2010+ ≈143k sold lots; cardKey (player+year+set+no+grade) already links repeat pairs; per-sport drills already publish CI'd repeat-sale indexes off pools this size.
- **Method:** Bailey-Muth-Nourse repeat-sale (the existing `buildRepeatSaleIndex` engine + existing `cardKey` keyer, zero new statistics) over era-partitioned pools: vintage (<1980), junk-wax (1980–99), modern (≥2010). Same 95%-CI sign-resolution gate, min-pairs, min-objects.
- **Surface:** new `drills.sports` rows (`cards:vintage`, `cards:modern`, …) — SubMarketDrills/artists render drill rows generically, so UI cost ≈ 0.
- **Dishonesty gate:** exclude the 14.4% unparsed-year cards entirely (never bucket "unknown" as modern); each era publishes only if its own CI resolves — junk-wax may abstain, and must be allowed to.
- **Effort: S.** Highest ratio in the audit.

### R2 · Empirical grade-ladder curve (price-per-grade)
- **Data:** 65.8% of sold cards graded (~190k sales with `_card.gradeCo`+`gradeNum`); `cardLadderKey` already pools same-card-different-grade sales; grade ladders with ≥2 rungs already stamped on live cards.
- **Method:** within-card fixed effects — for every ladderKey with sales at ≥2 grades, form paired log-price ratios between rungs; estimate the grade curve as the median (or Huber-robust mean) log-ratio per grade step, pooled globally and per era/grader (PSA vs SGC vs BGS) where each cell clears an n-gate (e.g. ≥200 pairs). Within-card pairing makes it mix-immune, exactly like repeat-sales.
- **Surface:** (1) replace the hardcoded `gradeMult` (raw 1 / 9→1.6 / 9.5→3 / 10→7) in build-market's tier-2 card valuer with the measured curve — directly improves shipped values and their honesty; (2) a "grade curve" strip on card LotPage/analytics ("PSA 10 trades ~6.2× a PSA 8 in this era, n=…").
- **Dishonesty gate:** never extrapolate to an unobserved rung; per-era curves only where supported (vintage 10s are structurally different from modern 10s); publish the pair-count with the multiple; tier-2 confidence stays 'medium'.
- **Effort: M.** Second-best ratio; improves an already-shipped feature's accuracy claim.

### R3 · The 23-year culture series + subject dossiers (the RR archive asset)
- **Data:** ~252k RR lots, dense 2003→2026, 96.5% sold; subjectKeys on 82% (~207k), itemClass on 87%, drill on 46% (hollywood/political/music/literary/…); ≈105k estimate-bearing sold lots. Nothing else in the collectibles space publishes a 2003-anchored autograph series.
- **Method:** two honest layers. (1) Per-drill and per-subject×itemClass **yearly trailing medians with n-gates** (the exact refs.json `yearly` pattern: publish a year only at n≥3–5) — descriptive $ series, no % appreciation claims. (2) Subject dossiers = the players.json recipe verbatim for culture: per subjectKey ≥25 sales → per-itemClass medians (signed photo vs letter vs document — the natural "price ladder"), TTM median, record, recent.
- **Surface:** culture drill pages upgrade from a single typical/record number to a 23-year chart; new `/subject` route mirroring `/player` ("Einstein: letters $X, signed photos $Y, n=…").
- **Dishonesty gate:** medians + n only, never a movement % (mix inside a drill shifts hard — a Beatles-heavy year is not appreciation); subjectKeys parse collisions gate at n≥25 like players; the "since 1996" framing must say 2003 (pre-2003 is ~80 lots).
- **Effort: M–L** (one build aggregation + one page pattern that already exists twice). The most differentiating feature here.

### R4 · Live bid-velocity read (descriptive now, calibrated later)
- **Data:** bidHistory on **78.5% of live Goldin lots** (median 2 snapshots, accruing nightly since Jul 16, retention 59); bidCount 100% on all ~293k closed Goldin lots; **~1,700 closed lots already carry full bid trajectories**, growing by roughly the weekly Goldin close volume.
- **Method — phase 1 (now):** pure descriptive deltas: "+31 bids since yesterday" (needs only 2 snapshots) and a same-subCat live percentile ("more bidding than 87% of live cards right now" — rank of current bidCount among live same-subCat lots, which is fully observed). **Phase 2 (4–8 weeks):** with a few thousand closed trajectories, fit the typical bidCount-vs-days-to-close curve per subCat (quantile bands over aligned trajectories) so a live lot's pace reads "ahead of / behind the typical curve" — still a count, still never a price.
- **Surface:** LotCard/LotPage live badge on Goldin lots; the eager payload would need a tiny `bidDelta24h` stamped at build (bidHistory itself stays corpus-only, per doctrine).
- **Dishonesty gate:** the platform's own doctrine — a bid count is a demand primitive, NEVER a price direction; no green/red, no "will beat comps"; abstain below 2 snapshots; phase-2 curve claims wait until the closed-trajectory sample supports the band (don't ship the curve on 2 weeks of data).
- **Effort: S–M** phase 1.

### R5 · Sell-through curves by price band (survival read)
- **Data:** ~15k bought_in + ~429k sold in the main corpus; estimates on 62% of sold; sellThroughPct already computed per market/sub-market/drill (n≥40/50 gates) but only as ONE number.
- **Method:** per market (and per drill where n clears), sell-through by estimate-mid bucket — an isotonic-regression-smoothed P(sell | est band) with binomial CIs; optionally by estimate-aggressiveness (est-mid vs comp median) where the engine has a comp value, which is the honest "over-estimated lots die" read.
- **Surface:** MarketIntelligence (next to seasonality, same gating idiom); LotPage context line ("lots estimated $25–100K in design sell 78% of the time, n=…").
- **Dishonesty gate:** bought_in detection differs by house (Goldin lots never bought-in — bid auctions always clear; RR unknown-result rows must be excluded, not counted as unsold); publish only house-populations where bought_in is genuinely observed (Sotheby's/Christie's/Phillips/Bonhams/Wright); binomial CI + n on every bucket.
- **Effort: S.**

### Runners-up (real but lower ratio)
- **House-calibration surface** — houseCal (n≥40 cells) is computed and shipped but read by one LotPage line; an analytics "estimate honesty by house" table is ~pure UI. Effort XS, value M.
- **Serial-scarcity curve** — editionTotal on ~86k cards; within-card paired ratios (/10 vs /99 of the same card) mirror R2's method; thinner pairs, do after R2.
- **Estimate-drift** — houseAccuracy quarterly series already exists per market and is consumed; per-house drift adds little beyond houseCal + R5.
- **Auth-body premium (authCert 89%)** — hopelessly confounded with item quality; would need within-player-within-form matching; abstain.
- **Description NLP (25% presence, corpus-only)** — condition-language parsing (e.g. "restored", "as-found") could feed hedonic dummies; unvalidated, corpus-only, do last.

## 4 · Honesty doctrine checkpoints applied above
Never fabricate → every feature stands on a measured presence % listed here. Abstain over wrong → every series/curve keeps the existing n-gate + CI-resolution idiom. Descriptive markets never show % → R3 and R4 are $-medians and bare counts by construction (typed like RealizedPoint / BidCompetitionPoint so a % caption is unrepresentable). Green/red only for real deltas → only R1/R2 touch anything directional, and both inherit the repeat-sale/CI machinery that already gates the shipped card indexes.
