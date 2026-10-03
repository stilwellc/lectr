# Sub-market data layering audit — where `subCat` / `drill` / `flown` / `sport` and `market.json drills` can enrich existing surfaces

Date: 2026-07-31. Lens: concrete layering opportunities with data that is live today. Nothing implemented.

## Data verification (what actually ships)

- **Every corpus lot carries the taxonomy.** Slim shards: 26,496/27,111 lots in `lots-0.json` carry `subCat`; eager `upcoming.json`: 4,549/4,549 carry `subCat`, 3,777 carry `drill`, 2,383 carry `sport`, 814 archive-pool lots carry `flown`. Types confirmed at `app/types.ts:262-264` (`subCat?`, `drill?`, `flown?`) and `app/types.ts:181` (`sport?`).
- **`market.json.drills`** — 92 rows across 6 verticals, typed at `app/hooks/useRayData.ts:104` as `Record<string, (SubMarketRead & { parent: string })[]>`. `SubMarketRead` (useRayData.ts:106-129) carries `readType` (`index`/`demand`/`descriptive`), CI'd `index` (+ `indexMethod: 'repeat-sale'|'hedonic'`), `demandNow` + `demandSeries` (watch families ship ~93 points — enough for a monoline), `typicalUsd`, `record` (usd/title/date/house), `lots`, `sellThroughPct`, `bidCompNow`.
- Spot-checked live rows: `cards:basketball` index repeat-sale 3Y **+108% [95, 121]**, record $2.93M LeBron RPA; `rolex:daytona` demand **−3.6%** vs estimate, typical $58.9K, 2,934 lots, 93-pt demand series; `cartier:panthere` demand **+25%**; `space:flown` descriptive typical $3,033 / 1,607 lots.
- Labels: `app/lib/subcat-labels.ts` (`subCatLabel`).
- **Lot → drill-row mapping is deterministic** but slug grammar varies by vertical. A lot's row is found by trying, in order:
  - sports/science: `${lot.subCat}:${lot.drill}` (`cards:basketball`, `space:apollo`, `tech:computing`, `instruments:globes`)
  - science flown: `space:flown` when `lot.flown === true`
  - watches: `${lot.artist}:${lot.drill}` (`rolex:daytona`, `patek-philippe:nautilus`)
  - art: `art:${lot.subCat}` (`art:prints`)
  - design: `design:${lot.subCat}` then `design-material:${lot.drill}` (`design-material:walnut`)
  - culture: `culture:${lot.drill}` (subject) and `culture-kind:${lot.subCat}` (kind)

  **Enabling primitive (P0, ~30 lines, trivial):** a shared `drillRowFor(lot, drills): DrillRow | null` helper next to `subCatLabel` in `app/lib/subcat-labels.ts`, plus a `readSentence(row)` formatter reusing the honesty ladder already written twice (`SubMarketDrills.tsx:35-59`, `SubMarketDirectory.tsx:61-80`). Nearly every opportunity below consumes it. Vertical key for `drills[vertical]` comes from `ARTIST_MARKET[lot.artist]` (already imported on LotPage).

Design-grammar sources read: certificate `LeaderRow` (LotPage.tsx:180-192), comps-head + ledger rows (`lectr-lot-comps-head`/`lectr-lot-comp`, LotPage.tsx:77-89), drill read cells (SubMarketDrills.tsx:35-59 — green/red ONLY on real deltas, mono ONLY on % figures, descriptive rows in plain ink), quiet chips (LotCard.tsx:303-312 meta line, ComparableModal.tsx:806-830 chip row).

---

## Opportunities, per surface

### 1. /lot certificate (app/components/LotPage.tsx) — THE flagship anchor

**1a. "Sub-market" leader row on the certificate.**
- **Anchor:** `LotPage.tsx:653` — immediately after the Reference row (637-643) and Player row (646-652), which are the exact precedent: taxonomy context rows in the leaders block.
- **Data:** `drillRowFor(lot, market.drills)` — `market` is already destructured from `useFullLots()` at LotPage.tsx:265 (used for `houseCal` at :387). Zero new fetches.
- **Render:** `<LeaderRow k="Sub-market" sub="3Y +108% verified [95, 121]">Basketball · cards</LeaderRow>` — index rows get `tone` + the CI sub in SubMarketDrills' exact voice; demand rows get `+25% vs estimate`; descriptive rows plain ink `typical $671 · 73,053 lots` (no tone — honesty rule).
- **User value:** the certificate currently answers "is THIS lot cheap vs comps" but not "is the split itself appreciating" — a bidder deciding between a basketball card at +40% gap and a football card at +40% gap needs exactly this row (+108% vs +29% 3Y).
- **Effort:** small (with P0 helper: ~15 lines).

**1b. Flown badge on space lots.**
- **Anchor:** same leaders block, or the `lectr-lot-head` kicker at LotPage.tsx:563-571.
- **Data:** `lot.flown === true` + the `space:flown` drill row (typical $3,033 vs space-wide $1,996 — flown carries a ~1.5× typical premium the data can state).
- **Render:** sub on the sub-market row: `flown hardware · typical $3.0K vs $2.0K program-wide`.
- **User value:** flown-vs-not is THE price axis in space collecting; naming it on the certificate explains estimates that would otherwise look rich.
- **Effort:** trivial once 1a lands.

**1c. ComparableModal — same read, one line.**
- **Anchor:** `ComparableModal.tsx:816-829` (the house · category chip row: add a quiet `subCatLabel(lot.subCat)` chip) and one context line under `LotValueBlock` at :875.
- **Data:** modal receives `lot` (subCat/drill ride on it); needs `market` — one `useRayData()` call inside (module-cached, free).
- **Render:** quiet single line in the faint register: `Basketball cards · 3Y +108% verified` — no new section, mirrors the `lot.year · medium` line at :866-870.
- **User value:** the modal is the home feed's decision surface — the split read lands where the bid decision actually happens.
- **Effort:** small.

### 2. Home feed + lot cards (app/preview/terminal/TerminalHome.tsx, app/components/LotCard.tsx, app/components/FeedToolbar.tsx)

**2a. Ledger-table "Cat." cell upgrade — the cheapest visible win.**
- **Anchor:** `TerminalHome.tsx:805` — `<td className="t-cat">{CAT_LABEL[lot.category] || '—'}</td>`. `CAT_LABEL` (TerminalHome.tsx:157-164) prints the useless `Object` for every sports/science/culture lot (the bulk of the book).
- **Data:** `lot.subCat` (on every eager lot) → `subCatLabel`.
- **Render:** `{lot.subCat ? subCatLabel(lot.subCat) : CAT_LABEL[lot.category] || '—'}` — `Cards`, `Game-used`, `Signed photos`, `Wristwatches` instead of `Object`.
- **User value:** the desktop default view (table earns ≥900px by default, TerminalHome.tsx:298-300) becomes scannable by kind at zero layout cost.
- **Effort:** trivial (one line + import).

**2b. Sport lens reads the stamped field, not the title heuristic.**
- **Anchor:** `TerminalHome.tsx:420` — `if (f.sport) arr = arr.filter(l => (sportOf(l.title) || 'Other') === f.sport);` and the pill counts at `FeedToolbar.tsx:108-111` (same `sortOf(l.title)` recompute).
- **Data:** `lot.sport` (crawl-stamped, `types.ts:181`; 2,383 lots in the sold pool, present on upcoming sports lots).
- **Render:** invisible — `(l.sport ?? sportOf(l.title)) || 'Other'` in both places. Same pills, honest counts.
- **User value:** the stamped field is build-verified; title parsing misses lots the pipeline already classified — the lens stops dropping lots.
- **Effort:** trivial.

**2c. Kind facet pills inside sports/culture/science verticals.**
- **Anchor:** `FeedToolbar.tsx:107-120` — the sports-pills block is the template; add a `kind` axis to `FeedFilters` (FeedToolbar.tsx:15-27) counted from `lot.subCat` and filtered at TerminalHome.tsx:411-452.
- **Data:** `lot.subCat` on eager lots. Counts from the live book (e.g. today: cards 2,749 · game-used 527 · photos 257…).
- **Render:** a second pill row in the toolbar's existing pill grammar: `Cards 2,749 · Game-used 527 · Tickets …`.
- **User value:** "show me only game-used" is the cut collectors shop by; today it needs a text query.
- **Effort:** small-medium (state plumbing through FeedFilters + reset effect at TerminalHome.tsx:319-325).

**2d. Quiet sub-market chip on the compact LotCard row.**
- **Anchor:** `LotCard.tsx:306` — the meta line deliberately suppresses the chip for `category === 'object'` lots (`catLabel && lot.category !== 'object'`), leaving objects with house · date only.
- **Data:** `lot.subCat` (+ `lot.drill` where present).
- **Render:** fill the suppressed slot: `· Cards · Basketball` in the same faint register. Label-only — no read on cards (market.json isn't prop-drilled here and a % on every card would be noise against the signal row).
- **User value:** the object-lot cards (most of the feed in sports/culture) finally say what the thing IS.
- **Effort:** trivial.

### 3. Maker pages (app/[artist]/page.tsx, app/components/ArtistHero.tsx)

**3a. Watch maker → model-family ledger.**
- **Anchor:** `app/[artist]/page.tsx:232` region — a new section between `ArtistHero` and the gated PriceChart/UpcomingLots sections (:100-130), watches-market makers only.
- **Data:** `market.drills.watches.filter(r => r.parent === slug)` — verified: rolex has 9 family rows, patek 8, cartier 6, AP 4, omega 3. Rows carry demandNow + 93-pt series + typical + record + lots.
- **Render:** SubMarketDrills' exact row grammar (`Daytona · −4% vs estimate · $58.9K typical · 2,934 lots`), headed `Model families · demand by line` in the `lectr-lot-comps-head` voice.
- **User value:** a Rolex page that says Cellini +20% while Daytona sits −4% is the single most actionable watch read the data holds — which line to bid, per maker, on the maker's own page.
- **Effort:** small (data is pre-aggregated; it's one filtered map into an existing row component).

**3b. Art maker kind split, client-side.**
- **Anchor:** same region for art-market makers; the page already loads the maker's full corpus (`allLots.filter(l => l.artist === slug)`, [artist]/page.tsx:179).
- **Data:** client medians per `lot.subCat` over the maker's sold lots (Picasso: 11,639 prints vs 4,812-market originals — per-maker numbers computable in one pass), with the market-level `art:prints` drill row (`+5% vs estimate`) as the quiet sub.
- **Render:** PlayerPage's cats table grammar (PlayerPage.tsx:148-168): leader rows `Prints & multiples …… 11,639 sales · $12K median`, sub `market +5% vs estimate`.
- **User value:** "is a Picasso print or a Picasso original the better market right now" — the CategoryFilter lens (:149) filters but never states the numbers side by side.
- **Effort:** medium (a memoized aggregation + gating so thin makers don't render junk rows).

### 4. /player dossiers (app/components/PlayerPage.tsx)

**Sport context subs on the category table.**
- **Anchor:** `PlayerPage.tsx:148-168` — the cats leader table; alternatively the header sub line :141-145.
- **Data:** `entry.sport` ('Basketball' → slug lowercase) → `drills.sports` rows `cards:basketball` (index +108% 3Y) and `game-used:basketball` (demand). `market` is available from the `useRayData()` call already mounted at :82.
- **Render:** the Cards row's `lectr-lot-sub` slot (currently `N sales`) grows the read: `73K-lot market · 3Y +108% verified`; Game-used row likewise. Tone rules per the honesty ladder.
- **User value:** the dossier shows Jordan's own medians but zero market beta — whether his cards are riding a +108% sport tide or outrunning it is the difference between player edge and market edge.
- **Effort:** small.

### 5. /value page (app/value/page.tsx)

**Sub-market context on flagged rows.**
- **Anchor:** mobile/stacked title line `value/page.tsx:404-409` (append to the `ray-value-mobdate` span's register); desktop ledger columns (:203) are a fixed 8-col grid — do NOT add a column; instead put the read in the ComparableModal (opportunity 1c covers it: every row opens that modal at :382).
- **Data:** `drillRowFor(d.lot, market.drills)` — note `market` is not currently destructured from `useFullLots()` at :42; it's in the hook's return already.
- **Render:** quiet appended fragment `· basketball cards +108% 3Y` on the title line; nothing on the desktop grid.
- **User value:** the flag says "cheap vs comps"; the drill row says whether the comps themselves are in a rising or falling split — a −46% demand split (memorabilia:golf) flag is a different bet than a +108% index split flag.
- **Effort:** small (given 1c lands, the mobile line is optional polish — rank it behind the modal).

### 6. /saved watchlist + ⌘K (app/saved/page.tsx, app/components/CommandK.tsx)

**6a. ⌘K sub-market entries.**
- **Anchor:** `CommandK.tsx:42-77` — the items memo; add a `kind: 'sub'` block from `Object.values(market.drills).flat()` (needs `market` from the `useRayData()` already mounted at :39).
- **Data:** all 92 rows; label = `r.label`, hint = the read sentence (`+108% 3Y verified · 73K lots` / `+25% vs estimate`), path = `/analytics` (or `/sub?id=` once opportunity 7 exists).
- **Render:** existing `ray-ck-item` rows; searching "daytona" or "flown" or "panthere" — which today match nothing unless a live lot title contains the word — returns the market itself.
- **User value:** the taxonomy becomes navigable from anywhere; today drills are only reachable via /analytics and /artists.
- **Effort:** small.

**6b. Saved-list sub-market grouping/chips.**
- **Anchor:** the upcoming section of `saved/page.tsx` (:127-131 feeds the grid/ledger around :280+).
- **Data:** `lot.subCat`/`lot.drill` on saved lots (savedLots resolve from allLots, :101-104).
- **Render:** either quiet chips per row (2d's chip reused) or group headers by drill in the kicker voice.
- **User value:** moderate — watchlists are small; a collector watching 6 Daytonas and 3 card lots sees their exposure by split.
- **Effort:** small (chips) / medium (grouping). Lower priority.

### 7. /ref dossiers (app/components/RefPage.tsx)

**Family-level context line above the reference.**
- **Anchor:** `RefPage.tsx:128-142` — the header sub line (`N sales · median · past year · beat-high · houses`).
- **Data:** the family drill row `${entry.maker}:${family}`. **Caveat:** `refs.json` doesn't carry the family; it must be derived from a lot — `onBlock[0]?.drill` (:84-87) or a scan of `allLots` for maker+ref carrying `drill`. Robust version = one build-time field (`family`) added to refs.json by the pipeline that already computes `drill` (larger, touches scripts).
- **Render:** appended fragment ` · Daytona family −4% vs estimate · 2,934 lots`, linking nowhere today (links to /sub if built).
- **User value:** a reference with 12 sales inherits a 2,900-lot family read — exactly the "level above" a bidder needs when the ref-level n is thin.
- **Effort:** small with the derivation caveat (renders only when a drill-carrying lot exists); medium for the honest build-time version.

---

## Is a dedicated /sub?id=cards:basketball dossier warranted? — YES

Pattern cost, measured against the two templates the prompt names:
- `/ref` = `app/ref/page.tsx` (thin Suspense query wrapper, ~30 lines) + `RefPage.tsx` (200 lines incl. module-cached `refs.json` fetch, monoline chart, ledger rows).
- `/player` = same wrapper + `PlayerPage.tsx` (243 lines incl. `players.json` fetch).

A /sub dossier is **cheaper than both**: its data is already in the eager phase-1 `market.json` — no module cache, no new fetch, no build artifact. Page composition, all from existing pieces:
- Masthead: label + the strongest read with CI (SubMarketDrills' readCell voice), `lots`/`sellThroughPct`/`estCoverage` in the sub line.
- The 93-pt `demandSeries` through `RefLine`'s monoline (RefPage.tsx:51-73) where readType is demand; index rows print the CI'd move as the RecordPlate-style figure.
- Leader rows: typical, record (with title/house/date — real data verified), bid competition (`bidCompNow`).
- "On the block now": `allLots.filter(l => isLiveUpcoming(l) && drillRowFor-matches)` — the same client filter RefPage runs at :84-87.
- Estimated ~250 lines + a 30-line query page. **Medium** effort.

The strategic argument: opportunities 1a, 1c, 2d, 4, 6a, and 7 all produce labels/reads with nowhere to click. One /sub page turns every one of them into a link (the Reference→/ref leader row at LotPage.tsx:637-643 is the exact precedent), and gives `SubMarketDirectory` + `SubMarketDrills` rows their missing drill-down. Build it after the top certificate/feed layers land.

---

## RANKED (value ÷ effort)

| # | Opportunity | Anchor | Effort | Why this rank |
|---|---|---|---|---|
| 0 | `drillRowFor` + `readSentence` helpers | app/lib/subcat-labels.ts | trivial | prerequisite for 1,4,5,7,8,12 |
| 1 | Lot certificate "Sub-market" leader row (+flown sub) | LotPage.tsx:653 | small | flagship decision surface; data already on the page |
| 2 | Feed table Cat. cell → subCatLabel | TerminalHome.tsx:805 | trivial | one line; kills 'Object' on the default desktop view |
| 3 | Sport lens reads `lot.sport` | TerminalHome.tsx:420, FeedToolbar.tsx:108-111 | trivial | correctness: stamped field over title heuristic |
| 4 | Player dossier sport-market subs | PlayerPage.tsx:148-168 | small | fills the dossier's only real gap (market beta) |
| 5 | Watch maker family ledger | app/[artist]/page.tsx:232 region | small | 9 pre-aggregated Rolex rows; the best watch read shipped |
| 6 | ComparableModal chip + read line | ComparableModal.tsx:816-829, :875 | small | reaches every feed/value row's decision moment |
| 7 | ⌘K sub-market entries | CommandK.tsx:42-77 | small | makes the taxonomy navigable; 'daytona' finds the market |
| 8 | /sub?id= dossier page | new, /ref pattern | medium | cheaper than /ref (no fetch); gives 1,4,6,7 a destination |
| 9 | LotCard quiet subCat chip | LotCard.tsx:306 | trivial | fills the suppressed object-lot slot; label-only |
| 10 | FeedToolbar kind pills | FeedToolbar.tsx:107-120 | small-medium | real shopping axis; needs filter-state plumbing |
| 11 | /ref family context line | RefPage.tsx:128-142 | small* | *derivation caveat; medium if refs.json grows `family` |
| 12 | /value mobile row context fragment | value/page.tsx:404-409 | small | mostly superseded by #6 (modal) |
| 13 | Art maker kind split | app/[artist]/page.tsx | medium | good numbers, partial overlap with CategoryFilter |
| 14 | Saved chips/grouping | saved/page.tsx:127+ | small-medium | small audiences per list; do chips only |
