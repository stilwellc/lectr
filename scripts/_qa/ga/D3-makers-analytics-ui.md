# D3 — GA UI Production-Readiness: Makers + Analytics + Dossier Pages

Date: 2026-08-03 · Auditor: Claude (pixels-first, then code) · Ships: tomorrow

Method: isolated dev server (working-tree clone with its own `.next` — the shared `.next` was being trampled by three concurrent dev servers, see Infra note), full-scroll slice screenshots with phase-2/3 + deep-pool waits, desktop 1440 + mobile 390 for the big three. Every fix below was re-screenshotted in situ after the change. `tsc --noEmit` clean.

Shots: `scratchpad/d3/shots/` (makers ×6, rolex/sports-cards/picasso dossiers ×5–8 each, analytics ×11, analytics/watches ×7, sub ×2 ×2, ref ×4 states, player ×4, mobile sets ×8–18, `verify-*` after-shots).

**Counts: 9 DIRECT FIXES applied · 9 PROPOSALS**

---

## DIRECT FIXES (mechanical, applied + verified in situ)

### F1. Mobile /analytics microstructure panels blew out the viewport — grid/ResizeObserver feedback loop
`app/analytics/page.tsx` (`.ray-desk-microgrid`)
At 390px the Sell-through / Market depth / Calendar / House-calibration panels ran away to ~600px and bled off-screen (clipped method lines, cut calendar columns — see `analytics-m-03.png`). Cause: a `1fr` grid track's *minimum* is the item's content width, and HeroChart's ResizeObserver-sized `<svg width={W}>` feeds back into that minimum (svg width → track min-content → bigger measure → wider svg). Fix: `.ray-desk-microgrid > * { min-width: 0 }`. Verified: probe shows `docW: 390`, only the house matrix's intentional internal scroller wider; `verify-micro-m.png` shows all four panels contained.

### F2. SubMarketDrills panel was unstyled on dossier pages (no padding, title run into method line)
`app/components/analytics/SubMarketDrills.tsx`
The panel leaned on `.ray-vm-card/.ray-vm-head` styles that only exist because **VerifiedMovers** injects them — VerifiedMovers never mounts on `/makers/<slug>`, so the watch "Model families" panel and the art/design "market this maker trades in" panel rendered zero-padding with "Model familiesRolex sub-markets · performance by family" as one run-on line (`probe-rolex-families.png`). Fix: self-contained `.ray-dr`-scoped rules — the exact pattern HouseMatrix/SeasonalityStrip/GradeLadderPanel already use for the same reason. Verified `verify-families.png`.

### F3. Dossier feature cards (References / Most-traded names) had no card padding
`app/makers/[slug]/page.tsx` (`DOSSIER_FEATURE_CSS`)
Same missing-VerifiedMovers dependency: `.mkr-panel.ray-vm-card{padding:var(--card-pad)}` added. Verified `verify-refledger.png` / `verify-playerstrip.png`.

### F4. RefLedger printed raw refs.json keys
`app/makers/[slug]/page.tsx` (RefLedger)
Rows read `oysterperpetual`, `oyster`, `cellini` while `/ref` prints "Oyster Perpetual" / "Ref. 1675". Now uses the same `refLabel()` util the ref dossier h1 uses. Verified.

### F5. PlayerStrip printed the lot count twice per row
`app/makers/[slug]/page.tsx` (PlayerStrip)
"Shohei Ohtani 138 lots … 138×" — the meta column duplicated the sub-label figure on every row. Meta column removed; name + n + median remain.

### F6. CalibrationCurve was double-railed — inset ~28px relative to its sibling engine panels
`app/components/analytics/CalibrationCurve.tsx`
Its only mount (analytics engine section) already wraps it in a `.rail` div; its own `rail` class double-applied the gutter (visible in `analytics-02.png` — "What a flag is worth" out of alignment with the record/grade-curve cards). `rail` dropped. Verified aligned in `verify-cal.png`.

### F7. Dead standalone frames deleted from the three Distributions tab charts
`CategoryBreakdown.tsx`, `AuctionHouseDistribution.tsx`, `PriceDistribution.tsx`, `Distributions.tsx`
Verified: all three are mounted **only** via Distributions' tab row, always with `embedded` — the standalone `<section>` frames (with off-grammar `--font-serif` h2 headings) were unreachable. `embedded` prop and dead paths removed; components are card-only now, mirroring SportBreakdown's existing shape. (This was the flagged CategoryBreakdown/AuctionHouseDistribution item — confirmed dead, deleted.)

### F8. RefPage carried a duplicate copy of the useRefs hook
`app/components/RefPage.tsx`
An inline `useRefs` + `RefEntry` + module cache, byte-for-byte semantics of `app/hooks/useRefs.ts` (which the watch-dossier RefLedger mounts). Two module caches = refs.json (1.9MB) fetched twice per session for a reader who visits both surfaces. Now imports the shared hook; `RefEntry` re-exported for compatibility. tsc clean.

### F9. RelativeStrength method line repeated its own title
`app/components/analytics/RelativeStrength.tsx`
"Relative strength" (title) · "relative strength · CI-verified…" (method) → leading duplication trimmed.

---

## PROPOSALS (judgment — not applied)

### P1. Dossier flow: the live-activity chips are orphaned from the section they describe
`app/makers/[slug]/page.tsx` — ValueEnginePresence + MovingNowSummary render after the drills/decade blocks, as bare chips floating between panels ("773 live lots moving now · +2,413 bids recently" sits under the decade band's caption, two screens above the Upcoming grid it summarizes — `dossier-sportscards-01/m-02.png`). Propose: render both summaries inside the `#upcoming` block, directly above `UpcomingLots` (they already deep-link `#upcoming`). This is the single change that most makes the wave-2c blocks read as one dossier instead of stacked modules.

### P2. "The maker's decade" on sports-cards reads as a market crash
3 qualifying years (2023 → 2026, ~$200K → ~$400) — pure source-mix (RR 30-yr archive high-value rows vs Goldin volume), honestly captioned but the *picture* screams −99.8%. A "decade" band with 3 points shouldn't print. Propose: raise the gate from `points.length < 3` to `< 6` (or suppress on bid-market/archive makers when the house mix across years isn't stable). Ships-tomorrow risk: this chart is the most alarming pixel on a flagship dossier.

### P3. Dossier panel framing is split-brained: boxed vs bare
Most-traded names / References / vertical-context drills = bordered cards; The maker's decade = bare rail strip; then "Price history" switches to the Fraunces display head. Propose one rule for the wave-2c blocks: give MakerDecadeBand the same `.ray-vm-card glass glass-quiet mkr-panel` frame as its siblings (one-line change, but it's a design call on the hero→panels→sections rhythm, so proposing).

### P4. /analytics: Relative strength rows duplicate The full book
The 12 leader/laggard rows reappear **identically** (same slug, figure, CI, n) in "The full book" ~2.5 screens below; at 'all' scope the book is ~94 rows / 3.5 screens (`analytics-04/05/06.png`). Verified movers does *not* overlap (maker-level vs sub-market-level) — keep it. Propose folding: give The full book a rank-sort header + the spread line and retire the separate RS card, or cap the book to the descriptive/unranked remainder with a "12 ranked above" foot. Saves a screen-plus of duplicated rows on the desk's main scroll.

### P5. /makers "All 39 names ↓" anchor targets a lazy-mounted element
`ArtistSparklines` links `/analytics#artist-rankings`, but `#artist-rankings` (ArtistRankingsTable) lives inside DeepPools and doesn't exist until phase-2 loads + the observer arms — the jump lands at the top of /analytics. Propose: on /analytics, arm DeepPools immediately when `location.hash === '#artist-rankings'` and `scrollIntoView` after the table mounts.

### P6. Player dossier names print ALL-CAPS
players.json stores `"MICHAEL JORDAN"`; PlayerPage h1 + FollowButton print it raw (grammar: sentence case — and the same athlete renders "Michael Jordan" in the dossier PlayerStrip from `lot.playerName`). Fix belongs in the players.json build (proper-case with particle handling), **not** display-layer `.toLowerCase()`-title-casing, which would corrupt LeBron/O'Neal/McGwire.

### P7. RecordPlate vitrine: a hung image hotlink leaves the 190px empty well indefinitely
`onError` + cached-failure ref handle dead links, but a request that never resolves (picasso's Christie's image, `ERR_TIMED_OUT` — `dossier-picasso-00.png` shows the blank framed well) shows an empty frame for the whole visit. Propose: paint the `.lectr-recplate-img` well only once the img fires `load` (cert-only until then), accepting the small layout shift, or a one-shot timeout that collapses to the certificate.

### P8. /analytics/<market> masthead stays corpus-global
On the watches desk the title still reads "Every market, read as one book." with the global 760,972-lot figure while every panel below is scoped (`analytics-watches-00.png`). Propose scoping title + lots figure when `activeKey !== 'all'` ("Watches, read as one book" · market lot count), keeping "On the book" as the deliberately-global cell.

### P9. /makers: VerifiedMovers card duplicates the roster cards' own verified chips
Page order is taxonomy directory → VerifiedMovers card → roster wall; the movers card's three rows (Cartier/Rolex/Patek) are the same CI'd reads already worn as `+24% 5Y verified` pills by those same three cards in the wall below (`makers-01.png` vs `makers-m-05.png`). Propose removing VerifiedMovers from /makers (keep on /analytics), tightening directory → wall into a two-beat page. Roster sort + compare controls themselves: placement/prominence read fine — no change requested.

---

## Page verdicts (pixels)

- **/makers** (desktop + 390): coherent. Masthead → taxonomy directory → movers → wall; directory cards and read-cells honest and consistent; mobile stack is clean; sort segs + compare toggle sit naturally above the wall. Only P9 ordering note.
- **Dossiers**: rolex — hero/record plate/families/references/price history flow well after F2–F4; sports-cards — strong except P1 orphan chips + P2 decade cliff; picasso — clean (P7 empty vitrine well when a hotlink hangs). Section-head grammar (quiet panel heads vs Fraunces "Price history") reads intentional once panels are consistently framed (P3).
- **/analytics** (desktop + 390 + /watches segment): panel rhythm is good — cards align after F6; deep-pools transition (kicker + paper certificate band) reads deliberate; grade curve/engine record/calibration form a coherent engine block; mobile fixed by F1. Duplication: P4 (RS vs full book); movers is genuinely distinct (maker-level).
- **/sub/cards/basketball** and descriptive `/sub/game-used/basketball`: both look intentional — the descriptive page's typical-$ hero + volume chart + record ledger carries thin data well. No empty-state work needed.
- **/ref**: deep (1675) and thin (patek 1215 n=10, 3738/100 n=8 — no chart, ledger carries the page) both intentional; unknown ref = branded 404 (static-export `dynamicParams=false`), acceptable.
- **/player?id=michael-jordan**: category ledger + market chips + trend + live/objects/recent all coherent; P6 caps-name is the one blemish.

## Infra note (not product)
All dev-server flakiness during this audit (vendor-chunk corruption, 404/500 flapping on 3000/3777) traced to **three concurrent `next dev` instances sharing one `.next` dir** during the parallel GA audits — audited around it with an isolated clone. Production static export is unaffected. Reminder: `next dev` needs `RAY_DEV_NO_EXPORT=1` for dynamic routes (documented in next.config.js).

---

**Final: 9 direct fixes applied (tsc clean, each re-verified in pixels). Top 3 proposals: P1 (attach the engine/moving-now chips to the Upcoming section — the one change that makes the dossier read as one document), P2 (n-gate "The maker's decade" harder — the sports-cards band currently draws a −99% crash out of source mix), P4 (fold Relative strength into The full book on /analytics — 12 rows print twice on the desk's main scroll).**
