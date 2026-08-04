# C2 · GA honesty-doctrine audit — lectr.bid

Audited 2026-08-03, against the doctrine: never fabricate; abstain > wrong; descriptive markets never
show %; green/red only on real measured deltas; mono only for %-figures; every figure names method + n;
reference = labeled range, never a point/flag; counts never dressed as price movement; dual-basis
(all-in / hammer) labeling on engine performance.

Method: every rendered number/claim enumerated from code across home/landers, /value, lot pages,
/makers + dossiers, /analytics, /sub /ref /player, /profile, blog/about/OG — then spot-verified on
https://lectr.bid with playwright-core (computed color + font per numeric node) on `/`, `/value`,
`/analytics`, `/makers/rolex`, `/sub/cartier/panthere`, `/sports`, `/about`. Built output in `out/`
was checked where prod and working tree disagreed.

Interpretation note (applied consistently): the codebase's own three-tier ladder
(`app/sub/SubPage.tsx:10–15`) is taken as the doctrine's operational form —
**index** (CI'd repeat-sales/hedonic) → % + mono + green/red allowed;
**demand** (measured median-%-over-estimate, labeled "vs estimate") → % allowed, color allowed;
**descriptive** (typical $, medians of what sold, counts, appreciation estimates) → plain ink, never %
as a movement claim, never green/red. Mono on prices/dates/counts in tape contexts is treated as
tabular typography, not a violation; mono misuse is only flagged where it dresses a non-verified read
as a verified one.

---

## VERDICT

**6 BLOCKER · 9 PRE-GA · 6 POST-GA.** The engine/backtest spine (receipt, record band, verified
movers, CI tape, reference bands, settled calls, profile track record) is genuinely clean — the trust
chain holds end-to-end. Every blocker is one construct: **`stats.appreciationRate` and other
descriptive median-shift reads wearing green/red % in returns clothing.** All are small, surgical
fixes (drop a color / a tooltip / add a gate); none require data work.

**Deploy-drift warning:** two of the blockers (B1, B6) are NOT on prod today — prod renders those
values in neutral ink. The local build (`out/_next/static/chunks/7861-ef89adde1dc3e06c.js` contains
`"data-dir":el` on the "Yearly ROI" value and its tooltip) ships them tomorrow. Fix before deploy or
the GA build introduces the regression.

---

## BLOCKERS

### B1 — Home hero "Yearly ROI": descriptive appreciation, colored, with a fabricated method claim
- **Where:** `app/preview/terminal/IndexHero.tsx:219` (`const roi = appreciation`), rendered
  `:308–312` (mobile) and `:389–394` (desktop rail); fed by
  `app/preview/terminal/TerminalHome.tsx:261–269`. CSS: `style.module.css:193–194, 1340–1341`
  (`[data-dir='up'] → var(--color-up)`). Page: `/` and every market lander.
- **The number:** e.g. `+15.1%` (all), `+29.7%` (sports) — revenue-weighted mean of
  `stats.json[artist].appreciationRate`, a coarse avg/median-price appreciation estimate.
- **Why:** (a) descriptive price-level read rendered as green/red mono % under the label "Yearly ROI"
  (rules: descriptive-never-%, green/red-only-measured); (b) the tooltip says *"Sales-weighted
  annualized value trend across this market's **verified repeat comparisons**"* — false provenance:
  appreciationRate is not from verified repeat comparisons; the verified reads live in
  `market.json.makerIndex`/drills. That is a mislabeled figure — the worst class of violation.
  (c) no n anywhere.
- **Severity:** **[BLOCKER]** — and a *new* regression vs prod (prod renders it neutral).
- **Fix:** neutral ink (drop `data-dir`), rename ("value trend · rough estimate" or similar), correct
  the tooltip, or replace the source with an actual verified read where one exists.

### B2 — OG share card: "prices up/down X.X% this year" in green/red
- **Where:** `app/opengraph-image.tsx:27–29, 94–96`. Surface: every link share of lectr.bid.
- **The number:** revenue-weighted mean of `appreciationRate`, printed
  `prices up 3.4% this year` colored `#2FBF71`/`#E5544B`.
- **Why:** descriptive aggregate dressed as a market price move with direction color, no method, no n
  (rules: descriptive-never-%, green/red-only-measured, method+n). Contrast: the backtest line on the
  same card (`:101–106`) is perfect (`+41% median over estimates · 38,734 replayed sales`).
- **Severity:** **[BLOCKER]** — this is the brand's first impression in every chat/social embed.
- **Fix:** drop the line or swap in a verified read (e.g. the strongest CI'd drill index with its
  horizon), neutral ink.

### B3 — Analytics sparkline cards: "appr. est." chip colored green/red
- **Where:** `app/components/analytics/ArtistSparklines.tsx:376–377` (source =
  `stats.appreciationRate` for `priceBasis` makers), `:185–191` (chip colored
  `var(--color-up)`/`var(--color-down-text)` + directional Flick), `:133–135` (sparkline line itself
  tinted green/red when `|appreciation| ≥ 25`). Page: `/analytics` (maker cards, sports/science).
- **Why:** the code comment (`:169–171`) admits it is "a coarse median-price appreciation estimate —
  NOT the confidence-bounded demand read", but the render gives it the exact same green/red ±% grammar
  as the demand chip; the honesty lives only in a 10px "APPR. EST." label and a hover tooltip.
  Descriptive read wearing % + color.
- **Severity:** **[BLOCKER]** (chip + line tint).
- **Fix:** plain-ink the appr.-est. chip and never tint the line off `appreciation` when `priceBasis`.

### B4 — Rankings table "12-mo movement" column: colored descriptive median shift (and a mislabel)
- **Where:** `app/components/analytics/ArtistRankingsTable.tsx:131` (collection lens: `movement =
  stats.appreciationRate`), `:169–171` (sport lens: `med12/medPrior − 1` on the loaded ~38K sample),
  rendered colored at `:489–497` (table) and `:595–600` (mobile trend pill). Page: `/analytics`
  (sports/bid markets).
- **Why:** (a) green/red % on a medians-of-what-sold shift — the codebase itself refuses to color this
  exact construct elsewhere (`PlayerPage.tsx:139–145`: "a shift in the mix … is not appreciation, and
  green here would claim it is"); (b) for the collection lens the header caption (`:450`) says
  *"Median sale over the trailing year vs the year before"* but the value is `appreciationRate` — a
  different method than the one named. Mislabel + descriptive-wearing-color.
- **Severity:** **[BLOCKER]**.
- **Fix:** plain ink for the column; make the caption match the actual source per lens (or compute the
  captioned stat for both lenses).

### B5 — Maker dossier References ledger: ungated "ttm" delta, colored — prints "+1155% ttm" in green
- **Where:** `app/makers/[slug]/page.tsx:200–202` (TTM median vs all-time median, no dispersion/mix
  gate, no n-floor on the TTM window), colored at `:211–215`. **Prod evidence:** `/makers/rolex`
  renders `+1155 % ttm`, `+201 % ttm`, `+114 % ttm` in green.
- **Why:** the comment claims "a real measured move (both sides are medians of realized sales), so it
  may carry direction" — but with no window-n or sanity gate the figure is a mix artifact at these
  magnitudes; a four-digit green % in a dossier is exactly the "wrong > abstain" failure the doctrine
  exists to prevent. (The panel note at `:222` names the method honestly — the gate, not the label, is
  what's missing.)
- **Severity:** **[BLOCKER]** (abstain > wrong; green/red only on deltas that mean what they look like).
- **Fix:** gate (e.g. TTM window n ≥ 20 and |Δ| ≤ ~100%, else abstain), or plain-ink it.

### B6 — Home hero "Bids/lot" count tinted green/red
- **Where:** `app/preview/terminal/IndexHero.tsx:237` (`dir` from QoQ count move), rendered with
  `data-dir` at `:316` (mobile) and `:399` (desktop); CSS `style.module.css:193–194, 1340–1341`.
  Page: `/` + `/sports` (cards vertical).
- **Why:** a count (median bids per sold lot) wearing the up/down price-move colors — the tooltip
  itself says "Not a price move", the render says otherwise. Rules: counts-never-dressed-as-price-
  movement; green/red-only-measured-deltas.
- **Severity:** **[BLOCKER]** by the letter of the doctrine (trivial fix). Like B1, this is in the
  local build but not yet on prod (prod shows it neutral).
- **Fix:** drop `data-dir={bc.dir}`; keep butter/neutral like "On the block".

---

## PRE-GA

1. **/value record band flagged cell lacks the word "all-in"** — `app/value/page.tsx:430–435`: headline
   `+41%`, sub `median realized vs estimate · 38,734 calls · +13% hammer-only`. The footer promises
   "each figure names its basis" but the headline's basis is only implied by "hammer-only" on the sub.
   The home receipt does it right (`SubMarketBoard.tsx:392–398`: "all-in basis · hammer-only …").
   Rule 8. Fix: `median realized vs estimate, all-in · …`.
2. **Worst-year sentence basis unnamed** — `app/value/page.tsx:471–482`: `+X% median over estimate ·
   N calls` — all-in vs hammer unstated. Rule 8.
3. **Analytics desk-strip "The record" cell basis unnamed** — `app/analytics/page.tsx:165–172`: green
   `+41%` captioned "flagged calls, replayed · median vs estimate"; dual basis appears only in the
   prose panel below ("… all-in (+13% at hammer, the honest basis)"). Rules 6/8.
4. **Value masthead "comps run +103% over these estimates"** — `app/value/page.tsx:379–381`: green,
   Inter (not mono), method ("median of flagged lots' comp gaps") unnamed, hardcoded `--color-up`.
   Measured, so not a blocker — but it's the page's first %-figure and carries the least labeling on
   the page. Rules 4/6.
5. **Lot page "This card" row: ungated flag color** — `app/components/LotPage.tsx:725`: the same-card
   median renders green whenever `currentBid < med`. Exact-identity comps, so measured — but it's a
   below-market flag issued outside the engine's confidence/calibration path, colored on a $ point
   rather than a delta, with no odds attached. Rule 3 / abstain-over-wrong. Fix: drop `tone`, or route
   through the signal path.
6. **Sub-market directory descriptive rows: "typical" price without n** — 
   `app/components/SubMarketDirectory.tsx:87–89`: `$X typical` with no sales count/window (the /sub
   dossier's own record section does it right: "median, last 12 months"). Rule 6.
7. **Lot page "Last sold" row unlabeled method** — `app/components/LotPage.tsx:728–732`: a bare
   `$850 · Jan 2024` with no "most recent same-card sale" label. Rule 6.
8. **Blog hardcoded verified-mover figures** — `app/blog/how-we-built-the-pricing-engine/page.tsx:213–216`
   and `app/blog/q2-2026-watches/page.tsx` (Cartier +51.2% [19,92] n=5,771; Rolex +23.6%; Patek −12.9%):
   literals, not fetched from `market.json`, in a nightly-refit system. Today they match prod's
   VerifiedMovers exactly (verified on `/analytics`), and the corrections register already logged one
   drift-and-fix cycle — but at GA these will drift again. Rule 1 (stale-risk). Fix: build-time fetch,
   or a standing corrections-register discipline with a drift check.
9. **%-figure mono inconsistency (bundle)** — measured %s render mono in some sites and Inter in
   others: value ledger `+74%` mono in the cell but Inter in the row-sig (`ray-value-row-sig`);
   VerifiedMovers `ray-vm-chg` Inter; PastResults "vs est" Inter; RefLedger ttm Inter; masthead gap
   Inter. The mono = verified-figure grammar loses meaning if it's inconsistent. Rule 4.

---

## POST-GA (wording/typography)

- `+N bids` plus-prefix on velocity counts (`LotPage.tsx:714`, `TerminalHome.tsx:204`,
  `LotCard.tsx:341`, `makers/[slug]/page.tsx:278`) — always labeled "bids", never colored; drop the
  `+` if desired.
- EngineHero verdict "1.5×" in green **Fraunces serif** (`SubMarketBoard.tsx:337` + `.ehRatio`) — the
  signal is measured and captioned ("its comparables sell above this ask, at the median" + fine-print
  method + confidence dots), but a serif data figure breaks the type grammar (serif = editorial,
  mono = measured).
- Q2 post dek rounding vs stat plates ($509M/„$508.8M", $240M/$239.9M, $126M/$125.6M).
- "faster than 73% of live lots" percentile in plain prose (`LotPage.tsx:715`) — fine as prose; could
  say "percentile".
- Grade-ladder rows rely on the section header for method ("medians, never means") rather than
  per-row labels (`LotPage.tsx:552–568`).
- RefLedger `$` medians in mono `.num` (`makers/[slug]/page.tsx:210`) — tabular typography, accepted,
  but note vs rule 4's strict reading.

---

## AUDIT TABLE — the trust chain for the site's ~22 most prominent figures

| # | Figure (as rendered) | Source field | Basis | Gate | Label/caption | Status |
|---|---|---|---|---|---|---|
| 1 | Home hero headline `+16.4%` (neutral, mono) | demandSeries() median-over-estimate level (`lib/demand.ts:27–67`) | vs estimate, trailing-12mo | ≥5 sales/window | hero.explain + horizon chip; **neutral ink by design** (`roiNeutral`) | CLEAN |
| 2 | Hero layer chips `+31.4%` (green, mono) | heroLayers → drills indexes/demand; volume layers print `N/qtr`, never % (`IndexHero.tsx:184–185`) | per layer kind | volume excluded from %/dir | legend + chip label | CLEAN |
| 3 | "Yearly ROI +15.1%" (rail) | stats.json appreciationRate, revenue-weighted | avg-price level | none | tooltip claims "verified repeat comparisons" — false | **B1** |
| 4 | "Bids/lot 21" | lot bidCount median/quarter (`lib/demand.ts:198–250`) | count | ≥2 quarters | "Not a price move" tooltip, but data-dir color | **B6** |
| 5 | Tape "Classic cards +118.9% · 3Y" (green, mono) | market.json drills index.changePct | repeat-sale CI'd index | publishable CI | `CI +103 to +136 · 49,052 lots` | CLEAN |
| 6 | Tape "Demand −4.0%" (plain ink, not mono) | drills demandNow | median vs estimate | ≥5/window | `over estimate · 1,223 lots` | CLEAN |
| 7 | Receipt "Replayed sales 38,734" | backtest.flagged.n (fetched) | count | n ≥ 500 to render | slip prints n twice | CLEAN |
| 8 | Receipt "Flagged · median vs est +41.0%" (green) vs "Unflagged +16.0%" | backtest.flagged/.unflagged medianPerfPct | **all-in**, named | replay | `all-in basis · hammer-only +13.0% vs −7.0% · settled nightly · as of <date>` | CLEAN — model citizen |
| 9 | Receipt "The edge +25.0 pts" (neutral) | flagged − unflagged | pts, not % | — | "(flag − rest)" | CLEAN |
| 10 | Home footer "+13% median … 38,734 replayed sales" | backtest.flagged.hammerMedianPct | **hammer**, named ("hammered over their estimates") | — | sentence names n | CLEAN |
| 11 | /value record band 4 cells (+41% / +16% / 44% / 3.4%) | backtest.json | all-in headline (word missing → PRE-GA 1), "at the hammer" named on beat-high | n ≥ 100 to render band | subs name n | PRE-GA 1 only |
| 12 | /value worst-year "+X% · N calls" | backtest.series min flaggedMedianPct | all-in (unnamed) | year n ≥ 30 | names the weakest year openly | PRE-GA 2 |
| 13 | /value ledger gap `+74%` (green, mono) + odds `72%` (neutral) | signalWithPool pct; calibrated beat-rate (backtest.calibration) | comps vs ask; odds from replay | confidence tiers; low-conf never headlines (pickCall) | "ranked by calibrated odds"; odds neutral ink | CLEAN |
| 14 | Lot cert "The gap +53%" (green) + confidence dots + "X% of flags like this beat their estimate" | signalWithPool / beatRatePct | comps vs ask | flag-eligible confidence ≥3 tiers | dots + beat-rate sub | CLEAN |
| 15 | Lot "Comps median $X · n sales" | engine pool median | realized | pool rules | "medians, never means" | CLEAN |
| 16 | Lot "Reference comps $q1–$q3" | science/cultureReferenceBand (`lib/comps.ts:1098–1199`) | realized IQR | dispersion ≤2.5×med; est-sanity ±5×; structurally cannot flag | `median · n sales · low-confidence reference`; range, no tone, no % | CLEAN — exactly the doctrine |
| 17 | Lot "Sub-market … +X% verified [lo, hi] · N lots" | drills index | CI'd | readType gating | "verified" + CI + n | CLEAN |
| 18 | Analytics VerifiedMovers `Cartier +51.2% [19, 92] · 5,771` | market.json makerIndex (hedonic) | log-price hedonic | 95% CI must resolve sign, else abstain | "price movement · 95% confidence" | CLEAN |
| 19 | Analytics grade ladder `2.47×` etc. | market.json.gradeLadder | within-card paired log-ratios | fitted pairs | caption names `3,535 pairs / 1,764 cards · holdout −6.4% median error` | CLEAN |
| 20 | LongHorizon era legend `+119% 3Y [103, 136] · 49,052 lots` | drills era indexes | CI'd | publishable | block method line | CLEAN |
| 21 | About "760,972 lots · 8 houses" (+ blog counts, OG backtest line) | meta.json / backtest.json imports | live data | — | corrections register logs past drifts | CLEAN |
| 22 | Profile track record + collection `+Z%` | save-time signal snapshots; paid-vs-appraised | hammer basis named; unpriced pieces excluded from % | n ≥ 3 per cohort | "the market's move, not your pieces'" on exposure | CLEAN |

## Verified-clean list (doctrine showcases)

Backtest receipt (dual basis + n, printed twice) · /value settled-calls tape (save-time flags only,
"all-in" and "at the hammer" both named, vs-comps rendered as a word, not a %) · reference bands
(range + "low-confidence reference", structurally unable to flag) · SubPage honesty ladder
(index/demand/descriptive enforced in render, method caption per chart mode) · PlayerPage category
medians deliberately uncolored · RelativeStrength excludes descriptive rows and says so ·
volume layers print `N/qtr`, never % · maker "market this maker trades in" panel labeled
"…across the whole corpus — not X's own figures" (borrowed context done right) · AlertsInbox
("green/red never decorates anything else") · blog corrections register (drift logged, abstention
announced when CIs widened) · Q2 posts label every mover as a demand read with n · profile collection
math (reference ranges never enter totals; unpriced pieces never enter the %) · feed tape signals
neutral-ink on prod · CIBeam labeled "95% confidence range" · house calibration lines name n
("hammers +0.5% vs mid · 247 sales").

---

## Final count

**BLOCKER: 6** (B1 hero Yearly ROI, B2 OG "prices up X%", B3 sparkline appr.-est. chips,
B4 rankings 12-mo movement, B5 RefLedger ungated ttm, B6 bids/lot tint)
**PRE-GA: 9** · **POST-GA: 6**

### Worst 5
1. **B1** — home-hero "Yearly ROI": descriptive appreciation in green/red mono % with a tooltip that
   claims "verified repeat comparisons." A mislabeled figure on the front door, shipping as a
   regression in tomorrow's build.
2. **B2** — OG card "prices up/down X.X% this year" in green/red: the descriptive read every share
   embed leads with, no method, no n.
3. **B5** — `/makers/rolex` printing **"+1155% ttm" in green**: the single most visibly wrong number
   on prod today; ungated median-mix artifact wearing the verified grammar.
4. **B4** — analytics "12-mo movement" column: colored descriptive median shift whose caption
   describes a different method than the collection lens actually uses — while the site's own
   PlayerPage comment forbids exactly this coloring.
5. **B3** — sparkline "appr. est." chips + line tints: coarse appreciation estimates in the same
   green/red ±% grammar as measured demand, honesty relegated to a 10px label and a tooltip.

All six blockers are render-layer fixes (drop a color attr, fix two tooltips/captions, add one gate,
swap one OG line); the data pipeline needs nothing. Fix B1/B6 **before** the GA deploy — prod is
currently cleaner than the working tree on those two.
