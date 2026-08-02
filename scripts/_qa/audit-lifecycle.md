# Lifecycle audit — data loading & render on navigation (code-lens)

Scope: `useRayData` module-cache layer, RayEntrance choreography, per-page loading
gates, remount/replay behavior on back-navigation, query-param page identity.
Companion audits: prod black-box repro (sibling), URL structure (sibling).

Legend: **CONFIRMED** = the mechanism is fully visible in code at the cited lines.
**SUSPECTED** = code shows the hazard but severity/trigger needs the repro agent.

Ranked by user impact.

---

## 1. CONFIRMED — Hero headline stuck at **0** on cached back-nav (RollingNumber `play=false` never lands)

**Symptom.** Return to the home page (or any lander) after the session has
`fullLoaded` (scrolled past the Phase2Sentinel earlier, or visited /value,
/artists, /analytics, /saved, any lot or artist page) → the observatory hero
renders `+0%` / `$0` **permanently**. The number never counts and never settles.

**Cause chain.**
- `app/hooks/useRayData.ts:469` — `fromCache = cached !== null && cached.fullLoaded`.
- `app/preview/terminal/TerminalHome.tsx:644` — `<IndexHero … play={!fromCache}>`
  (also `:604` MarketSwitch `open={!fromCache}`, `:383` TonightsWall).
- `app/preview/terminal/IndexHero.tsx:265-273` (mobile) and `:365-373` (desktop) —
  `<RollingNumber value={headline} from={reduce ? headline : 0} play={play}>`.
  With motion allowed, `from = 0`.
- `app/preview/terminal/RollingNumber.tsx:43` — `useState(from)` seeds display at 0;
  `:47-48` — `useEffect: if (!play) return;` — **no branch ever sets display to
  `value` when `play` is false**. Display stays `format(0)` forever.

Contrast: `app/components/CountUp.tsx:41,66-70` handles the same contract
correctly (`!animate` → land on `to` immediately). RollingNumber is the only
"count" primitive with the dead-end.

**Fix (1-3 lines).** In RollingNumber, replace the early return:
`if (!play) { setDisplay(value); return; }` — and/or seed
`useState(play && !reduce ? from : value)`. Risk: none — pure convergence to the
already-final figure; no layout or data change.

---

## 2. CONFIRMED — `fromCache` means "full corpus loaded", not "cache warm" → back-nav replays the whole entrance / behavior depends on where you've been

**Symptom.** Back-navigation to the home page usually replays the *entire*
arrival choreography (content flashes to opacity 0, then 600 ms staggered rise;
wall re-animates; hero re-fades) — but *sometimes* it doesn't, seemingly at
random. The "random" bit is whether any earlier page happened to pull phase 2.

**Cause.**
- Doc contract `app/hooks/useRayData.ts:78-80`: *"true when the module cache was
  already warm at mount — revisits render instantly."*
- Implementation `:469`: `cached !== null && cached.fullLoaded` — the flag is
  ANDed with phase-2 completion. The home lander is phase-1-only by design
  (`:196-198` opt-in phase 2; `TerminalHome.tsx:130-144` Phase2Sentinel fires only
  when the reader scrolls within 600 px of the settlement room). So on a warm
  revisit where phase 2 never fired, `fromCache` is **false** and
  `TerminalHome.tsx:625` `<RayEntrance animate={!fromCache}>` re-arms the hidden
  pre-state (`RayEntrance.tsx:27-42`) and replays everything.
- Inverse coupling (the prompt's "inner page leaves the next page thinking
  fullLoaded"): once /value (`useFullLots`, value/page.tsx:41) or the sentinel
  flips `cached.fullLoaded`, every later mount of *any* page sees
  `fromCache=true` — home then skips choreography **and** hits bug #1. Fresh
  session vs same-session behavior genuinely diverges, module-wide.

**Fix.** `const [fromCache] = useState(() => cached !== null)` at
useRayData.ts:469 (matching its own doc), and keep a separate
`fullLoaded`-derived flag for anything that truly needs corpus-complete. Risk:
low — pages gated on `!fullLoaded → RayLoading` (value:245, artists:71,
analytics:166, [artist]:260) mount their RayEntrance only after full data, so
"instant render with phase-1-warm cache" is exactly the documented intent.

---

## 3. CONFIRMED — Per-component animations replay on every remount regardless of `fromCache` (back-nav = re-animation, even when the gate says "instant")

Even with #2 fixed, four primitives self-animate on mount with no cache gate:

a. **Feed cards** — `app/globals.css:802-803`
   `.ray-feed-rekey { animation: rayFeedIn 420ms … both; }` with keyframe
   `from { opacity: 0 … }`; applied per card at
   `TerminalHome.tsx:837-850` with `animationDelay: min(i,10)*40ms`. `both`
   fill-mode means late-staggered cards sit **invisible up to 400 ms** on every
   mount — every back-nav to the lander re-fades the whole feed.
b. **CountUp numbers** — `CountUp.tsx:41` defaults `animate=true`; callers never
   pass it: `artists/page.tsx:80`, `saved/page.tsx:585`,
   `ArtistHero.tsx:231-235, 379-406`. Every back-nav re-counts from 0
   (the exact "numbers replay" symptom).
c. **IndexHero framer-motion `rise()`** — `IndexHero.tsx:246-250`
   `initial: {opacity: 0, y: 16 …}` gated only on `reduce`, never on `play` —
   the hero head/stat blocks fade in from nothing on every remount (this is what
   makes bug #1 read as "the page loaded but the number is 0").
d. **Chart wipes** — `hooks/useChartDraw.ts:44-46` `firedRef` is per hook
   instance; `layout.tsx` clip contract (`clip-path inset(0 100% 0 0)`) re-hides
   every recharts body on remount until the IO re-fires at threshold 0.2.

**Fix.** Thread the (repaired) `fromCache` in: skip `.ray-feed-rekey` class /
`animationDelay` when not animating; pass `animate={!fromCache}` at the CountUp
call sites; gate `rise()`'s `initial` on `play`; accept chart wipes as scroll
reveals (they're IO-gated, least harmful). Risk: low, presentation-only.

---

## 4. CONFIRMED — /sub, /ref, /player don't remount on `?id=` change (state leakage the codebase already diagnosed for /lot)

`app/lot/page.tsx:23-27` documents the hazard verbatim and fixes it with
`<LotPage key={id} …>`: *"client-side navigation between lots must REMOUNT the
page — otherwise dbLot/dbSettled/imgFailed state from the previous lot leaks."*
The three sibling query routes skipped the fix:

- `app/sub/page.tsx:20` — `<SubPage slug={id} />` (no key). SubPage renders
  `HeroChart` (`SubPage.tsx:213`), whose `hoverI` crosshair and measured `W`
  (`HeroChart.tsx:130-135`) persist across `?id=A → ?id=B`; a stale readout can
  print the previous drill's crosshair row set for a frame, and any latched
  in-view/draw state carries over.
- `app/ref/page.tsx:14` — `<RefPage refKey={id} />` (no key).
- `app/player/page.tsx:14` — `<PlayerPage playerSlug={id} />` (no key).

In App Router a query-only navigation re-renders the same segment (no remount),
so `useSearchParams` changes props only — component state survives by design.
`/lot?id=A → /lot?id=B` is safe (keyed); the other three are not.

**Fix.** `key={id}` on each of the three (one line apiece), mirroring
lot/page.tsx. Risk: none — these pages hold no state worth preserving across ids.

---

## 5. CONFIRMED — /saved flashes the "0 — Every collector starts by watching" empty state while the corpus is still streaming

- `saved/page.tsx:554` gate: `loading || !authReady || !savedReady → RayLoading`
  — `loading` is **phase-1 only**.
- `:556` next branch: `savedLots.length === 0 && orphanIds.length === 0 →` the
  zero-hero empty state.
- `savedLots` (`:110`) intersects savedIds with `allLots`, which pre-phase-2 is
  the eager *upcoming* slice only; a user whose saves have all concluded matches
  nothing. `orphanIds` (`:117-121`) **returns `[]` until `fullLoaded`** — so
  nothing holds the gate closed. Result: cold-load /saved → skeleton → wrong
  "you have nothing" hero → real ledger pops in when the ~10 MB shards land.
- Bonus flicker: `:123` `badgeCount = fullLoaded ? savedLots.length :
  savedIds.length` — the nav badge changes number mid-load.

**Fix.** Insert `!fullLoaded → RayLoading` (or gate the empty branch on
`fullLoaded`) before `:556`; keep `fullError` handling like value/page.tsx:236.
Risk: users with only-live saves wait for phase 2 before seeing cards — could
soften by gating only the *empty* branch, rendering live cards immediately.

---

## 6. CONFIRMED mechanism / SUSPECTED severity — Phase-2 arrival reshuffles the live lander under the reader

`useRayData.ts:343` `notify({ …, allLots: merged, fullLoaded: true })` swaps
`allLots` from the eager slice to the full 32 K merged corpus in one render.
TerminalHome recomputes `upcoming` (`:329-341`), `belowSignal` (`:346-356` —
`lotSignal(l, marketLots)` per upcoming lot against the now-huge pool),
`wallItems`, `engineHero`, `feed` (`:362-454`, incl. `diversifyFeed` whose order
can shift when the pool changes) — mid-scroll: card reorders, the settlement
band appears, and a main-thread stall proportional to corpus size. Signals are
re-attached from the eager lots (`:327-342`) so card *content* mostly holds, but
ordering and totals are not guaranteed stable.

**Fix.** Debounce/defer non-visible recomputes (e.g. `startTransition` around
the phase-2 notify consumer, or freeze feed ordering once painted until a
user-initiated filter change). Risk: medium — touching feed identity is easy to
get wrong; needs the repro agent's trace of what visibly moves.

---

## 7. CONFIRMED — Greeting replays if the reader leaves within ~2.3 s of first landing

`Greeting.tsx:29-32` stamps `lectr-greeted` only in the 2300 ms completion
timer; `:33` cleanup clears the timers on unmount. Navigate off the lander (or
market-switch via a real Link) before the stamp lands → the full-screen greeting
floor replays on the next home mount, including back-nav. (The at-completion
stamp was a deliberate StrictMode fix — the comment at `:25-28` explains why —
but it trades a dev artifact for a real prod replay.)

**Fix.** Stamp inside the `hold` timer (1750 ms) or on `pagehide`/`visibilitychange`,
keeping the arm/skip logic; or stamp on arm and clear-the-floor via a
`data-` attribute rather than relying on run-2 state. Risk: low.

---

## 8. SUSPECTED — cold back-nav (bfcache miss) lands on a short skeleton, losing scroll and replaying everything

No `history.scrollRestoration` handling and no Next `scrollRestoration`
experiment anywhere (grep: zero hits in app/ and next.config.js). No
`pageshow`/`beforeunload` handlers either, so bfcache is not blocked — when it
*hits*, restores are perfect (module caches are irrelevant, DOM restored
as-is). When it *misses* (memory pressure, cross-site, Chrome discard), back is
a **full reload**: module caches (`useRayData.ts:185-206`, `RefPage.tsx:31-32`,
`PlayerPage.tsx:40-41`, `lot/flagged.ts:16`) are empty, the page mounts as
`RayLoading` (short document), the browser's scroll restore has nothing to
anchor to, and the entrance replays on data arrival. Code shows no mitigation;
needs the repro agent to establish how often prod back-nav is a bfcache miss.

**Fix direction.** Persist a tiny phase-1 snapshot to sessionStorage for instant
first paint, and/or `history.scrollRestoration` + explicit restore after the
gate opens. Risk: medium (stale-snapshot handling).

---

## Verified-clean (checked, not guilty)

- **setState-after-unmount / notify-after-death**: both subscription hooks guard
  with an `active` flag and delete listeners on cleanup
  (`useRayData.ts:471-477, 535-543`). RayEntrance cancels its rAFs (`:78-81`);
  CountUp/RollingNumber cancel theirs; LotPage's Supabase probe uses a `dead`
  flag (`LotPage.tsx:295-303`).
- **Phase-1 → phase-2 notify race**: `notify(core)` runs synchronously before
  the inflight promise resolves (`:296, :356`); phase-2 completion arrives via
  network macrotask, after any pending `.then(listener)` microtask — a
  late-mounting subscriber cannot observe a regression from merged → core.
  The fallback path (`:388`) sets `cached` without notify but the `.then(listener)`
  delivers it.
- **StrictMode double-mount (dev)**: loadRayData is idempotent behind
  `cached`/`inflight`; `lectr-lit` (`ArtistNav.tsx:36-38`) stamps-then-sets so
  run 2 skips harmlessly; Greeting's ordering is deliberate (see #7);
  useSoldArchive re-reflects current module state on re-subscribe (`:540`).
- **RayEntrance stuck-at-opacity-0**: the hidden pre-state is scoped under
  `[data-ray-animate]` (`RayEntrance.tsx:27-42`) which is only rendered when
  armed, and the ready-flip is transition-based (no keyframe/fill dependency);
  `animate=false` never hides content. One edge: rAF doesn't fire in
  background tabs, so a cmd-clicked tab holds the hidden state until focus —
  cosmetic, self-resolving.
- **HeroChart measurement**: pre-measure placeholder reserves
  `minHeight = height + sub` (`HeroChart.tsx:217-220`) — no layout jump; the
  `W=0 → measured` remount costs one blank frame on back-nav only.
- **TonightsWall / MarketSwitch replays**: correctly gated —
  `[data-anim='true']`-scoped keyframes (`style.module.css:2069-2112`) resolve
  when `play=false`; the switch's ignition ripple is session-gated
  (`MarketSwitch.tsx:81-85`, `lectr-marketopen`).
- **`?v=lastCrawl` version-busting** (`useRayData.ts:308, 363, 425`): coherent —
  same-crawl revisits hit the browser cache, new crawls are new URLs; retries
  bypass with `reload` (`:320, 434`).
- **LotPage multi-source settle** (`LotPage.tsx:424-455`): `settled` requires
  phase-2 *and* (goldin-only) phase-3 *and* the DB probe — no premature
  "isn't on the book" path found in code; `key={id}` on the query route
  prevents cross-id leakage.

---

## Suggested repro checklist for the black-box sibling

1. Home → scroll to the settlement room (fires phase 2) → any link → **back**:
   hero shows `0%`/`$0` frozen (#1); feed cards re-fade (#3a).
2. Home → immediately (< 2 s) click a maker → **back**: greeting floor replays (#7).
3. Home (no scroll) → /about → **back**: full entrance replays (#2).
4. /saved with only concluded saves, hard reload: zero-state flash (#5).
5. /sub?id=cards:basketball → in-page link to another drill: crosshair/chart
   state carry-over (#4).
6. Long feed scroll while phase 2 streams on slow 3G: mid-scroll reshuffle (#6).
