# MULTI-LANE VALUE ENGINE — FINAL ENGINEERING SPEC (v-final, executable tonight by one engineer)

Synthesis verdict: Spec A (THREE NAMED LANES) is the base architecture — both judges ranked it first (9/10 honesty, 8.5/10 buildability). This final spec absorbs all eight ordered grafts from Spec B, resolves the honesty judge's one substantive ding on A (the forming shelf now faces the tape), and rejects B's convicted decisions permanently (see §7 cut list). All decisions are final — F1–F40. Ground truth re-verified against scratchpad/lanes/{precedent-laws,coverage-audit,estimate-lane,projection-lane,traction-signals,ledger-receipts}.md and the live repo.

Three lanes, one question each, one mechanism, one board section, one receipt kind, no shared score:
- **THE FLAGS** — "the estimate is wrong" (certified, untouched)
- **THE GAP** — "the bidding is behind the value" (no-estimate lots, projected close vs floor)
- **THE SLEEPERS** — "the price is right and nobody's looking" (verified-fair lots, dead room, closing)

---

## 1 · LANE TAXONOMY — FORMULAS, THRESHOLDS, GATES

### Lane 1 — THE FLAGS (certified, frozen)

**F1.** Ships exactly as-is: server `estimateValue` odds gate (compRatio ≥ 1.3 AND calibrated beatRate ≥ 50; 'strong' at ≥2×/≥60), ×5 sanity kill at the stamp, client `signalWithPool` fallback with its 14-step abstention ladder, dealScore ranking (`beatRatePct×1000 + min(pct,400)`). Zero threshold moves. It carries the only replayed certified record (+41%, n=38,671) and its calibration is the spine.
**F2.** Only change: the /value board kicker becomes `THE FLAGS · comps vs estimate` so the three-lane grammar is explicit. `signal` field, labels, saves, alerts, profile paths untouched.
**F3.** The Flags remain the ONLY lane admitted to dealScore, the CallPlate, and certified vocabulary — permanently. dealScore's `?? 50` beatRatePct default would silently rank uncalibrated calls at the 50-odds tier (precedent-laws §4); lanes 2–3 never enter it at any version.

### Lane 2 — THE GAP (no-estimate: projected close vs value floor)

**F4. Population law (graft: B's D4, the best recon in either spec).** The closeCurve is fitted EXCLUSIVELY from Goldin nightly bidHistory on sold lots (build-market.ts:1076-1110); estimate-house books (RR's 22/30-day min-bid open book) are out-of-distribution. Therefore `gapRead` hard-requires ALL of estLowUsd/estimateLow/estHighUsd/estimateHigh null — the Gap is a no-estimate lane by fitted-population law, not preference, and the annex footer prints it: `curve fitted from goldin bid histories · estimate-house books abstain (out of distribution)`.
**F5. Spine = growth-projected close, never the raw bid.** One lot, one statistic: `depth = 1 − bidProj.allIn / floor`. Raw vsBid gaps far from close are "merely early" — the curve exists to absorb the late surge (8+ days out closes at 5.7× the nightly bid). `value.vsBid.pct` renders as row context only (`bid now −52% vs comps`, muted), never ranks, never gates.
**F6. Floor rule (close-board's stricter variant promoted to the lane rule, close-board.ts:121-122):** `floor = value.low` only when `value.low > 0 AND value.confidence !== 'low'`; else `0.85 × cardComps.med` only when `cardComps.n ≥ 3`; else abstain. `gapRead` derives the floor itself from these fields (never trusts `bidProj.floor` blindly) so floorSrc provenance is always known: `'value.low' | 'cardComps'`.
**F7. Two shelves, one lane, both inside the curve's fitted region (edges [1,2,4,8]):**
- **AT THE WIRE** (the call): `daysOut ≤ 3.5`, `depth ∈ [0.25, 0.90]`, `!hasConditionFlag(title)`, floor per F6. These are today's deepValue gates verbatim — each documented against a real failure (thin-early defense; the 96%-under "Missing Back" SkyBox Ruby floor-error gate at 0.90).
- **FORMING** (labeled early, ranked strictly below wire): `daysOut ∈ (3.5, 8]`, `depth ∈ [0.40, 0.90]`, same condition/floor gates. Bar justification: measured vsBid median is −52% (n=370) and 192 lots sit ≤ −50%, so 0.40 still admits roughly half the measured pool while demanding 15pts more margin than the wire bar against the unmodeled dispersion of a median-only growth bucket. Window justification: 8 days is the closeCurve's LAST FITTED EDGE; beyond it the 8+ catch-all (one median over 8–30d) is near-noise — the lane abstains out loud past 8 days. (B was convicted for seating and logging unbounded far-dated rows; this line is the fix.)
**F8. Both shelves face the tape (resolves the honesty judge's ding on A).** Forming rows are no longer displayed-but-unlogged: every shelf entry logs a `k:'gap'` call with a shelf marker (F22). First-call-wins means a lot first seen forming grades on its forming-day projection — stated in the annex tooltip: `first projection shown is the projection graded`. This is stricter, not looser: earlier claims are harder claims. B's conviction (logging from the unfitted >8d region) does not apply — both shelves live inside the fitted edges.
**F9. The honest ×60 decomposition (A's D7, best-decision winner on the build lens): calls stay strict; reads become visible.** The lane does NOT resurrect all 486 union-qualified lots as calls — much of that gap is the curve correctly absorbing earliness. The fix is visibility: (a) forming shelf surfaces the deep-and-early set; (b) the cockpit dial counts the whole measurable lane; (c) v1.1 per-lot chips put the read on every appraised no-estimate lot (2,471) in neutral ink.
**F10. TCG abstains entirely, and says so.** 586 live lots, 465 with bidProj, ZERO value reads of any kind (no value/cardComps/soldComp keys — audit-confirmed). No floor, no gap. Annex abstention line: `tcg: projection only — no comp basis yet (465 floorless)`. Coverage build is v2, not a threshold hack.
**F11. Within-lane ranking: wire shelf strictly above forming; depth desc within shelf.** Permitted under law 3's exact condition (no calibrated rate exists yet), on the gated, capped, post-projection statistic. v2 swap decided now (graft: B's D13): when `gap.floorHit` publishes at 20 graded, ranking becomes `gapScore = odds×1000 + min(depthPct, 90)` — odds from floorHit by depth-bucket via the setCalibration pattern; a SEPARATE score that never touches dealScore lists.

### Lane 3 — THE SLEEPERS (fair price, dead room, closing)

**F12. Measurability gate first, printed.** Traction is measurable ONLY where a live book is exposed: RR Auction (the only estimate house with an open book — 696 est lots with currentBid, 134 at bidCount==0, per traction-signals §2) and the no-estimate bid houses. Bonhams/watches/art/design expose ZERO bid data — the annex prints `traction unmeasurable at bonhams/watches/art — no live book`. No proxy signals invented, ever.
**F13. Anchor gate — fairness must be VERIFIED, not merely unflagged (A's D11, best single decision across both specs — it is the exact gate whose absence convicted B twice).** Two admission tiers, both computed client-side from served fields:
- **fair-est** (`anchor:'fair-est'`): estimate present AND `value.compValueUsd / estMid ∈ [0.75, 1.3]`, estMid using the existing low||high single-point mirror. This is the engine's own at-market band (flag ≥ 1.3, above ≤ 0.75) reused as-is — the raw-ratio band already absorbs the premium-basis mismatch by construction (the 1.3-not-1.2 rationale, estimate-lane §1). The ratio is computed from compValueUsd + estimate, NEVER inferred from `signal == null` — null also covers engine abstentions and ×5-sanity kills, which must not read as "verified fair".
- **appraised** (`anchor:'appraised'`, no-estimate): `value.compValueUsd` present with `confidence ∈ {high, medium}` — mirroring deepValue's low-confidence exclusion.
Engine-abstained lots (no compValueUsd) never enter. An unverifiable estimate is not a correct estimate.
**F14. Dead-room gate: `bidCount === 0`, strict.** Median bidCount on bid-carrying est lots is 4 (p25 2) — zero is the unambiguous dead room. A "quiet" tier (≤2 bids + zero velocity) is deferred to v2 behind the quiet grading gate.
**F15. Entry gate: `currentBid ≤ compValueUsd` when `currentBid > 0`** (RR min-bid books). A dead room whose opening ask already exceeds the appraisal is correctly dead.
**F16. Window: closes ≤ 7 days.** Attention claims only mean something near hammer — a silent lot 22 days out is merely early. The lane is BURSTY by construction (RR: 0 → ~134 → 0 around each sale; RR's current est lots close in exactly 22d, i.e. ~Sep 16). Today's seatable rows: ~4 (no-est bc==0 + value + ≤7d, audit-exact) plus 0–2 fair-est — the empty-state law (F32) is load-bearing from night one.
**F17.** `hasConditionFlag` exclusion inherited. Within-lane ranking: time-to-close asc; ties by confidence desc, then compValueUsd desc. Never by any gap — no calibrated rate, and the mechanism IS the clock. All sleeper figures neutral ink.
**F18. Basis discipline (graft: B's D19 pattern).** The ledger anchor `p = value.compValueUsd` is already all-in (weighted median of realized all-in prices), so `r/p` is like-for-like with no conversion — and the tile copy SAYS so: `graded vs appraisal, both all-in · house estimates on rows are hammer-basis`. Fair-est rows label both figures: `est $2–3k (hammer) · appraised $2.4k (all-in)`.

---

## 2 · CLIENT-SIDE COMPUTATION PLAN (file-level)

**F19. Pre-work (decided, not open): move `scripts/lib/condition.ts` → `app/lib/condition.ts`** and update the three importers (`scripts/build-upcoming.ts`, `scripts/build-market.ts`, `scripts/close-board.ts`) to `../app/lib/condition`. Verified tonight: the module is string-only with zero imports, and scripts already import from app/lib (validate, similarity precedents). One file move, three one-line import edits.

**F20. New module `app/lib/lanes.ts` — the single source of truth for both lanes, imported by BOTH the /value page and build-upcoming (one-lot-one-number by construction):**
```ts
export type GapRead = { shelf:'wire'|'forming'; depth:number; allIn:number;
  floor:number; floorSrc:'value.low'|'cardComps'; daysOut:number };
export function gapRead(lot: Lot, now: number): GapRead | null;

export type SleeperRead = { anchor:'fair-est'|'appraised'; cvu:number;
  estMid:number|null; entry:number|null; closes:string };
export function sleeperRead(lot: Lot, now: number): SleeperRead | null;

export function laneCounts(lots: Lot[], now: number):
  { gapWire:number; gapForming:number; sleepers:number };
```
`gapRead` gate order: no-estimate check (F4) → `bidProj?.allIn > 0` → floor per F6 (derived from value.low/confidence/cardComps, with provenance) → daysOut from saleDateTime||saleDate → condition flag → depth bands per F7 → shelf. `sleeperRead` gate order: measurability (bidCount is a number) → anchor per F13 (estMid via the estUsdBand mirror logic — reuse/export from comps.ts:450-457) → bidCount===0 → entry per F15 → ≤7d → condition flag.
**F21. v1 consumes ONLY today's served fields — zero payload changes:** `value.{compValueUsd,low,high,confidence,basis,vsBid,poolSellThroughPct}`, `bidProj.{g,allIn,floor,below}`, `cardComps.{med,n}`, `currentBid`, `bidCount`, `bidVelocity`, `saleDateTime`, estimate mirrors, title. Because useRayData's close-board overlay rewrites currentBid/bidCount/bidProj (newer-generatedAt only), the client-computed lanes inherit ≤4h freshness at the wire for free. The /value page derives both lanes per activeKey from the live-lot list; the served `deepValue` array is no longer read by any surface from v1 (F36 retires it at the source in v1.1).

---

## 3 · CALLS-LEDGER CHANGES

**F22. Two new kinds + one additive marker field.** `scripts/lib/calls-ledger.ts:17-27`: widen `Call.k` to `'card' | 'vsbid' | 'gap' | 'quiet'`; add optional `s?: string` (shelf/anchor marker — `'w'|'f'` on gap, `'e'|'v'` on quiet for fair-est/appraised). NDJSON carries both with zero migration; dedupe key stays `${id}|${k}`, first call wins, coexisting with card/vsbid on the same lot.
**F23. Append seam** — build-upcoming.ts:235-254 (freshCalls) → appendCalls at :269, same night the lanes ship:
- `{k:'gap', s: shelf==='wire'?'w':'f', p: bidProj.allIn, f: floor, m}` — appended for EVERY shelf entry (F8). Distinct population from 'vsbid' (which logs every floored projection regardless of below); the two records measure different claims and never blend.
- `{k:'quiet', s: anchor==='fair-est'?'e':'v', p: value.compValueUsd, f: currentBid>0?currentBid:undefined, m}` — appended when the lot enters the Sleepers board.
Both computed by calling `gapRead`/`sleeperRead` from app/lib/lanes.ts inside the build (F20 — no drift possible).
**F24. Grading statistics, pre-defined before the first row lands (the card.medRatio/vsbid.belowHit precedent):**
- `gap.medRatio` = median(r/p) — projection honesty on called lots. Publishes at ≥20 graded.
- `gap.floorHit` = % of graded floor-carrying rows with r ≥ f — did the market confirm the claimed floor. ≥20 floor-carrying graded. Per-shelf splits (`gap.wire.*`/`gap.forming.*`) publish only at ≥20 graded PER SHELF; below that, combined only.
- `quiet.medRatio` = median(r/p) — was "fair" fair. ≥20 graded.
- `quiet.underPct` = % graded with r ≤ p — do sleepers clear at/below appraisal. ≥20 graded.
**F25. Seams:** calls-ledger.ts:98-121 — `summarize('gap')`/`summarize('quiet')` + CallsRecord widening (shelf splits computed by filtering on `s` before summarize). build-market.ts:1063-1074 — UNCHANGED (gradeCalls fill loop and emitReceipts are kind-agnostic, verified in ledger-receipts §1c-d).
**F26. /receipts page (all three silent-break spots fixed the SAME night):** widen `ReceiptRow.k` (:37) + local CallsRecord (:41-45); four forward-tape tiles, each printing `{graded}/{n} · publishes at 20 graded` under-gate (quiet tile carries the F18 basis sentence); extend the pending sum at :88 to all four kinds; REPLACE the binary ternary at :176-177 with the kind map `{card:'comps', vsbid:'proj', gap:'gap', quiet:'quiet'}` + correct tooltips — without this every new row mislabels as "Bid projection".
**F27. Close-board stays ledger-silent.** The 4h overlay refreshes boards but never appends (append-only, first-call-wins, nightly cadence = the auditable population). Gap annex cap states the seam: `board refreshes ~4h · receipts log the nightly call`. No retro-grading, no synthetic backfill; any retro study from bidHistory/close-board git history publishes as a separately-labeled replayed population or not at all.

---

## 4 · /VALUE PAGE COMPOSITION (Desk room grammar binding; copy verbatim)

**F28. Room order:** Room 1 cockpit (Masthead + MarketPulse + DialStrip w/ lane counts) → CallPlate (still the ONE lit element, Flags-only) → Room 2 THE FLAGS board (unchanged, kicker `THE FLAGS · comps vs estimate`) → Room 2c THE GAP annex → Room 2d THE SLEEPERS annex → Room 3 paper record band → Rooms 4–5 unchanged. New lanes are dark-ground annexes; live/uncertified material never touches paper.
**F29. THE GAP annex replaces ProjectionAnnex** (same slot, value/page.tsx:1407-1410; same row grammar: 44px thumb, hairline rows, mono right-aligned cells). Verbatim copy:
- Kicker: `The Gap · projected close vs floor` — Cap: `projected closes, not comps · board refreshes ~4h · receipts log the nightly call · record accruing`
- Row cells: `−41% under floor` (mono, NEUTRAL var(--color-fg) by law) · `proj $1,240 vs floor $2,010` (muted, floorSrc on hover) · `bid now −52% vs comps` (muted context) · closes + CloseClock inside 24h. Six wire rows by depth desc.
- Collapsed forming line: `+18 forming · 3.5–8d out · early — projection widens with days out` (expands to six forming rows, same grammar, `early` tag).
- Footer meter (mono, faint): `forward tape: {gap.n} logged · {gap.graded} graded · publishes at 20 graded` — fallback `forward tape: — · publishes at 20 graded`. Second footer line: `curve fitted from goldin bid histories · estimate-house books abstain (out of distribution) · tcg: projection only — no comp basis yet`.
**F30. THE SLEEPERS annex (new Room 2d).** Verbatim copy:
- Kicker: `The Sleepers · fair-priced, no bids, closing` — Cap: `verified-fair lots with a dead room · record accruing`
- Rows (time-to-close asc): thumb + maker/title + `est $2–3k (hammer) · appraised $2.4k (all-in) · 0 bids · opens $500` (appraised-tier rows drop the est cell) + closes/CloseClock. Every figure neutral ink; both bases named.
- Footer meter: `forward tape: {quiet.n} logged · {quiet.graded} graded · publishes at 20 graded · graded vs appraisal, both all-in`. Abstention line: `traction unmeasurable at bonhams/watches/art — no live book`.
**F31. DialStrip lane counters (counts only — the sole cross-lane arbitration):** `FLAGS {n}` (existing) · `GAP {wire} at the wire · +{forming} forming` sub `proj vs floor · ≤8d · goldin books only` · `SLEEPERS {n}` sub `verified fair · 0 bids · ≤7d`. Lane-2/3 counts in neutral ink. No interleave, no blended score, ever — the three claims are incommensurable (calibrated odds vs projection-vs-floor vs attention-vs-fairness).
**F32. Empty-state law (deliberate deviation from ProjectionAnnex's vanish-on-empty):** when a lane's board is empty but its queued pool is nonzero, render the abstention sentence + calendar instead of vanishing — Sleepers: `0 in window · rr final week opens ~sep 16 · 134 dead-room lots queued`. Vanish only on truly zero measurable inventory (design: 0 live lots → both annexes absent).
**F33. Color/magnitude law:** Gap depth and Sleeper figures never route through signalMagnitude and never wear mint/coral until their tape grades — mint/coral are for measured signed outcomes only. Depth is structurally capped by the 0.90 gate. No means anywhere; medians only.
**F34. Scope v1 = /value + /receipts only.** No LotCard/LotPage/Terminal changes in v1 — this sidesteps the entire 13-file binary-ternary minefield (precedent-laws §4) and keeps the night-one QA matrix to two pages.

---

## 5 · BUILD-SIDE v1.1 STAMP HARDENING (this week, after v1 verifies)

**F35.** Additive optional stamps in build-upcoming (the vsBid/basis/poolSellThroughPct precedent), computed from the SAME lanes.ts readers: `lot.gap?: {shelf, depth, allIn, floor, floorSrc}` and `lot.quiet?: {anchor, cvu, entry}`. The /value page keeps computing client-side so the intraday overlay stays live; stamps exist for SSR parity, inspectability, and non-hydrated surfaces.
**F36.** Retire the served `deepValue` array (graft: B's D27 — one lane never has two sources of truth): fold build-upcoming.ts:428-464 into the `lot.gap` stamp; remove the array from the payload once confirmed consumer-free (ProjectionAnnex retired in v1); update close-board.ts to emit the gap shelf shape in its overlay rows (it already re-derives proj/floor/below with the strict floor rule).
**F37.** Per-lot chips as NEW components reading the new optional fields — never through signal render paths: `GAP −38% proj` / `SLEEPER · 0 bids · fair`, neutral ink. Plus the LotPage one-line read sentence with named basis (graft: B's D26): `Projected close $1,240 all-in vs $2,010 comp floor — curve-projected, record accruing.`
**F38.** Sleeper anchor traceability: wire fair-est/appraised anchors into comp-evidence.json lookups like board rows — every displayed number's pool nameable.

---

## 6 · ACCEPTANCE CHECKLIST (run before deploy, in order)

**Honesty spot-checks (each is a scripted grep/inspect against the built payload + rendered DOM):**
1. No Sleeper row where `value.compValueUsd` is absent (signal-null ≠ verified-fair — the F13 law). Specifically verify a ×5-sanity-killed lot (value.signal 'below' but lot.signal null) is NOT seated.
2. No Gap row on any estimate-carrying lot (F4); no Gap/Sleeper row with `hasConditionFlag(title)` true; no depth outside [0.25, 0.90]; no forming row outside (3.5, 8] days.
3. TCG renders the abstention sentence and zero rows; watches/art render the no-book abstention; design (0 live lots) renders neither annex.
4. Zero occurrences of var(--color-up)/var(--color-down-text) in GapAnnex/SleepersAnnex/chips CSS; CallPlate remains the only lit element; no new values in either signal union (`git diff` on types.ts:161 + value.ts:39 shows none).
5. `git diff --stat` shows ZERO changes to the 13 signal-consumer files (Terminal, LotCard, LotPage, ComparableModal, AlertsInbox, profile, account.tsx, TerminalHome, TonightsWall, makers, lot/flagged, about/live, alerts matcher).
6. Ledger: run build twice — no duplicate `${id}|${k}` rows (first-call-wins holds); every gap row carries s:'w'|'f', every quiet row s:'e'|'v'; /receipts tape labels the new kinds 'gap'/'quiet' (NOT "proj"); pending sum includes all four kinds; both new tiles print the `{graded}/{n} · publishes at 20 graded` gate copy.
7. dealScore output on /value, /profile, TerminalHome byte-identical to pre-change (Flags ranking untouched).
8. Sizing reconciliation printed in the PR description against the audit sheet: 486 union / 467 no-est / 292 below=true / 370 vsBid (med −52%, 192 ≤−50%) / 8 previously served / 134 RR dead-room queued / ~4 sleepers seatable tonight — and the annex meters' live counts must be explainable from these.
**Screenshot criteria (the owner's standing gate — full-scale pixel-level verification in situ BEFORE deploy, iterate to perfect):**
9. /value per market key: sports (Gap populated, wire + forming), culture (small Gap), science (1–3 rows), tcg (abstention state), watches/art (abstention state), design (annexes absent) — verify Terminal shell, hairline rows, mono tabular-nums data cells, 10px floor, no banned tells (no ordinals/serif/tan/bento/eyebrows/italic-heads/blobs/3D), neutral ink on every lane-2/3 figure, CloseClock inside 24h.
10. Sleepers empty-state: the queued-pool + calendar sentence renders (do NOT ship a vanishing lane).
11. /receipts: four tiles, gate copy, correctly-labeled tape rows.
12. Mobile width pass on /value (annex rows wrap or scroll inside their own container; no horizontal page scroll).

**Rollout:** v1 TONIGHT = F19 condition lift + lanes.ts + two annexes + dial counts + freshCalls appends + summarize/CallsRecord + /receipts fixes, all verified per above, then deploy. v1.1 THIS WEEK = F35–F38. v2 GATED = gapScore recalibration at 20 graded (F11); quiet tier widening (F14) after quiet.medRatio publishes; TCG comp basis + per-house curves + watches/art bid exposure as coverage builds; graduation rule: a lane that publishes its gated stats earns paper-room ink ONLY as its own labeled population on /receipts — never summed with the replayed +41%, never wearing certified vocabulary ('graded' for forward tape, 'replayed' for backtest).

---

## 7 · CUT LIST (permanently rejected — no open questions)

1. **B's 'in-line' verdict** — an ungated, ungradeable fairness certification minted from mere compValueUsd existence (~2,471 lots). Both judges named it the most dangerous decision in either spec. Nothing anywhere may render "fair"/"in line" except a Sleepers row that passed the F13 anchor gate.
2. **B's unified verdict enum** ('flagged'|'behind'|'dead-room'|'in-line') — the structure itself is the blending vector between certified and uncertified claims. No shared vocabulary, no shared enum, no shared score.
3. **B's unbounded developing tier** — no Gap row or call beyond the curve's 8-day fitted edge, ever.
4. **B's dead-room admission via null signal** — fairness is verified from compValueUsd/estMid or the lot does not enter.
5. **B's night-one EvidenceChips on LotCard/LotPage** — app-wide chip QA deferred to v1.1 as new components (F37).
6. Cross-lane interleave or composite score, at any version; dealScore/CallPlate admission for lanes 2–3.
7. New values in either signal-label union; any change to account.tsx signing, profile flip detection, alerts matching.
8. TCG gap/sleeper calls before a comp basis exists; traction lanes for houses without book exposure (no proxies).
9. Retro-graded or synthetic ledger rows; replay claims for lanes 2–3 (input state unreconstructable leak-free).
10. Means anywhere; mint/coral or certified language on any lane-2/3 figure before its 20-graded gate; reference bands entering any lane (descriptive, never a call).
11. Profile/alerts/saves integration in v1/v1.1; a future Gap/Sleeper alert is a new additive `_signal` marker string, v2 at earliest.
12. Any change to the Flags' thresholds, calibration, backtest, or record — frozen through the entire program.

**Key files:** app/lib/lanes.ts (new), app/lib/condition.ts (moved from scripts/lib/condition.ts), app/lib/comps.ts (export estUsdBand if not already), scripts/build-upcoming.ts (:235-269 appends; :428-464 folded in v1.1), scripts/lib/calls-ledger.ts (:17-27, :77-81, :98-121), scripts/build-market.ts (no change v1), scripts/close-board.ts (import path v1; gap shape v1.1), app/value/page.tsx (kicker; Rooms 2c/2d; DialStrip; ProjectionAnnex at :191-245 retired), app/receipts/page.tsx (:37, :41-45, :88, :120-147, :176-177), app/types.ts (v1.1 optional gap/quiet stamps).

**Why this shape wins (for the owner, one sentence per lane):** THE FLAGS keep their certified +41% record untouched; THE GAP turns the computed-but-unserved 486-lot below-comps pool into a visible two-shelf lane whose every row — wire and forming alike — logs to the tape the night it ships, bounded by the curve's own fitted horizon; THE SLEEPERS create the missing "right price, no attention" lane gated on verified fairness, measurable books, and the 7-day clock, printing its burst calendar instead of vanishing — and no lane can ever contaminate the certified record, the saved-signal ledger, or each other.

---

## 8 · SEP 2 2026 AMENDMENTS (engine audit)

- **F6 → one source.** The floor rule is now the exported `valueFloor(lot)` in `app/lib/lanes.ts`; `gapRead`, `scripts/build-upcoming.ts` (the `bidProj.floor` stamp, previously UNGATED — any value.low, any card median) and `scripts/close-board.ts` all call it. A served `bidProj.floor` and the lane's floor can no longer disagree.
- **F13 basis.** The fair-est anchor compares the all-in appraisal to the estimate midpoint grossed to all-in (`estMid × lotAllInFactor`) before applying [0.75, 1.3]; the raw ratio silently carried ~20 points of buyer's premium.
- **F10 (TCG abstains) is partially lifted.** Bid-only Pokémon lots now carry a card-comp value from the `tcg-exact` tier (exact pokemonKey pool ≥ 2) or a proxy-ladder `tcg-grade-adj` value (capped 'low'). The Gap lane's floor rule admits `value.low` only at non-low confidence, so only `tcg-exact` rows can seat; the annex abstention line should now read "tcg: exact-card comps only — proxy grade ladder until a Pokémon ladder is fitted".
- **F1 / cut-list #12 (backtest + calibration frozen) is superseded** for the Sep 2 audit items: the replay now applies point-in-time calibration (P1-1), publishes out-of-sample band coverage per market (P1-2), per-market bands and MdAPE, and carries an engine version. The Flags' thresholds (1.3 / 0.75 / odds gate) are unchanged; the RECORD's meaning changed (it measures the calibrated engine), which is why `rowsOnVersionPct` is published.
- **F22/F24 card tape.** Card calls carry a tier marker in `s` (`x` exact, `g` grade-adj, `p` player, `t` tcg, `m` raw median) and `callsRecord.card.byTier` publishes each tier at 20 graded — the P0-2 per-tier receipt.
- **Labels.** `SIGNAL_LABEL` is exported from `app/lib/value.ts` and re-exported here; the four UI files that hardcode the strings are listed in ENGINE_SPEC_V2 §5.9.

## 9 · OCT 3 2026 ENGINE PASS — house-normalized Flags, expected hammer + max bid, card gate, shadow/promote

Product decision (Collin, Oct 3): lead with **expected hammer + max bid** (forecast the hammer better than the house) and gate card calls harder. Engine version **`2026.10.03-house-gate`** (`ENGINE_FLAGS_CURRENT` in app/lib/value.ts; the pre-pass engine replays as `ENGINE_FLAGS_LEGACY`).

**9.1 The house-bias index** (app/lib/indices.ts `makeHouseBiasIndexer`). Point-in-time recency-weighted median of log(realized all-in / estimate mid) over sales KNOWN strictly before the valuation day (6y window, 2y half-life, `compExclude`/undated excluded), per estimate kind (band `b` / single-point `p`), in a shrinkage ladder global → market, house → market × house (K = 20). `houseFactorOf` returns the habit relative to the global band habit (≈1 for a typical band house). build-market builds it for today from the engine population; the backtest replay and validate-engine build it per quarter. Measured: RR's single-point low clears 1.38× (global band 1.24×) → factor 1.11 — RR's policy is milder than the audit assumed; its 85%-odds top-50 monopoly came from the odds (9.2), not the ratio.

**9.2 House-normalized Flags.** `value.flagRatio` = comp median / (estimate mid × houseFactor); the signal (label, strength, `beatRatePct`) is called on it. `compRatio` stays the raw ratio (the ×5 data-fault sanity still reads it). "Beat" in the odds and in flag precision means realized above the **house-adjusted top** (`adjustedTop`: band high × factor; a single point × factor × 1.2, the median high/mid of band estimates) — the `:pt` odds rows used to mean "beat the low", which is near-certain, so every RR flag read 85%. Admission under the adjusted yardstick: odds ≥ 55 (`FLAG_GATE.minOdds`; sports' 1.3–2× bucket calibrates 51% and realized 49% out of sample with a 6.6pt edge — a coin flip is not a flag) and ≥ 10pt over the market's own at-market bucket. The record stores `fr` (flag ratio), `ba` (beat adjusted top) and `hl` (house habit) on every observation; legacy rows are rehydrated from the index at the row's quarter (market cell — legacy rows carry no house); the next full replay replaces the approximation.

**9.3 The house anchor** (`blendPredict`, `houseAnchor`): log(value/mid) = (1 − w)·h + w·log(comps/mid), h = the house-bias cell, w = the calibrated per-tier comp weight (refit on the anchor model where rows carry `hl`). Replaces the fitted market intercept / bare-premium anchor.

**9.4 THE BUYER'S FIELDS — what the UI reads** (every served value, hedonic and card):

| field | meaning |
|---|---|
| `value.expectedHammerUsd` | the prediction, **hammer basis** (same basis as the house estimate the page prints) = compValueUsd ÷ premiumFactor |
| `value.bandLowUsd` / `value.bandHighUsd` | the calibrated outcome band, hammer basis (13/87 residual quantiles; ~70% coverage measured) |
| `value.maxBidUsd` | the **30% quantile** of the calibrated outcome distribution, hammer basis — "only ~30% of comparable outcomes cleared at or below this": bid to here and you buy in the cheap third. Clamped into [bandLowUsd, expectedHammerUsd]. Uncalibrated: the log-normal 30% point between the band low and the median. |
| `value.premiumFactor` | all-in = hammer × this (the lot's stamped premium, else the house schedule) |
| `value.engineVersion` | the engine version that produced the value |
| `value.flagRatio`, `value.houseFactor` | the flag statistic and the house multiplier it divided by — the Flags' printed % must read `flagRatio` (fallback `compRatio`) |
| `value.gate` | (card values) the cell's trailing-year out-of-sample record: n, within30Pct, bias |

`compValueUsd`, `low`, `high` keep their all-in meaning for compatibility. backtest.json `calibration.maxBidCalibration[market]` publishes, per market, the share of actual hammers inside the band, at/below the max bid (nominal 30) and above it.

**9.5 The publish gates** (app/lib/cards-gate.ts). A card/TCG value publishes only when its market × tier × confidence cell, over the trailing 365 days of point-in-time-priced sold cards (each corrected by the tier bias as it stood the week the card sold), clears **n ≥ 50, ±30% hit ≥ 45%, |bias| ≤ 1.15×**; else the lot abstains `card:uncalibrated` / `card:gate-accuracy` / `card:gate-bias`. The no-estimate hedonic value takes the same bar per market × confidence from the record's trailing-year no-estimate rows (`calibration.noEstGate`; `noest:*` codes). Both gates sit at PUBLISH in build-market — the record keeps scoring every value, so a cell can earn its way back. TCG is now priced point-in-time and wears the tier bias/band like sports cards.

**9.6 Shadow / promote.** `ENGINE_FLAGS_CANDIDATE` (equal to CURRENT when nothing is pending). `RAY_ENGINE_CANDIDATE=1`: build-market values every lot under the candidate too and appends **shadow** rows (`sh: 1`, the candidate's version) to the value tape — never served; validate-engine prices each holdout lot's one comp pool under both engines with the point-in-time calibration each would have loaded and emits `candidate` (backtest-core `compareEngines`: value error on lots both valued, coverage, band, max bid, flag precision + edge on the house-adjusted yardstick) with `promote` = candidate median abs error ≤ current, ±30% ≥ current − 0.5pt, adjusted edge ≥ current − 2pt. Promotion = copy the candidate's flags into CURRENT and bump the version.

**9.7 G5 (live forward check) never graded** because the value tape lived only inside the corpus tar and the nightly assemble rebuilds data/corpus from segments — reborn empty every night (the Aug 14–24 calls-ledger bug again); validate-engine, running the same night, only saw rows served that day. data-store.sh now persists `latest/value-tape.json.gz` (push + pull-backtest). G5 grades the current version; every version on the tape (served and shadow) is graded into the validation JSON `live.byVersion`.

**9.8 Measured** (oneoff/qa/engine-ab.ts: test year Oct 1 2025 → Sep 2026, point-in-time calibration + indices per quarter, identical comp pools, 4,944 estimate + 1,017 no-estimate lots; oneoff/qa/live-ab.ts: the Sep 14 live book re-served, graded on lots sold by Oct 2):

| | legacy | Oct 3 |
|---|---|---|
| holdout estimate lots: median abs error (house mid: 31.0%) | 30.7% | **28.8%** |
| holdout estimate lots: ±30% (house: 49.4%) | 49.2% | **51.2%** |
| holdout bias (realized/value) | 1.111 | 1.056 |
| holdout band coverage | 68.5% | 69.2% |
| holdout hammers ≤ max bid (nominal 30%) | — | 22.6% |
| holdout flags / precision vs adjusted top / adjusted edge | 2,299 / 66.9% / 27.2pt | 2,137 / **68.1%** / **28.4pt** |
| live estimate lots (n 680): median abs error (house 32.3%) | 32.1% | **31.2%** |
| live hammers in band / ≤ max bid | — | 70.1% / 29.1% |
| live card values kept / ±30% hit / median abs error | 477 / 45.9% / 35.7% | 267 / **60.7%** / **23.0%** |
| live no-estimate values (±30% hit 26%) | 197 | 0 (abstain) |
| today's book: top-50 Flags from RR | 50 / 50 | 43 / 50 |

## 10 · OCT 5 2026 ENGINE PASS — headroom (byte-identical) + measured refinements

**10.1 Headroom (outputs byte-identical).** `scripts/ci/equivalence.ts` on the real corpus (Oct 3 input, both builds under `scripts/ci/freeze-clock.cjs`, `--no-mask`): 3,775 files, 0 differences; the Starling value book identical to the byte.
- **Comp candidate index** (`value.buildCompCandidateIndex` / `compCandidates`): the backtest's exact pre-filter (§ backtest-core header) as a shared, order-preserving index. build-market hands `resolveComps` only the roster members that can pass its admission gate — the maker roster, and the memoized sports maker × player / maker × sport rosters. Valuing the upcoming book: 219s → 10s at 1×, 3,476s → 40s at the 3× synthetic corpus.
- **No unbounded argument spreads** in indices.ts / hedonic-index.ts (`stats.maxOf`/`minOf`, Math.max/min semantics).
- **The value book in the single load**: `assemble.ts --single-load` builds it over the in-memory corpus (last corpus consumer) and leaves a marker keyed to the corpus files; the nightly's "Emit value book" step only pushes it (no second load; standalone/manual runs rebuild as before).

| | 1× before | 1× after | 3× before (Oct 3 run) | 3× after |
|---|---|---|---|---|
| assemble --single-load wall | 501s | 313s | 4,760s | 1,145s |
| upcoming valuation | 219s | 10s | 3,476s | 40s |
| peak RSS | 5.44GB | 5.27GB | 9.88GB | 9.85GB |
| peak live heap | 2,545MB | 2,756MB | 7,860MB | 7,277MB |
| value book | +25s, 3.3GB RSS, 10GB heap step | 10s in-process | — | 30s in-process |

Remaining superlinear phases at 3×: build-upcoming (runs twice: 152s + 152s), the engine gate (193s), persist (114s), page data (87s).

**10.2 Refinements, each measured out of sample** — holdout = oneoff/qa/engine-ab.ts (test year from Oct 1 2025, point-in-time calibration per quarter from the Oct 4 full-replay state, Oct 5 corpus, 4,917 estimate + 1,020 no-estimate lots); live = oneoff/qa/live-ab.ts (the Sep 14 book re-served, graded on lots sold by Oct 5; 681 estimate lots).

| refinement | measure | before | after | kept |
|---|---|---|---|---|
| Max bid: fit on point-in-time hammer residuals (xh) | holdout / live hammers ≤ max bid (nominal 30) | 28.6% / 33.6% | 29.2% / 34.5% | no (live moves away) |
| Card grade-adj: rungs within ½ grade only | PIT record ±30%, trailing 365d (medium / low) | 34.6% / 28.8% | 48.5% / 46.5% | pricer yes |
| | same, year to Oct 2025 | 31.8% / 26.4% | 55.5% / 41.3% | |
| | live, raw tier value (medium / low) | 19.3% / 33.0% | 57.1% / 44.8% | |
| | live, bias-corrected as published (medium / low) | (gated) | 35.7% / 39.7% | publish held (`CARD_TIER_HOLD`) |
| TCG grade-adj: own Pokémon ladder / ±1 grade / proximity weights | PIT record ±30% | 21.3% | 21.5% / 22.7% / 21.4% | no (keeps abstaining) |
| No-estimate bias correction (market × tier, house × market; 4y/2y/1y PIT fits) | holdout medErr / ±30% / bias | 67.1% / 29.2% / 1.069 | 67.1–67.9% / 28.7–29.0% / 1.00–1.04 | no |
| | live medErr / ±30% / bias | 99.5% / 26.4% / 1.170 | 101.0% / 26.9% / 1.117 | |
| Era-dated premiums in the hammer basis (`premiums.lotHammerFromAllIn`) | Christie's / Sotheby's USD-sale inferred hammers that are round bid increments | 7.2% / 20.3% | 97.6% / 99.2% | yes |
| | holdout estimate lots, hammer basis: medErr / ±30% / ≤ max bid | 29.0% / 51.0% / 29.8% | 29.0% / 51.1% / 29.6% | |
| | live, hammer basis: estimate lots medErr; Christie's; Sotheby's | 31.1%; 26.3%; 25.4% | 30.9%; 25.5%; 24.9% | |
| | live REA (all values) hammer medErr / ±30% / ≤ max bid | 40.3% / 37.9% / 57.9% | 34.8% / 46.2% / 49.7% | |

All-in figures (value error, ±30%, band coverage 72.0% holdout / 72.8% live, the Flags' adjusted edge 24.6pt / 22.3pt) are unchanged by every kept refinement. **The 22.6% "holdout ≤ max bid" of §9.8 was measured against the stale Aug 9 legacy state;** against the full-replay state the nightly now loads it is 28.6% (live 33.6%) — no recalibration was kept. True hammer for scoring = the published hammer, else realized through the dated inverse (validated by the round-increment test above).

## 11 · OCT 6 2026 ENGINE PASS — the Flags on the hammer basis (`2026.10.06-hammer-basis`)

**11.1 One basis.** House estimates are hammer-basis; comp medians are all-in. The comp/flag ratio compared the two, so "at market" read ≈1.25: the 1.3 'below' threshold sat just past at-market (weak flags) and 0.75 'above' sat 40% under it. With `EngineFlags.hammerBasis` the comps' median is read through the LOT's dated premium inverse (`premiums.lotHammerFromAllIn`) before dividing by the estimate mid, so at-market reads 1 and 1.3 / 0.75 are symmetric. The odds (`beatRatePct`) count a beat only when the HAMMER clears the (house-adjusted) top: backtest-core `calibrationOf` buckets on `fr / pc` and reads `hba` (`hb` raw); the certified buckets' `beat` is the hammer beat (`st.beatBasis = 'hammer'`); validate-engine G1/G2 count hammer beats. `calObs` keeps `cr`/`fr` all-in and adds `pc` (the comps' premium factor at the lot's schedule), `hb`, `hba`, `sf`, `hbs`; rehydration fills them by id lookup (168,022 / 168,022 rows on the Oct 5 corpus). The printed % everywhere reads `flagRatio` (`comps.engineFlagOf`, ComparableModal). `FLAG_GATE.minOddsHammer` = 45 (swept 55 / 45 / 35: 56 / 1,148 / 1,350 flags).

**11.2 Confidence** demotes at most one notch, on the record's error of the PUBLISHED value (`EngineFlags.confOnPublished`): before, every 2026 art / culture / sports value read 'low'.

**11.3 Measured** (oneoff/qa/engine-ab.ts, test year from Oct 1 2025, 4,917 estimate + 1,020 no-estimate lots; ONE yardstick for both: the hammer over the house-adjusted top):

| | house-gate (Oct 3) | hammer-basis (Oct 6) |
|---|---|---|
| flags | 2,257 | 1,148 |
| flag precision (hammer > adjusted top) | 43.4% (printed odds averaged 66) | 49.7% (odds 50) |
| edge (median hammer / adjusted mid, flagged − unflagged) | 19.0pt | 21.2pt |
| flagged odds vs realized, per quarter (25Q4 / 26Q1 / Q2 / Q3) | 0.5 / 4.2 / 5.8 / 1.7pt (all-in yardstick) | 1.6 / 0.2 / 3.3 / 0.3pt |
| value medErr / ±30% / band coverage | 32.3% / 47.7% / 72.0% | 32.3% / 47.8% / 68.2% |
| tiers (medErr high / medium / low) | 21.7% / 25.2% / 34.6% (n 270 / 682 / 4,985) | 24.1% / 29.1% / 38.0% (n 657 / 2,532 / 2,748) |

Per market the edge rose in art (21.0 → 25.4pt), culture, watches and fell in science (21.0 → 14.2pt) and sports (5.2 → −5.0pt on 39 flags). Live (the Sep 14 book replayed with every Oct 6 change, 948 graded): flagged hammer > high 52.3% → 56.9% vs unflagged 37.0% → 37.8%. Measured and NOT adopted: a 1-year odds half-life (`calHalfLife1y`: 1,047 flags, flagged odds error 1.4 → 3.1pt) and the single-figure estimate kind (`singleFigure`: 1,152 flags, edge and error flat). Counting bought-in lots as misses needs bought-in calObs rows (a full replay) — not done.
