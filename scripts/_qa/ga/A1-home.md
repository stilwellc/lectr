# GA-Readiness Live QA — A1: Home & Market Landers (lectr.bid)

Date: 2026-08-03 (evening, ET) · Target: production https://lectr.bid
Method: black-box, playwright-core channel:chrome, 1440×900 desktop. Headless for all flows + one **headed** Chrome pass to clear image-gated features. Scripts & screenshots: `/private/tmp/claude-501/-Users-collin/761c6cf6-ce91-4aef-9574-4ec63e9f275e/scratchpad/ga/` (files `00*`–`09*`).
Scope: `/` `/art` `/design` `/watches` `/sports` `/science` `/culture` — every flow listed in the GA brief.

**Verdict: GO.** 0 blockers. 1 pre-GA fix recommended, 4 post-GA items. Zero console errors, zero page errors, zero failed non-image requests, zero 4xx/5xx across every run.

---

## Defects

### D1 [PRE-GA] Hero layer chips: click is a no-op (isolation is hover-only; `aria-pressed` never toggles)
- **Repro:** load `/` → wait for hero → click the "Art −11.6%" chip (or any `style_layerChip` on any lander, e.g. "Daytona" on `/watches`) → move mouse away.
- **What's wrong:** clicking produces **no change whatsoever** — hero SVG `outerHTML` hash identical before/after click, all 7 path stroke/opacity attrs unchanged, and every chip's `aria-pressed` stays `"false"` forever. Isolation exists only as a **hover** effect (hover correctly dims the other lines and highlights the hovered series with endpoint labels — works great). So: a `<button>` advertising a toggle (`aria-pressed`) that never toggles; keyboard and touch users have no way to isolate a line, and screen readers announce a state that can't change.
- **Evidence:** `03c-chip-hover.js` output — `/`: `{hoverChanges:true, clickChanges:false}`, `/watches`: same. Screenshots `03c-hover-.png` (hover isolates, correct) vs `03c-click-.png` (click: nothing). Also `03b-hero-probe.js` path dumps.
- **Fix shape:** either make click pin the isolation (and flip `aria-pressed`), or drop the `aria-pressed` attr/button semantics if hover-only is intended.
- **Severity:** [PRE-GA] — interactive affordance broken for click/keyboard/touch; desktop hover users unaffected.

### D2 [POST-GA] Comp-pool contamination in the engine-hero read (data quality)
- **Repro:** `/` → click the chapter-01 engine hero card (Kenny Scharf "Ratfinkbonerthunk") → wait for "The call — 22 comparable prints".
- **What's wrong:** comp #21 in the "same-maker, same-form, size-banded" pool is **"[PRESIDENTS.] JACKSON, Andrew. ALS…"** — an Andrew Jackson autograph letter (christies.com lot-5698224) inside a Kenny Scharf screenprint comp pool. Likely a name-collision in comp matching. Undermines the method line printed directly beneath ("same-maker, same-form… medians, never means").
- **Evidence:** `04c-followups.js` MODAL CONTROLS dump (comp list with hrefs); screenshot `04b-engine-modal.png`.
- **Severity:** [POST-GA] — one bad comp of 22, median-based call is robust to it, but it's visible to a careful reader on the flagship surface. Worth a matcher audit.

### D3 [POST-GA] Lot modal has no Save action
- **Repro:** open any feed-row modal, wait for comps to load fully.
- **What's wrong:** modal controls are only `×`, maker link, "Open the lot page", "View lot" (external), "Copy link", comp links. The GA brief expects "save from modal". Saving exists only on row/card hover buttons (`.ray-save-btn`, aria-label "Save lot") and is auth-gated. Not broken — a capability gap vs. spec.
- **Evidence:** `07-final.js` FEED MODAL BUTTONS `["×","Copy link"]` after full comps load; `07-feedmodal-loaded.png`.
- **Severity:** [POST-GA].

### D4 [POST-GA] Forward does not restore the lot modal after Back closes it
- **Repro:** open a feed-row modal (pushes a history entry, history.length 2→3) → browser Back (modal closes — correct) → browser Forward.
- **What's wrong:** Forward lands back on the same URL but the modal does not re-open; the history entry is a dead state. Harmless but asymmetric.
- **Evidence:** `05b-feed2.js`: `BACK closes modal: true`, `FORWARD re-opens modal: false`.
- **Severity:** [POST-GA].

### D5 [POST-GA / verify] Settlement slip figure: "Median hammer vs estimate **0%**" (total market)
- **Where:** `/` settlement slip (phase-2): "Sold lots on the book 742,364 · Median hammer vs estimate 0% · Latest hammer Jul 31, 2026".
- **Concern:** an exactly-flat 0% median across the full 742K book reads as a possible computation/rounding artifact (hero says +16.4% 1Y; receipt unflagged +16%). It may be genuinely true over the 30-yr archive-heavy corpus — but verify `soldMedianPct` before someone quotes it. Rendered honestly (neutral, unsigned) either way. Scoped slips look sane (`/sports`: "Recent median, realized $2K", `/science`: $15K).
- **Evidence:** `07-final.js` SLIP dump; `07-slip.png`, `08-slip-sports.png`, `08-slip-science.png`.
- **Severity:** [POST-GA] verification item, not a rendering defect.

---

## What's CLEAN (all verified, with evidence)

**Cold loads — all 7 landers** (`01-coldload.js`, fresh context each): DCL 405–582 ms, `load` 557–810 ms, hero figure painted 0.98–1.6 s. No flashes/stuck states, no skeleton residue, no NaN/undefined/null% anywhere, no loading text after settle. Zero console errors / page errors / 4xx-5xx on every lander. Titles correct per market ("Watches — lectr" etc.). Hero count-up animation from 0 is deliberate (settles at +16.4% home, +19.7% watches…).

**Market pill switching** (`02-pills.js`): all 7 pills are pure pushState — **0 document navigations** across the full cycle; URL, `document.title`, hero figure, "On the block" count, and feed rows all re-read per market (e.g. Art 30 / Design 15 / Watches 9 / Sports 2,705 / Science 139 / Pop Culture 818); the `.terminal-shell` root DOM node survives every switch (marked-node check — **no remount jank**); scroll stays at top. Back/forward ×14 through the pill chain restores every URL + hero figure exactly.

**Hero chart** (`03*`): scrub readout works — quarterly readout ("2026 Q1 · The market +16.4% · Art −9.6% …") tracks the pointer at 0.2/0.5/0.8 widths. Window toggle 1Y/3Y/5Y/ALL re-renders figure + period label (+16.4% → +15.5% (3Y) → +22.4% (5Y) → +21.9% (ALL) → back). Chip hover-isolation works (see D1 for click). Flip views on `/sports` `/science` `/culture` render the alternate $-level instruments per honesty doctrine ($366 / $723 / $420 "typical price paid at hammer" — no % on descriptive markets), with per-market chips (Classic/Modern/Vintage on sports; family/kind chips with n-per-qtr on science/culture).

**Ch. 01 — engine hero** (`04-chapters.js`, `04c`): renders (kicker "The value engine", "We find what the room misprices.", live featured lot with 1.5×, ask $1K vs comps median $2K · 22 sales, confidence ●●●○, method+n line). Whole card is a button → opens the lot modal; comps load in <20 s with 22 linked comps (house · date · dims · price · ±est); maker link `/makers/kenny-scharf`; canonical `/lot?id=rago-413597` in-app transport; external house link; ESC closes. "See all value lots →" CTA → `/value` and back, clean.

**Ch. 02 — markets tape**: 8 rows initial, CI beams in **8/8**, labels link to `/sub/*` (all 200 — see link sweep), row tap opens the `readPop` read card ("Classic cards (1980–99) · 95% confidence range +103/+136 · Repeat-sale index · 3Y · 49,052 lots · Open the dossier →"), **ESC closes it**, dossier CTA navigates to `/sub/cards-era/classic` (correct title). "Show 45 more" → 8→53 rows. Demand rows for descriptive families show "Demand +x% over estimate · n lots" (no fake price %).

**Ch. 03 — receipt**: replayed 38,671 · flagged +41.0% · unflagged +16.0% · edge +25.0 pts · dual-basis fine print "all-in basis · hammer-only +13.0% vs −7.0% · settled nightly · as of 2026-08-03" · serial "no. 38,671" · stamp element present · "see the full record →". Footer record line consistent (+13% hammer basis, same n).

**Feed** (`05*`): all 4 sorts re-order correctly (Biggest gap descends 4.8×→2.1×; Newest surfaces fresh Goldin lots; Estimate descends from the Apple-1; Soonest restores). "● Below market 18" filter → exactly 18 rows, matches rail count. Category cells with counts (sum = 3,716 = block count). **Sport lens works**: Sports → Basketball 569 → 24 rows all basketball, "545 remaining", Clear restores. bidVelocity chips render on Goldin lots (`59 +19/24h`, `.ray-bidvel-sub`). Card/table view toggles both directions (24 cards ⇄ 24 table rows; icon buttons carry proper aria-labels). Pagination: 24→48, "Show more (3,692 remaining)"→"(3,668 remaining)". Row click → modal with honest read ("Trading below comparable market · 72% rate of beating estimates · 15 sales · Calibration · low-confidence"); ESC and Back both close (see D4 for forward).

**Save / auth gate** (`05d`): Save lot → clean auth card ("Sign in to save lots… Continue with Google") over `ray-auth-scrim`; **ESC dismisses**, × present, page fully interactive afterwards. Not signed in ⇒ watchstrip untestable anonymously — code confirms it renders only with ≥1 saved lot (`TerminalHome.tsx:572` `savedIds.length===0 → null`, links to `/profile` with velocity/next-hammer line). Recommend one manual signed-in pass.

**Settlement slip** (`07/08`): phase-2 sentinel fetch → slip renders on scroll-approach (~3–10 s): total-market slip with serial no. 20260803; "Show the archive" expands the settled ledger (419→2,786 px) and toggles to "Hide the archive". Scoped variants honest: "Sold Sports lots on the book 352,190", "Sold Science lots on the book 27,777". `/art`-style scoped markets render the PastResults ledger directly (by design, confirmed in source). See D5 for the 0% figure.

**Tonight's Wall + images** (headed pass, `09-headed-wall.js`): in real Chrome **33/33 images load** and the Wall mounts with 5 plates (Haring 4.8×, Warhol 2.0×/1.7×, Matisse 1.6×, Jeanneret 4.3×), correct kicker copy, zero page errors. Headless image-load rates (home 3/28) are pure ORB artifacts — wright20.com serves `image/jpeg 200` (curl-verified, with and without referer). **Not a defect.** Feed rows degrade to monogram placeholders gracefully when images are absent.

**Search rail**: ⌘K button opens search dialog, input auto-focused, "warhol" returns maker + on-the-block lots, ESC closes. Rail "Below market now 18↗" scrolls to feed (y≈3007) and applies the 18-row filter.

**Link sweep** (`06-links.js`): **79 unique hrefs** across all 7 landers, HEAD/GET-checked: **0 broken, 0 stuck redirects — every one resolves 200**, including all `/sub/*` dossier routes, `/makers/*`, `/value`, `/analytics`, `/profile`, `/about`, `/blog`.

**Back/forward chains ×3** (`07-final.js`): lander → pill(/art) → tape label → real nav `/sub/art/sculpture` → back → back → forward → forward, repeated 3×: every step landed the exact URL with hero state restored (+18.7% on /art each time), no dead states, no reload jank, zero errors accumulated.

---

## Counts
| Severity | Count |
|---|---|
| BLOCKER | 0 |
| PRE-GA | 1 (D1) |
| POST-GA | 4 (D2–D5) |
