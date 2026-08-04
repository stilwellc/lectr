# D2 · GA UI production-readiness — VALUE + LOT + MODAL

Audited as pixels on a local dev server (isolated clone on :3778 — four fleet dev
servers were corrupting the shared `.next`, so this audit ran against a private
APFS clone with edits synced in). Surfaces shot: `/value` full scroll at 1440,
1280 and 390; lot pages for a flagged Warhol textile (art), a live Goldin Jordan
rookie (card-comp + bid velocity + grade ladder), and an RR Darwin letter
(science); the comps modal opened from a /value ledger row (Wright/Jeanneret),
a Goldin sports card, a science lot, and a Warhol edition — desktop and 390
sheet. `tsc --noEmit` clean on all owned files. Screenshots in
`scratchpad/shots/` (session scratchpad).

## Direct fixes shipped — 9

1. **/value ledger: Hammers column truncated every long date** — 88px ellipsized
   "Aug 13, 2026" to "Aug 13, 20…" on most rows at both 1440 and 1280. Widened
   to 100px (`app/value/page.tsx` grid-template-columns). Verified in situ:
   dates now print whole.
2. **"+1 bids" → "+1 bid"** — bid-velocity pluralization on the LotPage
   certificate row (`app/components/LotPage.tsx`). Verified on the Jordan lot.
3. **Same pluralization in both LotCard variants** (chip text + title attr,
   two call sites, `app/components/LotCard.tsx`).
4. **"Ask" label over a bid-shaped value** — the RR Darwin lot printed
   "Ask — $4K bid · 9 bids". The label now follows the value's shape: any lot
   without a two-sided estimate and with live bids reads "Current bid"
   (`LotPage.tsx`). Verified in situ.
5. **Modal header image: empty well on hotlink-block** — a blocked photo
   (`onError` removed the img) left a bare 200px block; the Wright modal opened
   onto a black void. Applied the file's own comp-row-thumb pattern: serif
   initial always behind, photo overlays (`ComparableModal.tsx`). Verified: the
   "F" plate now shows through.
6. **Modal "· Object" category chip suppressed** — LotCard already suppresses
   `category === 'object'` ("Object" names nothing); the modal printed
   "RR Auction · Object". Now consistent (`ComparableModal.tsx`). Verified.
7. **Dead import `subCatLabel`** removed (`ComparableModal.tsx` — never called).
8. **Dead import `MarketStats`** removed (`LotCard.tsx`) and **unused `score`
   destructure** in the modal's comp-row map removed.
9. **Dead CSS rule `.lectr-lot-skel`** removed from LOTPAGE_CSS (`LotPage.tsx`
   — the skeleton only ever uses `.lectr-lot-skel-block`).

## The modal: hierarchy or pile? — verdict: hierarchy, holds

The worst case (card-comp lot: exact-sale + value + calibration + sub-market
lines inside the bordered panel, then exact-card sales + grade ladder, then
date, then 3 CTAs) still reads in registers: bold claim panel → faint
calibration/sub-market disclosure → evidence lists with muted headers → CTAs.
The 390 sheet stacks tall but never ambiguates who speaks. No mechanical
regrouping needed. (The empty-state and CTA-order nits are proposals below.)

## /value ledger — density verdict: good at both 1440 and 1280

The rail is fixed-width so both widths render identically; 8 columns + save
control land without collision, hover leader line reveals cleanly ("comps
median $15K vs $6K–$8K ask · 2.1× over · 65 sales") and collapses without
layout shift. Confidence dots render in the odds column where no calibrated
beatRate exists. The settled tape rendered 0 rows in current data (no
market-scoped flagged+realized lots) — placement unverifiable as pixels;
conditional render confirmed correct in code. Worst-year line sits correctly
under the record chart. Mobile ledger (390): the audited-good stack holds.

## Proposals (5)

**P1 — Card lot page: contradictory proof surfaces (top pick).**
The Jordan lot certificate says "This card — 13 sales, same card & grade —
$173K" while "The comps" section below prints *"No comparable sales clear the
gates for this lot — lectr doesn't manufacture a pool."* The modal already
suppresses the generic comps section for `value.basis === 'card-comp'`
(isCardComp); LotPage doesn't. Before: empty-pool sentence under a lot with 13
exact-card sales. After: in `LotPage.tsx`, when `lot.value?.basis ===
'card-comp' && (lot.cardComps?.n ?? 0) > 0` and `compRows.length === 0`, either
hide the comps section (ladder + This card rows are the proof surface) or render
`lot.cardComps.lastSales` as the ledger rows titled "This exact card · N sales".

**P2 — formatEstimate drops one-sided estimates.**
The Darwin lot carries `estimateLow: 10000, estimateHigh: undefined` — the
certificate and every card print only "$4K bid · 9 bids"; the house's own $10K
low never appears anywhere. Before: two-sided-estimate branch, else bid, else
fallbacks. After (in `LotCard.tsx` formatEstimate, between those branches):
`const oneSide = lot.estimateLow || lot.estimateHigh; if (oneSide && !(lot.currentBid && lot.currentBid > 0)) return \`from ${fmt(oneSide)} est.\`;`
— bid-led lots unchanged (the live bid stays the honest lead), estimate-only
lots stop reading "Estimate on request" against a published low. Touches the
most-repeated line in the product → needs sign-off.

**P3 — Modal empty state says nothing, twice.**
Science/uncalled lots print header "Context — 0 comparable sales (no call on
this lot)" AND body "No comparable sold lots found for this artist." Before:
both lines. After: when `comparables.length === 0 && !called && !band`, header
reads "Context — comparable sales"; body adopts LotPage's voice: "No comparable
sales clear the gates for this lot — lectr doesn't manufacture a pool." (One
message, one voice across surfaces.)

**P4 — Card lot certificate row order buries the price evidence.**
Current order: Current bid → Hammers → House → Player → Sub-market → Bid
velocity → This card → Last sold. The exact-card median ($173K vs $45K bid) is
the strongest line on the page and sits last. After: Current bid → This card →
Last sold → Hammers → House → Player → Sub-market → Bid velocity (price context
adjacent to price; logistics after).

**P5 — Mobile /value rows: the date/urgency is swallowed by long titles.**
`.ray-value-mobdate` renders inline inside the single-line ellipsized title
span, so "· closes tonight" / "hammers Aug 13" vanishes on any long title
(most rows in the current data). After: under 900px give the date fragment its
own block line under the title (`display:block` on `.ray-value-mobdate` in the
mobile branch) — the urgency word was built (#12) but is currently invisible
almost everywhere it matters.

## Notes (no action)

- Reference-comps row (science/culture band) did not render for the sampled
  Darwin lot even fully loaded — `scienceReferenceBand` abstains on it; the row
  hides cleanly. No dead-row states found on wrong lot types anywhere.
- LotCard's three variants are consistent: photo card / compact row / monogram
  fallback all carry the same signal → soldComp → cardComp → estimate cascade;
  save button states correct in all three (filled fg / bg-elevated / overlay).
- CallPlate compact on /value reads clean; its PriceBand slot legitimately
  no-ops when `signalWithPool` declines the call lot.
- `/value` settled tape absent in current data — not a bug; re-check post-crawl.

**Final: 9 direct fixes · top 3 proposals: P1 (card-lot comps contradiction),
P2 (one-sided estimates dropped), P3 (modal empty-state dedupe).**
