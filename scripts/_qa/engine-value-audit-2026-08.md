# Engine Value-Add Audit — how to make the engine worth more · 2026-08-13

Companion to `data-engine-audit-2026-08.md` (correctness/coverage). This one
answers: how does the VALUE the engine delivers to a user get higher/better?
Two passes: a code-grounded product audit and a 10-competitor field sweep.

## THE DIAGONAL PROBLEM

The highest-actionability read (below-market flag + calibrated odds, with the
+41/+16 receipt) has the SMALLEST reach — estimate houses only, ~6% of the
live book. The biggest-reach product (card comps + vsBid on the no-estimate
houses, 94% of the book) has the WEAKEST receipt — no published record at
all. Closing that diagonal is most of the opportunity. Reach is being fixed
by the Tier-1 heals; every lever below multiplies by it.

## THE COMPETITIVE FRAME (10-product sweep)

- Every strong player is single-vertical (Card Ladder cards / WatchCharts
  watches / LiveArt art — and LiveArt, the only one with real CI discipline,
  is pivoting to crypto). NOBODY runs one certified methodology across
  verticals. The S&P-DJI-of-collectibles position is open.
- Deal feeds exist (Market Movers "Deals", PriceCharting sub-minute eBay
  alerts) but publish ZERO accuracy. Marketplaces (ALT/Fanatics/Chrono24)
  structurally cannot flag their own lots. Independence + a rolling,
  per-flag public track record is the un-copyable product.
- The whole card-tool category is retrospective eBay-sold data. CI'd value
  bands on LIVE premium-auction lots pre-hammer is uncontested space.
- Cross-vertical relative value + cross-house venue spreads: structurally
  unique to this corpus; also the B2B data product (WatchCharts-for-Business
  model: insurers, lenders, family offices).
- Table stakes lectr lacks: portfolio tracker marked to own indices (the
  retention engine everywhere), per-item watchlist alerts, pop-report
  context on card lots (GemRate made census an expected column).
- Worth copying: LiveArt's published CI calibration ("95% bands contained
  94.6%"), Artprice's 24h day-pass, Chrono24's free flagship index as PR.

## EDGE-SIZE FINDINGS (from the receipt + calibration data)

- Receipt is GLOBAL-ONLY: no per-vertical or per-price-band split exists.
  Watches' low-ratio calibration buckets run 35-36% beat rates (near coin
  flip) while cr>2.0 runs 69-72% everywhere — the 1.3 flag threshold should
  be per-vertical.
- The premium edifice rests on one flat PREMIUM_FALLBACK=1.25
  (backtest-core.ts:29). A real per-house BP schedule table (public fee
  schedules, tiered) de-biases cross-house comp medians by up to ~10% AND
  unlocks max-bid guidance.
- Comp pools are sold-only (bought-ins never enter) → comp medians biased
  up. failToSell 3.4 vs 4.1 proves flags don't chase no-sales, but a
  bought-in-aware sell-through shadow check tightens flag honesty.
- Spec's own governing result: aggregate error sits at the repeat-sale noise
  floor — the dominant delivered-value lever is REACH + product, not model
  accuracy.

## THE TIMELINESS LEAK

One nightly crawl; soft-closes decide in minutes. vsBid is ~18-20h stale at
the decision moment — a "below comps" glow stamped 1am ET is frequently
false by 9pm. Goldin's own 60-snapshot bidHistory can QUANTIFY the close-day
leak today. Fix is light: a "closing board" job recrawling only lots closing
<24h (a few hundred pages), every 4-6h + a T-4h pass, emitting a tiny
overlay JSON (id → currentBid, refreshed vsBid) + a "closing today, still
below comps" digest section. No full assemble; corpus stays nightly.

## TOP 10 LEVERS (user value × feasibility with current data)

0. (Precondition: Tier-1 titleTokens/slug heals — shipped separately.)
1. **Max-bid guidance** — walk-away hammer = band-lo ÷ house BP. Blocked
   only by the missing BP schedule table. Converts every read into an action.
2. **Published record for the no-estimate + card-comp products** — nightly
   vsBid/MdAPE track + a "card-comp said $X, sold $Y" settled tape (the
   /value settled-calls pattern is the right shape). Trust for the 94%.
3. **Close-day board + T-4h alert** — recovers the largest pure value leak.
4. **Cross-house card arbitrage** — byCardKey already hash-joins Goldin +
   the six houses; live×live collisions and live-vs-cross-house-sold gaps
   are computable tonight. Unique in the market.
5. **All-in cost line on every lot** — the BP table + one UI line.
6. **Per-vertical / per-price-band edge receipt** — extend CalObs/Bucket
   keys; feeds per-vertical thresholds and honest vertical marketing.
7. **Exit-liquidity read per drill** — median resale interval (days) +
   realized spread from repeat pairs + sell-through; primitives all present,
   nothing surfaced.
8. **Seller-side league table + consign-timing** — realized medians per
   house×category (mix-controlled via cross-house cardKey pairs) + the
   already-served monthly seasonality. Opens the consignor audience.
9. **Grade-arbitrage surface** — the grade ladder is ALREADY FITTED and
   served (analytics.gradeLadder); surface gem-premium reads + raw-priced-
   near-graded flags. Presentation work, not modeling.
10. **Portfolio/watchlist digest** — mark-to-market + flag-change alerts
    over the existing Resend pipeline. The retention flywheel. (Competitive
    table stakes: this + per-item alerts + pop-report context.)

## RECEIPT GAPS (trust debt, ranked)

1. Card-comp tiers: flagship product, zero backtest.
2. No-estimate vsBid: 94% of book, no record.
3. Global receipt over-claims for watches (publish per-market splits).
4. Conformal "70%" + house-calibration lines: bare assertions, no drill-through.
5. backtest.json freshness (Aug 5 vs Aug 13 market) — stamp + display recency.
