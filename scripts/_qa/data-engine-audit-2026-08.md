# Data Labeling · Corpus · Engine Audit — 2026-08-13

Three measured passes over the full local corpus (1,124,077 segment rows; assembled
lots 514,702 + archive 561,316) plus an end-to-end engine code-read. Every number
below was counted, not estimated.

## THE HEADLINE

**The Aug-2026 expansion houses are IN the corpus but INVISIBLE to the product's
brain.** The isolation-first crawl doctrine worked perfectly at the segment level —
but the "wiring in" never happened at the SEMANTIC level. The 8 expansion slugs
(graded-cards, memorabilia, autographs, unopened-wax, type-1-photos,
programs-publications, equipment-artifacts, pop-memorabilia) are not in ARTISTS,
not in SPORTS_KIND, not in the card-parse pass, and their rows never get
titleTokens. Four independent audit findings are all this one gap:

- **97% of the live book (4,650/4,778 lots) cannot be valued** — no titleTokens
  → the engine literally cannot vectorize them or see their comp pools
  (build-market.ts:136 requires titleTokens; only ray-crawl.ts:3914 stamps it)
- **~280K crawler-stamped subCats WIPED at assemble** — stampSubCats deletes
  subCat when sub-cats.ts SPORTS_KIND doesn't know the slug
- **165,206 expansion card lots have zero player identity** — the _card parse
  only touches artist==='sports-cards'
- **~250K sold rows feed no vertical surface** — marketOf('graded-cards')
  falls back to 'art' (constants.ts:109)

## TIER 1 — one-file unlocks (Small effort, five-to-six-figure row impact)

1. **titleTokens heal** — idempotent pass in normalizeCorpus reusing
   titleTokens() from app/lib/normalize.ts. Unlocks value-engine visibility for
   97% of the live book + seats ~280K-row comp pools. Watch build time:
   consider engine-excluding graded-cards like sports-cards and serving via
   the card paths instead (see Tier 2.1).
2. **SPORTS_KIND map: add the 8 expansion slugs** (sub-cats.ts:22) — restores
   the ~280K wiped subCats in one map edit.
3. **ARTISTS registration of the expansion slugs** (constants.ts) — kills the
   'art' fallback; ~250K sold rows start feeding sports tape/recentSold/stats/
   sub-markets. S code, M validation (check every sports surface).
4. **Single-point-estimate fallback in the client engine + backtest**
   (comps.ts:448/531, value.ts:210, backtest-core.ts:37 — mirror demand.ts:43)
   — RR's 196 live lots get signals; RR enters the backtest record. A/B first.
5. **REA bidHistory → bidVelocity** — widen the Goldin-only gate at
   ray-crawl.ts:3584 to REA (bid data already scraped nightly on 2,388 lots).
6. **Small heals**: REA imageUrl missing https:// scheme (98.7% of 181K rows);
   Memory Lane title boilerplate truncation ("Bids: N Opening Bid:…" inside
   85.1% of titles — truncate at first Bids:/Status: token + retro-heal 9,795
   rows); purge 435 CSS-junk titles (Lelands/LOTG); re-run the Lelands gallery
   heal to fix ~1,900 resolver-mis-dated rows (resolver read the CURRENT
   auction's End banner on old lot pages → clamped saleDate to run-day; prices
   correct, dates wrong; also patch resolve-suspects to preserve original
   saleDate); drop the 1 "Lot Withdrawn…Status: Sold" row; null 12
   empty-string saleDates.

## TIER 2 — parser & pipeline work (Medium)

1. **Route graded-cards + unopened-wax through the card paths**
   (build-market.ts:560-573 sports pass + parseCard measurement on REA/H&S/ML/
   LOTG title formats). Unlocks: tiered card values on 2,453 live REA lots
   (51% of book) AND the sports flagship's 5Y horizon — the 30-yr ~160K-card
   expansion archive is the single biggest index unlock in the repo (sports
   5Y currently abstains: Goldin history only reaches 2022).
2. **H&S 400-lot cap** — every auction since 2022-11 truncates at exactly 400
   lots (~50% of every modern sale silently missing). Fix pagination cap in
   crawl-hugginsscott.ts + re-crawl 2022→present.
3. **Expansion-house playerSlug parser** — extend recoverPlayerSlug to REA/
   Lelands conventions (canary already firewalled). Then widen
   SPORTS_SCIENCE_SLUGS / soldCompBand (comps.ts:803) to identity-carrying
   expansion slugs.
4. **Pokémon: grade parse + cardKey analog** — grades sit unparsed in 40,621
   titles (3 rows have gradeLabel). A set|cardNo|edition|grade key over the
   Goldin pokemon rows + a culture branch in tryRepeatSale = the culture
   vertical's first certified index read (culture drills today: 0/17 index).
5. **Assemble-time content dedupe** — ~9K duplicate rows under distinct ids
   (Goldin 3,976 / RR 2,274 / REA 1,437 / Christie's 783): key
   (house, saleDate, normTitle, priceUsd), keep first.
6. **Backfills**: REA missing months (2024-12, 2025-08, 2025-11, 2025-12,
   2026-07); Lelands 2025-01→09 hole; H&S images (0% on 72K rows — check the
   headless-UA trap before trusting empties); Sotheby's descriptions (0.8% vs
   Christie's 99.1%).
7. **H&S/Lelands cert-parse extension** — 40-47% authConfidence=low from
   looser cert phrasing; extend sports-crawl CERT/GRADE regexes.
   Also: Goldin has authConfidence on 0 rows — the doctrine gates never test
   the biggest house; stamp it in the Goldin ingest.

## TIER 3 — engine ladder (M–L)

1. **A published record for the no-estimate product** — vsBid/absolute-value
   MdAPE nightly track (validate-engine methodology folded into backtest-core).
   The product that now covers 94% of the live book has no receipt; the famous
   +41-vs-+16 receipt only covers both-bounds estimate houses.
2. **Goldin sold → client shards / server band precompute** (Spec v2 Step 8b,
   doc's own estimate: worth ~5× the game-used parser's live yield).
3. **Watches era gate** — only after watches-backtest2/keytype-err measurement
   lands (Spec v2's own precondition).
4. **Dims crawl-stamp + design modelKey** — size gate fires on 0.28% of pairs
   vs 29.8% possible; modelKey identity also enables a DESIGN repeat-sale
   branch (the LC2/Conoid doctrine in comps.ts:241 is the key spec).

## WHAT MEASURED CLEAN (don't spend time here)

- 0 duplicate ids within/across all 15 segments
- 0 sold rows with missing/≤0 realized price; 0 upcoming rows carrying price
  fields; 0 future-dated sold (beyond +1d); 0 fx anomalies on 101K non-USD
  rows; 0 missing priceBasis
- No price-bleed signature outside the healed trio (Goldin/REA same-price
  clusters = bid-increment quantization × buyer's premium, verified)
- Withdrawn-language contamination: 1 row corpus-wide
- Title lot-number prefixes: ≤2 rows (non-issue)

## WATCH ITEMS

- Lelands: 1,746 sold rows dated run-day + 180 dated prior-day, basis
  'realized', while the sale runs to 08-15 — verify these lots actually
  soft-closed before comps trust them (they came via the gallery-sold path
  during a live sale + the resolver date bug above).
- backtest.json generatedAt 2026-08-05 vs market.json 08-13 — confirm the
  nightly incremental backtest step is still writing in CI.
- Stale-upcoming zombies: 55 rows, all monolith houses, all recent — W11
  covers them; verify they clear after the next full nightly.
- Memory correction: Engine Spec v2's "reference-band UI" deferred item HAS
  shipped (LotPage.tsx:448, profile/page.tsx:193).
