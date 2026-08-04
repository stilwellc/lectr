# B2 — ENGINE & MATH audit (GA readiness)

Auditor: Claude (read-only pass, every line of the 11 scoped files, 4,087 LOC).
Date: 2026-08-03. Scope: app/lib/{comps,value,demand,similarity,indices,submarkets,heroLayers,cards,normalize,validate}.ts + app/utils.ts.
All failure inputs below were repro'd in a node harness (scratchpad), not inferred.

Severity: [BLOCKER] renders a wrong/fabricated figure at GA · [PRE-GA] honesty/correctness defect worth fixing before ship · [POST-GA] hardening.

---

## PRE-GA findings

### 1. [PRE-GA] Demand Index is premium-contaminated but presented as "% over estimate"
`app/lib/demand.ts:46` — `perf: l.priceUsd / estMid - 1`.
`priceUsd` is premium-inclusive (~1.25× hammer); `estMid` is hammer-basis. Every DemandPoint
is inflated ~+18–25pts: a market trading exactly AT estimate renders as "+25%" demand.
The codebase already knows this and corrects it in the two sibling reads:
- `indices.ts:99-101` houseAccuracy: "realized/mid ran ~1.18 from premium alone and could
  never say the houses 'missed'" → uses `hammerUsd || realizedUsd/1.25`.
- `utils.ts:166-177` overEstimatePct: "divide out the premium before comparing, or every
  figure overstates by ~25pts".
So the app ships two different answers to "how far over estimate does the typical sale land",
and `formatDemand` (`demand.ts:70`) prints the inflated one as a signed green/red `+46%`.
Trend SHAPE is unaffected (bias ~constant), the LEVEL is the lie — and per the honesty
doctrine every realized-vs-estimate comparison must divide out premium or be labeled all-in.
**Fix (pick one, 2 lines):** in the demandSeries loop use
`const hammer = (l.hammerUsd ?? l.hammerPrice ?? 0) > 0 ? … : l.priceUsd / 1.25` and
`perf: hammer / estMid - 1` (matches houseAccuracy; changes historical levels, shape intact);
OR keep the math and force every caption through "all-in vs estimate" labeling. Do not ship
the bare "% over estimate" caption on this series.

### 2. [PRE-GA] Edition-path ×5 sanity band reads the RAW estimate fields and shadows `estMid`
`app/lib/comps.ts:585-589` (inside `compPoolRead`):
```ts
const estMid = lot.estimateLow && lot.estimateHigh ? (lot.estimateLow + lot.estimateHigh) / 2 : 0;
```
Two defects in one line:
- **Unit mix:** the function's outer `estMid` (comps.ts:533) is built from `estUsdBand()`
  (USD, alias-safe). This inner shadow reads raw `estimateLow/High` — on any row where the
  old fields are native-currency (pre-migration Bonhams GBP, or any future ingest where the
  alias invariant slips), the edition ×5 collision guard compares a USD median against a
  native band. A GBP 100–150k band vs a $160k median passes/fails on the wrong axis.
- **Guard bypass:** on a row carrying ONLY `estLowUsd/estHighUsd` (old fields absent rather
  than aliased), the shadow computes 0 → `!estMid` → the edition sanity band is SKIPPED
  entirely, so a repeated-subject-title collision pool (the exact class the guard exists
  for — 'walt disney studios' ×368) can mint a false very-high edition unchecked. The
  form-path twin guard at comps.ts:647 correctly uses the outer USD `estMid` — the two
  paths silently disagree.
**Fix:** delete the shadowed line; use the enclosing `estMid` (it is guaranteed >0 there).

### 3. [PRE-GA] Card setName corrupted for years 2020, 2000, 1919 (year-slice indexOf bug)
`app/lib/cards.ts:87` — `noParens.slice(noParens.indexOf(out.year.slice(-2)) + 2)`.
The last-2-digits search finds the FIRST occurrence, which for years whose trailing pair
also appears earlier in the year lands inside the year itself. Repro'd:
- `"2020 Panini Prizm #101 Justin Herbert…"` → setName `"20 Panini Prizm"`
- `"2000 Bowman Chrome #236 Tom Brady…"` → setName `"0 Bowman Chrome"`
(2017/2020-21 forms parse clean.) 2020 is one of the highest-volume card years in the
corpus. Internally consistent (same wrong key both sides) so exact-card comps still pair —
but every dossier/ladder surface that renders `setName` shows "20 Panini Prizm", and
`cardKey`s for `"2020 …"` vs `"2020-21 …"` titles of the same product can never converge.
**Fix:** the year regex is `^`-anchored, so the year starts at index 0:
`const afterYear = noParens.slice(out.year.length);` (2-digit-year path: slice past the
matched 2-digit token instead).

### 4. [PRE-GA] FATAL-1 "non-future saleDate" uses instant `now` — same-day sales in UTC-ahead timezones can abort the publish
`app/lib/validate.ts:75-80` — `isRealNonFutureDate` compares `new Date(saleDate).getTime()
<= now`. `saleDate` is day-granular and parses as UTC midnight, so a lot marked sold with
saleDate = "today in HKT/NZDT" is "future" until 00:00 UTC of that day (repro'd:
`2026-08-04` sold-row vs now=Aug 3 22:00 UTC → fatal). FATAL-3 (validate.ts:142-151)
already solved this exact problem for upcoming lots with a day-granular string compare;
FATAL-1 didn't get the same treatment. Consequence is not dishonesty but a fully aborted
corpus write (crawler policy: fatal → no publish) the night before/of any Asia-Pacific sale
whose results post before UTC midnight. Narrow window, cheap fix, expensive failure.
**Fix:** compare day strings like FATAL-3: `l.saleDate.slice(0,10) <= todayStr` (optionally
todayStr+1 for a same-day buffer), instead of instant epoch compare.

### 5. [PRE-GA] The flag pct is all-in-vs-hammer — every render site must carry the basis label
`app/lib/comps.ts:737-744` — `ratio = med / estMid` divides a premium-inclusive comps
median by a hammer-basis estimate mid; `pct = round((ratio-1)*100)` therefore overstates
the hammer-basis edge by ~25pts (backtest itself is dual-basis: +41% all-in / +13% hammer).
The 1.3 threshold correctly prices the premium out of the DECISION (comment at :738-741 is
right), but the NUMBER that escapes — `signalMagnitude()` at :761-770 prints a bare
`+35%` / `2.5×`, and `value.ts` `compRatio`/`strength` share the same basis. Nothing inside
these files labels it. This is a cross-check, not a code bug in scope: verify every surface
rendering `signal.pct` / `compRatio` says "at realized (all-in) prices" or equivalent;
doctrine line 8 makes an unlabeled figure a ship-stopper.

---

## POST-GA findings

### 6. [POST-GA] fmtSignedPct/toneOf/formatPrice pass NaN/Infinity through to the screen
`app/utils.ts:151-155` — `fmtSignedPct(NaN)` renders `"−NaN%"` (repro'd), `fmtSignedPct(Infinity)`
renders `"+Infinity%"`; `utils.ts:159-161` `toneOf(NaN)` → `'down'` — a NaN paints signal-RED;
`utils.ts:181-195` formatMoneyAxis/formatPrice render `"$NaN"`. All callers currently guard
(overEstimatePct returns null, engine ratios are finite), so no live path found — but these
are THE terminal formatters and one un-guarded future caller ships a NaN in mono font.
**Fix:** first line of each: `if (!Number.isFinite(n)) return '—'` (toneOf → `'flat'`).

### 7. [POST-GA] extractEdition accepts fractional-inch dimensions as editions
`app/lib/normalize.ts:565-576` — the bare-fraction branch: `"…drawing 5 3/4in x 8in"` →
`editionOf: 3, editionTotal: 4` (n≤m≤999 passes; the lookahead `(?![\d.\/])` doesn't exclude
a following `in`/`"`/`cm`). Downstream damage is contained — `similarity.ts:206-210` requires
`editionMarker` + category print/original before a physicalMatch, and the fingerprint only
gains a noisy component — but the stamped field itself is fabricated data.
**Fix:** extend the bare-fraction lookahead: `(?!\s*(?:in\b|"|″|cm\b))`, or require the
labeled form when a dims-ish context is present.

### 8. [POST-GA] Zero-denominator fractions → Infinity into dims
`app/lib/comps.ts:192-194` (`parseFrac`) and `app/lib/normalize.ts:213-218` (`parseMeasure`):
`"5 1/0 x 4 in"` → Infinity (repro'd). In comps the area/length gates then EXCLUDE the pair
(ratio Infinity > cap) — honest-by-accident; in normalize, `sc(Infinity)` → `heightCm:
Infinity` → `sizeClass 'monumental'` persisted, and `sizeRatio` → Infinity hard-rejects all
comps for that lot. Never renders (dims aren't formatted through these helpers) but poisons
the stamped row. **Fix:** `if (!den) return 0;` / reject non-finite in `sc()`.

### 9. [POST-GA] ICS all-day event collapses for UTC+13/+14 readers
`app/utils.ts:254-279` — DTSTART comes from the raw date string but DTEND from
`new Date(saleDate+'T12:00:00')` (LOCAL noon) `+86_400_000` → `toISOString()`. At UTC+13
(NZDT), local noon is 23:00Z the PREVIOUS day, so DTEND === DTSTART (repro'd:
`2026-08-04` → DTEND `20260804`) — a zero-length all-day event that some calendar apps drop.
**Fix:** derive next day in UTC from the string: `Date.UTC(y, m-1, d+1)` → format.

### 10. [POST-GA] Diameter symbol never matches
`app/lib/normalize.ts:227` — `axisLabel` lowercases the token then tests `/…|Ø|⌀/` — the
uppercase `Ø` can never appear in a lowercased string, so `"Ø 30 cm"` falls to positional
height instead of dia (w=d). Add `ø` to the class.

### 11. [POST-GA] Metric paren with mixed units treats cm as mm
`app/lib/normalize.ts:296-297` — parenthetical branch: `mm: /mm/i.test(paren[1])` — a paren
like `"(43.5 cm x 6 mm)"` flags mm → the 43.5cm axis becomes 4.35cm. The standalone branch
(:299) already does `/mm/ && !/cm/`; mirror it in the paren branch.

### 12. [POST-GA] overEstimatePct never reads the canonical USD estimate fields
`app/utils.ts:166-177` — signature/body use only `estimateLow/estimateHigh`. Correct today
solely because migration made the old fields aliases; `comps.ts estUsdBand` and
`demand.ts:37-38` both defensively read `estLowUsd ?? estimateLow`. One un-aliased future
row reintroduces the exact USD-price-vs-native-estimate bug this family was built to kill.
**Fix:** accept + prefer `estLowUsd/estHighUsd` with the same fallback.

### 13. [POST-GA] Price-index point `n` is market volume, not the index's own basis
`app/lib/indices.ts:144-147` — `index.push({ …, n: volByQ.get(q) })`: the n attached to an
index point is ALL sold lots that quarter, while the value is computed from the qualifying
cohorts only (`rels`, ≥3). Doctrine says "every figure names method + n" — this n mildly
overstates the sample behind the number. **Fix:** carry `rels.length` (or cohort sample
count) as n, or both.

### 14. [POST-GA] demandSeries has no staleness gate
`app/lib/demand.ts:27-67` — realizedCohortSeries and bidCompetitionSeries both emit `[]`
when the freshest window closed >1y before now (:157-160, :247-250); demandSeries doesn't,
so a vertical gone dark keeps its last quarter as the series tail. The x-axis dates it, so
not dishonest — but inconsistent discipline within one file. Mirror the gate.

### 15. [POST-GA] watchKeyKind derives from title while the pool key uses the persisted reference
`app/lib/comps.ts:673` — `wkk = watchKeyKind(lot)` (title recompute) vs the pool gate on
`watchKeyOf(lot)` (persisted `lot.reference`, :545). Consistent today because the crawl
stamps `reference` from the same `watchKey(title)`; if reference ever gets a richer source
(structured house field), the H1 medium-cap and the §1.3 material-purity flag gate silently
misclassify ref-keyed pools as model-name. Add `watchKeyKindOf` reading a persisted kind, or
assert the invariant in validate.ts.

### 16. [POST-GA] GRADE_RE requires a leading dash — non-Goldin grade formats parse as 'raw'
`app/lib/cards.ts:24` — `/[-–—]\s*(PSA|BGS|SGC|CGC)…$/` matches Goldin's "… - PSA 10" shape
only. A card titled "1952 Topps #311 Mickey Mantle PSA 5" (no dash — Heritage/RR style)
gets `gradeCo: null` → `cardKey` suffix `'raw'` → a graded card pools with raw copies
(10–100× price gap). Safe while sports-cards is Goldin-only; add the dash-less form (or
reuse extractCollectibleTags' looser `\b(PSA|BGS|SGC|CGC)\s*\d` as fallback) before any
other house's cards flow through parseCard.

### 17. [POST-GA] heroLayers palette modulo — dormant collision
`app/lib/heroLayers.ts:113` — `LAYER_PALETTE[i % 6]` across main+sub. Every current view has
≤6 total layers so no collision exists; adding a 7th layer to any view silently duplicates
hue 1, violating "a line's color indexes it to its chip". Guard or extend the palette when
lists grow. (The window rebase itself lives in the hero component, not this file — its
base>0 guard was NOT auditable here; `markets.*.index` values are exp()-derived and rebased
>0 in indices.ts, but drills `indexSeries` is built elsewhere. Cross-check the component.)

---

## VERIFIED SOUND (checked, no defect)

- **comps.ts** — `classifyForm` WeakMap cache (lots immutable, safe); `unknown` never
  matches (curried gate returns `()=>false`, anchor-known vs candidate-unknown inequality);
  `modelKey` CODE_BLACKLIST + year rejection; watch no-reference abstention (:545, matches
  server engine); sports/science identity abstention (:555-557 + soldCompBand :954);
  sothebys-algolia exclusion with the documented §2.2 asymmetry; median() callers all
  pre-sort; q1/q3 floor-indexing never out-of-bounds and only over-widens IQR on tiny pools
  (guard gets STRICTER, honest direction); ×5 form-path band uses USD estMid (:647);
  negative/zero estimates abstain end-to-end (truthiness + band guards); set normalization
  (edition path exempt by same-title construction — correct); wood/H1/H3 demotions ordered
  after the ladder; `flagEligible` material-purity defaulting to 0 when material unparsed
  (conservative); `signalMagnitude` caps (5×+ floor, −99% bound — Above Market pct
  mathematically <100 since med,estMid>0); `dealScore` br×1000+min(pct,400) can't be NaN
  on any reachable input and default br=50 is deliberate; reference bands structurally
  cannot flag (never called from signal paths, confidence pinned 'low'); `cleanGoldinTitle`
  pure/safe; sort comparators on saleDate — sold rows have validated dates, and per spec a
  NaN comparator result is treated as +0 (no instability).
- **value.ts** — weightedMedian total=0 degenerate returns first value (unreachable: weights
  >0 by gate); lerpQuantile vs round quantile split is deliberate and documented; decay
  guards isNaN(saleDate)→1 and refMs→now; exact-match consistency guard's non-null
  assertions are protected by the estMid truthiness; `vsBid` divisor compValueUsd>0 always
  (pool realizedUsd>0); fallback tier never claims 'high'; conformal band only applies when
  compValueUsd>0; resolveComps `saleDate < priorTo` string-compare is safe on the canonical
  YYYY-MM-DD shape (validate FATAL-7 enforces it).
- **demand.ts** — trailing CALENDAR window (never adjacent keys) in all three series;
  `Date.UTC(y, q*3+3, 1)` month-13 rollover correct; future-sale clamps in the two cohort
  series; MIN floors; distinct point types (%, $, bids) enforcing caption separation;
  estMid≤0 skip; invalid-date skip.
- **similarity.ts** — cosine 0-norm guard; idf on empty table → 0 → total abstention;
  player hard-gate only when BOTH sides carry an id (documented coverage honesty);
  physicalMatch requires hard discriminators (real serial ≥4 chars w/ digit; real edition
  marker + category; photo-match + entity + temporal pin at strong ≥0.9); bonus clamp
  [0,1]; CandidateIndex rareTokens cached consistently with retrieval (the old slice(0,6)
  divergence is fixed and commented).
- **indices.ts** — geometric chain inputs strictly positive (m>0, base>0 checked) so
  log/exp safe; rebase base0 = exp(·) > 0 always; sell-through excludes cards (no false
  100%) and floors n≥6; house accuracy divides out premium (hammer ?? realized/1.25) and
  guards mid>0; MIN_PER_QUARTER on both accuracy and index; median() sorts internally;
  QUARTER(null) → null → skipped.
- **submarkets.ts** — pure lookups; every path returns null on missing data; sport label
  round-trip (DRILL_SPORT ↔ sportDrillOf) consistent with sportOf labels.
- **heroLayers.ts** — layers with <6 points abstain (null → filtered); volume points carry
  value=n (a count, labeled as volume); subLabel matches the sub band's actual kind per
  view; no division anywhere in the file.
- **cards.ts** — GRADE/SERIAL/NAME regexes all linear (bounded lazy quantifiers, no nested
  unbounded groups — no catastrophic backtracking; hostile 10k-char titles scan linearly);
  parseFloat/parseInt inputs regex-constrained (never NaN); cardKey/cardLadderKey abstain on
  partial identity; looksLikeCard's brand-vs-authenticator discipline; playerSlugOf
  unicode NFD + combining-mark strip correct.
- **normalize.ts** — FX table deterministic, nearest-year fallback with later-year
  tiebreak, USD=1 always, null amounts preserved (never coerced to 0); yearOf/isoDay/
  round2 safe; extractYear field-wins + fraction-strip + future-year cap (call-time, not
  frozen); firstYear bounds 1800..now+1; stripBioParens ≥15-year span requirement (kills the
  birth-year bug without eating work-date ranges); canonMedium first-hit-wins ordering;
  titleTokens dedupe + light singularization + drop-list double-check (pre and post-stem);
  objectFingerprint thin→null discipline (untitled + no model/dims/edition never
  fingerprints; sports needs entity+year); fnv1a deterministic across runtimes; imageHash
  never throws (null on any failure), sharp lazy-load tolerant.
- **validate.ts** — detection/policy split (pure, no throws); alias-safe price-field
  presence check; FATAL-3's day-granular timezone-proof compare (the model FATAL-1 should
  copy — see finding 4); usdMatchesNative ±1 tolerance comfortably covers round2 error;
  fxRate>0; blanket-forced-currency check; warn-rate accumulators divide by `lots.length
  || 1` (no div-by-zero on empty input).
- **utils.ts** — formatDate UTC-pinned (hydration-safe); localToday local-calendar by
  design, DST-safe (get* are local calendar reads); trueSaleDay saleDateTime-wins;
  isLiveUpcoming grace window computed in UTC epoch (DST-proof) and string-compared;
  overEstimatePct premium math itself correct (hammerPrice alias read is right — see
  finding 12 for the estimate side); formatMoneyAxis B/M/K rollover with .0 trim; sportOf
  full-name-only crossover surnames; craftTitle shouting-ratio guarded by letters>8 (no
  0-division); makeAuctionIcs null on malformed date (never throws in the click handler).

---

## COUNTS

- **BLOCKER: 0** — no reachable path renders NaN/Infinity/fabricated figures with current
  callers and current (validated, migrated) data.
- **PRE-GA: 5** (findings 1–5)
- **POST-GA: 12** (findings 6–17)

## WORST 5

1. **demand.ts:46** — Demand Index level is all-in-vs-hammer, rendered as bare "% over
   estimate": ~+25pt systematic inflation; the same file tree corrects this basis twice
   elsewhere. The flagship honesty defect in scope.
2. **comps.ts:585-589** — edition ×5 sanity band: shadowed `estMid` on raw native fields —
   unit-mixed on any non-aliased row AND fully bypassed on *Usd-only rows, defeating the
   collision guard the edition path exists to enforce.
3. **cards.ts:87** — every plain-"2020"/"2000"/"1919"-titled card ships a corrupted setName
   ("20 Panini Prizm") into dossiers and set-level keys; 2020 is a flagship card year.
4. **validate.ts:75-80** — FATAL-1 instant-based future check can abort the entire nightly
   publish for a same-day Asia-Pacific sale; FATAL-3 already contains the correct pattern.
5. **utils.ts:151-161** — the terminal % formatters render `−NaN%`/`+Infinity%` and paint
   NaN direction-red; one unguarded caller away from a doctrine breach on any surface.
