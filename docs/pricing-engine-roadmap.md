# Pricing-engine optimization roadmap

*Produced 2026-07-16 by a deep audit of the pricing engine: 10 measurement analysts +
6 temporal-holdout experiments on the real corpus (43,436 lots; every claim below is
measured, not asserted). Baseline at audit time: flagged n=3,354, median +40% vs
estimate, beat-high 63%, 24pt edge over unflagged; ~31% of sold-with-estimate lots
valued.*

## The verdict

The engine's **relative signal is real and robust** — flagged lots beat unflagged by
~24pt median (18pt at the hammer), replicated across five independent replays. But:

1. **~70% of the headline "+40% vs estimate" is buyer's premium, not edge** —
   realized/hammer is almost exactly 1.25, flat across houses and price bands, while
   estimates are hammer-basis. Hammer-basis truth: flagged **+12% / 43% beat** vs
   unflagged **−6% / 27%**. The signal is real; the framing overstates it.
2. **The card signal users actually see was never backtested.** `computeDeepSignal`
   (cards) is a different algorithm from `estimateValue` (the validated engine); its
   measured record is +28%/57% vs the engine's +40%/63%, and 3 live cards contradict
   their own modal.
3. **Coverage is fuel-limited, not math-limited.** 55% of targets have <2 same-maker
   candidates at any gate. Phillips alone has 15.7k estimate-bearing sold lots we
   capture 3.3% of.

## Top 10 (ranked by user-facing impact)

1. **Basis-honest claims layer** *(eval+engine, S/M — STRONG)* — dual-report the
   record hammer-basis (+12%/43% vs −6%/27%); raise the client threshold 1.2→1.3
   (4/36 live flags sit in the pure-premium +20–31% zone); fix the four
   premium-inflated surfaces (houseAccuracy at `indices.ts:87` reads ~1.18 from
   premium alone; PortfolioHeader; demand.ts:46; modal beatRate copy). A lot
   hammering exactly at estimate currently reads "+25% over estimate."
   **Do NOT** correct inside the engine ratio — measured null (constant /1.25
   absorbed by thresholds; 97% flag overlap).
2. **Engine owns the card signal** *(engine, M)* — stamp card `signal` from `value`
   in build-upcoming; ship the **contradiction guard now** (suppress client flag when
   the engine disagrees — that bucket measures exactly baseline, zero information);
   modal pool from `value.poolIds`. Head-to-head on 25,076 targets: engine +40%/63%
   vs client +28%/57%; client-only flags (70% of card volume) are +25%/54%. The
   "Warhol Cow +157% below / modal says above" class dies here (root cause:
   `comps.ts:460` pool-trim drops 3-letter tokens like "cow"). Cost: card flag volume
   −47% (60→32) — an explicit product-density call.
3. **Recency decay hl=2y** *(engine, S — validated ADOPT)* — weight
   `cos² · 0.5^(age/2)` in the weighted median. Identical coverage, edge
   23.9→25.0pt, +199 clean flags; churn directionally perfect (removed flags realize
   like unflagged; added flags +26%/58%). Verify Goldin path at adoption (wants
   hl≈1y — see #10).
4. **Honest coverage expansion** *(engine, S/M — validated SHIP)* — tier-b fallback:
   when the strict 0.50/65 pool has <3 comps, retry at 0.45/55 (still ≥3), capped
   "medium". +1,744 lots (30.6→37.5%) at **full engine quality** (+38.9%/63.1%).
   Optional thin tier (2-comp, relaxed): +1,802 more (→44.7%) at +30.0%/59.9% —
   ship only as a distinct "thin" confidence with the band suppressed. Publish
   per-tier backtest rows so the headline never silently blends.
5. **Phillips backfill** *(data, S — endpoint verified live)* —
   `api.phillips.com/api/maker/{id}/lots?page=N&resultsPerPage=100` (~165 requests):
   +15.7k estimate-bearing sold lots (we have 542 of 16,205 = 3.3%); watches +10,555
   comps (**+142% vertical depth**) with native `wReferenceNo`/`wModelName` as
   structured fields. Attacks the starved watch pools (median 1 lot/ref) and all 6
   stale makers. Tag priceBasis premium-inclusive; verify HK/CH/UK currency; dedupe
   vs existing 542.
6. **Production-faithful backtest** *(eval, S)* — remove `PRIOR_CAP=500`
   (64.9% of targets saturate it; uncapped coverage 37.9% with edge INTACT) and score
   the 6,053 excluded bought-ins as outcomes (honest flagged beat 56.4%, edge WIDENS
   to 16.1pt, and yields a new stat: flagged lots fail to sell 10.7% vs 26.6%
   above-market). Then **re-baseline all settled A/B verdicts** (the cap was an
   implicit recency filter). Same parity fix on Goldin (capped 36% MdAPE vs
   production-truth 41.2%).
7. **Art title-token hygiene** *(data, S/M — the only change measured to improve
   coverage AND edge together)* — strip parentheticals "(American, 1928–1987)" +
   artist-name tokens from art titleTokens (corpus + crawler atomically), and reject
   birth-year `yearNum` (20.6% of art yearNums are the artist's birth year; one
   $11.2M Matisse joined a $7k print pool via a spurious "same year 1869" bonus).
   Art: coverage 19.8→21.1%, flagged +9%, edge 27.6→29.6pt.
8. **Comp-pool pollution pack** *(data+engine, S/M each — A/B before ship)* —
   (a) extract lot QUANTITY ("pair", "set of six", "(4 works)") and gate on it: the
   #1 false-comp class, in 22.1% of design / 7.9% of art pools, +12–20% error;
   (b) modelKey junk: blacklist 'an/a/s/on' + karat guard ("an 18ct"→`an18`, 339
   lots) + one-shot re-stamp; (c) exact-match consistency guard: demote when
   compRatio>5 contradicts the lot's own physical/model match (the "+1525% HIGH
   confidence Shoe" class).
9. **Calibration pack** *(engine+eval, S — out-of-time measured)* —
   (a) relevel beatRate per-market with hl-3y recency weighting + shrinkage (fixes a
   17pp art mid-bucket overclaim; keep the STEP — logistic measured worse);
   (b) replace displayed band with split-conformal per-tier multipliers (held-out
   coverage 71–77% vs current 42–51%; "high" confidence is currently the LEAST
   honest band at 41.8%); (c) cap beatRate trust above compRatio~10 (measured 61%
   actual at cr>10 vs displayed 69%); (d) show bucket-conditional medians
   ("cr 1.3–2: +30% median, 24% finish below") instead of the flat +40%.
10. **Goldin no-estimate path** *(engine+data, S each)* —
    (a) ADOPT sport/entity-restricted priors (coverage +44% relative, paired accuracy
    win p≈0.003); (b) hl≈1y recency on the uncapped live path (MdAPE 41.2→38.8%,
    P=99.9%); (c) persist nightly bid snapshots ({date,bid,bidCount} appended) — the
    only path to a bid-momentum feature (final bidCount already stratifies outcomes
    0.74×→1.00×, but zero pre-sale trajectories are stored today).

## Data roadmap (ranked)

1. Phillips paginated backfill (+15.7k est-bearing sold; watches +142%). [S]
2. Ingest Phillips `wReferenceNo`/`wModelName` structured (watch ref share 41%→~99% there). [S]
3. Art titleTokens re-stamp + birth-year yearNum rejection (holdout-validated, #7). [S/M]
4. Quantity extraction in normalize.ts → comp gate/penalty (A/B first). [M]
5. Extraction hygiene (all measured signal-neutral = correctness): watch "Ref:" separator
   (fixes 2,102/3,071 unextracted refs; do NOT hard-gate pools on it — measured −31%
   below-calls), modelKey blacklist + karat guard + key re-stamp. [S]
6. Persist nightly Goldin bid snapshots (enables momentum after ~4–8 weeks of accrual). [S]
7. Verify the 951 Wright premium==hammer rows (2005–2021) against live pages before
   any rewrite — possible hammer-recorded-as-realized contamination (~10pt on design comps). [M]
8. Audit the corrupt-estimate tail (compRatio>10, n≈72: parse/currency anomalies, e.g.
   cr=509 and cr=1047 lots). [S]
9. Dedupe re-crawl/id-variant duplicates only (christies-X vs christies-auc-X; one
   $11.2M sale under two ids; 225 valued targets have a cosine≥0.995 same-price top comp).
   Cross-house dedupe is a measured NON-issue (1 true dup in 36,310). [S/M]
10. Sotheby's GraphQL slug enumeration 2020–2024 (+2–5k est-bearing; diversifies the
    85%-Bonhams watch pool; live cards are 67% Sotheby's but backtest values n=91). [M]
11. Heritage crawler — only AFTER Phillips (advertised on /about, zero code today). [L]
12. Accept the honest ceiling: 31.9% of targets have ZERO same-maker candidates at any
    gate (Picasso: 3,462 such lots). Set per-category coverage expectations.

## Engine roadmap (ranked)

1. ADOPT recency decay hl=2y (validated; +1.1pt edge, +199 clean flags).
2. ADOPT tier-b relaxed fallback (validated; +7.0pp coverage at full quality).
3. Product call: 2-comp thin tier (→44.7% coverage at +30%/60%; band suppressed; never
   promote; no agreement guards — measured to select the WRONG lots).
4. ADOPT Goldin sport/entity priors + hl≈1y recency (validated; re-confirm after
   backtest parity fix).
5. MIGRATE card signal to the engine (contradiction guard immediately; then stamp from
   `value`; modal pool from poolIds).
6. ADOPT per-market recency-weighted beatRate relevel (keep step architecture; refit
   every corpus build — never hardcode again; cap trust at cr>10).
7. ADOPT split-conformal band multipliers (held-out 71–77% coverage vs 42–51% today).
8. PROTOTYPE via gate-ab: exact-match consistency guard; quantity-mismatch gate;
   distinctive-token IDF guard on degenerate titles (42.9% of valued art targets have
   ≤2 distinct tokens; "Q bench" hits cos 1.0 with everything).
9. PROTOTYPE (honesty-sensitive): hierarchical maker-form shrinkage prior as tier-3
   fallback for comp-less lots (covers 91.9% of the uncovered at +30.9%/58.4% — but
   part is premium/house-lightness; copy must be relative, visually distinct, never
   blended into the headline record).
10. Goldin uncovered lots: ship a "recent sales of this player/event" CONTEXT strip,
    never a number (entity-median fallback measured 70.4% MdAPE — unshippable as an
    estimate).

## Evaluation roadmap (ranked)

1. Remove PRIOR_CAP (re-baseline all settled verdicts after).
2. Goldin backtest/production parity (same cap bug).
3. Score bought-ins as outcomes (honest beat 56.4%; edge widens; new sell-through stat).
4. Dual-basis reporting everywhere a claim renders (page/value/Terminal/OG/about/
   houseAccuracy/PortfolioHeader).
5. Per-tier backtest rows for every fallback tier (the +40% headline stays truthful
   only unblended).
6. Stratified edge reporting: by era (post-2020 edge ~30pt — a "2020+" headline is
   both more honest AND stronger), by price (edge only 9.7pt >$10k — consider a
   confidence discount where mistakes are expensive), per-house (suppress/flag where
   backtest n is thin).
7. Auto-calibration emission: backtest writes per-bucket beatRate + conformal
   multipliers into backtest.json; value.ts reads them (with min-n, max-delta,
   monotonicity guards). Ends the fit-once-goes-stale failure mode.
8. Backtest gate: no shipped signal without a temporal-holdout record (one assertion
   post-migration).
9. Point-in-time IDF (measured immaterial — 2.6% label changes, edge identical — do
   for documented purity, low priority).
10. Close cross-house dedupe as a non-issue.

## Do NOT do (measured dead ends)

- Hammer correction INSIDE the engine ratio (null — constant rescale absorbed by thresholds).
- House- or (house,maker)-bias adjustment to estMid (house: null p=0.84; maker-cell:
  actively dilutes −2.5 to −3.6pt — maker estimate-lightness IS the alpha the comp
  engine harvests).
- Logistic/learned probability replacing the step beatRate (worse out-of-time,
  Brier +0.0067; all features except compRatio are null; no learned score beats raw
  compRatio for ranking).
- beatRate conditioned on confidence tier (worse out-of-time; 2025–26 inverts).
- Static bias multiplier on Goldin (2023–24 regime artifact; recency fixes it at source).
- Tier T3 (2-comp at score≥55: 8.6pt edge) and cross-form same-maker fallback (13.1pt;
  "comps a table with a chair") — both under half the 23.9pt baseline separation.
- Swapping the card path's model-line gate for numeric watch refs (−31% below-calls at
  current 7.4k watch depth; persist the fixed ref ALONGSIDE the line key).
- Absolute hedonic pricing (loses to house estimates 1.8–4.2× vs 1.25–1.45×),
  repeat-sale index (no built groups), embedding/minhash retrieval (retrieval failures
  are 0.5% of the coverage funnel — the constraint is candidate scarcity).
- Wright crawl depth (cap not binding; ~365 marginal lots).
- Re-testing the settled set: TOP_K/weights (noise), thresholds 1.3/0.75 (frontier),
  per-market gates (rejected), hard model gate on the value path (rejected).
- Bid-momentum features before snapshots accrue (~4–8 weeks; zero trajectories today).

## Suggested execution order

**Wave 1 (claims + quick validated wins):** #1 basis-honest claims + #2 contradiction
guard + #3 recency decay + #6 backtest parity (then re-baseline).
**Wave 2 (coverage + fuel):** #4 tier-b fallback (+ thin-tier product call),
#5 Phillips backfill, #7 art token hygiene.
**Wave 3 (calibration + card migration):** #9 calibration pack, #2 full card-signal
migration, #10 Goldin pack, #8 pollution pack prototypes.
