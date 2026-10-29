# DESK — the standing law of /profile

`app/profile` is ONE page: the collector's desk. This page is the law in one
sitting as it stands tonight; each file's header is the long form, the tests
under `app/profile/**/__tests__` the proof. The recommender it reads is its
own law, [PICKS.md](PICKS.md). Last revised Oct 29 2026 (passes 10–14).

## 1 · One page, layered

```
masthead + cockpit        page.tsx DeskMasthead · desk/cockpit.tsx (four cells + the 14-day strip)
section bar (sticky)      desk/sectionbar.tsx — one item per band, its figure, the current one underlined
Today                     desk/rooms/adapters Today → today.tsx TodayBand (never folded; carries DailyNudge)
Watching · For you · Week · Record ⫽ Collection · Names     each group FOLDED to its first screen
More                      Budget · Signals · Market · History — CLOSED to one row each, mounted on the tap
Account                   desk/rooms/account — rides under every group
```

- **`desk/sections.ts`** is the desk, top to bottom: `SECTIONS` (id · key ·
  group · tab · Component · meta · when · fill). `TABS` survive only as the
  GROUPING and the link resolver: every `#anchor`, `g`-chord, push link and
  email link (`#tab-watching`) resolves through `tabOf` / `SUB_ANCHORS`
  (`#settled` → History, `#inbox` → Signals, `#week-YYYY-MM-DD` → the week).
  `tabItemsOf` gives each group its lead figure (`NAMESAKE`: Collection wears
  Portfolio's piece count, Week its own); `TAB_NO_COUNT` keeps Budget's band
  a setting, not a count. `GROUP_ORDER` in page.tsx is the read order;
  `MORE` names the closed rooms; `TAB_ORDER` puts Your calls before the
  record inside Record.
- **`desk/fold.tsx`** — `Clamp` mounts a room whole and shows its first
  screen, cut on the last whole row (`[data-nav-row]`), one "Show all N ·
  Room" opens it in place; `Closed` is the More rooms' one row (mark · name ·
  figure · hint) and the tap mounts them; a clamped room below the first
  screen is a **lazy seat** (IntersectionObserver, rootMargin 100%) as tall as
  the clamp until the reader is a screen away. A jump, a chord or a deep link
  into a fold opens it first (`OPEN_TAB_EVENT` → `JUMP_EVENT` → rail.tsx's
  landing poll). The section bar's figures come from the registry, never
  from a mounted room.
- Record + Collection pair into one band at ≥ 900px; Collection's band is
  ink. A cold desk (no save, pick, follow) mounts its rooms whole — the quick
  start and the index are the invitation.

## 2 · The row grammar (`desk/row.tsx`)

Every lot on the desk is one `DeskRow`: `[photo] title / maker · house ·
estimate / [tag] meta facts / decision line` with ONE figure on the right,
`figureKind` naming what it is — `est` · `bid` · `hammer` · `clock` · `mark` ·
`plan`. A row needs only a `RowLot` (id, title, house, photo), so an archived
save, a graded call or a pick's snapshot prints in the same grammar. The whole
row is the link to `/lot?id=`; every control (My max, Details, the action)
sits above the stretched link with its own ≥ 44px target.

The title link carries the row as **one sentence** (`figureWordsOf`): the tag,
the title, the sub-line, then the figure with its meaning — "estimate
$2.3M–$3.45M", "live bid $8K, 12 bids", "hammered $1.3K, +12% vs estimate",
"closes 8:30 AM, in 14h". A node sub/figure passes its words
(`subText` / `figureText` / `figureSubText`).

Keys (`desk/keys.ts`): **j/k** walk `[data-nav-row]` rows and focus the title;
**Enter** opens the lot; **Shift+Enter** or **o** opens Details where a row
has them (the dossier takes focus, Close hands it back); **g** then a letter
opens that room and lands on it (`keysLegend`; a room not on the desk says
so); **?** opens the legend. Every landing writes the address bar.

## 3 · Every figure, and where it is derived

Nothing is derived in JSX. Each figure has ONE pure source (a test greps the
rooms for inline arithmetic in figure slots — `head-figures-pure.test.ts`).

| figure | source | rule |
|---|---|---|
| saves → rows, orphans, shelves | `desk/derive.ts` `resolveSaved` · `splitOrphans` · `partitionSaved` | aliases walked before an orphan is declared; a ledger not loaded is never "withdrawn"; a row past its sale day with no result is on the settled shelf but **awaiting results**, never settled (`pendingResultsOf`) |
| Watching total · priced · one-bound · flagged · next · closes today | `derive.watchSummaryOf` ← `desk/priced.ts pricedTotal` | **estimate aliases are USD** (the build converts; a GBP Bonhams lot carries no fxRate and its `estimateLow/High` ARE dollars — never convert again); a one-bound estimate is "from $X", counted, never summed; `closedEarlierToday` is said apart from `closesToday` (the close instant is behind the minute clock) |
| what changed (moved signals, new bids) | `derive.watchChangesOf` | a legacy direction-unknown save never counts as moved; new bids = live count − saved `bid_count`, no baseline → no claim |
| the record (median vs estimate, n, split, series) | `derive.recordOf` | judged = sold with a price against an estimate (`utils.overEstimatePct`, premium inside); **`oneSidedN`** says how many were judged against a one-bound estimate; the flagged-vs-rest split prints at 3 + 3 |
| since your last visit | `derive.sinceLastOf` | SETTLED means a result posted (`status: 'sold'`), never a pending row |
| Did you win? · one-tap clear | `derive.unclaimedOf` | one filter for the count and the ids it dismisses: sold, not owned, not dismissed, orphans not provisional |
| collection totals | `derive.collectionTotalsOf` | the appraisal total is the ENGINE's over the pieces it appraised; "marked vs bought" reads `appraisedOfPaid` vs `appraisedPaid` (the SAME pieces, n said) |
| a mark's basis | `desk/rooms/collection-logic.ts markBasisText` | "12 comps · as of Oct 12" (the W31 settled appraisal's clock, `lot.valueAsOf`) · "live, read nightly" on the block · comps alone on a pre-clock value |
| My max vs the bid · Needs you | `priced.liveBidUsd` · `derive.overMaxOf` · `derive.needsYouOf` | a non-USD bid with no rate is unreadable (null — never a false alarm); Needs you is **counted once** (over max ∪ closing today) + results; a watch that closed earlier today waits on the house, not you |
| Your calls | `edge/edge.ts gradeDesk` | called = est mid × (1 + call); miss = realized ÷ called − 1; hit ±`EDGE_HIT_PCT`; a save dated **after the hammer** is not a call (`excluded.afterHammer`); `estSide` names a one-bound estimate ("vs est. low $2K"); the streak says how many hits rest on a **provisional** ledger result; medians print at `EDGE_MIN_N`; signed calls exist only since `SIGNED_SIGNAL_SINCE` |
| Portfolio marks, growth, if sold now | `portfolio/portfolio.ts` | appraisal = the engine's `lotVerdict` only (never a client re-appraisal); every mark prints n comps and `as of`; "if sold now" = expected hammer less the house tier's ASSUMED commission, named as such; a maker's YoY is /makers' own words |
| Budget plan · all-in | `budget/budget.ts` · `lib/premiums.ts` | your max leads, then the engine's max bid, then the labelled anchor; a night SUMS only engine/room-priced rows (estimate midpoints listed apart unless asked; one-bound never); all-in = the house schedule **on the sale date** (era-dated REA, Wright/Rago/LAMA, Christie's/Sotheby's tiers), the row saying "assumed" when no schedule is on file (`premiumSource`) |
| Names: live count, soonest sale, pulse | `names/names.ts` | the calendar sums USD aliases once; a category follow has no entity and no sold history; the 12-mo median never prints without its n and scope; **one sale has no YoY** (`pulseOf` drops n < 2) |
| Your week · the 14-day strip | `week/week.ts planWeek` · `viewOf` · `weekLeadOf` · `desk/cockpit-logic hammerStrip` | watch > pick > name, once each; a timed close lands on the reader's day, a date-only sale on its house day; names never add to the money; the tab counts what the room LISTS (hidden picks are not counted); the strip equals the week day by day (`tab-parity.test.ts`) |
| Today's reads | `desk/rooms/today-logic.ts todayReadsOf` | one read per lot in evidence order (hot > quiet > soon > comps > below), `READS_MAX` 8; **the velocity freshness gate**: "+5 bids in 24h" prints only while the crawl is fresh (`LotCard.crawlIsFresh`: today's stamp or an ISO inside 24h); a percentile is cited only from the median up |
| the section bar's figures | `sections.tabItemsOf` | each equals its room's head figure on the same desk (`tab-parity.test.ts`) |

Standing honesty rules: green/red only on a MEASURED delta (a miss off your
call is ink); a reference band is a labelled range that never enters a total;
abstention prints its reason (a failed fetch is never a fact about a lot);
every total says its basis beside it ("at estimate midpoint · 3 of 5 priced ·
1 from one bound, not summed").

## 4 · The Daily Desk

`scripts/lib/daily-desk.ts planDesk` + `daily-desk-html.ts renderDesk` are the
paper; they import nothing Node-only, so **the desk builds today's edition on
the page** (`desk/edition-model.ts` maps the desk's saves, book, settled rows,
recs and follows onto the runner's inputs; `desk/edition.tsx` renders it in a
sheet). The glance's figures read the desk's own rules (`pricedTotal`,
`liveBidUsd`, `pricedBasisText`) and parity is tested
(`derive-figures.test.ts`). The morning send (`scripts/daily-desk-send.ts`)
runs the same `planDesk` per opted-in reader.

Review recipe: `npx tsx scripts/daily-desk-send.ts --dry-run --preview-dir out/dd
[--only <email>]` renders every reader's paper to files without sending; in
the workflow the dry run uploads them as the `daily-desk-preview` artifact.

## 5 · The account's migrations

| migration | gives | without it |
|---|---|---|
| `0010_my_max` | `saved_lots.max_usd` — My max graded, summed, flagged | My max is session-only (toast); Budget's plan leads with the engine's figure |
| `0011_daily_desk_email` | `email_prefs`, the recipients function, one-click unsubscribe | no paper; the Account toggle and the nudge are absent |
| `0012_result_dismissed` | `saved_lots.result_dismissed` — "none of these were me" | a dismissal lasts the session; the inbox and Needs you re-count on reload |
| `0013_interests` | `user_interests` — the quick start's markets and price range on the account | the band and markets live on the device only; the paper cannot read them; picks differ by device |

All additive and idempotent; the client tolerates each absence
(`account.tsx NEW_COLS` fallback) and never sends the column it lacks.

## 6 · Re-reading the desk

- **A seeded desk, locally**: `next dev --webpack` in the worktree; in the
  browser set `localStorage['ray-saved-lots']` to a JSON list of saves
  (`{ id, savedAt, estMid, signalPct, bidCount, owned?, maxUsd? }`),
  `lectr-follows` and `lectr-picks` likewise, then reload `/profile`.
  `?preview=signedout` shows the signed-out desk in dev. Freeze the clock the
  way the shot rig does (`SHOT_NOW`, Playwright `clock.setFixedTime`) when a
  countdown must read the same twice.
- **The frames**: `node scripts/ui-shots.mjs` — `profile-desk-{desktop,mobile}-{light,dark}`
  is /profile on a POPULATED desk, seeded at runtime from the frozen served
  payload (`resolveDeskSeed`: eight live lots across three houses, six
  settled, follows from their makers); a missing baseline fails; only
  `--approve` writes one.
- **The figures**: `npm test` — `derive-figures`, `tab-parity`,
  `today-logic`, `collection-logic`, `head-figures-pure`, plus each room's
  own (`edge`, `portfolio`, `budget`, `names`, `week`).
- **The picks**: `scripts/recs-sweep.ts` (eleven desks, read as the owner) and
  `scripts/recs-eval.ts` (holdout, personas, reason truth) — PICKS.md §7.

## 7 · Known gaps (Oct 29)

- `utils.overEstimatePct` judges a one-bound estimate against its single
  bound as the "midpoint" (the app-wide convention, kept identical to the
  demand index); the desk SAYS so (`oneSidedN`, `estSide`) rather than
  changing the basis.
- The Record judges every settled save, including one saved after it sold;
  only Your calls excludes it (`afterHammer`). A results' `vsEst` in the paper
  reads the save-time `est_mid`, built with the same one-bound fallback.
- `settledCount` ("N settled watches" on History) is `sold + soldOrphans`; the
  pending split is printed beside it, not removed from it.
- The cockpit's picks-only cell counts `recs ∪ closingPicks`; the For-you tab
  counts `recs` — they can differ by the return loop's closers.
- A row saved with no `savedAt` cannot be dated against the hammer and is
  graded as a call.
- Collection's tab count is Portfolio's `desk.collection.length`; before the
  archive lands it includes the device's kept settled rows while the
  collection room counts resolved rows — equal once loaded.
- The week's meta reads the device's picks toggle through `safe-storage`;
  during SSR there is no device and the count is the default's (picks hidden
  when a watch is on the week).
