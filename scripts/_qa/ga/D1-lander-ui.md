# D1 · Lander/Home UI production-readiness (GA)

Surface: `app/preview/terminal/**` (TerminalHome mounted at `/` + market landers `/culture`, `/sports`, …).
Method: full-scroll Playwright screenshots at 1440 and 390 of `/`, `/culture`, `/sports`, before and after every change; `tsc --noEmit` clean; final CSS re-validated with postcss.

## Fixes applied (mechanical) — 11

### Dead weight
1. **`style.module.css`: 2,110 lines of dead CSS deleted (3,878 → 1,768).**
   Definitive audit: every class selector greppped against all terminal `.tsx/.ts`
   (`styles.X` + `styles['X']`, no dynamic access exists). 258 unused local
   classes → 522 dead rules, 9 emptied media queries, 7 orphaned keyframes
   (`pulse`, `tapeScroll`, `mLive`, `paperTickFall`, `tickFallA/B`,
   `ttTerminusPulse`), and their orphaned section banners. Covers the full
   named families (`moversBand*`, `moverCell*`, `verifiedStrip/Row*`,
   `condensed/subTable/subRow`) plus older abandoned compositions
   (`bento*`, `plaque*`, `plate*`, `record*`, `readCard*`, `mob*`, `tape*B`,
   `guarantee*`, `edge*`, `flag*`, `ci*`, `chart*` after MarketChart's removal).
   `:global(...)` selectors and data-URI false-positives (`w3.org`) excluded.
2. **`MarketChart.tsx` deleted (365 lines + recharts usage).** Unmounted since
   the HeroChart rebuild — only its `IndexPoint`/`ChartLayer` *types* were
   imported. Types re-homed as local aliases of `HeroChart`'s `HeroPoint` in
   `IndexHero.tsx:41-50`.
3. **Legacy duplicate `.tape` / `.tapeLabel` rules removed** (old hairline-ticker
   grammar sharing class names with the live board — was applying an edge-fade
   `mask-image` and a green `--color-up` label color onto Room A's tape;
   `style.module.css` old lines 329–353).
4. **`hooks.ts`: unused `fmtDelta` removed.**
5. **`VerticalGhost.tsx`: unused default export removed** (+ its `.ghost` CSS
   block, ~45 lines). `GhostGlyph` (consumed by MarketSwitch) kept; stale
   header comment rewritten to match.

### Broken / awkward edge states
6. **Culture & science mobile board rendered ZERO rows** — an empty cream panel
   over a lone "Show 17 more". The mobile collapse filtered to
   `readType === 'index'` rows, and those markets are 100% descriptive.
   Fallback to the capped list when no index rows exist
   (`SubMarketBoard.tsx:507-515`). Verified at 390: 8 full rows + "Show 9 more".
7. **Chapter numbering with no engine call** — landers without a flagged hero
   (culture) printed "02 · The markets / 03 · The receipt" with no 01.
   Chapters renumber when `hero` is absent (`SubMarketBoard.tsx:544,656`).
8. **Engine-hero dead image left a large blank mat** (observed live on `/` —
   Wright-hosted image). Added the feed-thumb fallback grammar: a serif
   monogram under the photograph, `onError` hides the img
   (`SubMarketBoard.tsx` EngineHero; `.ehImg`/`.ehMonogram` in CSS). Verified:
   "W" monogram on the mat instead of void.
9. **Board blurb claimed content it doesn't show on scoped landers** —
   `/culture` said "17 sub-markets — cards by era and sport, watch model
   families, art and design kinds". The enumeration now prints only at `all`
   scope (`SubMarketBoard.tsx:558-561`). Honesty-doctrine fix by omission; no
   new copy invented.

### Spacing / truncation bugs (visible in screenshots)
10. **Tape-row label crush** — culture desktop labels truncated to
    "Signe…/Autog…/Spac…"; home rows to "Vintage cards (…". Right column
    capped at `fit-content(42%)` so long descriptive values wrap; labels get a
    2-line clamp before ellipsis (`.tapeRow` grid, `.tapeLabel`). Verified:
    "Signed photos", "Presidents & political", "Vintage cards (pre-1980)" all
    legible, CI beams aligned.
11. **390px collisions** — first board row printed "REPEAT-SALE INDEXCI +104…"
    as one unbroken run (nowrap tag overflowing its column). Mobile tape grid
    → `minmax(0,1fr) fit-content(55%)`; the readType tag now wraps instead of
    truncating (it's an honesty label — "DESCRIPTIVE — …" was dropping
    "NO INDEX"). Verified clean at 390.

### Edge states audited, no fix needed
- **0-result feed** (desktop + mobile): Flick glyph, "Nothing on the block
  matches that.", "Clear the lenses", toolbar "0 of 3,664 · Clear" — clean.
- **Tonight's Wall stand-down**: <3 loadable images → the whole section +
  its seam collapse with no residue (verified on `/` where hero-lot images
  were blocked).
- **Feed image-fail**: monogram plates hold in both table and row variants.
- **Below-market = 0**: mobile stat prints an em-dash tile; desktop rail row
  prints "—". Consistent.
- `tsc --noEmit` exit 0 after all edits.

## Observation for the data desk (not a UI fix)
- Home (`all`) settlement slip prints **"Median hammer vs estimate 0%"** over
  741,521 sold. `fmtSignedPct(0)` rendering exactly flat across the full
  corpus is plausible (RR archive lots without estimates are excluded) but
  reads like a bug at a glance — worth a cross-check that `overEstimatePct`
  isn't zeroing on a dominant cohort.

## Proposals (judgment — orchestrator to review)

1. **Tonight's Wall captions repeat one maker five times** (culture/sports:
   every plate reads "Entertainment & Icons" / "Sports Cards"). Current:
   `wallMaker` = ARTIST_LABEL + est line. Proposed: when all shown plates share
   a maker label, print the lot's `craftTitle` (one line, ellipsized) in the
   maker slot instead. Why: the caption line is the only text under the art;
   five identical strings waste it.
2. **Thin-market wall candidacy** — culture plates lead with "bid $10 / $14"
   under front-row framing. Proposed: on markets where the top image
   candidates are sub-$50 open bids, prefer estimate-carrying or flagged lots
   for the wall (fall back as today); or suppress the bid line under a floor.
   Why: $14 bids undercut "the strongest lots on the block".
3. **Three CTAs to `/value` on one scroll** — chapter 01 "See all value lots →",
   receipt "see the full record →", colophon "See the record ↗". Proposed:
   keep 01's pill as the primary; point the receipt's link at
   `/analytics` engine-science (the backtest's actual home). Why: the receipt
   promises the *record*, and the duplicate destination dilutes all three.
4. **Culture/art archive slab** — "Recent results" (PastResults) renders as a
   full-dark panel inside the cream settlement room; heaviest seam on the
   page. Proposed: paper-skin the recordband inside `roomPaper` (the
   SettlementSlip already token-flips). Why: one room, one material.
5. **Home hero chip strip density** — at `all` scope 7 layer chips print in a
   single mono line under the stage. Proposed: cap default chips at the 5
   strongest layers with a "+2 more" expander (chips already toggle). Why:
   legend readability; the scrub readout still lists everything.
6. **Board blurb legend wrap at 390** — the inline ⊢◆⊣ / ∿ glyph clauses
   break mid-sentence on mobile. Proposed: stack the two glyph clauses as
   their own centered line under the sentence at ≤640px. Why: the legend is
   the board's key; it shouldn't shatter.
7. **Feed table "Cat." cell prints uppercase tracked labels** ("WRISTWATCHES",
   "PRINTS & MULTIPLES") — the only all-caps data cell in a sentence-case
   grammar. Proposed: sentence-case the cell (`subCatLabel` already returns
   clean labels; the caps come from the `t-cat` style). Why: grammar
   consistency; caps + tracking also widens the column.
8. **`/culture` hero headline "$420 per year"** — the `heroReturnPer` suffix
   ("past year") reads as "$420 per year" next to a typical-price level.
   Proposed: for `realized`-unit heroes, suffix "typical, past year" (or move
   the window into the explain line, which already says "Typical price paid at
   hammer · past year"). Why: a level must not scan as a rate.

## Artifacts
- Before/after full-scroll screenshots: scratchpad `shots/` (`home|culture|sports`-`1440|390`-full.png + sliced `-p*.png`, zooms).
- CSS backup pre-prune: scratchpad `style.module.css.bak`.
