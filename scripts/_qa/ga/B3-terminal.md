# B3 · GA-READINESS AUDIT — TERMINAL / LANDER COMPONENTS

Date: 2026-08-03 · Scope: `app/preview/terminal/*` (TerminalHome, SubMarketBoard, TonightsWall,
IndexHero, HeroChart, MarketChart, Sparkline, RollingNumber, emblems, hooks, verified, VerticalGhost,
style.module.css — every line read), `app/components/{Greeting,MarketSwitch,Masthead,RayEntrance,CountUp,Flick}.tsx`,
`app/page.tsx` + the 7 lander re-export pages (`/art /collectibles /culture /design /science /sports /watches`).
Cross-referenced against `app/lib/market.tsx`, `useRayData`, `useSavedLots`, `ComparableModal`, `globals.css`,
`next.config.js`. Read-only; no edits. Dead-CSS list produced by scripted cross-reference of all 442 local
classes against every `styles.X` use in the 7 importing files (url()/data-URI and `:global()` false positives excluded).

Verdict: **0 BLOCKER · 7 PRE-GA · 15 POST-GA.** No hooks-rules violations, no missing cleanups, no
missing/index list keys, no unguarded localStorage. The page is fundamentally sound; the PRE-GA items are
a modal-history × market-switch interaction, one CSS-cascade layout break, two broken animation gates,
one honesty bug in evening mode, and two a11y gaps in surfaces the audit was explicitly pointed at.

---

## PRE-GA findings

### 1. [PRE-GA] Closing the lot modal after a market switch reverts the URL/market
`app/preview/terminal/TerminalHome.tsx:319-339` × `app/lib/market.tsx` (`setMarket` pushState)
Scenario: open a lot (pushes the `lectrLot` history entry on `/`), switch market via MarketSwitch while the
modal is open (`setMarket` pushStates `/art` ON TOP of the lectrLot entry), then close the modal with the X.
`setTableLot(null)` sees `modalPushed.current === true` and calls `history.back()` — which pops back to the
stale lectrLot entry whose URL is `/`. The market flips back to the previous one under the reader, and the
lectrLot entry is now the live entry (next Back does a silent no-op close). Nothing closes or invalidates the
modal entry when the URL moves.
Fix (pick one): (a) close the modal on market change — `useEffect(() => setTableLotRaw(null) /* + clear
modalPushed via replaceState */, [activeKey])`; or (b) in `setTableLot(null)`, only `history.back()` when
`window.history.state?.lectrLot` is still true, else just `setTableLotRaw(null)` and reset the ref. (b) also
hardens finding 2.

### 2. [PRE-GA] Rapid modal close → reopen self-closes and strands a history entry
`app/preview/terminal/TerminalHome.tsx:319-339`
Scenario: close via X (`history.back()` dispatched — traversal is async), immediately open another lot before
`popstate` lands. The reopen sees `modalPushed.current === false` and pushStates a fresh entry; the pending
back-traversal then pops **that** entry, `onPop` fires, and the just-opened modal instantly closes (and on
some engines an orphan entry remains). Reproducible with fast taps on mobile.
Fix: same state-check as 1(b) — before pushing in `setTableLot(lot)`, skip the push if
`window.history.state?.lectrLot` already true (set `modalPushed.current = true` instead); in `onPop`, also
ignore pops whose destination state still carries `lectrLot`.

### 3. [PRE-GA] Duplicate `.hero` rule defeats the ≤900px hero layout override
`app/preview/terminal/style.module.css:1961-1967` (vs `:1360-1367` media override, base at `:136-147`)
The Tonight's-Wall block re-declares bare `.hero { grid-template-areas: "head rail" "stage stage"
"movers movers" "wall wall"; }` AFTER the `@media (max-width: 900px)` override that sets the single-column
areas `"head" "stage" "rail" "movers"`. Same specificity, later in source → the two-column area map wins at
**every** width. In the 821–899px viewport band (desktop composition still renders; `isMobile` flips at 820)
the media block's `grid-template-columns: 1fr` applies but the areas force a phantom second column: the
metrics rail gets squeezed into an implicit auto column beside the headline instead of stacking below it.
Also note: "wall" is a vestigial area — TonightsWall no longer renders inside the hero grid (it lives in
`.wallSeparator`, TerminalHome.tsx:696).
Fix: delete the `.hero` re-declaration at 1961-1967 entirely (the wall area is dead; the base at 136 already
carries the correct desktop areas).

### 4. [PRE-GA] `styles.hcTerminus` does not exist — the terminus pulse ignores reduced-motion
`app/preview/terminal/HeroChart.tsx:300` × `style.module.css:3814`
`<g className={reduce ? undefined : styles.hcTerminus}>` references a class never defined in the module
(`styles.hcTerminus` → `undefined`, className omitted — the only used-but-undefined class in the whole
module). The actual pulse lives on `.hcTerminusRing` (css:3814) which self-animates `hcPulse 2.6s infinite`
unconditionally and has **no** `prefers-reduced-motion` block. Net: the reduced-motion gate is a complete
no-op and the hero terminus pulses forever for reduced-motion users — the one place the Terminal breaks its
otherwise airtight motion doctrine.
Fix: `className={reduce ? undefined : styles.hcTerminusRing}` on the ring circle itself (move the class off
the CSS's unconditional selector), or add `@media (prefers-reduced-motion: reduce) { .hcTerminusRing
{ animation: none; opacity: 0; } }` and delete the phantom `styles.hcTerminus` reference.

### 5. [PRE-GA] Evening mode: "closes today" judged on the UTC day, not the reader's day
`app/preview/terminal/TonightsWall.tsx:90-91`
`evening` is correctly local (`new Date().getHours() >= 18`, effect-mounted — hydration-safe), but
`todayIso = new Date().toISOString().slice(0,10)` is **UTC**. Every US evening after ~5-8pm local, UTC has
already rolled to tomorrow, so `closesToday` (`saleDate <= todayIso`) tags lots hammering **tomorrow** with
"closes today · +N bids" — exactly the window evening mode exists for. Direct honesty-doctrine violation
(a promise about time rendered on the wrong clock).
Fix: `import { localToday } from '../../utils'` and use it (the same clock the feed/nextHammer already use);
compute it inside the `useMemo`/render only where `evening` is true to keep the SSR path inert.

### 6. [PRE-GA] Feed table `<tr role="button">` — no Space key, and nested interactives become presentational
`app/preview/terminal/TerminalHome.tsx:784-791` (rows), `:812-818` (maker Link), `:849-858` (save button)
The clickable `<tr>` carries `role="button"` + `tabIndex={0}` but only handles Enter (`:787`) — role=button
requires Space activation (Space also page-scrolls here). Worse, per ARIA, children of `role="button"` are
presentational: the maker `<Link>` and the save `<button>` inside each row are semantically erased for AT
users (and role=button on `<tr>` destroys the row/gridcell semantics the `<table>` promises). Keyboard-tab
order still reaches them, but a screen reader announces one giant button.
Fix: drop `role="button"` from the `<tr>`; make the title cell's text a real button (the same pattern
FeedRow already uses at `:219`), or keep row-click as a pointer affordance only and add
`if (e.key === ' ') { e.preventDefault(); setTableLot(lot); }` plus `role`/semantics left intact.

### 7. [PRE-GA] Read-card dialog (`readPop`) has no focus management
`app/preview/terminal/SubMarketBoard.tsx:587-625`
`role="dialog" aria-modal="true"` + ESC (`:496-501`, cleanup correct) + backdrop click are right, but focus
is never moved into the card, never trapped, and never restored to the invoking TapeRow on close; body
scroll isn't locked. A keyboard user who opens a read stays focused on the tape behind the overlay
(aria-modal then hides the focused element from AT — a trap in the bad sense). ComparableModal
(`app/components/ComparableModal.tsx:428-466`) already implements the full pattern — ESC, Tab trap,
focus restore.
Fix: reuse ComparableModal's trap effect: on open, `closeBtn.focus()`; trap Tab within `.readPopCard`;
restore `document.activeElement` on close. 15 lines, pattern already in-repo.

---

## POST-GA findings

### 8. [POST-GA] `ttRingIgnite` keyframes don't exist — mobile wall verdict-ring ignite is a silent no-op
`style.module.css:2113` (only reference; no `@keyframes ttRingIgnite` anywhere). The mobile strip's
"rings light left→right" flourish never plays; the ring shows statically from the base `.wallPlate[data-tone]`
style (no content loss). Fix: add the keyframes (opacity/box-shadow 0→1) or delete the two-line rule.

### 9. [POST-GA] TonightsWall entrance rise is not reduced-motion gated
`TonightsWall.tsx:111-112` (`data-anim={play}` only reflects `fromCache`) × css `:2069`, `:2104-2110`.
The 520ms rise+fade plays for reduced-motion readers (it resolves to visible, so nothing is lost, but every
sibling — RayEntrance, IndexHero `rise()`, HeroChart wipe — gates on the OS switch). Fix: `const reduce =
useReducedMotion(); data-anim={play && !reduce ? 'true' : undefined}`.

### 10. [POST-GA] Table view replays its entrance on cached back-nav (grid view doesn't)
`TerminalHome.tsx:763` — the table wrapper always carries `ray-feed-rekey` (420ms `rayFeedIn`,
globals.css:803), while the card/row branches gate it on `fromCache` (`:887`, `:899`). A cached revisit with
the table preference re-fades the whole ledger — the one ungated replay left on the page. Fix:
`className={fromCache ? undefined : 'ray-feed-rekey'}` (keep `key={feedKey}` so lens changes still rekey;
note filter-driven rekeys are user-initiated and fine either way — gate only the mount case if preferred,
e.g. also keying on a `mounted`-style flag).

### 11. [POST-GA] engineHero signal scope mismatch + frozen `Date.now()`
`TerminalHome.tsx:442-460`. Candidates are filtered by `belowIds` (signals computed vs `marketLots`,
`:397-407`) but re-scored with `lotSignal(l, allLots)` — in a scoped market the hero's multiple/confidence
can disagree with the same lot's row signal one section below (both real, different comp pools; reads as a
contradiction). Also `Date.parse(l.saleDateTime) > Date.now()` is evaluated only when the memo's deps
change — a timed lot that closes while the tab sits open stays showcased. Fix: pass `marketLots` for
consistency; accept the staleness or key the memo on a coarse clock tick.

### 12. [POST-GA] Layer-chip "tap to isolate" cannot be pinned with a mouse
`IndexHero.tsx:192-194`. Click sets `litLayer`, but the subsequent `onMouseLeave` clears it
(`cur === key → null`), so the pinned state (aria-pressed) is unreachable for mouse users — isolation works
as hover-only on desktop, tap-to-pin on touch. Fix: track pinned separately from hovered (two states,
highlight = pinned ?? hovered), or skip the mouseleave clear when the chip was clicked.

### 13. [POST-GA] `role="tablist"/"tab"` without tabs semantics
`IndexHero.tsx:273-279`, `:374-380` (tfToggle) and `MarketSwitch.tsx:100`, `:128`. No arrow-key
navigation, no `tabpanel`/`aria-controls`; AT announces a tab UI that doesn't behave like one. Fix: use
`role="radiogroup"`/`aria-checked`, or plain buttons with `aria-pressed` (the switch already re-scopes in
place, which is closer to a radio than a tab).

### 14. [POST-GA] HeroChart scrub is pointer-only and `role="img"` flattens the data
`HeroChart.tsx:227-234`. No keyboard access to the crosshair/readout; the aria-label names the chart but
none of its readings. Acceptable floor for GA (the rail/chips carry the figures as text); a
`aria-label` including the latest reading, or arrow-key scrubbing, would close it.

### 15. [POST-GA] Masthead serial fallback renders `new Date()` — hydration mismatch on day boundaries
`app/components/Masthead.tsx:50`. When `serial` is undefined (`/value`, `/profile` before `lastCrawl`
resolves), the build bakes the build-day serial and the client re-derives the user-day — a text mismatch
whenever they differ (React 18 falls back to client render + console error). The component's own doc says
"renders identically from server and client". Fix: require `serial`, or fall back to a build-time constant
(`process.env.NEXT_PUBLIC_BUILD_DAY`) instead of render-time `Date`.

### 16. [POST-GA] Raw-text `<style>` blocks are one apostrophe away from a hydration break
`TerminalHome.tsx:623-643`, `Masthead.tsx:53-58`, `RayEntrance.tsx:86` — all three are currently clean
(verified char-by-char: no quotes/apostrophes/angle-brackets/ampersands, so React's escaping is a no-op),
and RayEntrance's NOTE documents the discipline. But the guard is a comment, not a mechanism — a future
CSS comment with a `'` or a `>` child combinator silently breaks raw-text hydration. Fix: convert all three
to `dangerouslySetInnerHTML={{ __html: css }}` for belt-and-braces.

### 17. [POST-GA] `/preview/terminal` legacy path 404s; comment claims it redirects
`app/page.tsx:4` says "the legacy /preview/terminal path redirects here", but there is no
`app/preview/terminal/page.tsx` and `output: 'export'` (next.config.js) cannot serve `redirects()`. Any old
bookmark/shared link 404s. Fix: add a one-line stub page re-exporting `../../page` (mirrors the 7 landers)
with `robots: noindex`, or fix the comment and add a host-level (Cloudflare) redirect rule.

### 18. [POST-GA] `useMediaQuery` uses `MQL.addEventListener` with no fallback
`app/preview/terminal/hooks.ts:23-24`. Safari ≤13.1 throws (only `addListener` exists) — every consumer
(isMobile, reduced-motion) dies. Fine if the support matrix starts at Safari 14 (2020); otherwise wrap with
the `addListener` fallback.

### 19. [POST-GA] MarketChart.tsx is fully dead — nothing mounts it
Only `IndexHero.tsx:9` touches the file, and only for **types** (`import { type IndexPoint, type
ChartLayer }`). `MarketChart` and `LayerPane` have zero render sites anywhere in `app/`. It is the sole
recharts import in the terminal directory, so deleting it removes recharts from the lander bundle graph.
Fix: move the two type defs into IndexHero (or a `types.ts`), delete MarketChart.tsx + its exclusive CSS
(Appendix A, tier 2) — `chartWrap/chartGlow/chartMask/chartTip*/chartAnno/chartTerminus*/
chartLayerLabel/subPaneChart` + `@keyframes ttTerminusPulse` + its reduced-motion block (css:3696-3725,
3737 partial, 3786).

### 20. [POST-GA] Dead code inventory (TS/TSX) — see Appendix B
Highlights: `VerticalGhost` default export unmounted (only `GhostGlyph` is used, by MarketSwitch);
`fmtDelta` (hooks.ts:96) unused; `FEATURED = []` makes SubMarketBoard.tsx:94-98 a no-op; MarketSwitch's
entire non-compact card branch (`:127-160`, `Spark`, the `demand` prop) has zero call sites; TonightsWall's
`base`/`--wall-base` vestige; TerminalHome's defensive `savedMeta` cast (`:52-53`, `:294`) — the hook ships
it typed; `watchStrip.future` re-filter (`:590`) is a tautology over `live`.

### 21. [POST-GA] Duplicate/conflicting CSS rules (cruft, no visual break except finding 3)
`.feedTitle` declared three times (css:2118-2124, 2127-2128 verbatim duplicate, plus the poster override
at 2629); `.deskShell` padding-bottom set at 129 then zeroed at 2278 (intended handoff, worth a comment);
`.tapeLabel` has `letter-spacing: -0.01em` twice (2961-2962).

### 22. [POST-GA] MarketSwitch comment rot
`MarketSwitch.tsx:21-27, 59-60` document a `lander` dropdown variant ("Choose a category" / "Change
category") that does not exist in the code. Misleads the next editor.

---

## Explicit-hunt verdicts (the checklist, item by item)

- **Hooks rules**: clean everywhere. Every early return (HeroChart:222, TonightsWall:97, SubMarketBoard:505,
  Sparkline:37, MarketSwitch:98, Greeting:40, VerticalGhost:160) sits after all hooks. No conditional hooks.
- **Deps arrays**: no stale-closure bugs found. The three deliberate `[]`-with-disable effects
  (MarketSwitch ripple, RayEntrance arm, useInView) all read values that are provably mount-stable
  (`fromCache` is `useState(() => cached !== null)` — fixed per mount, useRayData.ts:477). `localToday()`
  inside memos (upcoming/nextHammer/watchStrip) goes stale across midnight with the tab open — accepted
  site-wide pattern, noted only.
- **List keys**: all reorderable lists keyed on stable ids (`lot.id`, `keyOf(r)`, `t.key`, `line.key`,
  `label`). Index keys exist only on static decorations (ReplaySeal ticks, RayLoading skeletons) — fine.
- **Dead code**: findings 19-22 + Appendices.
- **Animation gates (`fromCache`/`play` threading)**: RollingNumber (play=false lands on value —
  audit-lifecycle #1 fix intact), IndexHero `rise()`, HeroChart `animCls`, CIBeam/Monument/ReplaySeal/
  ValueReceipt (`play`/`receiptsSeen`), RayEntrance, Greeting (session), MarketSwitch ripple (session) —
  all correctly gated. The two leaks: finding 10 (table rekey) and findings 4/9 (reduced-motion, not
  fromCache).
- **Cleanup**: every listener/timer/observer audited returns its cleanup — Phase2Sentinel IO,
  TerminalHome popstate + 2× matchMedia, HeroChart ResizeObserver, SubMarketBoard keydown, Greeting/
  MarketSwitch timers, RollingNumber/CountUp/RayEntrance rAFs, useInView IO+timeout, market.tsx
  scroll/popstate. Zero leaks.
- **Modal-history pushState**: findings 1 and 2. Back-closes-modal works; ComparableModal's own
  ESC/trap/restore verified sound. (The readPop overlay deliberately skips history — acceptable, it's a
  popover, not a page-state.)
- **A11y**: findings 6, 7, 13, 14; TapeRow's div→role=button conversion itself is correct (Enter+Space+
  preventDefault+tabIndex+aria-pressed, SubMarketBoard:419-427) — but the nested dossier `<Link>` inside
  it (:432-440) is presentational-children territory; same class of issue as finding 6, lower stakes since
  the dossier is also reachable from the read card. Icon buttons carry aria-labels throughout; decorative
  SVG/imgs are aria-hidden/alt="" throughout. Focus-visible styles exist on every interactive class.
- **SSR/hydration**: `crawlDay`'s `new Date()` fallback (TerminalHome:255) is unreachable in SSR output
  (loading branch renders the skeleton at build; data is client-fetched). Greeting/evening/ripple/feedView
  are all effect-armed. Raw `<style>` blocks verified entity-free (finding 16). Masthead is the one real
  hazard (finding 15). Sparkline's `useId` in url(#…) is fine on React 18 (`:r1:` ids).
- **Evening-mode clock**: gating is hydration-safe; the UTC day bug is finding 5.
- **bidVel/receipt localStorage**: `bidVel()` guards shape+status (TerminalHome:195-197); receipt
  read-then-write is try/caught, StrictMode-guarded via `captured` ref, and `Number(prior)` NaN falls
  through harmlessly (SubMarketBoard:363-374). `ray-feedview`, `ray-market`, greeting/marketopen
  sessionStorage — all try/caught. Clean.

## VERIFIED SOUND (checked, no action)

- `diversifyFeed` termination (deferred-only pass breaks the loop, TerminalHome:77).
- Phase2Sentinel: IO-less environments call `triggerFullLoad()` immediately; observer disconnects on fire.
- ArchiveResults: error → retry → loading-state reset path (`retryArchiveLoad`) correct; archive sort stable.
- Modal Back-gesture close (the primary audit-navbugs fix) works, incl. scroll restore via market.tsx's
  `__lectrScroll` ledger; TerminalHome's `onPop` and market.tsx's `onPop` compose without conflict.
- Wall backfill honesty: 14 candidates → 5 shown, `onError` + 1px-placeholder (`naturalWidth < 4`) drops,
  <3 plates stands the row down; call lot stays in the lead through the evening re-rank.
- HeroChart: hoverI out-of-range after a market switch degrades to null (no crash); `usePane` guards
  min===max; `monotonePath` handles n=1/2; `niceTicks` cannot loop (span>0 guaranteed by caller).
- `!W` first-paint placeholder reserves exact height (no CLS); ResizeObserver drives true-pixel viewBox.
- CountUp: NaN → safe 0; A→B→A restart-from-screen via `shownRef`; armed-after-mount first sweep from 0.
- RollingNumber: cached/reduced paths land on value; raf canceled on dep change.
- Greeting: StrictMode double-mount + fast-nav replay both handled (stamp at hold point).
- RayEntrance: hydration-safe arming (useLayoutEffect), double-rAF flip, both rAFs canceled.
- The 7 lander pages: pure metadata + `export { default } from '../page'` — no logic to break; market
  scoping via PATH_MARKET verified for all 7 paths (incl. `/collectibles → all`).
- Honesty doctrine spot-checks: fmtCI/fmtPct mono-scoped via `.pctData`; descriptive rows never show %;
  bidComp labeled "bids/lot", never through fmtPct/fmtMoneyCompact; scopedSold labeling; qMove uses level
  difference (the sign-flip comment at IndexHero:204-208 is implemented correctly).
- `verified.ts` is NOT dead: `verifiedMovers` feeds `components/analytics/{VerifiedMovers,ArtistSparklines}`;
  `fmtPct` feeds IndexHero/SubMarketBoard. Only its Terminal-side consumers died (movers CSS, Appendix A).

---

## Appendix A — DEFINITIVE dead-CSS inventory (`style.module.css`, 3,878 lines)

Method: every `.class` token in every selector (comments/url()/strings stripped, `:global()` excluded)
cross-referenced against every `styles.X` / `styles['X']` in the 7 importing tsx files. A rule is
"safe-dead" only if every comma-alternative in its selector contains ≥1 dead class.

**Result: 442 local classes defined · 197 used · 246 dead · 502 safe-dead rule blocks · ≈1,895 lines
(~49% of the file).** The prior audit's "~250 orphaned lines" undercounted by ~7.6× — the dead mass is not
just movers/verified: it includes the entire retired pre-observatory desktop (statusBar/heroThesis/midGrid/
edge card/record board), the retired mobile shell (`mob*`, 1060-1234), the pre-Plate&Tape sub-board
(`subTable`/`subRow`/`mobSub*`), the retired bento read-cards + museum plaques (2319-2616), the guarantee/
paper-rain/tick-rain scenography, and Room-B plates (3117-3257).

### Tier 1 — dead now (246 classes). Safe-to-delete line ranges (merged, block-exact):
```
68-106, 112-119, 257-326, 329-338, 354-425, 441-457, 513-533, 574-582, 599-611,
616-653, 656-662, 665-808, 811-871, 874-972, 975-990, 994-1013, 1016-1019, 1023,
1042-1055, 1060-1234, 1261-1269, 1280-1288, 1314-1315, 1331-1334, 1345-1349,
1371-1372, 1375-1383, 1387-1410, 1416-1418, 1434, 1444-1445, 1451-1490, 1493-1537,
1540-1588, 1692-1708, 1725-1726, 1729-1799, 1802-1819, 1907-1916, 1943-1957,
1976-1989, 2081, 2084, 2156-2168, 2194-2218, 2249-2251, 2255-2256, 2262-2276,
2293-2296, 2300-2316, 2319-2382, 2385-2420, 2423-2457, 2460-2490, 2493-2565,
2568-2586, 2589-2594, 2598-2616, 2637-2638, 2645-2651, 2656-2695, 2698-2711, 2719,
2723-2725, 2772-2780, 2793-2794, 2812-2830, 2834, 3014, 3026-3053, 3073, 3094,
3102, 3117-3191, 3194-3228, 3231-3240, 3245-3257, 3294-3362, 3473-3487, 3777-3785
```
Class list (grouped): statusBar wordmark wordmarkDot statusMeta statusSep statusItem liveDot ·
heroMoversArea moversBand moversBandLabel moversBandRows moverCell moverCellName moverCellChg moverCellCi ·
heroMeta heroLeft heroDeltas heroDelta heroExplain heroThesis heroStats stat statBtn statVal statLabel
statFlag heroReturnTag heroRight cmdPill · chartCard chartCardHead · tapeSection tapeTrack tapeStatic
tapeItem tapeDot tapeMaker tapeTitle tapePrice tapeHouse · midGrid midGridMain movers moversHead
moversTitle moversTable moversColHead moversTrendHead moversRow moversTick moversIndex moversDelta
moversSpark moversN moversFoot moversCi moversEmpty moversSection moversPaper right frameToggle frameBtn ·
edgeCard edgeTitle edgeStatBig edgeStatNum edgeStatCap edgeRows edgeRow edgeRowLabel edgeRowVal edgeFoot ·
recordSection recordBoard recordHead recordCaption recordList recordListMobile recordRow recordRank
recordCat recordMain recordObj recordMaker recordBarCell recordBarTrack recordBar recordPrice recordSource
recordMeta recordTitle recordEmpty · instrumentRow callCol boardCol condensed condHead condCount ·
footer footerMuted mobShell mobIndexCard mobIndexNum mobDeltas mobSpark mobThesis mobTape mobMovers
mobMoverList mobMoverCard mobMoverTop mobMoverName mobMoverBot mobMoverIndex mobRecords mobEdge mobEdgeNum
mobSearchDock mobFooter · mHeroLive mHeroDeltas mHeroDelta mHeroDeltaSub mHeroReturnTag roiUp roiDown
ledgerBand · subTable subColHead subRow subTag subSupport subMeta subShowMore mobSubList mobSubCard
mobSubTop mobSubName mobSubBot · verifiedStrip verifiedHead verifiedRows verifiedRow verifiedName
verifiedChg verifiedCi verifiedEmpty verifiedEmptyDot · wallKicker wallSub · roomProof cardRoomHead inkMark ·
bento bentoCell readCard readCardHead readCardName readSeal readCardRead readCardPct readCardMoney
readCardPer ciBand ciTrack ciAxisLine ciZeroTick ciFillBar ciPointDot ciSvg ciAxis ciZero ciFill ciDot
sparkLine ciEnds ciTag readCardRecord readCardRecordLabel readCardRecordVal readCardRecordTitle
readCardFoot readCardMethod · plaqueWall plaqueMidRow plaqueMiniRow plaque plaqueTopRow plaqueNo plaqueCat
plaqueTitle plaqueMaker plaquePrice plaqueFoot plaqueSource · guarantee guarTitle guarRow guarItem guarFill
paperRain · monument monSwap monDelta tickRain · receipts receiptsKicker receiptsLine receiptChip ·
roomB plateZone hatchField plate plateRank plateTitle plateMaker plateFigure strikeRule plateProv
srcDiamond srcDiamondSm srcLink archivalChip archivalChipSm provSource · tapeRowB tapeRank tapeTitleB
tapeMakerB catChip tapeOut register · flagRow flagPlate flagImg flagMaker flagTitle flagEst flagSignal
engineLine · subPane subPaneMeta.
Keyframes that die with these blocks: `pulse` (liveDot), `tapeScroll`, `mLive`, `paperTickFall`,
`tickFallA`, `tickFallB` — each referenced only from dead classes. Alive: `ttWallRise`, `hcPulse`,
`hcWipeIn` (and `ttRingIgnite` is referenced-but-missing, finding 8).

### Selector-prune only (5 mixed rules — delete the dead alternative, keep the rule):
- L461-477 / 478-483 / 484-488: drop `.cmdPill` (keep `.cmdPillFull`).
- L1425-1430: drop `.ledgerBand` (keep `.mHeroCard`); also delete the `.ledgerBand > div` rule at 1434.
- L2235-2239: drop `.condCount`, `.moversFoot`, `.subColHead`, `.wallKicker` from the label-grammar list.

### Tier 2 — dead after MarketChart.tsx is deleted (finding 19):
`chartWrap chartGlow chartMask chartTip chartTipPeriod chartTipVal chartTipN chartAnno chartTerminus
chartTerminusHalo chartLayerLabel subPaneChart` + `@keyframes ttTerminusPulse` + its reduced-motion block
(≈ css 537-571 partial, 1823-1861, 3696-3725, 3711, 3737-3743 partial, 3786). `chartCardTag` stays
(IndexHero sparkline fallback uses it).

### Also delete with finding 3/21:
`.hero` re-declaration 1961-1967; duplicate `.feedTitle` 2127-2128; duplicated `letter-spacing` 2962.

## Appendix B — dead TS/TSX inventory (safe to delete, usage-grepped repo-wide)

| Item | Location | Note |
|---|---|---|
| `MarketChart` + `LayerPane` + `TerminalTooltip` | preview/terminal/MarketChart.tsx (whole file) | keep `IndexPoint`/`ChartLayer` types (move to IndexHero); drops recharts from lander graph |
| `VerticalGhost` default export + `styles.ghost` CSS (1864-1904) | preview/terminal/VerticalGhost.tsx:158-166 | `GhostGlyph` named export IS used (MarketSwitch:114) — keep the glyphs |
| `fmtDelta` | preview/terminal/hooks.ts:96-99 | zero call sites |
| `FEATURED` + curation mapping | SubMarketBoard.tsx:76, 94-98 | `[]` forever → map/filter/Set are no-ops |
| MarketSwitch card variant (`Spark`, non-compact branch, `demand` prop) | MarketSwitch.tsx:29-45, 127-160 | all 6 call sites pass `compact` |
| `base` / `--wall-base` | TonightsWall.tsx:95, 129 (css var default covers it) | constant 0 |
| `SavedMeta` cast scaffolding | TerminalHome.tsx:52-53, 294 | useSavedLots ships `savedMeta` typed |
| `watchStrip.future` re-filter | TerminalHome.tsx:590 | tautology over `live` |
| 'lander' variant docs | MarketSwitch.tsx:21-27, 59-60 | comment rot |
| "redirects here" claim | app/page.tsx:4 | no redirect exists (finding 17) |

---

## COUNTS
**BLOCKER 0 · PRE-GA 7 · POST-GA 15** (+ dead-CSS: 246 classes ≈ 1,895 lines; dead-code: 10 items).

## WORST 5
1. **#1 modal close after market switch reverts the market/URL** — TerminalHome.tsx:319 × market.tsx
   pushState; core nav promise breaks on a 3-tap sequence.
2. **#3 duplicate `.hero` rule kills the ≤900px layout override** — style.module.css:1961; rail squeezed
   beside the headline for 821-899px readers on the GA lander.
3. **#5 "closes today" on the UTC clock** — TonightsWall.tsx:90; every US evening, tomorrow's lots wear
   today's promise — an honesty-doctrine breach in the feature built for that exact hour.
4. **#4 phantom `styles.hcTerminus`** — HeroChart.tsx:300; the reduced-motion gate on the hero's infinite
   pulse compiles to nothing.
5. **#6 `<tr role="button">` swallows its links and ignores Space** — TerminalHome.tsx:784; the table view
   (the desktop default) is semantically one giant button per row for AT users.
