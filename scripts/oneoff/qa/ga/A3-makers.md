# A3 — MAKERS surfaces · GA-readiness live QA

Black-box QA against **https://lectr.bid** production, 2026-08-03 evening, playwright-core 1.62 (channel: chrome, headless, 1440×900).
Scope: `/makers` roster, `/makers/m/<market>` ×6, dossiers (rolex, patek-philippe, sports-cards, game-used, pablo-picasso, george-nakashima + thin-data fab-5-freddy, tickets-passes, meteorites), `/ref` click-throughs, `/player` click-throughs, record-plate vitrine, reduced-motion, legacy redirects. Every internal href HEAD-checked per page.
Evidence + scripts: `scratchpad/ga/` (`A3-*.js`, `shots/A3-*.png`, `A3-*-results.json`).

**Zero page errors, zero console errors, zero failed requests, zero 4xx/5xx on lectr.bid across every session.** All headless image loads succeeded (roster 2/2; dossier vitrine + lot thumbnails from house CDNs all loaded) — no external-image rate caveat needed.

---

## DEFECTS

### D1 [PRE-GA] Dossier hero animates through fabricated giant percentages on every load
The "Typical sale vs its estimate, trailing 12 months" hero figure eases **down from a multi-million bogus value** to the real one, visible ~1–1.5 s on every dossier open once phase-2 data lands (which can be 4–14 s in):

- patek-philippe: `+31,186,000% → +798,038% → +28%` (sampled at 400 ms; screenshot frozen at **`+18980442%`** with green "heating · was +9% a year ago" beneath it)
- rolex: `+6,253,680% → +291,710% → +135% → +24%` (separate run caught `+5092765%`)

Repro: open `/makers/rolex` or `/makers/patek-philippe`, watch the hero when the big % first paints. Script: `A3-32-hero-transient.js`. Evidence: `shots/A3-patek-philippe-transient-4293ms.png`, `shots/A3-rolex-transient-13135ms.png`.
This is the flagship figure on the page, in the site's honesty-doctrine mono style, showing a number that was never measured. Under `prefers-reduced-motion` the animation is skipped and `+28%` paints directly — same short-circuit (or animate up from 0) is the fix. Non-% heroes (fab-5-freddy `$11K`, meteorites `$7K`) are unaffected.

### D2 [PRE-GA] Taxonomy directory cards have no "+N more" → `/analytics/<vertical>` links
The six sub-market cards on `/makers` surface 40 of the 94 tracked drill rows with **no affordance to reach the rest** — no "+N more" element exists anywhere in the cards (checked anchors, buttons, text nodes; card grid = 6 children, each 5–7 `/sub` rows and nothing else; headers "Art · 58,729 lots" are not links). The intended targets `/analytics/art|design|watches|sports|science|culture` all exist and return 200. Script: `A3-12-taxcards2.js`; evidence `shots/A3-taxonomy.png`.

### D3 [PRE-GA] Record-plate vitrine cycles but has no dots — no manual navigation
`.lectr-recplate` auto-cycles top-3 (Record sale → 2nd highest → 3rd highest, ~6 s cadence, first advance can take ~30 s while phase-2 settles) and hover/reduced-motion behave correctly, but the wrapper HTML contains **zero navigation controls** (full `outerHTML` dump: no buttons, no dots, no tablist). Users cannot jump to or return to a specific record; the plate is also invisible to keyboard/AT as a carousel. Scripts: `A3-72-recplate.js`, wrapper dump in transcript. Confirmed on rolex and meteorites.

### D4 [POST-GA] External link rot in "Recent results": wright20.com sold-lot links 404
On george-nakashima, outbound `wright20.com/auctions/2026/07/...` links in Recent results returned **404** (4 distinct URLs across two loads: `design/131`, `design/134`, `design/135`, `essential-design/270`) — Wright removes lot pages after the sale. Every other house's outbound link checked (Bonhams, Phillips, Sotheby's, Christie's, Toomey, Rago) returned 200. Rows rotate per load, so incidence is intermittent (2 of 4 loads). Consider dropping/decaying outbound hrefs for houses known to purge, or falling back to the in-app `/lot` canonical.

### D5 [POST-GA] Sports-cards "The maker's decade" band reads as a crash to zero
Linear-scale yearly-median band descends ~$200K (2023) → ≈$0 at the 2026 endpoint (`shots/A3-sports-cards-playerstrip.png`, bottom). It is real, method-labeled data (mix shift: Goldin's low-value card volume dragging the n-gated median), but visually it announces a market collapse. A log scale or a mix-shift annotation would keep it honest *and* legible.

### D6 [POST-GA] Dossier `<title>` is the bare maker name
`/makers/rolex` → `<title>Rolex</title>`, while the roster ("The roster — makers tracked at auction — lectr") and ref pages ("Patek Philippe Ref. 3800/1 — reference · lectr") carry full branded titles. SEO/branding inconsistency on the highest-traffic template.

---

## CLEANS (all verified passing)

**/makers roster** (`A3-10-roster.js`, `A3-roster-results.json`)
- Masthead: h1 "Every maker, read as a live market curve.", kickers "The roster · full market" / "39 tracked names", summary line "39 tracked names · 3716 live lots on the block · 94 tracked sub-markets · market demand +28%".
- Taxonomy cards: 40 `/sub/...` rows, all HEAD 200; measured verticals show % vs estimate, descriptive verticals (science, culture) correctly show "$ typical" — no fabricated %.
- Verified movers ledger: Cartier +51.2% 5Y [19, 92] · Rolex +23.6% 5Y [11, 38] · Patek −12.9% 3Y [−21, −4] — CI brackets, red/green only on measured deltas.
- **All 4 sort options reorder for real** (4 distinct top-10 orderings; 39 cards preserved each time): Sales value → picasso/warhol/patek…, Demand now → music-memorabilia/tickets-passes…, Sold count → sports-cards/entertainment…, On the block → sports-cards/entertainment/game-used….
- **Compare on one axis rebases**: tooltip relabels from "2013 Q2 +57% vs estimate" → "2013 Q2 +3614% from window start" (`shots/A3-roster-compare-on.png`).
- Live-lot chips on 22/39 cards ("2052 on the block" sports-cards etc.); verified chips: rolex "5Y verified", cartier "5Y verified", patek-philippe "3Y verified".
- All 39 cards link to dossiers; all 94 unique hrefs on the page HEAD 200.

**/makers/m/<market> ×6** (`A3-20-markets.js`)
- All six load market-scoped rosters (art 17, design 4, watches 5, sports 5, science 5, culture 3 — sums to 39), correct membership, no cross-market bleed.
- Market tab click **moves the URL** (`/makers/m/art` → `/makers/m/watches`), Back restores `/makers/m/art` with the art roster intact; from `/makers`, tab click navigates to `/makers/m/sports`. All hrefs 200 on every page.

**Watch dossiers — rolex, patek-philippe** (`A3-40-watch-deep.js`)
- Model-family ledgers link `/sub/<maker>/<family>` (9 rolex, 8 patek), all 200.
- References ledgers link `/ref/<maker>/<key>` (8 each); clicked through 4: oysterperpetual → "Oyster Perpetual", 5513 → "Ref. 5513", calatrava, 3445 — all render with series charts, no error states.
- **Slash-ref codec works**: `/ref/patek-philippe/3800~2f1` renders "Ref. 3800/1", full title, 75 sales, yearly series (`shots/A3-ref-patek-3800slash1.png`). (Note: no `~2f` ref happens to appear in either top-8 ledger, so the codec path is reachable today only via direct URL/other surfaces.)
- TTM deltas colored sanely: every `+` green rgb(47,191,113), every `−` red, refs without a measured ttm show **no** delta and no color (abstention over fabrication).

**Sports dossiers — sports-cards, game-used** (`A3-50/51`)
- Player strips link `/player?id=` (6 each); Shohei Ohtani and Cal Ripken Jr. player pages render fully.
- Moving-now summaries present: "1380 live lots moving now · +4,545 bids recently" / "390 live lots moving now · +953 bids recently".
- **Phase-3 archive loads**: price history spans 1991 Q3 → 2026 Q3 (sports-cards) and 1997 Q3 → 2026 Q3 (game-used); Recent results reach back to 2016–2020 sales (1916 Babe Ruth blank back, 1933 Goudeys). Settle 12–16 s — inside the 30 s budget.
- Player-strip medians abstain with "—" where no realized price, with the honest caption ("a volume fact, not a price move · median shown only where ≥3 sold").

**Art/design dossiers — pablo-picasso, george-nakashima** (`A3-60`)
- Kind-context ledgers link `/sub`, and carry the disclaimer **personalized**: "art sub-markets across the whole corpus — not Pablo Picasso's own figures" / "…not George Nakashima's own figures". (Anyone grepping for the literal phrase "not the maker's own figures" will miss it — it interpolates the name.)
- Maker's-decade band present on both; no error states; all internal hrefs 200 (only external wright20 rot, D4).

**Thin-data makers — fab-5-freddy (15 lots), tickets-passes, meteorites** (`A3-80`)
- All render gracefully: heroes fall back to $ figures (never bogus %), record plates render (fab-5-freddy: $11K record, 53% sell-through, 15 lots, 2 houses), ledgers abstain with "—", no NaN/undefined/empty sections, all hrefs 200. (One "NaN" regex hit on meteorites was a false positive: "Prove**nan**ce".)

**Record-plate vitrine** (`A3-71/72`)
- Cycles top-3 with labeled states (Record sale / 2nd highest / 3rd highest) at ~6 s.
- **Hover pauses** (no advance in 20 s hovered; resumes within 20 s of unhover).
- **Reduced motion honored**: with `prefers-reduced-motion: reduce`, no auto-advance in 45 s, and the hero count animation is suppressed (`+28%` paints directly).
- The one hero-text change seen under reduced motion is the initial data-arrival swap ("Recent sales" placeholder → real stat), not an animation.

**Legacy routes**
- `/artists` → 301 → `/makers`; `/kaws` → 301 → `/makers/kaws` (browser lands, h1 "KAWS"); `/rolex` → 301 → `/makers/rolex`; `/saved` → 301 → `/profile`; `/makers/rolex/` → 308 → canonical; `/makers/does-not-exist` → 404. (`/artists/kaws` 404s — that form never existed; noting for completeness.)

---

## FINAL

**Counts:** 74 checks executed · **68 pass** · 6 defects (**0 BLOCKER · 3 PRE-GA · 3 POST-GA**). No JS errors, no failed/4xx requests to lectr.bid anywhere in scope; every internal link on every audited page resolves 200.

**Worst 5:**
1. **D1 [PRE-GA]** — hero flashes `+18,980,442%`-class fabricated figures on every verified-maker dossier load; worst possible look for an honesty-doctrine product on launch day; fix = start count from 0 or reuse the reduced-motion short-circuit.
2. **D2 [PRE-GA]** — taxonomy "+N more" → `/analytics/<vertical>` links absent; 54 of 94 drills unreachable from the roster's directory.
3. **D3 [PRE-GA]** — record-plate vitrine has no dots: auto-cycle only, no manual/keyboard navigation.
4. **D4 [POST-GA]** — wright20.com Recent-results links 404 (house purges sold-lot pages).
5. **D5 [POST-GA]** — sports-cards maker's-decade band visually collapses to $0 (real mix-shift, alarming presentation).
