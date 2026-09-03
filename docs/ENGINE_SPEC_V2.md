# THE ENGINE SPEC v2 — lectr comp engine consolidation

Consolidates the 7 vertical investigations (art, game-used, watches, design, science, culture, classification) into one implementable change set for `/Users/collin/Dev/Ray/app/lib/comps.ts` and `/Users/collin/Dev/Ray/scripts/lib/corpus-normalize.ts`. Both files read in full; all thresholds below are the measured winners, all rejected variants are listed with the numbers that killed them.

**Governing result:** aggregate error will NOT drop — art proved the engine already sits at the repeat-sale noise floor (leave-one-out 0.431 across 22,345 same-title sales vs shipped 0.427). Every change below buys one of three things instead: (1) coverage where the engine is structurally blind (game-used 0→65%, science 5→38.5%, culture 0→34%), (2) flag honesty (kill the measured dishonest-flag classes), (3) bias removal (design set-size ±15–17% directional bias). That is what the honesty doctrine prices.

---

## 1 · SHARED CORE CHANGES (app/lib/comps.ts)

### 1.1 Frozen invariants — DO NOT TOUCH (re-validated by every vertical)
- Pool floor `>= 3` (all 7 backtests).
- Dispersion guard `(q3−q1)/med <= 2.5` (kills only 6.4% of game-used identity pools; correct everywhere it was measured).
- Form-pool ±5× estimate sanity (science: cut worst tail 227,281% → ≤1,234%; reused verbatim in both reference tiers).
- Edition path precedence (design: edition-kind 0.296 vs form-kind 0.453; art: 41% of reads).
- Furniture length gate 2.2× unchanged — it sees only 0.28% of comp pairs (design-dims.ts); the lever is dims coverage at crawl, not the threshold.
- **NO global low-confidence flag suppression** — explicitly rejected by measurement: art low-conf flags beat 89% (40/45) at n=1500; the 67% seen at n=600 was n=12 noise. Confidence is calibrated for error width, flag honesty is flat across tiers.

### 1.2 Confidence ladder — keep tiers, add three demotion hooks
Tier formula unchanged (`edition→very-high; ≥12&spread≤1.0 or titleKin≥6&spread≤1.5→high; ≥6&spread≤1.8→medium; else low`). Measured monotone: very-high 0.377 / high 0.427 / medium 0.529 / low 0.549 (art). Hooks, applied after the ladder in `compPoolRead`:

```
// H1 · watches: model-name key (not a ref number) → cap 'medium'
//     ref-keyed pools IQR/med 0.53 vs model-name 1.27 (2.4× looser; cartier|tank spread 1.66)
if (isWatch && watchKeyKind(lot) === 'model-name') confidence = min(confidence, 'medium');

// H2 · design: wood-mixed form pool → demote one notch (high→medium, medium→low)
//     wood-mixed>34% pools belowWin 67% vs 74% pure; hard wood gate measured HARMFUL (0.349→0.368)
if (kind === 'form' && FURNITURE.has(form) && anchorWood && diffWoodShare(pool, anchorWood) > 0.34)
  confidence = demoteOneNotch(confidence);

// H3 · art: category-reclassified (o2p-sniffed) anchor → cap 'low'
if (lot.catReclass === 'o2p') confidence = 'low';
```
`watchKeyKind`: 'ref' when `watchKey` matched the explicit-reference regex (comps.ts:262), 'model-name' when it matched `WATCH_MODELS`. Expose it from `watchKey` (return `{key, kind}` internally or a parallel fn).

### 1.3 Flag eligibility — one gate in `signalWithPool`
Add `flagEligible: boolean` to `CompRead`; `signalWithPool` returns null (no Below/Above Market) when false, while `appraiseLot` still returns the value. Rules (each measured):

```
flagEligible = true
if (lot.catReclass === 'o2p') flagEligible = false            // art: sniffed cohort beats 59–67% even post-fix, vs 85.5% standard
if (isWatch && watchKeyKind === 'model-name'
    && materialPureShare(pool, anchorMat) < 0.8) flagEligible = false  // watches: BM hold 39%; ref key or material-pure pool required
// reference tiers (science/culture) and soldCompBand can never flag — enforced structurally (§2.5/§2.6): they are separate
// functions that return descriptive bands only and are never read by signalWithPool/dealScore/value lists.
```
Culture slugs are excluded from `compPoolRead` entirely (§2.6) — that removes their 52 flags at medAbsErr 0.68 (worst-calibrated cohort in the audit set).

### 1.4 Thresholds unchanged
Below Market ≥1.3, Above ≤0.75, edition/form sanity ×5, top-24 overlap-then-recency capping — all unchanged.

---

## 2 · PER-VERTICAL GATE MODULES

### 2.1 ART (print/original + size + series) — inside `comparableTo` / `compPoolRead`

**A — category healing moves to the corpus (§3.2), not runtime.** The runtime PRINT_CUES sniff from the art report is superseded by `normalizeArtCategory` (98.8% adjudicated precision, 99.4% with the maker scope guard): flips heal BOTH anchor and candidates in one pass and survive to the client shards. The engine consumes only the stamped `lot.catReclass` marker for H3 + flag suppression. Do not double-implement the sniff client-side; sold-archive (title-only, medium coverage 0.0%) is explicitly out of scope until precision is re-measured there.

**C — area gate 4× → 2.5×, art 2D forms only, still opportunistic:**
```
// in comparableTo, else-branch of the size gate:
const AREA_MAX = ART_2D_TIGHT.has(a) ? 2.5 : 4;   // ART_2D_TIGHT = {print, poster, painting, work-on-paper, original-2d, photograph}
if (areaA/areaB > AREA_MAX || areaB/areaA > AREA_MAX) return false;
```
Measured (1500-anchor sample): 25/835 reads affected; retained-22 err 0.535→0.476; 3 reads lost at err 0.143; aggregate 0.427→0.427 (free). Do NOT ship dims-required-when-anchor-has-dims (measured worse 0.427→0.433, and live dims coverage 73.2% vs sold 7.4% would gut live pools — monitor live read-coverage after ship, per the art risk note).

**D — series-availability abstain, print form-path only:**
```
seriesOf(t) = normalizeTitle(match(t, /(?:,|\s)from\s+(?:the\s+)?(.{3,50}?)(?:\s*\(|,|\s*\d*\s*$)/i)?.[1]) if len>=3
if (form === 'print' && kind === 'form' && (sa = seriesOf(lot.title))) {
  if (pool.filter(c => seriesOf(c.title) === sa).length < 3) return null;   // abstain
  // DO NOT hard-filter pool to same-series — measured worse (retained 0.345→0.388); the overlap scorer already series-sorts
}
```
Measured: abstains on 9/835 reads (1.1%) whose baseline err was 0.587 (replication 10/91 at 0.769); loses 3 flags at 67% beat. Spot-check the regex against Bonhams title conventions pre-ship.

**Rejected (do not implement):** year band ±15y (no-op, originals are 3% of art reads), in-pool series requirement, dims-required variant, low-conf flag suppression.

### 2.2 GAME-USED (identity + item) — `soldCompBand` + build stamp

**Identity stamp is a corpus pass (§3.4), not an engine change.** `recoverPlayerSlug` (spec'd verbatim in §3.4) lifts sold identity coverage 2.5% → 93.9% (180 → 6,879/7,324), live 94.2%, 97.8% agreement with existing stamps. Root cause fixed at the source: cards.ts `NAME_TOKEN` requires a capital and 97% of sold game-used is lowercase sothebys-algolia.

**Engine changes in `soldCompBand`:**
```
// item gate: for lot.artist === 'game-used', replace compFormKey equality with objectType EQUALITY
//   (sportsForm's 'sports-worn' lumps pants/sneakers/helmet/cap; objectType coverage is 100% on sold)
if (lot.artist === 'game-used') {
  if (objectTypeOf(l) !== objectTypeOf(lot)) exclude;      // instead of compFormKey(l) === form
}
// identity gate unchanged in shape: idKey = playerSlug (now stamped); NO entity fallback for sports slugs
//   (entity is polluted event text: "Eastern Conference Finals", coverage 2.3% — measured dead end)
// eventKey/sportYear/entity remain SCORE-only; floor ≥3, top-24, dispersion ≤2.5 unchanged
// confidence bands unchanged (high = n≥8 && spread≤1.0 → err.med 0.333; medium = n≥4 → 0.444) — DESCRIPTIVE only, never flags
```
Measured trade objectType vs sportsForm: −10 bands/300 (68.3%→65.0%) for err.med 0.395→0.359, p75 0.698→0.667. Take the accuracy.

**OBJECT_TYPE_RULES hygiene:** extend the ball rule so `baseball|basketball|football` titles stop landing in 'other' (183/707 sold 'other' rows are balls) — MUST be ordered AFTER the helmet/cap/pants rules ('football helmet' would otherwise key as ball).

**Document the algolia asymmetry** at comps.ts:496: `compPoolRead` excludes `sothebys-algolia`, `soldCompBand` does not — that asymmetry is what makes game-used priceable (title carries identity, priceUsd is real). Add the comment so a future cleanup doesn't re-zero the vertical.

**Structural ceiling (do not chase with parser work):** live book is 100% Goldin, client corpus holds ZERO Goldin game-used sold rows; 379/534 live identities have no history. 13–14% live coverage is the ceiling until Goldin sold history ships to client shards or bands precompute server-side against the full 507K R2 corpus — that lever is worth ~5× the parser's live yield.

### 2.3 WATCHES (material; size rejected) — inside `comparableTo`
```
// STRICT coarse material gate, after the refA !== watchKeyOf(candidate) check:
coarseWatchMaterial(l):  // from lowercase(title + ' ' + medium)
  gold  = /\b(gold|or jaune|or gris|or rose|or blanc)\b|\b18k\b|\b14k\b|\b18ct\b|\b9ct\b/
  steel = /\b(steel|stainless|acier)\b/
  class = (gold && steel) || /two[- ]tone/ ? 'two-tone'
        : /platinum|platine/ ? 'platinum' : gold ? 'gold' : steel ? 'steel'
        : /titanium/ ? 'titanium' : null        // gold shades collapse — fine split measured no better (0.305 vs 0.303)
if (isWatch) {
  const ma = coarseWatchMaterial(lot);
  if (ma && coarseWatchMaterial(candidate) !== ma) return false;   // STRICT: unparsed candidate ≠ ma → excluded
}
```
Measured (2,500 anchors): reads 1,713→1,655 (−3.4%), medAbsErr 0.311→0.300, hi-conf 0.293→0.285, BM flags 888→847 — pure honesty trade (rolex|daytona steel $47.5K vs two-tone $11.2K in the same pool today). Strict over opportunistic per doctrine: an unparsed-material comp is a loose comp.

**Size gate: DO NOT ship** — byte-identical to baseline; mm coverage 0.3% titles / 0.1% dims, description absent on all 68,067 watch-maker lots.

**Model-name key handling:** H1 confidence cap + flag rule from §1.2/§1.3 (ref key OR ≥80% material-pure pool required to flag). This is the response to the 39% BM hold rate that identity gating alone cannot fix.

**Era/recency gate: DO NOT ship yet** — motivated (5–10× price moves inside ref+material pools across 25 years, likely the driver of the 61% flag-fail) but `watches-backtest2.ts` / `watches-keytype-err.ts` had not finished; measure first (checklist step 10).

**Stale-stamp fix:** handled corpus-side by `restampIdentityKeys` (§3.5) — kills the bonhams-31913-7 Ellipse-rings-as-wristwatch false flag (+52% high-conf) at the source. Belt-and-suspenders runtime guard in `formOf` (stamped watch form + live classifyForm='jewelry' → prefer jewelry) is optional once shards regenerate; ship it only if shard regen lags the deploy.

### 2.4 DESIGN (set normalization + wood demotion + plural rescue)

**GATE 1 — set-size per-unit normalization in the form path (the only design change that moves error). Ship first or together with Gate 2, never Gate 2 alone:**
```
S = {1:1, 2:1.25, 4:1.3, 6:2.27, 8:2.75}          // table for N with ≥8 supporting cells
S(other N>1) = sqrt(N)                              // out-of-sample fallback (leaves +0.136 pair residual — acceptable)
setSize(title):
  /\bpair of\b|\bpaire de\b/                       → 2
  /\bset of (\w+)\b|\bsuite de (\w+)\b|\bensemble de (\w+)\b/ → numword   // French forms included: 52+13+26 lots measured missed
  leading number-word ("Two Early LCW Chairs")     → N
  else 1
// FORM-kind pools only (edition path = same title = same set size):
unit_i = price_i / S[setSize(comp_i.title)]
med    = median(unit) * S[setSize(lot.title)]
// dispersion guard AND ±5× est sanity run on the NORMALIZED prices
```
Measured: overall 0.385→0.379; set-anchor mixed-pool signed err +0.170→−0.024 (medAbs 0.492→0.438); single-anchor set-heavy −0.151→+0.038; reads 7,314→7,324; belowWin holds 75%. This kills the false Above Market class (audit2-design errs +2.4 to +5.4). REJECTED: hard same-set-bucket gate (only 10/638 set anchors have pure pools — silences the segment), linear /N (+0.416 over-correction). Re-fit S at the Sunday full-truth pass (in-sample fit risk).

**GATE 2 — plural/compound/French form rescue in `classifyFormUncached`** (second pass when the design ladder yields 'design-other'):
```
chairs|armchairs?|\w*chair\w*|fauteuil|chaise → seating-chair   // AFTER bench/stool/sofa checks
stools|tabourets? → seating-stool;  benches → seating-bench;  tables → table
bureau → desk;  lit\b → bed;  miroir → mirror
```
Rescues ~1.4k of design-other's 5,307 (1,072 'chairs' lots alone; design-other is 48.6% of the vertical). Error-neutral by measurement (+143 reads; changed subset 1,015 improved / 966 worsened) — ship for pool semantics and flag explainability, and stage behind the digest diff (live flag churn expected). Because it changes `classifyForm`, it REQUIRES the restamp pass (§3.5) in the same release.

**GATE 3 — wood: demotion only (H2, §1.2), NEVER a hard gate** (measured harm: 0.349→0.368, −164 reads, −204 flags; wood-as-scorer neutral 451/445). Affects 440 reads / 301 flags whose belowWin is 67% vs 74%.

### 2.5 SCIENCE — `scienceReferenceBand` (additive, CANNOT flag)
New exported function beside `soldCompBand`; never called from `compPoolRead`, `signalWithPool`, `dealScore`, or any value list. Returns `{kind:'reference', confidence:'low' /*hard cap*/, median, q1, q3, low, high, n}`; UI renders a RANGE labeled "reference comps", never a point appraisal, never red/green.
```
SCIENCE_SLUGS = {meteorites, fossils, scientific-instruments, space-exploration}
if (!isSportsScienceObject(lot) || !SCIENCE_SLUGS.has(lot.artist)) return null
form = formOf(lot)
if (!SLUG_CANON_FORMS[lot.artist].has(form)) return null
  // meteorites→{meteorite}; fossils→{fossil}; scientific-instruments→{instrument,tech}; space-exploration→{space}
// pollution guards (anchor AND candidates):
if (/\([^)]*\b(1[4-9]\d{2}|20[0-2]\d)\b[^)]*\)/.test(title)) return null            // artist-dated parenthetical = leaked art lot
if (slug==='fossils' && /\b(photograph|panoramic|panorama)\b/i.test(title)) return null
if (slug==='space-exploration' && !(missionNumber || SPACE_NOUN.test(title))) return null  // bare 'apollo' is an old master
if (slug==='space-exploration' && sigWords(title).size < 3 && !entity) return null   // '[Apollo 11]' carries no information
// identity: entity OR title-derived (curated regex lists: ~30 meteorite names + types; ~30 genera;
//   ~20 instrument types; missions with roman-numeral normalization apollo xii == apollo 12)
admit iff sameSlug ∧ sameCanonForm ∧ sold ∧ !leakedArt ∧ (entityMatch OR titleIdentityMatch)
  // fossils ONLY: fallback admit on ≥3 significant-word overlap when anchor has NO identity (+76 reads, same err profile)
score = 3*entityMatch + 3*identityMatch + wordOverlap; pool = top 24 by score, then recency
if (pool.length < 3) return null
if ((q3−q1)/med > 2.5) return null
if (estMid && (med > 5*estMid || med < estMid/5)) return null
```
Measured: 179/3,545 sold science anchors → ~1,366 (5.0%→38.5%, 7.6×); med|err| 50–55%, 79–84% within ±100%; worst residual capped 1,040–1,234% (from 227,281% naive). REJECTED by measurement: flown-parity gating (med|err| 61%→66%), word-overlap admission outside the fossils fallback (the 227,281% class). Zero flags gained/lost by construction. Live book has 0 science lots today — impact begins at the next Christie's science sale.

### 2.6 CULTURE — `cultureReferenceBand` (additive, CANNOT flag) + engine exclusion
```
CULTURE_SLUGS = {movie-tv, music-memorabilia, entertainment-memorabilia}

// EXCLUSION (in compPoolRead, before anything): culture slugs never enter the frozen engine —
//   (a) repeated subject-header titles ('walt disney studios' ×368, 'the beatles' ×295) pass the current
//       nt≥8/≥2-token edition gate and would mint false very-high editions;
//   (b) simulated flags: n=2,008, 61.7% beat, median realized/estMid 1.20 < 1.25 premium break-even — negative edge;
//   (c) the band (medAbsErr 0.61) is 2× WORSE than the specialist estimate (0.32) where estimates exist.
if (CULTURE_SLUGS.has(lot.artist)) return null;

cultureReferenceBand(lot, allLots):   // shape mirrors soldCompBand; confidence ALWAYS 'low', label ALWAYS 'reference'
  sold = culture-slug sold+priced, id!=lot.id, source!=='sothebys-algolia'   // pooled across all three slugs
  // TIER E (edition-like) — GOLDIN ONLY (measured to FAIL at Christie's: 0.60/47.3% vs Goldin 0.25/85.2%):
  if (house(lot)==='goldin' && distinctiveTokens(nt) >= 5) {
    same = sold where normalizeTitle === nt
    if (same.length >= 3 && IQR/med <= 2.5) return band(same, tier:'edition-like')
  }
  // TIER R (reference): axes from crawl-stamped subjectKeys/itemClass (§3.4):
  if (subjects.length === 0) return null                     // abstain — no identity, no stranger pools
  pool = sold where subjectsIntersect && itemClass EQUAL     // STRICT class gate: loose variant degrades within-2× 72.3%→66.5%
  if (itemClass === 'other') require pool.length >= 6        // 'other' is the weakest cohort (0.58 / 52.6% within 2×)
  cap 24 by titleWordOverlap then recency; floor ≥3; IQR/med ≤ 2.5; ±5× est sanity when estimate exists
  return band(pool, tier:'reference')
```
Subject-extraction stoplist ships with the extractor: house-header pseudo-subjects ('film stars and entertainers', 'walt disney studios'-as-header ×373, 'various artists') are sale categories, not identities. Measured: 0 → 6,080/17,862 anchors banded leave-one-out (honest prior-sales-only: Goldin 16.7% @ 0.42, Christie's 25.1% @ 0.68 — quote THESE numbers, not the headline); Goldin edition-like core 0.25 / 85.2% within 2× on a population (9,150 estimate-less anchors) the estimate engine can never touch. 6 of 17 current live culture lots band immediately. Flags: 0 by design and by measurement.

---

## 3 · CORPUS-NORMALIZE HEALING PASS SPEC (scripts/lib/corpus-normalize.ts)

New `normalizeCorpus` order (existing passes keep their positions; new passes marked ★):
```
1  clampImpossibleYears
2  rerouteScienceMisroutes
2b rerouteRelicCards
2c ★ normalizeArtCategory          // category re-derivation (classification report, precision 98.8→99.4%)
3  enrichWatchReferences
3b ★ recoverPlayerSlugs            // game-used identity, sold AND upcoming in ONE pass, one function
3c ★ stampCultureAxes              // subjectKeys[] + itemClass for culture slugs (extractors from scripts/_qa/culture-lib.ts)
4  reconcileSaleDates
5  ★ restampIdentityKeys           // MUST RUN LAST — after every category flip and with the current classifyForm
```

### 3.2 `normalizeArtCategory` (★2c) — exact rules
Scope guard: `ART_MARKET_MAKERS` only (kills the Nakashima provenance FP; design/watch/science/sports rows never touched). Test string `s = title + '  ' + medium`.
```
// regexes verbatim from the classification report:
PRINT_PROCESS, PLATE_FROM, FROM_SERIES (TITLE only, provenance-guarded), EDITION_STRONG (bare 'numbered' BANNED —
  Warhol 'numbered VF 115.034' estate stamp, a $64K painting, was the measured FP), bareEditionFraction (den≥8, num≤den,
  den≤3000, size-fraction '31 1/2' excluded), ORIGINAL_STRONG (never-touch superset), OIL_CANVAS, EDITION_ANY

if category==='original':
  if ORIGINAL_STRONG(s): skip
  if any print cue: category='print'; lot.catReclass='o2p'; restamp formKey        // 169 rows; 79 auto-proof
else if category==='print':
  if PRINT_PROCESS(s) || PLATE_FROM(s) || EDITION_ANY(s): skip                     // Madoura ceramics, porcelain multiples
  if OIL_CANVAS(s): category='original'; lot.catReclass='p2o'; restamp formKey     // 16 rows incl. six >$1M oils
```
Idempotent and ping-pong-free (ORIGINAL_STRONG ⊇ OIL_CANVAS). `catReclass` persists to client shards — it feeds H3 + flag suppression (§1.2/§1.3). Impact: 185 rows (0.094% of corpus); 122 sold-priced rows leave original-2d pools where they sit ~20× under the true medians (matisse $6,075 vs $118,825; picasso $4,472 vs $110,682); ~14 seven-figure oils leave print candidate pools; the live Matisse Jazz plate's false high-conf $6,358 appraisal (n=24, pool = its own mislabeled siblings) dies. Do NOT extend to the 309,817-row sold-archive (title-only; precision unmeasured there).

### 3.4 `recoverPlayerSlugs` (★3b) — game-used identity
One function, both sides, same pass (atomicity is load-bearing: an intermediate probe with mixed old/new key schemes dropped live bands 77→10).
```
recoverPlayerSlug(title):
  s = cleanGoldinTitle(title)
  s = s.replace(/\|.*$/, ' ')                                   // pipe suffixes
  s = s.replace(/[‘“][^‘’“”]*[’”]/g, ' ')                        // curly-quoted 'moments'
  s = s.replace(/(^|\s)['"][^'"]*['"](?=\s|$|[,.])/g, ' ')       // straight quotes — BOUNDARY-paired only (never sever O'Neal / Ja'kobe)
  drop leading ' - ' segments while (tokens<=5 && (/\d/ || /finals?|game|round|series|conference/i))
  skip leading month tokens and digit-leading tokens             // "Oct. 17, 2010", "'97"
  per token (max 3): NFD-strip diacritics (kukoč→kukoc) → keep [a-z0-9'’.-] → strip trailing [.,] → strip possessive /['’]s$/
  break on digit token · STOP word (test the hyphen HEAD: 'game-used'→'game') · TEAM word (city+nickname, big-4 + major soccer)
  exception: TEAM word as FIRST token + plain surname = a name (magic johnson); else abstain (orlando magic team ball → null)
  require ≥2 kept tokens → playerSlugOf(join)
Card-brand titles (Upper Deck/Panini/Topps lead) keep the parseCard route — never run the extractor on them.
```
Stamps `playerSlug` on game-used rows where missing (overwrite policy: overwrite existing stamps too — old stamps are the measured garbage 'jayson-tatum-boston'/'christmas-day'; 97.8% prefix-agreement where both parse). Measured: sold identity 2.5%→93.9%, live 94.2%. **Build canary: fail the build if sold game-used identity coverage < 85%** (TEAM/STOP lists are maintained lists; Sotheby's title formats already vary).

### 3.5 `restampIdentityKeys` (★5) — formKey re-derivation, every lot, every build
```
for lot in lots:
  fresh = classifyForm(lot)                       // current ladder, incl. the design plural rescue (§2.4 Gate 2)
  if (lot.formKey !== fresh) {
    // sports-slug shield: don't stamp 'jewelry' minted by the set-of gate on e.g.
    // 'complete set of chicago bulls championship rings' (measured latent FP)
    if (SPORTS_SLUGS.has(lot.artist) && fresh === 'jewelry') { lot.formKey = undefined; continue; }
    lot.formKey = fresh;
    if (lot.category === 'object') lot.objectClass = objectClassOf(lot);
  }
```
Today corrects exactly 22 stale rows (6 watch — incl. the live Cartier Ellipse ring set flagged +52% off a wristwatch pool; 15 science; 1 sports); permanently prevents classifier-version drift (ray-crawl.ts:3594 only stamps rows the crawl touches; assemble sees the whole corpus nightly). Cost: one WeakMap-cached pass, <60s measured on 196K rows.

**Shard regen (same release):** regenerate `public/data/ray/lots-*.json` through current `slimForClient` so `formKey` (and `catReclass`, `playerSlug`, culture axes) actually survive — the served shards carry 0/196,407 formKey today despite corpus-io.ts:102 intending otherwise. Smoke-check ComparableModal/LotPage consumers.

---

## 4 · ORDERED IMPLEMENTATION CHECKLIST + VALIDATION PLAN

Every step lists the gate metric (must improve) and the guard metrics (must not regress). All backtest harnesses already exist in `scripts/_qa/` — note the art/design numbers come from verified replicas (art: 150/150 exact match vs shipped; design: 0.2% read drift); **any edit to comps.ts invalidates the clones — re-verify the replica match before reusing a probe.**

**Step 0 — close the open measurement (blocking for step 1).** Rerun `scripts/_qa/classification-normalize-spec.ts` to completion (~20–40 min; its per-artist before/after reads/flags/medAbsErr table was still computing at deadline). Gate: flipped-artist hindsight error must not regress vs the audit2-art 0.46 baseline.

**Step 1 — corpus healing (corpus-normalize.ts): passes 2c, 3b, 3c, 5 + shard regen.**
Validate: 185 category flips ±5; formKey drift 22→0 (`classification-drift.ts`); game-used sold identity ≥ 93% (`game-used-coverage.ts`), canary wired at 85%; the 3 upcoming art flips still value=null-or-honest-print-read (they are value=null today, so zero live flags may be lost); bonhams-31913-7 no longer flags; shards carry formKey on 100% of rows.

**Step 2 — shared core (comps.ts §1): `flagEligible`, H1–H3 hooks, culture exclusion.**
Validate: art 1500-sample flag beat ≥ 85.5% (baseline 415 flags @ 85.5%); culture reads in the frozen engine go 80→0 by design (removing the medAbsErr-0.68 cohort and its 52 flags); no other vertical's read count moves.

**Step 3 — comparableTo gates: watches material (strict), art area 2.5, art series abstain.**
Validate (watches, 2,500-anchor seed-42 sample, `watches-backtest.ts`): medAbsErr 0.311→≤0.302, hi-conf 0.293→≤0.287, reads ≥ 1,650 (−3.4% budget). Validate (art, 1500 sample, `art-4-final.ts`): reads ≥ 830 (835 baseline, −0.6% budget), medAbsErr ≤ 0.425, flag beat ≥ 85.5%. Guard: live watch/art read-coverage after deploy (sold dims 7.4% vs live 73.2% — the area gate will prune MORE live comps than backtest shows; alert if live art read-coverage drops >3pts).

**Step 4 — design: Gate 1 (set normalization) + Gate 2 (plural rescue) TOGETHER (Gate 2 alone worsens set mixing inside seating-chair), Gate 3 demotion; stage behind the digest diff.**
Validate (`design-backtest.ts` / `design-gates.ts`, 7.3k reads): overall medAbsErr 0.385→≤0.380; set-anchor mixed-pool signed err from +0.170 to |≤0.05|; single-anchor set-heavy from −0.151 to |≤0.05|; belowWin ≥ 74% (baseline 75%); reads 7,314→≥7,300; the audit2-design Above Market catastrophes (+2.4 to +5.4) must disappear from the flagged set. Re-fit S table at the next Sunday full-truth pass.

**Step 5 — game-used soldCompBand (objectType gate + OBJECT_TYPE_RULES ball fix).**
Validate (`game-used-final.ts`, 300 sampled sold anchors): bands 0→190±10 (65%), err.med ≤ 0.37, p75 ≤ 0.68; high-tier err.med ≤ 0.34; live book bands 0→~76/567 (13.4% — the Goldin-history ceiling, do not chase higher); zero flags emitted (structural).

**Step 6 — science `scienceReferenceBand` + culture `cultureReferenceBand` + reference-band UI (range, 'reference comps' label, pinned low, excluded from dealScore/value/beat-rate).**
Validate: science hindsight coverage 179→1,300±100 with per-slug within-±100% ≥ 79% and worst residual ≤ 1,300%; culture LOO bands 6,080±200 with Goldin within-2× ≥ 72% and tier-E ≥ 85%; grep-level assertion that `signalWithPool`/`dealScore` have no code path into either function; 0 flags from both tiers on the full live book.

**Step 7 — audit re-run.** Regenerate `audit-summary.json` / `audit2-*.json`. Must-improve: game-used bands (was 0), science bands (scientific-instruments was 0/120), watches formMatch 0.5→1.0, culture reads present as reference bands. Must-not-regress: audit2 medAbsErr per vertical (art ≤0.46, design ≤0.44, watches ≤0.42); total live flag count may DROP (that is the point — the drops are enumerated dishonest classes: sniffed-art, model-name-watch, culture).

**Step 8 (deferred, in priority order):** (a) watches era/recency gate — **MEASURED AND DECLINED Aug 30 2026** (`scripts/_qa/era-gate-loo.ts`, build-side engine, 4,000-anchor LOO: ±15y touched-read err 35.8%→36.2%, ±10y −1.3pt touched for 73 lost reads — under the ≥2pt bar; the 1,500-anchor run showed a phantom −2.5pt win, so any re-litigation needs n≥4,000). Same pass adopted the build-side ART area gate at ≤4× (`scripts/_qa/dims-gate-loo.ts`: touched 95/2,185 reads 49.4%→39.9%, aggregate 45.4%→44.9%; ≤2.5× — this spec's client band — measured WORSE there; design/watches declined) — wired in `app/lib/similarity.ts`; (b) Goldin sold history → client shards or server-side band precompute vs the 507K R2 corpus (worth ~5× the game-used parser's live yield); (c) crawl-stamp dimensions + design modelKey (unlocks the currently-blind 2.2× length gate: fires on 29.8% of pairs when it can see, sees 0.28%); (d) meteorite weight parsing (the biggest unexploited within-identity lever for science bands).

**Global regression tripwires (every step):** repeat-sales card index untouched (no card-path file is modified); `signalMagnitude`/`dealScore` semantics unchanged; edition path precedence unchanged; flag beat definition (realized ≥ estMid, premium-flattered ~1.25×) used ONLY for A/B deltas, never quoted as an absolute win rate.

---

## 5 · SEP 2 2026 ENGINE AUDIT — WHAT SHIPPED (amends §1–4 and supersedes ENGINE_LANES cut-list #12 for the backtest/calibration items below)

All file references are the shipped code; every number is measured on the local Aug 14 corpus snapshot (1.10M lots, 283k backtest targets).

### 5.1 The backtest lives again (P0-1)
- **Exact candidate pre-filter** — `scripts/backtest-core.ts` `candidatePriors`: per-maker inverted index; a prior is a candidate only if it shares a token from the target's heaviest-IDF prefix (suffix-norm bound: cosine ≤ ‖a_shared‖/‖a‖ < 0.45 ⇒ inadmissible) or its exact ref/edition key. Necessary-condition filter, **byte-identical results** (2,421-target stratified harness, diff = 0). Throughput 31 → **459 targets/s**; culture 148 → 2.3 ms/target. Root cause of the "40→4/s past 160k" collapse: the RR archive's 228k-lot entertainment-memorabilia roster, not array growth.
- **Rehydration instead of forced rebuild** — `rehydrateState`: `pf = r·cr − 1`, `fl = cr ≥ 1.3` (the uncalibrated legacy labeler), `et = 'b'` pre-Aug-14, `sd` from the frozen `nowMs` anchor, `kt` by (market, sale-day) cohort lookup. Local: all 85,515 legacy rows repaired; byMarket went from n:0 everywhere to art 18,002/16,480, watches 13,028/20,625, design 3,197/3,450, science 802/819, culture 1,996/2,611, sports 2,292/3,682 (flagged/unflagged).
- **"New" keying** — `build-backtest-incremental.ts`: never-attempted (`scoredIds ∪ triedIds`) AND (closed inside the trailing 120-day window OR `firstSeen` after the prior run). Nightly budget 80k, chunked oldest-first. Late-posted results are no longer dropped.
- **Per-market legs** — `build-backtest.ts --market <m> --leg-dir …` and `--merge`; `mergeStates` is exact (order-free accumulators). Design leg: 17.5k targets in 22 s wall (incl. 18 s corpus prep). Incremental (3.5k targets after rehydration): **34 s wall**.
- **Exit codes** — both entry points exit 1 on any failure; `assertRecord` refuses an empty summary; state writes are atomic (tmp + rename).
- Workflow changes are in `docs/ENGINE_WORKFLOW_PATCH.md` (blocking job, leg matrix, stale-record check, validate-engine gate).

### 5.2 Point-in-time calibration (P1-1)
`replayTargets` scores in saleDate order and calls `setCalibration(calibrationFor(state, quarterStart))` at every calendar-quarter boundary — the calibration is refit from observations dated strictly before the quarter (≥500 rows, else the hardcoded holdout fallback). The record now measures the engine production ran. `ENGINE_VERSION = '2026.09.02-pit-cal'`; rows carry `ev`; `backtest.json.rowsOnVersionPct` shows how much of the record is on the current labeler (1.7% until a full leg run).

### 5.3 Out-of-sample band coverage (P1-2)
`calibration.bandCoverageOOS[market] = {high, medium, low, nFit, nTest, split}` — fit on the older half of that market's rows (its own median sale day), tested on the newer half; per-market tier bands (`calibration.bandByMarket`, n ≥ 150 per tier) with the global band as fallback, and the engine reads `bandByMarket[market][conf] ?? band[conf]`. Local (global-split run): all 81/78/73; art 72/73/69; watches 86/78/72; design 83/79/76; science —/66/68; culture —/—/85; sports —/74/61. **The in-sample `bandCoverage` (70/70/70 by construction) must no longer be cited as "70% of the time" — the UI should print the OOS figure for the lot's market.**

### 5.4 Card-comp tier honesty (P0-2) — `scripts/build-market.ts` §3e
Tier 1/2 pools now use a **1-year half-life recency decay** (they used every sale ever); the **band is the pool's own 15/85 lerp dispersion** (`[min,max]` at n=2) instead of `low = high = value`; **n=2–3 exact → 'medium'**, n ≥ 4 → 'high'; tier 2 grade-adjusts EVERY rung to the target grade (all rungs vote) instead of nearest-rung only; bid reads go through `vsBidRead` (all-in). Venue clamp stays ±10% unless a house has ≥300 cross-house observations (then ±20%) — the Aug 25 build had five houses pinned at the clamp; raw shrunk factors are logged. The forward tape grades per tier: `calls-ledger` card calls carry `s` = `x` exact / `g` grade-adj / `p` player / `t` tcg / `m` raw median, and `callsRecord.card.byTier` publishes each at 20 graded.

### 5.5 One floor rule (P1-4)
`app/lib/lanes.ts` `valueFloor(lot)` (value.low at non-low confidence, else 0.85 × cardComps.med at n ≥ 3) is called by `gapRead`, `build-upcoming` (bidProj stamp — was ungated) and `close-board`.

### 5.6 Basis (P1-5)
- `app/lib/premiums.ts` `inferHammerUsd(lot)`: published hammer, else realized ÷ the lot's own premium factor. Used by `indices.ts` houseAccuracy, `build-market` houseCal + seasonality, `backtest-core` hammer perfs. No flat `/1.25` remains in owned files. **Still flat in a file not owned by this pass:** `scripts/sub-markets.ts:154` (`price / 1.25`) — switch to `inferHammerUsd`.
- `value.ts` `vsBidRead`: the bid is grossed to all-in before the ±12% comparison (a raw hammer bid read ~20% "below comps" on every lot). Shared by the hedonic path and all card/TCG tiers.
- `value.ts` `basisNote(kind)` exports the caption strings: `estimate` → "all-in realized vs hammer-basis estimate — the gap carries the buyer's premium by design"; `bid` → "bid grossed to all-in (house premium) vs all-in comp value"; `value` → "comp value is all-in (median of premium-inclusive realized prices)".
- **UI captions that must change (owned by the UI agent):**
  - `app/opengraph-image.tsx` — "hammered +41%" is an ALL-IN figure; either say "realized +41% vs estimate (all-in)" or print the hammer-basis `flagged.hammerMedianPct` (+13%).
  - `app/components/MethodologyNote.tsx` — the 30%/20% thresholds sentence must carry `basisNote('estimate')`.
  - `app/components/analytics/ArtistRankingsTable.tsx`, `TopSales.tsx` — "premium divided out" is false where hammer is inferred; caption: "hammer where published, else realized ÷ house premium schedule".
  - `app/components/analytics/PortfolioHeader.tsx`, `ArtistSparklines.tsx` — the second stat compares all-in to hammer-basis; caption with `basisNote('estimate')`.
  - `app/components/ComparableModal.tsx:104` — "70% of the time" → the market's `bandCoverageOOS` figure.

### 5.7 Abstain reasons (P1-6)
`estimateValueEx` returns `{ value, abstain }` (`AbstainReason`: `pool<3`, `no-candidates`, `no-identity`, `dispersion`, `no-value`, `card:pool<2`, `card:player<5`, `tcg:pool<2`). `build-market` stamps `lot.abstain` when `value` is null (and deletes it when a value lands); card/TCG tiers stamp partial reasons on the ValueResult (`abstain: 'card:player-median-context-only'`). `slimForClient` keeps the string, so served rows distinguish abstained from never-ran. `estimateValue` (null-returning) is unchanged for every other caller.

### 5.8 Gates with teeth (P1-8)
- `scripts/validate-engine.ts`: markets derived from `ARTISTS`; runs through `backtest-core.valueOne` (production replay path); gates G1–G4 (see file header); exits 1 on failure; `--sample`, `--market`, `--json`.
- `scripts/assemble.ts` sentinel: poison signature = price ≥ $1,000 repeating ≥ 15× with ≥ 60% on one saleDate AND `price ÷ premiumFactor` not a round increment (`premiums.isRoundIncrement`, absolute ±$1 tolerance on a 50/100/500/1000 step by size); `::warning::` per signature, `meta.json.sentinel.signatures[]`, exit 1 at ≥ 2 distinct poison signatures (`RAY_SENTINEL_WARN_ONLY=1` override).
- `scripts/build-market.ts` coverage floor: fails if valued-upcoming drops > 40% vs the prior `market.json.coverage` while the book held ≥ 60% of its size (`RAY_SKIP_COVERAGE_GATE=1` override). `market.json.coverage = {upcoming, valuedUpcoming, hedonicValued, cardValued, abstained}`.

### 5.9 P2 items
- **One quantile** — `value.ts` `quantile()` (lerp on a sorted array) imported by `comps.ts` (5 dispersion sites), `backtest-core` bands, `emit-value-book`, `validate-engine`.
- **Sleeper band basis** — `lanes.ts` `sleeperRead` compares all-in cvu to `estMid × lotAllInFactor`.
- **Per-market confidence** — `calibration.mdape[market][tier]` (median |1/r − 1|); the engine demotes 'high' > 30% and 'medium' > 50% one notch in that market (`CONF_MDAPE_CEIL`). Local: sports high 0.483 and culture high 0.388 demote; science/culture/sports medium demote.
- **FX** — `normalize.ts` 2025/2026 rows replaced (GBP 1.270/1.330, EUR 1.080/1.150, CHF 1.190/1.250, AUD 0.645/0.700, CNY 0.139/0.145, HKD 0.128); sources in the comments. Re-stamp 2026 with the full-year average in Jan 2027.
- **Point-in-time IDF** — documented decision to keep the full-corpus IDF (`backtest-core.ts` header above `prepare`): production itself values with the build-day IDF, the leak is a token-weighting effect not a price leak, and a per-period rebuild multiplies replay cost by the period count.
- **Removed** the dead `market.calibration` block in `build-market.ts` (no UI read it; every surface cites `backtest.json.calibration`).
- **Lane labels** — `SIGNAL_LABEL` exported from `value.ts` and re-exported from `lanes.ts`. Files that still hardcode the strings and should import: `app/makers/[slug]/page.tsx:257`, `app/components/ComparableModal.tsx:41-42`, `app/components/LotCard.tsx:211-212`, `app/preview/terminal/TerminalHome.tsx:186-187`.
- **TCG comp tier** — `build-market.ts` §3e: `pokemonKey` (year|set|#no|edition|GRADE) exact pool (n ≥ 2, 1y decay, dispersion band; n ≥ 4 'high' else 'medium', tier `tcg-exact`) and a cross-grade pool adjusted with the SPORTS grade ladder as a proxy (tier `tcg-grade-adj`, capped 'low', no vsBid) until a Pokémon ladder is fitted. Counts are logged as `[market] tcg value estimator`.
