# GA-readiness live QA — A2: VALUE & LOT surfaces (lectr.bid)

Run: 2026-08-03 (evening) → 2026-08-04 UTC · black-box, playwright-core 1.62 `channel:'chrome'` headless, 1440×900.
Evidence dir: `/private/tmp/claude-501/-Users-collin/761c6cf6-ce91-4aef-9574-4ec63e9f275e/scratchpad/ga/` (screenshots `.png`, text dumps `.txt`, raw JSON: `value-sweep.json`, `lots.json`, `headcheck.json`, `verify.json`, `final.json`).

Corpus state at test time: 18 flagged lots (17 ledger + Today's Call), all art/design; watches / sports / science / culture segments empty. 71 unique hrefs HEAD-checked across all pages.

---

## DEFECTS

### D1 [BLOCKER] — #1 flagged ledger row's external "View lot" is a 404 (wrong house domain)
The top row of the flagged ledger (Keith Haring, *Bad Boys 2*, `wright-295955~`, 72% odds / 4.8× gap) carries house **Wright** and links `https://www.wright20.com/auctions/2026/08/prints-unlimited/196` → **404** (verified via direct fetch; other wright20 URLs return 200, so it isn't bot-blocking). "Prints Unlimited" is a **Rago** sale — the identical path on ragoarts.com returns **200**: `https://www.ragoarts.com/auctions/2026/08/prints-unlimited/196`. House attribution/URL builder crosstalk between the sister houses (crawler stored the lot under `wright-` with a wright20 URL; the lot even shows "Hammers Aug 14" = Rago's sale day, while true Wright lots hammer Aug 13). Affects the same link in the row modal and on the static lot page `/lot/wright-295955~`. Second lot with same defect (not flagged): `wright-295921~` → `.../prints-unlimited/195` (404). Sitemap id `wright-413240` (Rago-style numeric id under wright prefix) is more crosstalk evidence, though its URL resolves.
Repro: /value → first ledger row → modal → "View lot". Evidence: `headcheck.json`, `int-modal-row0.txt`, `lot-canon-tilde.png`.

### D2 [PRE-GA] — All Bonhams `brk_*` house CTAs 404, including two flagged lots hammering Aug 4–5
Every `bonhams-brk_*` lot (10 in the current book; Bruun Rasmussen sales routed through Bonhams) links `https://www.bonhams.com/auction/brk_<sale>/lot/<hash>` → **404 "Page not found"** confirmed in a real Chrome load (`verify.json` → `bonhams-brk`). Flagged lots affected: `bonhams-brk_1008730-99F544FD154A` (Warhol Marilyn tapestry, in the art ledger, hammers **Aug 4 — GA day**) and `bonhams-brk_1008729-B7ADEC56ABA9` (Cartier bangle, Aug 5). The product's conversion CTA ("View at Bonhams") dead-ends on a flagged call the day it launches.
Repro: `/lot/bonhams-brk_1008730-99F544FD154A` → "View at Bonhams". Evidence: `lot-bonhams-flagged.png`, `verify.json`.

### D3 [PRE-GA] — Reference certificate row links to 404 for every current watch lot
Lot pages render a Reference row whose link 404s when no `/ref` dossier exists: `/ref/patek-philippe/4132~2f1`, `/ref/omega/2813`, `/ref/audemars-piguet/26400so` all **404** (branded "This page isn't on the block" — honest, but still a dead certificate link). The route itself is fine (`/ref/rolex/1675`, `/ref/rolex/6263` → 200 from /makers/rolex). All 3 watch lots with references in the current book are affected; either suppress the link when no dossier exists or generate the page. The `~2f` codec output on the Patek link is additionally suspect (slash-bearing refs may never resolve).
Repro: `/lot/bonhams-brk_1008725-9A8B27E97767` → "Ref. 4132/1". Evidence: `final.json` refChecks, `ref-404.png`, `lot-watch-ref.png`.

### D4 [PRE-GA] — Browser Back with ComparableModal open exits the page instead of closing the modal
Opening the modal pushes no history entry (URL stays `/value`). Sequence home → /value → open row modal → Back lands on **home** (test that navigated directly landed on `about:blank`). ESC and ✕ close correctly; Back should too (mobile users instinctively use it and will be thrown off the surface).
Repro: `a2-03-back-harvest.js` backTest: `{open modal at /value, goBack → url https://lectr.bid/, modal gone}`. Evidence: `back-harvest.json`, `int-after-back.png`.

### D5 [PRE-GA] — Today's Call modal drops the value block / calibration / sub-market lines
"See the comps" on the Today's Call plate (Kenny Scharf `rago-413597`, confidence ●●●○ high) opens a modal with **no** "Trading below comparable market…" line, no calibration line, no sub-market line/link, and labels the figure "**Median**" instead of "**lectr value**". The identical modal for ledger rows (Keith Haring) shows all three lines. The Scharf **lot page** itself shows gap +53%, confidence high, and a sub-market row — so the data exists; the modal payload from the plate (and from the home card, same lot) is thinner. Flagship-surface inconsistency.
Repro: /value → "See the comps"; compare with first ledger row's modal. Evidence: `int-modal-todayscall.png/.txt` vs `int-modal-row0.png/.txt`, `home-modal.png`.

### D6 [PRE-GA] — Settled-calls tape absent from every /value surface
No settled/tape section renders on /value or any of the 6 segments (full-page screenshots + full text dumps searched). The data is live in the payload (`upcoming.json → tape.all`: settled Goldin results, "04 Topps Chrome Refractor LeBron … $76K" etc.), so figures/tone could not be assessed at all. If the tape was meant to ship on /value for GA it is missing; if it moved to the overview only, drop from the /value spec.
Evidence: `value-*-full.png`, `value-*-text.txt`, `upcoming.json`.

### D7 [POST-GA] — OG-description copy bugs on static flagged lot pages
`/lot/rago-413597` meta/og description: "comps run **+53% the ask**" (missing "over" — the multiplier variant "4.8× the ask" reads fine) and "**$1K–$1K est.**" (degenerate range when low = high; should collapse to "$1K est."). Social cards are the one place these pages will be judged before click.
Evidence: curl output in report session; `lots.json`.

### D8 [POST-GA] — Ledger "Hammers" column truncates dates at desktop width
At 1440×900 every ledger date renders "Aug 13, 20…" / "Aug 14, 20…" (ellipsis). Cosmetic but on the flagship table.
Evidence: `int-ledger-closeup.png`, `value-total-full.png`.

---

## QA NOTES (not defects)

- **Headless-only image failures**: wright20/ragoarts images fail with `ERR_BLOCKED_BY_ORB` and their pages 403 under the HeadlessChrome UA (CloudFront bot rules). With a stock Chrome UA the same hero image loads (`lot-hero-normalUA.png`, imgFails 0). Real users are fine; monogram fallback is graceful anyway. Any GA smoke-test automation should spoof a normal UA or it will false-positive.
- **Save is auth-gated**: clicking any save button (plate bookmark or ledger row) opens a clean "Sign in to save lots" sheet (Google) and stores `localStorage.lectr-pending-save` with the lot payload. Post-auth persistence could not be verified without credentials; pre-auth the button correctly stays unsaved after reload. Consider surfacing the pending state.
- **Closes-today salience untestable**: nothing closes on test day (first hammer Aug 4). Nearest evidence: lot page shows "Hammers Aug 4, 2026 · **tomorrow**" (relative salience working; `lot-bonhams-flagged-text.txt`).
- **Card grade-ladder in modal untestable today**: no card lots on /value or home (sports unflagged). The card lot page's certificate does show the exact-card rows: "This card · 1 sale, same card & grade · $121K / Last sold $121K · Jul 2023" (`lot-goldin-cardcomps-text.txt`).
- Duplicate-looking ledger rows ("Cushion Chair with Arms" ×2) are two distinct lots (Wright sale lots 201 and 203) — not a dupe bug.
- `upcoming.json` has 25 `signal` lots vs 18 shown — assumed post-signal gating; masthead (18) = ledger (17) + Today's Call, consistent with the 18 sitemap lot pages.

## CLEAN — verified working

**/value + all 6 segments** (`/value`, `/art`, `/design`, `/watches`, `/sports`, `/science`, `/culture`):
- Masthead figures honest and internally consistent (18 flagged · comps +103% · $100K · 7 makers · first hammer Aug 4); segment-specific rewrites ("…where the art market clears", per-segment counts).
- Today's Call plate: strip instrument, Ask/Comps median (n sales)/Gap/Confidence dots ●●●○ high/Hammers rows; all 3 CTAs live (See the comps → modal; Open the lot page → `/lot?id=rago-413597` → canonicalizes; View lot → ragoarts 200).
- Flagged ledger: 12 rows + working "Show 5 more" (→17); calibrated odds column (72%…67%) with **dot-tier fallback ●○○○ on low-confidence rows** (art segment) — no fabricated %; row hover reveals the leader caption line ("comps median $30K vs $6K–$8K ask · 4.3× over · 27 sales"); row click → modal.
- Thin-market empty state on all 4 sparse segments: "No lots are flagged below market right now — the crawl refreshes daily." — honest, no fake plate.
- Record band (+41% / +16% / 44% / 3.4% with basis + n captions), worst-year line (2001, +23%, 692 calls), record-by-year chart (2000–2026, flagged vs unflagged, premium-inclusive caption), engine card + blog link (`/blog/how-we-built-the-pricing-engine` → 200).
- Segment tab buttons client-navigate to `/value/<seg>` correctly.
- Zero console errors / page errors across all 7 pages.

**ComparableModal** (from /value rows, Today's Call, and home card): value block ("Trading below comparable market … 72% … 15 sales"), calibration line (0.47×–2.81×, 70%, n 85,515), sub-market line + link (`/sub/art/prints` 200), strip with "this estimate"/"comps median", lectr value / Range / vs.Est triplet, 10-comp ladder with per-comp house·date·medium·dims, maker link (new `/makers/<slug>` form), Open-the-lot-page link, Copy link; ESC ✓ and ✕ ✓ (Back ✗ = D4). (D5 exceptions noted.)

**LOT pages**:
- `/lot?id=<id>` self-canonicalizes to `/lot/<id>` for flagged, non-flagged and tilde ids (`wright-295955~` survives encoding).
- Flagged static pages: instant SSR (40 KB, H1 + full certificate in source, ~90 ms DCL), real OG (title/description/image/twitter card) — `rago-413597`, `wright-295955~`.
- Non-flagged shell resolves in ~2–8 s for every vertical tested (watch, Goldin card, Goldin jersey, RR science, RR culture).
- `/lot/<bogus>` and `/lot` (no id): instant honest "This lot isn't on the book" + "Back to the tape", no spinner, generic OG only on shell.
- Certificate rows: Ask/Estimate ✓; Comps median + n ✓; house-calibration line ("estimates here run rich · hammers −13% vs mid · 200 sales") ✓; Sub-market links all 200 (`/sub/art/prints`, `/sub/patek-philippe/ellipse`, `/sub/cards/basketball`, `/sub/game-used/soccer`, `/sub/space/apollo`, `/sub/culture/hollywood`); Player link `/player?id=lebron-james` / `kylian-mbappe` / `michael-jordan` → 200; Reference-comps range on culture lot ("$4K median · 4 sales · low-confidence reference · $4K–$6K" — labeled range, honest); **Bid velocity on live Goldin** ("+2 bids · in the last 24h · faster than 57% of live lots"); descriptive sub-markets show counts not % ("8,505 lots tracked · $2K typical") per the honesty doctrine.
- Comps sections resolve on every lot (incl. "RECENT SOLD · 16 COMPARABLE GAME-WORN JERSEYS" with thumbnails on live Goldin); honest abstain where gates fail ("No comparable sales clear the gates for this lot — lectr doesn't manufacture a pool").
- Save + Copy link present on all lot pages; house CTA present on all (dead targets = D1/D2 only).

**Links**: 71 unique hrefs HEAD-checked; 68 OK (Bonhams 308→200 trailing-slash redirects fine); the only failures are D1/D2/D3 above.
