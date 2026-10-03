# A4 — GA-readiness live QA: ANALYTICS + DOSSIER PAGES

**Target** https://lectr.bid · black-box, playwright-core 1.62 (channel: chrome, 1440×900) · run Aug 3 2026 (desk No. 20260803)
**Evidence** `/private/tmp/claude-501/-Users-collin/761c6cf6-ce91-4aef-9574-4ec63e9f275e/scratchpad/ga/` — `report-*.json`, `run-*.log`, `shots/A4-*.png`, `headcheck.json`

## Verdict

**0 BLOCKER · 2 PRE-GA · 4 POST-GA.** The research desk is GA-ready. Zero console errors, zero page errors, zero failed requests, zero 4xx/5xx across every page loaded in the suite. All 169 unique hrefs collected across the audited surface HEAD-check 200 (0 redirects, 0 dead). The honesty doctrine holds everywhere I could poke it.

---

## Coverage

| Surface | What was exercised | Result |
|---|---|---|
| `/analytics` + 6 scopes (`art design watches sports science culture`) | full audit each (2 passes on design/sports/science/culture) | PASS |
| Desk strip | 4 figure cards per scope; cross-foots (94 subs = 5+29+28+17+7+8; 39 makers = 17+4+5+5+5+3) | PASS |
| IndexLab | 1Y/3Y/MAX toggle per scope — path `d`, axis (3Y: 2023 Q3→2026 Q3; MAX: 2020 Q4→2026 Q3; 1Y: 2025 Q3→) and legend values all change; layers render (7 lines on all, 6 watches, split volume/Δ% sub-panel on sports/science/culture — deliberate, labeled) | PASS |
| RelativeStrength | leaders + laggards, 5–12 rows/scope, sparks per row, every row links `/sub/*`, spread line ("+171pp" all/sports, "+48pp" art, "+44pp" watches, "+26pp" design). Absent on science + culture — no verified series there; consistent with its own caption "descriptive markets excluded" (see O3) | PASS |
| VerifiedMovers | rows on all (3) + watches (3); empty scopes print the abstention line "No maker in <m> clears the 95%-confidence bar yet — we only print a move the data resolves." | PASS |
| Micro quad | sell-through, depth, calendar w/ takeaway line ("Jan runs hottest at +12% · Aug softest at −13%"), house matrix n≥40-gated (em-dash cells: 16 all, 4 culture, 1 sports/science, 0 art/design; Goldin/RR rows dropped entirely — correct, no estimates) | PASS |
| Engine science | record strip (+41% all-in / +13% hammer / +16% unflagged / 3.4% fail, n=38,671) identical every scope; grade curve on **all + sports only** (absent art/design/watches/science/culture) ✓; calibration curve = "What a flag is worth" (85,515 replayed sales, 10×+ bucket honestly drops) present every scope | PASS |
| LongHorizon | correct per-scope variant: card-era repeat-sale (all/sports) · kind demand (art) · kind+material demand (design) · model-family demand (watches) · sales volume "counts, not prices" (science) · 23-yr yearly median $, n-gated (culture) | PASS |
| Full book | uncapped — 94 rows on all, 5/8/29/28/7/17 per scope, no "show more", every row links `/sub/*`, zero stray hrefs | PASS |
| Deep pools | sentinel mounts on scroll; maker rankings rows link `/makers/<slug>` (art/design/watches/science/culture), top sales link `/lot?id=` (5/scope, all 200), distributions render (Category/House/Price tabs, bars present); sports/science shard branch: sports pulls `lots-3.json` (18MB), all pulls `lots-2`+`lots-3` (36MB) | PASS w/ D4, D5 |
| Market pill switch | pushState confirmed — **0 full reloads** across 7 pill navs; URL moves (`Pop Culture` → `/analytics/culture`); desk figures re-scope; Back ×3 restores URL **and** content each step; Forward works | PASS |
| `/sub` dossiers ×10 | cards/basketball, cards-era/classic (CI'd colored green +109%/+119%, CI bands, repeat-sale caption) · rolex/daytona −4% red, design-material/walnut +14%, art/prints +5%, instruments/globes +10% (demand vs estimate · quarterly) · culture/music $723, culture-kind/photos $379, space/flown $3K (plain typical, **no % anywhere, uncolored**) — hero read matches readType in all 10; chart per series type (music = 23-yr yearly 2004→2026 ✓); record row present (music: Bob Dylan letters $670K · RR Auction); back-links "← All sub-markets on Analytics · The taxonomy on Makers" | PASS |
| Legacy `/sub?id=x:y` | `cards:basketball` and `rolex:daytona` both redirect to path form and render | PASS |
| `/ref` | `/ref/rolex/1675` renders full reference dossier (226 sales, median, beat-rate, chart, recent sales w/ images); slash-codec `/ref/patek-philippe/3800~2f1` renders "Ref. 3800/1" ✓; legacy `/ref?id=rolex:1675` redirects to path ✓ | PASS w/ D2 |
| `/player` | `?id=lebron-james`, `michael-jordan`, `tom-brady` all render player dossiers with the cards vs game-worn cross-market read (e.g. LeBron: 5,588 sales · cards median $427 · game-worn $4K) + on-the-block rows | PASS w/ D1, D3 |
| 404 | `/nonsense` returns HTTP 404 + the real branded page ("This page isn't on the block") | PASS |
| Href integrity | 169 unique hrefs from every audited page → HEAD (GET fallback): **169/169 = 200**, 0 redirects | PASS |

---

## Defects

### D1 [PRE-GA] — No player strip on sports `/sub` dossiers; `/player` unreachable from the dossier surface
- **Repro:** load `/sub/cards/basketball`, `/sub/memorabilia/baseball`, `/sub/game-used/basketball`; scroll fully, wait. Zero occurrences of player/athlete content; each dossier exposes exactly 13 hrefs, all nav/footer/back-link.
- The "Most-traded names" strip lives only on maker pages (e.g. sports-cards maker dossier), so player dossiers — which render beautifully — are two hops off the dossier path. If the strip was intended on sports sub-market dossiers for GA, it isn't there; if maker-page-only is intent, downgrade to POST-GA discoverability.
- **Evidence:** `probe-sub-basketball.txt` (grep player|athlete|most-traded → 0), `shots/A3-sports-cards-playerstrip.png` (strip on maker page), `shots/A4-player-lebron.png`.

### D2 [PRE-GA] — `/ref/rolex/1215` 404s (specified QA target)
- **Repro:** GET `/ref/rolex/1215` → HTTP 404 branded page. Legacy `/ref?id=rolex:1215` redirects to the same 404 path (redirect machinery itself is fine). Sibling refs on `/makers/rolex` (1675, 6263, 1803, 5513, 6239, oysterperpetual, cellini…) all render.
- Ref key `1215` isn't in the reference index. Confirm the key (Cellini 1215?) exists in corpus or scrub it from anything published; the failure mode (real 404) is at least honest.
- **Evidence:** `shots/A4-ref-rolex-1215.png`, `shots/A4-ref-rolex-1675.png`, `report-ref-player-404.json`.

### D3 [POST-GA] — `/player?id=michael-jordan` renders raw-uppercase name
- h1 + follow button read "MICHAEL JORDAN" / "Follow MICHAEL JORDAN" while peers are proper-cased (LeBron James, Tom Brady, Shohei Ohtani). Source-name normalization miss; clashes with the sentence-case grammar.
- **Evidence:** `shots/A4-player-jordan.png` vs `A4-player-lebron.png`.

### D4 [POST-GA] — Sports deep-pool rankings rows are dead ends
- On `/analytics/sports` the rankings table pivots to sports (Basketball $225.88M … Hockey), correct per taxonomy, but rows carry no links and no pointer cursor — every other scope's rankings rows link `/makers/<slug>`. Obvious landing: `/sub/cards/<sport>` or `/sub/memorabilia/<sport>`.
- **Evidence:** `11-anomalies.js` output (rankRows links `[]`, clickable false), `shots/A4-x-sports-deepzone.png`.

### D5 [POST-GA] — Deep pools can exceed 30s to hydrate on cold cache
- First-pass automated scroll: design and sports deep pools still skeleton-less/empty at the 30s poll ceiling; art took 15.9s, watches 14.1s post-scroll. Re-visit (warm cache) mounts in <1s. Driver: 27–35MB/scope (`lots-2.json`/`lots-3.json` 18MB each + `upcoming.json` 6.7MB + `lots-15.json` 6.9MB). Within the stated budget but the tail is user-visible on slow links; consider skeleton-first paint or shard trim.
- **Evidence:** `report-design.json` / `report-sports.json` (`readyMs: TIMEOUT30s`) vs `11-anomalies.js` re-run (mounted, skel=0); byte tables in `run-*.log`.

### D6 [POST-GA] — Legacy `/ref?id=` slash form renders 200 empty state instead of redirecting
- `/ref?id=rolex/1215` (slash instead of colon) stays on the query URL and shows in-app "Not in the reference book" at HTTP 200; the colon form correctly redirects to the path route. Harmless unless old links used slashes.
- **Evidence:** `report-ref-player-404.json` (ref-legacy-slashid).

## Cleans & observations (no action)

- **O1** Honesty doctrine verified in situ: descriptive dossiers show no %, no green/red; demand/CI reads colored only on measured deltas; mono font on figures; every instrument carries method + n; movers/RS/house-matrix abstain loudly rather than fill ("41 more tracked descriptively — no verified motion, so not ranked").
- **O2** `/analytics/pop-culture` 404s but nothing anywhere links it — pill and footer both use `/analytics/culture`. Only matters if marketing ever prints the other slug.
- **O3** RS section absent (not broken) on science + culture; no CI/demand sub-market series qualify there. If globes-style demand reads were meant to seed science RS, that's a data question, not a page bug.
- **O4** Engine record prints n=38,671 vs 38,734 in current backend state — page is one nightly behind; consistent everywhere it appears.
- **O5** Desk figures live-consistent: 760,985 on the book / 742,364 sold / 8 houses / 94 subs on every scope; masthead No. matches run date.
- **O6** Full-page (`fullPage: true`) screenshots of /analytics stitch incorrectly (sticky sections) — harness artifact, not a site bug; all evidence shots are viewport/element captures.

## Final count

**Defects: 6 — 0 [BLOCKER] · 2 [PRE-GA] (D1, D2) · 4 [POST-GA] (D3–D6).**

**Worst 5:** D1 (player dossiers orphaned from sports dossier surface) · D2 (/ref/rolex/1215 404) · D4 (sports rankings rows dead) · D5 (deep-pool cold-cache tail >30s) · D3 (MICHAEL JORDAN casing).

Ship it. Nothing here blocks tomorrow; D1/D2 are worth a decision (not necessarily a fix) before the doors open.
