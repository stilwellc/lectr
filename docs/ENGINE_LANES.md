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

## 11 · OCT 6 2026 — THE RECORD'S POPULATION (unsold lots, per-market cells)

**Unsold lots — the decision: RESTRICT, not impute.** Christie's and Sotheby's history before 2026 (and Hake's, and most of RR) was crawled sold-only: a results page lists what sold and a bought-in lot simply vanishes. The record's headline levels (flagged/unflagged/above in backtest.json) therefore measured survivors, and "failed to sell 3.9%" was diluted by ~75k lots that could never fail. Imputing the missing bought-ins at a cohort rate would print lots that were never observed, at a rate borrowed from other houses; restricting the claim to where unsold lots were actually captured prints only what was seen. The headline is now claimed on:

- **Population:** range-estimate lots (et 'b') in a house × calendar quarter whose concluded range-estimate lots include ≥ 3 bought-ins making up ≥ 3% of them (`unsoldCapturedCells`, `UNSOLD_CAPTURE_MIN_N` / `_MIN_SHARE`; real sell-through runs 70–90%, a sold-only crawl reads ~0%). Oct 6 corpus: 292 cells — Bonhams 95 quarters (2003–), Wright 88, Phillips 44 (2013–), LAMA 35, Rago 26, RR 2015 Q3, Christie's 2026 Q2 only, Sotheby's 2026 Q3–Q4 only.
- **Basis:** CONCLUDED lots. A bought-in is a failed outcome: it ranks below every sold lot in the medians (perf −100%) and never beats the high. `medianSoldPct` / `hammerMedianSoldPct` / `beatHighSoldPct` / `hammerBeatSoldPct` carry the same population without the bought-ins.
- **Hammer twins:** every range row now carries `hp` (inferred hammer / estimate mid − 1) and `hb` (hammer > estimate top), so the hammer basis can be re-aggregated over any population; legacy rows got them by corpus lookup.
- **Bought-in rows:** `state.bi` (market, house, day, call, tier) — the rows behind the boughtIn counts. The tier buckets (`flaggedTiers`) now count their bought-ins (they read 0% fail-to-sell by construction). A pre-Oct-6 state is repaired once by `backfillUnsold` (the bought-ins on record re-scored point-in-time; no sold replay) — the nightly incremental does it itself; by hand: `npx tsx scripts/build-backtest.ts --backfill-unsold`.
- **Kept for continuity:** `soldOnly.{flagged,unflagged,above}` = the pre-Oct-6 buckets (every house × period, sold medians). `recordBasis.headline` says which basis the top-level arms are on ('sold-only' when a state has no bought-in rows yet). `flaggedTiers`, `distribution` and `series` remain on the sold-only all-population basis (calObs carries no tier; the series predates the split).

| headline (flagged · unflagged · above) | sold-only, all houses (before) | unsold-captured, concluded (after) |
|---|---|---|
| n sold / bought-in | 31,595 / 1,275 · 45,080 / 1,828 · 19,885 / 1,072 | 9,430 / 1,266 · 8,377 / 1,780 · 3,330 / 1,050 |
| median vs estimate mid, all-in | +41% · +19% · +14% | +28% · +7% · 0% |
| median vs estimate mid, hammer | +12% · −6% · −9% | 0% · −14% · −20% |
| beat the high, all-in | 66% · 49% · 46% | 57% · 39% · 31% |
| beat the high, hammer | 42% · 27% · 26% | 36% · 20% · 15% |
| failed to sell | 3.9% · 3.9% · 5.1% | 11.8% · 17.5% · 24% |

The flagged-vs-unflagged ordering and the ~21-point edge survive; the levels do not. Within the captured cells the SOLD-only flagged median is +39% (hammer +10%) — survivors there look like survivors everywhere; the drop is the bought-ins counted.

**Per-market cells (byMarket, /value "The record" for a selected market)** are now the headline's population: range-estimate rows in captured cells, bought-ins in the median (n ≥ 50 concluded to publish), 'unflagged' = at-market calls only (above-market calls were being counted as unflagged), with `above` its own arm. Single-figure estimates ("$500+", RR) are a different yardstick (a floor, not a range) and are reported separately as `singleFigure` (sold-only — no single-figure bought-in is ever a target); `soldOnly` keeps the all-house sold arms. The old culture/science/sports cells were 90–99% single-figure RR rows (culture flagged n 30,288 of which 544 range); sports range-estimate flags run −10.7% sold-only, the +26.8% shown was the RR single-figure rows (+38%). Culture, science and sports have no captured range-estimate population (cells under n 50 → medPct null → /value falls back to the global line).

## 12 · OCT 6 2026 ENGINE PASS — the Flags on the hammer basis (`2026.10.06-hammer-basis`)

**12.1 One basis.** House estimates are hammer-basis; comp medians are all-in. The comp/flag ratio compared the two, so "at market" read ≈1.25: the 1.3 'below' threshold sat just past at-market (weak flags) and 0.75 'above' sat 40% under it. With `EngineFlags.hammerBasis` the comps' median is read through the LOT's dated premium inverse (`premiums.lotHammerFromAllIn`) before dividing by the estimate mid, so at-market reads 1 and 1.3 / 0.75 are symmetric. The odds (`beatRatePct`) count a beat only when the HAMMER clears the (house-adjusted) top: backtest-core `calibrationOf` buckets on `fr / pc` and reads `hba` (`hb` raw); the certified buckets' `beat` is the hammer beat (`st.beatBasis = 'hammer'`); validate-engine G1/G2 count hammer beats. `calObs` keeps `cr`/`fr` all-in and adds `pc` (the comps' premium factor at the lot's schedule), `hb`, `hba`, `sf`, `hbs`; rehydration fills them by id lookup (168,022 / 168,022 rows on the Oct 5 corpus). The printed % everywhere reads `flagRatio` (`comps.engineFlagOf`, ComparableModal). `FLAG_GATE.minOddsHammer` = 45 (swept 55 / 45 / 35: 56 / 1,148 / 1,350 flags).

**12.2 Confidence** demotes at most one notch, on the record's error of the PUBLISHED value (`EngineFlags.confOnPublished`): before, every 2026 art / culture / sports value read 'low'.

**12.3 Measured** (oneoff/qa/engine-ab.ts, test year from Oct 1 2025, 4,917 estimate + 1,020 no-estimate lots; ONE yardstick for both: the hammer over the house-adjusted top):

| | house-gate (Oct 3) | hammer-basis (Oct 6) |
|---|---|---|
| flags | 2,257 | 1,148 |
| flag precision (hammer > adjusted top) | 43.4% (printed odds averaged 66) | 49.7% (odds 50) |
| edge (median hammer / adjusted mid, flagged − unflagged) | 19.0pt | 21.2pt |
| flagged odds vs realized, per quarter (25Q4 / 26Q1 / Q2 / Q3) | 0.5 / 4.2 / 5.8 / 1.7pt (all-in yardstick) | 1.6 / 0.2 / 3.3 / 0.3pt |
| value medErr / ±30% / band coverage | 32.3% / 47.7% / 72.0% | 32.3% / 47.8% / 68.2% |
| tiers (medErr high / medium / low) | 21.7% / 25.2% / 34.6% (n 270 / 682 / 4,985) | 24.1% / 29.1% / 38.0% (n 657 / 2,532 / 2,748) |

Per market the edge rose in art (21.0 → 25.4pt), culture, watches and fell in science (21.0 → 14.2pt) and sports (5.2 → −5.0pt on 39 flags). Live (the Sep 14 book replayed with every Oct 6 change, 948 graded): flagged hammer > high 52.3% → 56.9% vs unflagged 37.0% → 37.8%. Measured and NOT adopted: a 1-year odds half-life (`calHalfLife1y`: 1,047 flags, flagged odds error 1.4 → 3.1pt) and the single-figure estimate kind (`singleFigure`: 1,152 flags, edge and error flat). Counting bought-in lots as misses needs bought-in calObs rows (a full replay) — not done.

## 13 · OCT 6 2026 PRICING WAVE 2 — comp selection (`2026.10.06-comp-purity`)

**Why.** A hand-judged sample of the comps the live engine selected (1,493 comps across 200 live lots) read 42.7% good / 39.3% weak / 18.0% wrong. The wrong ones follow a few generic shapes: identity-less titles ("J. Edgar Hoover", "[Apollo 11]", Picasso "Nature morte"), signed vs unsigned, another subject ("Pope Pius XI" for "Pope Clement XI"), another designator ("Apollo 10" for "Apollo 13", plate III for plate II), another object class (participation medals for a torch), another medium / edition class. Readers: `app/lib/comp-purity.ts`. `resolveComps` now attaches each comp's row (`Comp.lot`).

**Measured** on the recategorized corpus. Holdout = oneoff/qa/engine-ab.ts, test year from Oct 1 2025 (8,180 estimate targets, 5,020 valued). Live = oneoff/qa/live-ab.ts --full-cal, the Sep 14 book graded on lots sold by Oct 5 (1,078 estimate lots, 680 valued). Precision = hammer > house-adjusted top. "Shown" baseline = the flags engineFlagOf actually displayed: the ×5 sanity already hid 155 holdout / 14 live flags.

| | baseline (shown) | purity gate | hard boundaries | both (adopted) |
|---|---|---|---|---|
| holdout flags / precision / edge | 971 / 49.9% / 21.4pt | 708 / 49.4% / 21.0pt | 1,022 / 51.5% / 23.1pt | 680 / 49.6% / 20.1pt |
| live flags / precision / edge | 122 / 47.5% / 24.7pt | 74 / 55.4% / 38.8pt | 134 / 47.8% / 25.7pt | 84 / 56.0% / 38.7pt |
| holdout values / medErr / ±30% / band (same lots) | 4,695: 28.0% / 52.2% / 67.9% | unchanged | 4,695: 27.7% / 52.6% / 68.1% | 27.7% / 52.6% / 68.1% |
| live estimate values / medErr / ±30% / band | 680: 26.5% / 54.1% / 70.7% | unchanged | 632: 26.4% / 54.9% / 71.8% | same as boundaries |
| judged comps good / weak / wrong | 42.7 / 39.3 / 18.0% (1,493) | 56.5 / 27.2 / 16.2% (635) | 54.4 / 32.9 / 12.7% (1,124) | 65.5 / 23.5 / 11.0% (537) |

- **Purity gate** (`EngineFlags.purityGate`, flag-level): any directional read needs ≥ 3 comps with an object-naming title, the target's medium family and edition class, sold ≤ 10y before the valuation, and within 5× of the pure comps' median. Otherwise the signal is null (`value.abstain = 'flag:purity'`). The signal is also stripped when the comp ratio is outside [1/5, 5] (`'flag:ratio-x5'`): engineFlagOf already hid those, but the signal still shipped "strong, 64%". The value pool itself is unchanged. The record still scores these lots into calObs, outside the call buckets. Live and holdout disagree here: live precision is +8pt, while the holdout's withheld reads were slightly better than average (−0.5pt precision, −0.4pt edge, within EDGE_TOL_PT). The judged sample does not separate them either: signalOk true kept 50 / null 47, false kept 29 / null 30.
- **Hard boundaries** (`EngineFlags.compBoundary`, pool-level): signed vs unsigned (handwritten counts as autograph material), the target's person not named by the comp, a conflicting designator (not on watches or cards), and disjoint memorabilia object classes. 325 holdout and 48 live estimate lots lose their value (fewer than 3 comps left). Of the comps dropped, 7% were judged good and 34% wrong. The legacy RR terse titles ("Roy Orbison Album") are the main cost.
- **Cards**: a lone exact sale prices at most 'low' (live: 127 values, 19.4% medErr, the gate passes the cell). The variant tokens carrying bag / yellow and white letters / gray and white back now give the Ohtani SP and the 1956 backs their own keys (live card values 324 → 320, ±30% 63.3 → 64.1%). The comps-vs-bid read ships only within 1 day of the close (`value.vsBidLive`): 193 live reads withheld.

**Measured and NOT adopted:**
- `purityPool` (keep only pure comps in the value pool): holdout medErr 28.4 → 29.0%.
- `weightCap` (no comp over 35% of the weight): holdout medErr 28.4 → 28.7%, ±30% 51.6 → 51.4%; live 26.5 → 26.1% but ±30% 54.1 → 53.7% and band 70.7 → 70.0%; a 50% cap 28.5%. Abstaining when every comp is over 10y old costs 170 holdout values (102 live) and leaves the rest's error unchanged (28.3% = 28.3%; live 26.7%).
- `exactBlend` (≥ 2 comps at cosine ≥ 0.95 → blendW ≥ 0.5): holdout medErr 28.4 → 29.6%, band 67.2 → 65.8%. Learned point-in-time instead (train Oct 2023 → Sep 2025, house × exact count): every fitted weight was lower than today's (0.05–0.30). On the test year's 3,099 exact-pool lots: current 27.6%, learned global 27.5%, per house 28.0%. Per-house cells do not transfer.
- RR single-point house factor by estimate size (sub-$300 / $1k / $5k cells under the house's 'p' habit): RR 31.5 → 31.3%, but holdout overall 28.4 → 28.7% and live 26.5 → 26.7%, edge 24.6 → 22.0pt. RR's 'p' habit already tracks realized (median hl 0.32 vs realized/mid 0.32). The $300–1k floors' 40% error is dispersion, not bias.

## 14 · OCT 6 2026 PRICING WAVE 3 — the clean pool (`2026.10.06-wave3`)

**Measured** the same way as §13, each rule alone on top of `2026.10.06-comp-purity`, then together. Holdout = oneoff/qa/engine-ab.ts from Oct 1 2025 (8,180 estimate targets). Live = oneoff/qa/live-ab.ts --full-cal, the Sep 14 book graded on lots sold by Oct 5. Judged = the hand-judged comp sample from wave 2 (per-comp verdicts), counted after the wave-2 boundaries.

| | comp-purity | wave 3 (adopted) |
|---|---|---|
| holdout flags / precision / edge | 680 / 49.6% / 20.1pt | 658 / 50.2% / 21.1pt |
| holdout values / medErr / ±30% / band (same lots) | 4,592: 27.8% / 52.6% / 68.2% | 27.8% / 52.5% / 68.1% (103 values withdrawn, 26.9% medErr) |
| live estimate values / medErr / ±30% / band | 632: 26.4% / 54.9% / 71.8% | 617: 26.0% / 55.9% / 72.8% |
| live flags / precision / edge | 84 / 56.0% / 38.7pt | 83 / 57.8% / 39.9pt |
| live card values / medErr / ±30% / band | 320: 21.0% / 64.1% / 78.1% | 320: 19.9% / 65.3% / 80.0% |

- **Extended boundaries** (`boundary2`, comp-purity.ts): a lone "I" closing a designator ("Fillette, I, from …") and "pl. 94" read as designators, romans compare as numbers; different catalogue-raisonné numbers in one system (B. 138 vs B. 200; F&S 179 vs the 179–182 set); a single plate against the whole portfolio, either way round ("Ten Landscapes" vs "Landscape 2, from Ten Landscapes"; "Untitled (from the Pop Shop I portfolio)" vs "Pop Shop I"). Holdout flags 680 → 676, edge 20.1 → 20.2pt (art 22.3 → 23.4pt); live ±30% 54.9 → 55.1%, edge 38.7 → 39.8pt; judged: every comp it drops was judged wrong (6 of 6), wrong share 12.7 → 12.3%.
- **Identity-less art** (`idLessAbstain`): an art target with no catalogue citation, no medium / edition evidence and a title core of ≤ 4 words abstains when its comps span > 20× ('identity-less'; Phillips "Homme assis" against the $8M painting). Holdout: 48 values withdrawn at 32.4% medErr, edge 20.1 → 20.9pt; live unchanged.
- **Watch dial variants** (`watchVariant`): Stella, agate, Aquatic, Dual Time, Tiffany, Paul Newman, tropical, meteorite, mother-of-pearl, hardstones, pavé, sigma — a different variant set is a hard boundary. Holdout watches: flags 27 → 23, precision 40.7 → 47.8%, edge 23.8 → 26.6pt; 41 values withdrawn at 26.9%; the changed values 18.3 → 17.3%.
- **Stale floor** (`staleFloor`): a pool whose weighted median comp is > 5 years old never values the lot under its printed low estimate. Live medErr 26.4 → 26.1%, ±30% 54.9 → 55.5%, band 71.8 → 72.2% (high tier 28.3 → 25.2%); holdout 8 values change, 123 → 95% medErr, nothing else moves. The all-in floor (low × premium) over-lifted: holdout ±30% on its 91 changed lots 42.9 → 37.4%.
- **Thin card pools** (`cardThinMedian`, build-market priceCard): an exact pool of ≤ 3 sales prices at its plain median — the 0.5y-half-life weighted median of two sales was the newer one. Live cards medErr 21.0 → 19.9%, band 78.1 → 80.0%, bias 1.022 → 0.996.

**Measured and NOT adopted:**
- `pureRead` (the directional ratio and the read's median from the purity-gated comps): holdout precision 50.2 → 50.5%, edge 21.1 → 21.7pt on top of the adopted set, but live edge 39.9 → 37.3pt (two Christie's flags swung to below and both missed). The Flags edge must not degrade on either yardstick; it stays off.
- `exactWeight` (≥ 3 comps at cosine ≥ 0.9, ≤ 3 years, IQR ≤ 1.5× → comp weight ≥ 0.6): holdout medErr 27.7 → 27.9%, band 68.1 → 67.8% (522 changed values 23.8 → 25.3%); live medErr 26.4 → 26.1% but band 71.8 → 71.4%. At 0.4: holdout 27.8%, band 67.9%. The exact comps already carry their weight through the tier weights.
- The **quantity** boundary ("(19) Documents" vs one document, "Signatures" vs one signature): holdout culture medErr 29.1 → 29.6%, edge 31.9 → 31.0pt; the judged comps it dropped were all 'weak', none 'wrong'. `BOUNDARY2.quantity = 0`.

## 15 · OCT 6 2026 PRICING WAVE 4 — the round-2 re-audit (`2026.10.06-wave4`)

**Measured** each rule alone on top of `2026.10.06-wave3`, then together. Holdout = oneoff/qa/engine-ab.ts --cal full from Oct 1 2025 (Oct 5 corpus; 8,194 estimate + 2,793 no-estimate targets; error on all-in realized vs the published value, estimate lots). Live = oneoff/qa/live-ab.ts --full-cal: the Sep 14 book graded on lots sold by Oct 6 (940 valued), and the Sep 24 book (355 valued) as a second tape. Live error is on the HAMMER vs the served expected hammer, after the live-bid floor.

| | wave 3 | wave 4 (adopted) |
|---|---|---|
| holdout estimate values / medErr / ±30% / band | 4,613: 28.7% / 51.7% / 67.0% | 4,367: 27.7% / 52.6% / 67.7% (246 withdrawn at 40.9%) |
| holdout RR (estimate) medErr / bias | 31.6% / 1.026 | 30.6% / 1.054 |
| holdout flags / precision / edge (compareEngines) | 652 / 50.8% / 20.8pt | 605 / 52.1% / 21.3pt |
| live Sep 14: all / estimate medErr | 23.2% / 25.8% (940 / 616) | 22.8% / 25.0% (907 / 583) |
| live Sep 14 RR medErr / bias | 27.1% / 0.909 | 25.9% / 0.914 |
| live card band coverage (Sep 14 · Sep 24) | 70.4% · 75.5% | 75.6% · 80.8% |
| live Sep 24: all medErr / bias | 20.0% / 0.916 | 19.5% / 0.944 |

- **The partial habit** (`partialHabit`, `PARTIAL_HABIT` fr 0.8, s 0.3): a single-point estimate ("$500+", RR) whose ≥ 3 pure comps read under the house's habit (flag ratio < 0.8) anchors on 70% of the habit. RR lots there realize ≈ the printed figure × premium, while the habit anchor put them at ~1.1–1.3× it. Holdout: 659 values change, medErr 36.0 → 34.5%, ±30% 43.4 → 44.6%; estimate lots 28.7 → 28.3%. Live: 62 change, 27.6 → 22.5%, bias 0.871 → 0.926. RR live bias barely moves (0.909 → 0.911): the rest of RR's over-prediction is the house-bias index lagging RR's Jul–Sep 2026 softening (holdout RR realized / mid 1.45–1.50 in Mar–Jun, 1.25–1.38 in Jul–Sep) — a recency question for indices.makeHouseBiasIndexer (HB_HL_Y 2y) that moves the Flags' yardstick too; not done here. s 0.5: holdout 28.4%, RR bias 1.076, live RR bias 0.929 — not taken (holdout bias). fr < 1.0: holdout RR 31.6 → 31.8% — not taken.
- **The wrong-scale pool** (`poolScale`): an estimate lot whose comp ratio (after the exact-match guard) sits outside ×/÷ 5 abstains (`'pool-scale'`): the wave-3 engine stripped the signal there but shipped the estimate-anchored value (Lichtenstein "Entablature" painting off its prints, $547k; Warhol "Self-Portrait" offset litho off paintings). Holdout: 246 values withdrawn at 40.9% medErr; live: 33 withdrawn at 33.6% (Sep 14), 15 (Sep 24). No other value moves.
- **Held Flags markets** (`flagHold`, `FLAG_HOLD_MARKETS` sports + watches): the holdout put sports flags at 20.8% precision (24 flags, edge −1.8pt) and watches at 23 flags; a held market's would-be 'below' read ships no signal (`'flag:held'`), the value stands. Holdout flags 652 → 605, precision 50.8 → 52.1%, edge 20.8 → 21.3pt; live: 4 watches flags withdrawn (2 of 4 beat). Release a market when its holdout flags reach n ≥ 50 with an edge.
- **Card band 10/90** (`cardBandWide`, cards-gate `CARD_BAND_WIDE_Q`): the 13/87 band of the point-in-time residuals covered 65–74% of live card outcomes; 10/90 covers 75.6% (Sep 14) / 80.8% (Sep 24). The value, bias and max-bid quantile are unchanged.
- **No odds without calibration** (`uncalNoOdds`): a lot with no calibrated odds row returns NaN (no directional call, beatRatePct 0) instead of the original holdout curve (42–69%). No effect where the nightly calibration loads (both yardsticks unchanged).
- **No bid lift in the final day** (`bidLift24h`, `BID_FLOOR_FINAL_DAYS` 1): inside 24h of the close the live-bid floor is the bid itself (Sep 24 tape: floored lots closing within 24h realized 1.00× the bid, 10 of 14 exactly at it); 1–3 days out the ×1.1 lift stays — RR lots 1–3 days out on the Sep 14 tape realized 1.21× the bid. Publish-only (no holdout effect).
- Also: floorAtBid floors the all-in low of a value carrying no hammer band; Sotheby's artist-page estimates in an unconvertible currency fail closed (no estimate) instead of reading as USD.

**Measured and NOT adopted:**
- `sameWork` (≥ 3 comps that are the same work by comp-purity.sameWorkComp — same title, same house family, h × w ±10% — sold ≤ 3y → comp weight ≥ 0.5): holdout 23 values change, median error 23.5 → 22.9%, ±30% 60.9 → 69.6%, mean |log error| 0.307 → 0.268, but art's 21 go 18.4 → 22.9% median; no lot on either live tape qualifies (0 changes), so the live half of the bar is unmeasured. Flip it on when a graded book carries such lots (wright-417164 "Têtes", rago-417217 "Puppy (vase)" on the Oct 6 book).
- `mediumKnownPool` (an art / design target with a medium family prices off the comps carrying that family as evidence when ≥ 3 do): holdout 307 values 28.1 → 26.9%, flags precision 50.8 → 50.2%; live 46 values 25.8 → 33.6%.
- `bidLiftOff` (no ×1.1 lift at all): Sep 14 tape all-lot medErr 23.2 → 23.6%, the 70 changed 10.2 → 21.0%; Sep 24 tape 20.0 → 21.0% overall although its 69 changed went 10.0 → 6.5%.
- Finer calibration edges above 1.3: not attempted (changes the record's buckets; needs its own pass).
- Bonhams (live bias 1.57, n 11) and Phillips (live engine 23.7% vs house estimate 16.1%, n 36): holdout Bonhams 29.3% vs house mid 30.4% (n 388), Phillips 24.1% vs 26.7% (n 375) — the live gaps are one hot sale and n 36; no change.

**Client (NEEDS-REVIEW commit, separate):** lotMaxBid prints the engine's value.maxBidUsd only (no 0.85 × card-median floor, no maxHammerFor(low) on ×5-faulted values); lanes.valueFloor drops the card-median branch; LotPage / ComparableModal / /profile / /value no longer import appraiseLot, signalWithPool or soldCompBand (scripts/__tests__/client-fallbacks.test.ts fails if anything under app/ does); pack.a / pack.ap ship only for engine-valued lots; the intraday close-board bid re-floors the value (floorAtBid). For the owner: CalibrationCurve.tsx still labels the odds "beat the high estimate, all-in" — since §12 they are the HAMMER over the house-adjusted top (label text not changed here).

## 16 · OCT 6 2026 PRICING WAVE 5 — object-type comp boundaries (`2026.10.06-wave5`)

**Why.** The round-2 re-audit judged 200 live comp sets (1,175 comps): 31% good / 47% acceptable / 22% wrong; cards 99% good, non-card 24% wrong (Hake's 85%, Sotheby's 60%, Christie's 38%). The wrong comps are different objects sharing a person or maker's name, RR's subject-only archive titles ("Woodrow Wilson"), and unique works mixed with multiples.

**Harness.** `oneoff/qa/comp-precision.ts` re-runs today's pool selection (backtest-core.compsOne → estimateValueEx, Oct 5 corpus with categorization wave 3) on every hand-judged lot of the three comp audits (600 lots, 3,864 per-comp verdicts; the latest round wins). It scores the pool each engine serves against the verdicts and lists the judged pairs a rule drops, by grade. It also reports expected hammer vs the appraiser's hammer. DEV / TEST is md5(lot id) parity. Rules were tuned on DEV only. Cards are out of scope: they price on their own key and judged 99% good.

**Adopted** (`EngineFlags.objectBoundary` with `BOUNDARY5`, and `memIdLessAbstain`; readers in comp-purity.ts):
- **Paper format** (`paperFormatOf`): a cut signature never prices a letter, and the reverse; a manuscript never prices anything else. On DEV, letter ~ signature judged 12 wrong / 10 acceptable / 0 good, and manuscript ~ letter 10 / 0 / 0. Letter ~ document ~ check stays one family (19 good or acceptable, 0 wrong). Signature ~ signed document also stays (16 acceptable / 7 wrong).
- **Subject-only titles** (`isBareSubjectTitle`): the bare-name reader, confirmed by the lot's own stamps. The title (or either side of a topic colon) is the lot's subject / entity / player, or it has ≤ 2 words that name no object. Such a comp never prices an object-naming target. A memorabilia TARGET with such a title abstains (`'identity-less'`).
- **Space missions and flight status** (`missionsOf`, `flightOf`): a mission is a designator across programs too (Skylab 2 ≠ Apollo 11). Lunar-surface flown, flown and unflown are three markets.
- **Jewelry / material culture** (`objectClassesOf5`): bracelets, charms, fobs, pinbacks and ribbons (Hake's) are never priced by paper or photographs.

**Measured** on the wave-4 engine:

| | wave 4 | wave 5 (adopted) |
|---|---|---|
| judged TEST comps in today's pools, wrong share (non-card) | 17.0% (867 judged) | 15.0% (805) |
| · culture / science | 8.9% / 30.2% | 6.0% / 28.6% |
| · RR / Christie's / Sotheby's / Wright | 14.2 / 18.1 / 30.0 / 16.4% | 11.2 / 18.1 / 30.0 / 16.4% |
| · Hake's (3 judged comps, 1 lot) | 100% | lot abstains |
| judged DEV comps wrong share | 14.7% | 9.2% |
| judged TEST pairs dropped (good / acceptable / wrong) | — | 7 / 22 / 55 of 560 / 837 / 382 |
| TEST judged lots valued; appraiser error (same lots) | 198; 16.9% | 191; 16.9% (8 withdrawn at 19.2%) |
| holdout values (all) / same-lot medErr / ±30% | 5,655 / 31.6% / 48.4% | 5,528 / 31.6% / 48.4% |
| holdout withdrawn / changed | — | 133 at 56.8% medErr (55 Sotheby's science at 96%) / 138: 43.7 → 40.1% |
| holdout flags / precision / edge (adj) | 591 / 54.0% / 24.3pt | 591 / 54.1% / 25.3pt |
| live Sep 14 values / medErr / band | 947 / 22.8% / 75.3% | 933 / 22.8% / 75.5% (14 withdrawn at 32.7%) |
| live Sep 14 flags hammer > high | 79: 67.1% | 78: 67.9% |
| live Sep 24 | 337 / 18.8% | unchanged (no lot touched) |

On the 17 changed Sep 14 values, error went 20.7% → 22.0% (n small). Judged "acceptable" comps are dropped too (the pool loses close but not exact objects). The holdout same-lot error does not move.

**Measured and NOT adopted:**
- **Another named work of a suite** (`workConflict`: each title carries a content word the other lacks, e.g. "Minotaure caressant une femme" vs "Minotaure, buveur et femmes"). Also **another colorway** (`colorConflict`, "Balloon Dog (Red)" vs "(Blue)"). On DEV it dropped 26 wrong / 7 acceptable / 2 good pairs. But in the pool, holdout art went 27.2 → 27.5% on the same lots, with 57 art values withdrawn at ~27% (no worse than the values kept). As a purity fault only (`workPurity`): holdout art flags 213 → 184 (precision 53.5 → 53.8%), and live Sep 24 lost a correct flag (61.5 → 58.3%). Plates of one portfolio often trade alike (judged good: "Homage to Euclid" vs other La mémoire élémentaire plates). Art TEST wrong share therefore stays 21.9%; Christie's / Sotheby's art needs a price-aware or catalogue-aware test, not a title test.
- **Bulk** (count ≥ 3 / collection / archive vs one): DEV 8 wrong / 16 acceptable (the wave-3 quantity rule was rejected on the holdout too).
- **Stamped unique vs multiple** (art subCat originals vs prints) and **subject-only art comps**: no comp in today's pools (the formKey gate already separates them).
- **Known misses, seen on TEST, not tuned:** "Apollo 17 Lunar Flown Checklist Page" reads as plain 'flown', so 6 good lunar-surface comps were dropped. "USS Constitution Ashtray" is a 2-word object title read as subject-only.

## 17 · OCT 6 2026 PRICING WAVE 6 — catalogue identity for art comps (`2026.10.06-wave6`)

**Why.** After wave 5 the art pools were still the worst judged: TEST wrong share Christie's 18.1%, Sotheby's 30.0%, Wright 16.4% (art 21.9%). Wave 5's title rules (another work of a suite, another colorway) were rejected on the holdout. The wrong DEV art comps are other works that share a title or a suite ("Minotaure aveugle guidé par une fillette dans la nuit" pricing plate I at 8×), unsigned posters pricing signed prints, and a whole illustrated book pricing one of its plates — usually far off the estimate's scale.

**Adopted** (`EngineFlags.crWork`, `CR_WORK = { minN 3, maxAgeY 3, w 0.5, idExact 1 }`): the CATALOGUE FLOOR. The wave-4 same-work comp floor, keyed on catalogue identity instead of title + house + dimensions. An art lot with ≥ 3 comps sold in the last 3 years that are the same work (the same catalogue-raisonné number, or the same edition identity key: `similarity` idExact) puts at least 0.5 of the prediction on the comps. Art only: on watch references the same floor made live Sotheby's watches worse (28 values, 24.2 → 30.1%).

| wave 5 → wave 6 | |
|---|---|
| holdout art medErr / ±30% / band | 27.2 → 26.6% / 53.4 → 53.9% / 70.1 → 70.3% (917 values, none withdrawn) |
| holdout values changed | 90: 22.1 → 20.4% |
| holdout all / flags | 31.6% = 31.6%; 591 flags, precision 54.1%, edge 25.3pt (unchanged) |
| hand-judged TEST pools | unchanged (the floor moves the weight, not the pool): art wrong 21.9%; Christie's 18.1 / Sotheby's 30.0 / Wright 16.4% |
| TEST appraiser error, art lots | 20.3 → 19.7% (Wright 24.9 → 22.6%) |
| live Sep 14 | 933 values, art 25.2% = 25.2%, ±30% and band equal; 5 art values changed (12.7 → 13.0%); 78 flags unchanged |
| live Sep 24 | no lot touched |

**Measured and NOT adopted:**
- **The scale-consistent pool** (`compScale`, `COMP_SCALE`): an art / design comp whose hammer sits more than 4× outside the printed estimate leaves the pool when ≥ 3 comps remain. The identity-less and pool-scale abstentions still read the unfiltered pool, so the filter never revives a pool that prices another object (the first version did: 9 of 29 new comps wrong on DEV). The pools get much purer: DEV same-lot art wrong 12.7 → 10.3%. TEST: art 21.9 → 16.9%, Christie's 18.1 → 11.4%, Sotheby's 30.0 → 27.6%, Wright 16.4 → 15.5%. TEST appraiser error 20.3 → 19.7%, holdout art 27.2 → 27.1%. But the holdout art band fell 70.1 → 68.8% and art flags 213 → 205 (precision 53.5 → 53.2%). Live it lost on both books: art 25.2 → 26.7% (Sep 14) and 25.2 → 27.2% (Sep 24), and the Sep 24 flag hit rate fell 61.5 → 53.3%. With the extra pool-median condition (also ×3 off the pool median) it was still worse live: 26.0% / 26.1%. The off-scale comps are often the wrong object, but the price they carry still informs the value.
- **The catalogue pool** (`crPool`): a target that cites a catalogue number prices off same-citation comps only. No DEV pool qualifies (few targets cite a number). Different citations were already a hard boundary (wave 3, `catalogueConflict`).
- **The catalogue floor on citations alone** (`CR_WORK.idExact = 0`): holdout art 27.2% = 27.2% (too few cited pools).
- **Edition size and sheet dimensions as compatibility:** no judged DEV pair carries an edition size on both sides. Of 98 pairs with dimensions on both sides, the area ratio separates nothing (> 2.5×: 1 pair).

Harness additions: `comp-precision.ts` and `engine-ab.ts` take `--a wave5`. Tests: `scripts/__tests__/pricing-wave6.test.ts`.

## 18 · OCT 6 2026 PRICING WAVE 7 — band coverage, the RR bid, new releases, the odds floor (`2026.10.06-wave7`)

**Why.** The round-3 re-audit graded the live tape on the PRODUCTION calibration (`live-ab.ts --full-cal`): band coverage 76%, not the 83% the legacy calibration read; culture / RR 66%; watches 17% above the band; cards 16% below. A quarter of RR lots hammered at the snapshot bid. Modern cards were over-called. The served odds looked off in the 40–59% buckets.

Yardsticks: the test-year holdout (`engine-ab.ts`, 5,589 lots, calibration refit each quarter); the Sep 14 and Sep 24 live books graded to the Oct 6 corpus with the production calibration. The two books share 268 of the Sep 24 book's 335 valued lots (long Goldin and Memory Lane sales), so a card rule needs an independent check: the point-in-time card record (every card sold in the trailing year priced as of its own sale day).

**Adopted:**
- **The market tails** (`vbMarket`, `VB_MARKET = { q 0.10, minN 150, kMin 0.6, kMax 2.5, hlY 0.75, windowY 3 }`). A per-market × tier band drifted out of sample (§ Sep 27, `VB_PER_MARKET`). Each market × path now pools its tiers and fits one exponent per tail on the global path × tier band: a row falls under lo^k when log z / log lo > k, so k is that ratio's (1 − q) weighted quantile. The market's cell is the global band with its tails raised to k (backtest-core `fitValueBands` → `valueBandByMarket`). Values and Flags are unchanged.

| holdout coverage / mean log width | wave 6 | wave 7 |
|---|---|---|
| all | 70.4% / 1.05 | 77.9% / 1.24 |
| art | 69.8% / 0.81 | 72.7% / 0.85 |
| culture | 63.6% / 0.79 | 71.4% / 0.94 |
| design | 69.4% / 0.79 | 86.1% / 1.16 |
| science | 62.1% / 0.84 | 79.4% / 1.28 |
| sports | 65.9% / 0.84 | 81.1% / 1.18 |
| watches | 76.9% / 0.76 | 78.9% / 0.80 |
| no-estimate sports | 77.5% / 1.83 | 81.9% / 2.07 |

Live, all wave-7 rules combined: Sep 14 76 → 83% (width 0.80 → 0.93); culture 66 → 81%, art 79 → 88%, watches 79 → 80% (above the band 17 → 15%), design 79 → 87%, cards 80 → 82%. Sep 24 80 → 86% (0.78 → 0.81); art 79 → 94%. Art over-covers live while it under-covers on the holdout, and design over-covers on both. q 0.08 reached 82.0% on the holdout at width 1.39. A 1.5y / 6y fit reached 77.5%; on the holdout it put culture at 69.2%, against 71.4% for the 0.75y / 3y fit.

- **The RR bid pull** (`bidPull`, `BID_PULL = { houses [RR Auction], above 1.15, w 0.15 }`, `value.pullTowardBid`, applied at publish before `floorAtBid`). An RR value above 1.15× the live bid moves 15% of the way (in log) to the bid; the band, max bid and all-in figures scale with it. The rule was tuned on the Sep 14 RR book (253 lots), where it took error from 25.9 to 21.1%, bias from 0.91 to 1.00 and band coverage from 66 to 70%. Out of sample:

| check | before | after |
|---|---|---|
| Sep 14 odd lots (w chosen on the even lots) | 27.4% | 21.1% |
| Sep 14 even lots | 23.5% | 21.0% |
| Sep 24 book, 11 RR lots | 18.9% | 16.7% |
| Sep 25 sale on the served tape, 17 lots, Sep 20–24 snapshots | 37.5–52.6% | 25.5–33.1% |

Run through the engine (Sep 14), culture error went 26 → 21% and band coverage 66 → 72%. The audit's w = 0.3 gave 21.4% in sample and 18.2% on Sep 24.

- **The new release** (`cardNewRelease`, `CARD_NEW = { years 1 }`, abstain `'card:new-release'`). A sports card whose set year is at least the valuation year − 1 abstains.
  - Point-in-time card record (trailing year, Oct 6 corpus): 56 new-release residuals at 52.1% median error, realized 0.79× the value. Older sets: 1,700 residuals at 27.6%.
  - Live cards: Sep 14 20.8 → 20.3% (26 withdrawn at 43%); Sep 24 15.2 → 11.9% (35 withdrawn at 42%).
  - The audit's rule (serial ≤ /25 or < 12 months old needs ≥ 2 exact comps) measured 20.5% on Sep 14 and 12.3% on Sep 24. New releases miss at every pool depth: medium-confidence new cards had 84% error on Sep 14.
- **The odds floor** (`oddsFloor`, `ODDS_FLOOR.lo 0.10`). The calibrated odds were clamped at 30%, so the low buckets served 31% where 25% beat (holdout). After the change the holdout buckets serve 17.5 / 24.2 / 33.5% and realize 15.4 / 23.3 / 33.5%. Brier score: holdout 0.2051 → 0.2005; Sep 14 0.2086 → 0.2062; Sep 24 0.2152 → 0.2157 (54 lots). Flags are unchanged: 588, precision 50.5%, edge 20.6pt.

**Measured and NOT adopted / not changed:**
- **Refitting the 40–59% odds buckets.** On the holdout they are calibrated: served 45.4% realized 46.9%, served 52.8% realized 51.8% (850 lots). The live miss (served about 51%, realized 60% against the adjusted top) is 78 lots on one book, 47 of them RR single-figure estimates. The audit's 64–70% read the raw top.
- **A REA venue factor by price tier.** The point-in-time card record has REA under-called (985 residuals, bias 1.05; commons under $250, 1.11). Only the Sep 14 sale over-called (0.87).
- **The science "regression".** Of the 199 changed science lots (wave 3 → 6, all RR single-figure estimates), mean |log error| moved 0.398 → 0.404. Per step, wave 4 improved median error 39.0 → 37.3% (169 lots) and wave 5 52.9 → 51.5% (38 lots); wave 6 touched none. The bias move to 1.09 comes from `partialHabit`, which is neutral on science error (on 37.6% / off 38.6%) and better on culture (31.6 / 33.5%) and sports (33.9 / 38.2%). Nothing was reverted.
- **The Phillips reference** (`houseReference` captured, `corpus-normalize.USE_HOUSE_REFERENCE = false`). Phillips titles never print the reference, and the stored description is the title. The maker API carries it as `wReferenceNo` (on 100% of sampled lots; 9,440 of 9,514 parse with `watch-ref.readHouseReference`). The crawler now stores it raw (stripped from served). Reading it into `reference`, measured on a back-stamped corpus:
  - Holdout: Phillips values 351 → 425, but the 351 already-valued lots went 24.1 → 24.3% (band 77.5 → 74.6%) and watches overall 21.6 → 21.7%.
  - Live: Sep 14 Sotheby's watches 22.0 → 22.2%.

  The structured reference therefore stays out of the comp key. A `PHILLIPS_DEEP=1` crawl backfills the history.
- **The reference-family bound** (`watchRefBound`; `WATCH_REF_BOUND.refless`). With the stamped corpus, on the holdout: 85 watch values changed (21.5 → 21.4%) and 43 were withdrawn. Live: Sotheby's 22.2 → 23.0%.
- **The art plate key.** The catalogue floor misses because the data is missing, not because of the reader. Only 10 of 406 Sep 24 art lots cite a catalogue number: the Christie's and Bonhams text lacks the line, and most "B." / "plate" hits are birth years and plate sizes. Of 156 cited Sep 14 lots, 97 have no same-plate sale in 3 years. Reader fixes would lift Sep 14 qualifiers from 7 to 8 and Sep 24 stays at 1. Those fixes: read `medium`; Alan Ramié / Delteil / Duthuit tails; comp-purity dropping "IIIA.50" and merging II.50 with IIIA.50.
- **RR rare-content under-calls** ("as President", ship's pass, Type I vs III, multi-signer): not attempted this wave.

Harness additions: `engine-ab.ts` and `comp-precision.ts` take `--a wave6`. Tests: `scripts/__tests__/pricing-wave7.test.ts`.

## 19 · OCT 6 2026 PRICING WAVE 8 — the round-3 under-call classes (no engine change; `2026.10.06-wave7` stays)

**Why.** After wave 7, three under-call classes carried a third of the live error beyond ±30%: vintage watches (10.9%, Sotheby's bias 1.34), card key / grade premium (10.0%), and RR rare content (11.8%, bias 1.22).

Yardsticks: the test-year holdout (`engine-ab.ts --a wave7`, Oct 6 corpus, 5,717 values). A training window (`engine-ab.ts --from 2023-10-01 --to 2025-10-01`, 7,749 values) checks whether a pattern predates the test year. The Sep 14 and Sep 24 books go through `live-ab.ts --full-cal` (920 and 300 values). Rules are tuned on the Sep 14 even lots and tested on the odd lots (md5 parity). Cards use the point-in-time card record (trailing year, 1,715 residuals).

**What the pools show.** The engine picks the right comps in all three classes. The misses come from the sale itself, not from a lost identity.
- **Watches.** The Day-Date 1803 (guilloché dial) priced off ten 1803 sales at $9.5k–17.8k and sold for $81.9k, 2.1× its high estimate. The "Red Stella" 18038 priced off eight Stella-dial 18038s ($19.5k–145k) and sold for $139k, 2.2× its high. The Bubbleback 3131 priced off ten 3131s ($5.4k–11.5k) and sold for $52k. On the holdout, the lots that sold above the house's high estimate (216 of 861) carry the whole bias (1.55). Dial and rarity words show no stable premium: "extremely rare", "retailed by" and the dial variants read 0.90–1.11 in the training window and 1.20–1.39 in the test year (n 15–36 per half-year).
- **Cards.** The Ohtani 2018 Topps Update US1 BGS 9.5 had four earlier sales under the identical title at $67–288. It sold for $4,028, and the Sep 14 value was $271. The Bednarik 1948 Leaf yellow-background PSA 4 had one exact sale in the window ($4,797) and sold for $10,742. The Ichiro Victory PSA 10 had two same-week exact sales ($39 and $98). None of these pools holds base cards. In the point-in-time record, raw bias by segment (1970–99 sets 1.20, grade 9 1.20) does not repeat live: grade 9 reads 1.18 on Sep 14 and 1.01 on Sep 24, and 1970–99 reads 1.09 and 1.01. Two identity faults were found but not changed, because neither causes an under-call: the "Victory" and "Upper Deck Victory" set keys split one card, and every colour reads as one `v:color` variant (the Bednarik orange background shares the yellow ladder).
- **RR.** Wells & Fargo priced off ten Wells & Fargo American Express certificates ($500–1,739) and sold for $4,980. Conan Doyle priced off seven Conan Doyle ALS ($446–1,344) and sold for $1,553. Lon Chaney Sr. priced off his own signed photographs ($1.2k–3.0k, with Jr. rows in the tail) and sold for $4,185. Content tokens show no stable premium either. The subCat habit flips between windows: documents 1.00 in training and 1.12 in test, space 0.96 and 1.11. A letter "on" a topic reads 1.01 on the holdout.

**Measured and NOT adopted:**
- **The habit premium** (`habitPremium`, `HABIT_PREMIUM = { fr 1.4, k 1.1 }`): an estimate lot whose comps read ≥ 1.4× the house habit gets its value × 1.1. Comps over the habit realize above the value in both windows (bias 1.06–1.15 at fr ≥ 1.25). The parameters were tuned on the Sep 14 even lots.

| | wave 7 | habit premium |
|---|---|---|
| holdout all medErr / ±30% / bias / band | 31.4% / 48.8% / 1.031 / 76.8% | 31.1% / 48.9% / 1.019 / 76.9% |
| holdout changed (919) | 34.1% (mean abs log 0.405) | 32.4% (0.390) |
| holdout per market, all lots | art 26.2, culture 31.0, design 28.7, science 31.0, sports 27.5, watches 21.8% | 26.4, 31.1, 28.8, 31.5, 28.0, 21.7% |
| training window, changed (1,652) | 31.8%, ±30% 48.3% | 32.7%, ±30% 46.7% (worse in 5 of 6 markets) |
| live Sep 14 estimate lots: odd / even | 21.65 / 24.71% | 21.14 / 24.25% |
| live Sep 24 estimate lots | 26.93% | 26.15% |
| live Sep 14 changed (91): medErr / bias | 30.1% / 1.00 | 29.8% / 0.91 |
| audit classes, Sep 14 odd lots: watches / RR / cards | 36.0 / 26.6 / 25.0% | 36.0 / 24.2 / 25.0% |

The lift fixes the mean (bias goes to 1.0) but not the median. The residuals above the habit are right-skewed, so the training window's median error and ±30% got worse. On the holdout, five of six markets also got worse on all lots, while their changed lots improved. Sotheby's watches did not move. At k 1.05, Sep 14 odd lots went 21.65 → 21.75% (worse). The rule stays off. It can be replayed with `--b-flags habitPremium=1`.
- **The estimate premium**: when comps sit far under the estimate (cr < 0.4–0.6), shrink the comp weight by 50–100% (offline, exact blend inversion). Training watches 20.72 → 20.70–21.10%. Holdout watches 21.83 → 21.83–22.57%, and Sotheby's 19.9 → 20.4–21.5%.
- **A higher comp weight above the habit** (w ≥ 0.2–0.5, or w + 0.1–0.3, when fr ≥ 1.25–2): training all 25.1 → 25.2–27.1%.
- **A shorter house-habit half-life** (`indices.HB_HL_Y` 2 → 1 / 0.5, both the anchor and the Flags yardstick). Holdout all 31.4 → 31.2 / 31.5%. Watches 21.8 → 22.1 / 21.9% and art 26.2 → 27.1 / 27.2%.
- **RR comp recency** (`COMP_HL.point` 2 → 1 / 0.5, a new sweep handle; the default is unchanged). Holdout RR 30.5 → 30.5 / 31.0% (20–37 values withdrawn). Training RR 23.6 → 23.8%.
- **A dial / gem-set variant boundary** (guilloché, gilt, diamond-set). The tokens show no holdout bias: diamond-set 0.95 in training and 1.03 in test, guilloché 0.84 and 0.96. Not built.

**The Phillips deep backfill (report only, no crawl run).** The 5 tracked watch makers' maker-API histories hold 10,715 Phillips lots. The corpus has 4,926 of them, and none yet carries `houseReference`, because the nightly crawler with the field has not run. `PHILLIPS_DEEP=1` walks every page of every Phillips maker, art included, instead of the nightly 2 pages. For watches it would add about 5,800 lots: Patek Philippe 3,526 (the corpus has 269), Rolex 1,682, Cartier 579. They come from Geneva (2,161), Hong Kong (2,782) and New York (846) sales, and 5,032 of them carry a reference. Wave 7 measured `USE_HOUSE_REFERENCE` only on back-stamped existing rows (Phillips 24.1 → 24.3%). The deeper Patek pools are the case it never tested. Order: run the deep crawl once, let normalize stamp the references, then re-run `engine-ab.ts` with the reader on vs off before flipping it. Flipping it before the backfill is the wave-7 result again.

Harness additions: `engine-ab.ts` takes `--to` (a training window) and `--a wave7`; `comp-precision.ts` takes `--a wave7`; `live-ab.ts` rows carry `bw` / `cm` / `ca` / `n`, and `--pools` adds the pool ids and title. Tests: `scripts/__tests__/pricing-wave8.test.ts`.

## 20 · OCT 6 2026 PRICING WAVE 9 — the Phillips reference after the deep backfill (no engine change; `2026.10.06-wave7` stays)

**Why.** Wave 7 measured `USE_HOUSE_REFERENCE` on 826 back-stamped rows and found it flat. The deep backfill has now landed (corpus `versions/20261006T162315Z`): 17,336 Phillips rows, 16,043 of them sold, and 9,491 carry `houseReference` (Rolex 3,968, Patek Philippe 3,610, Audemars Piguet 996, Omega 521, Cartier 396). With the flag off, normalize keys almost none of them: 27 Phillips sales sit in the watch repeat-sale pool.

**The field is sound.**
- Format. `readHouseReference` reads 9,423 of 9,491 fields (99.3%) and keys them with the title reader's core (`splitWatchRef`), so no new key: "5711/1A-010" → 5711/1, the same key as a title "Ref. 5711/1A"; "5100P-001" → 5100; "3970EP-019" → 3970; "26300ST.OO.1110ST.08" → 26300; Rolex suffixes stay ("126710BLNR" → 126710blnr), as on the title path; Omega's six-part numbers stay whole. The 68 misses are multi-watch fields ("Blue: 6127G-010; Violet: …"), typos ("154120R.YG…"), glued suffixes ("11659912SA") and 3-digit Rolex numbers.
- Agreement. Phillips titles print a reference on 5 of these rows. 2 agree; the other 3 are the title reader taking the plural "reference 5004s" as 5004s. Across houses, 92.5% of house keys match a reference another house printed (Rolex 97.0%, Patek 96.0, AP 85.0, Omega 74.9, Cartier 55.2). A Phillips sale sits a median 40.0% from the other houses' median for the same key (±3 years, 6,885 sales); a random key of the same maker sits 251%.

**Measured** (corpus-normalize flag off vs on, same corpus; the Sep 14 / Sep 24 books get the field copied by id and the backfilled Phillips sales dated before the book, then each arm's normalize re-derives the references):

| | off | on |
|---|---|---|
| holdout all: values / medErr / band | 5,888 / 31.2% / 76.6% | 5,937 / 31.1% / 76.3% |
| holdout watches, same 1,002 lots: medErr / mean abs log / bias / band / log width | 21.7% / 0.267 / 1.041 / 77.3% / 0.80 | 21.7% / 0.265 / 1.035 / 75.6% / 0.77 |
| holdout watches changed (315, 227 Phillips): medErr / band | 19.6% / 80.0% | 18.6% / 74.6% |
| holdout Phillips watches, same 345: medErr / band | 21.2% / 77.4% | 21.6% / 73.3% |
| holdout Christie's 298 / Sotheby's 229 / Bonhams 130 | 21.7 / 20.7 / 26.5% | 21.2 / 20.3 / 26.8% |
| holdout Rolex 322 / Patek 480 / AP 79 / Cartier 94 / Omega 27 | 20.7 / 20.0 / 25.6 / 31.3 / 43.2% | 20.2 / 20.0 / 25.6 / 31.3 / 44.4% |
| live Sep 14 watches: values / medErr / bias / band | 124 / 22.7% / 1.07 / 80% | 129 / 21.2% / 1.03 / 80% |
| live Sep 14 changed (25, all Sotheby's watches): medErr / ±30% / bias / band | 23.3% / 64% / 0.97 / 76% | 17.9% / 60% / 0.90 / 72% |
| live Sep 24 (303 values, 4 watches) | 16.2% | 16.2% (nothing changed) |

The on arm added 52 holdout watch values at 26.1% and withdrew 3.

**Comp precision.** The judged comp set (`comp-precision.ts`) holds 7 watch lots and 4 Phillips lots (none watches), and it is identical on and off. The new `oneoff/qa/watch-ref-precision.ts` scores every served pool by reference identity instead. It covers the 2,695 watch lots sold since 2025-10-01 whose true reference is known.
- Phillips (947 lots): values 647 → 731. Pool comps carrying a different reference: 61.7 → 26.1%; on the 643 both arms value, 61.5 → 28.3%. Median error against the hammer on those 643: 21.9 → 22.4% (Rolex 22.2 → 23.0, Patek 21.0 → 21.5, AP 20.6 → 17.7%).
- Other houses (1,159 both valued): cross-reference comps 3.1 → 2.7%, error 21.7 → 21.5%.

**Why it stays off.** The reference fixes the pools, and the point error holds or improves everywhere except Phillips' own lots. The band is the problem. Exact-reference pools promote 99 changed watch values to the high confidence tier (65 from medium, 34 from low). The high tier's band already under-covers watches (72.6% off, 71.0% on). On Phillips lots, the error does not shrink to match: same-lot band coverage drops 4.1pt and the width 9%. The holdout watch band drops 1.7pt, and wave 7 was the band-coverage wave. Next: fit the high-tier watch band to these lots (or hold Phillips house-reference values at their pre-flag tier for the band), then re-run this A/B. The A/B needs only a second code root with `USE_HOUSE_REFERENCE = true`.

**What the backfill alone did (flag off).** Pre-backfill corpus (`versions/20261006T145723Z`) vs the backfilled one, holdout: watch values 861 → 1,005, medErr 21.8 → 21.7%, band 79.0 → 77.3%. Phillips watch values went 200 → 347 at 22.4 → 21.2%; Sotheby's 19.9 → 20.7%. On the 607 lots both value, 22.7 → 22.9%. Against wave 7's numbers (watches 830 at 21.6%, band 78.9%; Phillips' valued lots 24.1%), Phillips is better and watches overall are level. Live Sep 14 (snapshot vs snapshot + backfill): watches 120 → 124 values, 23.5 → 22.7% (mean abs log 0.270 → 0.274). Sep 24: 3 → 4 watch values.

**The watch index.** The repeat-sale block (build-market `buildVerticalRepeatSale`) does not become publishable either way. Every horizon fails the endpoint-sensitivity gate:

| | pairs / objects | 1Y shift vs CI | 3Y | 5Y |
|---|---|---|---|---|
| off (pre- and post-backfill alike) | 20,275 / 3,204 | 12.9 vs 11.3pt | 13.3 vs 12.4 | 27.4 vs 14.3 |
| on | 23,350 / 3,610 | 13.7 vs 10.4pt | 20.6 vs 11.7 | 21.0 vs 13.1 |

Gates unchanged.

Harness additions: `oneoff/qa/watch-ref-precision.ts` (reference-identity comp precision, run from a flag-off and a flag-on code root).
