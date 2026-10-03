# A6 — GA mobile sweep · lectr.bid

Black-box QA, playwright-core 1.62 (channel: chrome, headless), context `{viewport 390×844, isMobile, hasTouch, deviceScaleFactor 3}`, iPhone UA. Landscape spot-checks at 844×390. Run 2026-08-03. Evidence: `…/scratchpad/ga/A6-shots/*.png`, per-page JSON `…/scratchpad/ga/A6-r-*.json`, scripts `A6-run1…run11`.

## Surfaces walked (18)

`/` · `/watches` · `/sports` (landers) · `/value` · `/lot/bonhams-brk_1008730-99F544FD154A` · `/makers` · `/makers/rolex` · `/makers/sports-cards` · `/ref/rolex/oysterperpetual` · `/analytics` · `/analytics/watches` · `/sub/cards/basketball` · `/profile` (signed out) · `/blog` · `/blog/how-we-built-the-pricing-engine` · `/blog/corrections` · `/about` · landscape `/` + `/value`.

Per page: horizontal overflow, tap-target measurement, sub-11px text, fixed/sticky inventory, edge-flush content, console/pageerror/requestfailed capture, full-page screenshot, phase-2 poll to 30s.

---

## Defects

### D1 [PRE-GA] /analytics — microstructure quad + calendar render 602px wide and are clipped; right ~40% unreachable
- **Repro:** load `/analytics` at 390px, scroll to the microstructure section (~docY 2380–2700). Reproduced **5/6 loads** (one load laid out correctly — it's a layout race, likely chart width measured before the container settles).
- **Evidence:** `A6-shots/analytics-overflow.png` — "Sell-through" and "Market depth" cards cut mid-chart ("sold + offered · qu…", axis "2023 Q…" truncated); "The calendar" month grid also runs past the right edge. Probe: `.ray-vm-card` w=602 inside `.ray-desk-microgrid` w=358; `main.ray-shell` scrollWidth 618 vs innerWidth 390; html `overflow: clip` hides it, **no horizontal scroll exists**, so the content is unreachable, not scrollable. `document.scrollingElement.scrollWidth` stays 390 — a plain overflow check misses it (fullPage screenshot came out 618 CSS px wide, which is how it was caught).
- Not reproduced on `/analytics/watches` (probed twice, all panels 358px). House matrix itself (`.ray-hm`) fits at 358 and its inner scroll wasn't needed.

### D2 [PRE-GA] Vitrine dots on maker dossiers are 6×6px tap targets (spec asks ≥40px)
- **Repro:** `/makers/rolex` and `/makers/sports-cards`, record-sale vitrine pager under the hero card.
- **Measured:** "Sale 1 of 3" **16×6px** (active), "Sale 2 of 3" / "Sale 3 of 3" **6×6px**, computed padding 0 — real hit area is the dot itself. Effectively untappable with a finger.
- **Evidence:** `A6-shots/sc-dots-region.png`, measurements in run5 log. (aria-labels are present — good — but the hit boxes need a ≥40px padded wrapper.)

### D3 [PRE-GA] ⌘K search: maker+model and model-only queries return "Nothing matches."
- **Repro:** open search on `/`, type `rolex daytona` → "Nothing matches." Same for `daytona` and (earlier probe) `patek phil`. Single-token prefixes work: `rolex` → "Rolex · watches maker", `patek` / `patek philippe` → maker + 1 live lot, `warhol`, `lebron` → live lots. Case-insensitivity is fine (rolex/Rolex/ROLEX identical).
- Maker+model is the canonical collector query shape; at minimum the maker ("Rolex") should surface for `rolex daytona`.
- **Evidence:** `A6-shots/searchq-rolex_daytona.png`, `searchq-daytona.png`, `searchq-patek.png`, `search-rolex.png`.

### D4 [POST-GA] Back gesture with search palette or menu sheet open leaves the page instead of closing the overlay
- **Repro:** history blog→home; open ⌘K palette, `page.goBack()` → lands on `/blog` (palette gone with the page). Same for the burger menu sheet. The **lot modal does this right** (back closes modal, stays on page, scroll position restored — verified on `/`, `/watches`, `/sports`). Sheets/palette should push the same history state the modal does.
- **Evidence:** run11 log: `afterBack={"url":"https://lectr.bid/blog"}` for both.

### D5 [POST-GA] /value "Save lot" buttons 30×30px (portrait and landscape)
- `.ray-value-save`, 14 instances measured 30×30. Bookmark icon in a dense ledger — workable but below the 40–44px floor everything else on the page meets (modal close is 44×44, lot CTAs 44px).
- **Evidence:** `A6-r-value2.json`, `A6-r-landscape-value.json`.

### D6 [POST-GA] Batch: interactive text links with <24px hit height across pages
Worst measured: lot-page maker byline "ANDY WARHOL" 96×**13**; "2052 live right now" (sports-cards dossier) h=**14**; blog kicker "NOTES FROM THE DESK" h=**14**; sub-dossier breadcrumbs "Sports" / "← All sub-markets on Analytics" h=**16**; ref-page "Rolex" crumb h=**16**; "All notes" h=17; "All 39 names ↓" h=20.6; "SEE THE FULL RECORD →" h=22; "Watches in Q2" h=22.3; timeframe chips 1Y/3Y/5Y/ALL 35–38×**29** (both chip families: `style_tfChip`, `ray-il-tfbtn`); top-of-footer market links ("Art" 18.5×28.3) on every page.

### D7 [POST-GA] Sub-11px text (spec floor 11px) — recurring micro-labels
8.5px `lectr-lot-dots` "●○○○" (lot page), 9px "today's call" wall tag, 9.5px `ray-bidvel-sub` (bid-velocity number on dossier), 9.5px `ray-ss-n`/`n` counts on analytics (23 groups <11px on /analytics — densest page), 10px chart axis labels, `mHeroTag`, `wallSignal` "comps sell at 4.8× this ask", kickers at 10.5px. All look deliberate (kicker grammar) but they're below the stated floor at 390px; the 9–9.5px data figures (bidvel, pool counts) are the ones worth lifting.

### N1 [NOTE] `/ref/rolex/1215` → 404
The brief's sample ref URL 404s (bare status, confirmed via request). Real ledger links use `/ref/rolex/oysterperpetual`, `/ref/rolex/1675`, `/ref/rolex/6263`, etc. — numeric keys exist, so 1215 is just not a catalogued Rolex ref. The dossier's own ledger links all resolve; verify nothing else deep-links to uncatalogued refs.

---

## Cleans (verified working at 390px)

- **Horizontal overflow:** none on any page (`scrollWidth` 390/390 everywhere) — the only visual overflow is D1's clipped quad, which a scrollWidth check cannot see.
- **Console:** **zero** console errors, page errors, or non-aborted failed requests across all 18 surfaces and all interactions.
- **Home:** boot splash → wall + feed paint in **328ms** after nav. Wall plates render with house images (loaded fine headless, `naturalWidth` 220). Engine hero, "Show 46 more" tape, ⌘K pill present.
- **Instrument:** touch scrub works via pointer drag (readout changes during drag, verified on `/`); tap alone doesn't move it. Chip rail (`layerChipsScroll`) scrolls horizontally (0→200 / 0→163 on landers). Timeframe chips switch.
- **Market pills:** tap "Watches" navigates to `/watches` (new URL scheme respected everywhere; no legacy routes seen in-app).
- **Feed:** landers list feed cards; **bidVelocity live on /sports** ("+19 bids · 24h" on Goldin lots, 12/12 rows). Bonhams-only feeds (watches) correctly show none — no fabricated velocity.
- **Lot modal:** opens from feed row, image loads, close is 44×44, CTAs "Open the lot page" / "View lot" / "Copy link" ≥36px; **body scroll locked** behind modal (no scroll trap); **back gesture closes modal, stays on page, restores scroll position**.
- **Menu sheet:** all links present (Overview/Value/Makers/Analytics/Blog/Sign in at h=58, category rows h=54, "Find a maker" filter, counts). No unseen-dot badge observed signed-out (nothing rendered in dot slots — can't verify the seen-state logic black-box).
- **/value:** ledger 102 rows, call plates with comps CTAs, closes-today strip, backtest receipt, odds/est columns readable; full richness ~10–17s on emulated mobile (within the 30s poll, nothing hangs).
- **Lot page:** certificate (`lectr-lot-cert`) at 15.5px base font — readable; estimate + method/n lines present; "View at Bonhams" 171×44 and "Save" 90×44 tappable.
- **/makers:** sort control ("Demand now", 93×48) reorders the roster (verified order change), 39 maker cards at 358px wide, directory link present.
- **Dossiers:** rolex ref ledger rows 370×42 (tappable), leads to working ref pages; sports-cards "Most-traded names" player strip + record sale vitrine render with images; earlier "duplicated page" appearance was a fullPage-screenshot stitching artifact — DOM verified single (1×h1, 1×"Price history").
- **/analytics + /analytics/watches:** desk panels stack single-column (except D1), deep pools section present, eager paint fast; house matrix fits at 358px.
- **/sub/cards/basketball:** verified index chart + record card render; honest labeling ("every point a real reading") intact.
- **/profile signed out:** clean pitch + "Sign in with Google", no leaked empty-state UI.
- **/blog, post, corrections, /about:** render fully, no overflow, longform readable (post 12.9K chars).
- **Landscape (844×390) `/` + `/value`:** no overflow, no layout breakage; same D5/D6 tap sizes carry over.
- **Safe-area:** no content flush to screen edges except chart axis labels ("0%", "$0") and intentional edge-bleed carousels (wall row/tape); fixed header doesn't overlap content at any scroll depth checked.

---

## Counts

- Surfaces audited: **18** (16 portrait + 2 landscape) · Interactions exercised: scrub, chip rail, market pills, modal×3, back-gesture×3 (modal/sheet/palette), menu, search×12 queries, makers sort, vitrine tap hunt, ref-ledger nav
- Defects: **3 [PRE-GA]** (D1–D3) · **4 [POST-GA]** (D4–D7) · **1 note** (N1) · **0 [BLOCKER]**
- Console errors across entire sweep: **0**

## Worst 5

1. **D1** /analytics microstructure quad + calendar clipped off-screen, unreachable (5/6 repro) — the flagship research page loses ~40% of three panels on mobile.
2. **D2** vitrine dots 6×6px on both dossier types — untappable.
3. **D3** search "rolex daytona"/"daytona" → "Nothing matches" — canonical collector query shape dead-ends the night before launch.
4. **D4** back gesture exits page when menu sheet / search palette open (modal already does it right — inconsistent).
5. **D5+D6** tap-target batch: 30×30 Save-lot in the value ledger + 13–22px-high text links sitewide.
