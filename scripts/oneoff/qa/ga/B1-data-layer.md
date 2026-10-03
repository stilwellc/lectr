# B1 — GA-Readiness Audit: Data Layer & Hooks

Date: 2026-08-03 · Auditor: Claude (read-only) · Ships: tomorrow
Scope (every line read): `app/hooks/useRayData.ts` (565), `app/hooks/useRefs.ts` (39), `app/hooks/useSavedLots.ts` (14), `app/hooks/useChartDraw.ts` (70), `app/lib/account.tsx` (425), `app/lib/alerts.ts` (145), `app/lib/supabase.ts` (19), `app/lib/market.tsx` (203).
Cross-referenced: `public/_headers`, `supabase/saved-lots.sql`, `supabase/add-owned-column.sql`, `app/components/AlertsInbox.tsx`, `app/components/ArtistNav.tsx` (badge), `app/analytics/page.tsx` (DeepPools arming), `app/components/LotPage.tsx` (ArchiveProbe), `app/constants.ts` (MARKETS.live).

**Counts: 0 BLOCKER · 4 PRE-GA · 13 POST-GA**

---

## PRE-GA

### P1. Phase-3 sold-archive fetched UNVERSIONED on cold mounts → year-pinned stale data + lost soldComp merge
`app/hooks/useRayData.ts:428-431` (with `public/_headers` `/data/ray/sold-archive-*` = `max-age=31536000, immutable`)

`loadSoldArchive()` reads `cached?.lastCrawl` and `cached?.allLots` **synchronously at call time**. `useSoldArchive`'s effect calls it on mount, but phase 1 (which populates `cached`) is async — on any cold session where the archive tier mounts before phase 1 resolves, `ver = ''` and `soldComps` is an empty Map. Reachable: `/preview/terminal` mounts `useSoldArchive` unconditionally at the top (guaranteed); `/analytics/sports|science` deep-link + quick scroll into the armed DeepPools while phase 1 is still in flight (slow connections make this window seconds wide).

Failure scenario: the bare (query-less) `sold-archive-index.json` / `sold-archive-N.json` URLs are immutable-cached for a year. A user who ever hit this path re-serves a months-old archive from HTTP cache after every new crawl — silently stale repeat-sale pools, wrong shard count vs. the live index, and archive lots never receive the precomputed `soldComp` re-attach (empty map is latched forever because `archiveLoadedState = true` is permanent). Violates the honesty doctrine silently.

Fix (3 lines): make `loadSoldArchive` async and `await loadRayData()` at the top (after the inflight/loaded guard, before building `ver`/`soldComps`), so version + soldComp map always come from a resolved phase 1.

### P2. Orphan-alerts unseen-count skew — CONFIRMED (prior-audit flag) + permanent stuck badge
`app/lib/alerts.ts:87-91` (`remove`), `:127-145` (`useUnseenAlertCount`), `:117-121` (`markAllSeen`) with `app/components/AlertsInbox.tsx:88,96,116+`

`remove()` deletes only the `saved_searches` row — its `alerts` rows survive (no cascade schema exists in the repo to prove otherwise). `useUnseenAlertCount` counts ALL unseen rows including orphans; `AlertsInbox` renders alerts only under a still-existing search (`searches.map → bySearch.get(s.id)`), so orphaned alerts are counted but never rendered. Worse: if the user deletes their **last** search, `AlertsInbox` returns `null` entirely (`searches.length === 0`, line 88) — the only path to `markAllSeen` disappears.

Failure scenario: user deletes a search that had unseen matches → nav badge on every page shows "N new matches", profile inbox shows nothing new (or nothing at all) → badge glows forever, across sessions. Trust-destroying for the retention loop.

Fix: in `remove()`, also `supabase.from('alerts').delete().eq('search_id', id)` (and add FK `on delete cascade` server-side); additionally compute `unseen` only over alerts whose `search_id` is in the live `searches` set so the badge and the inbox can never diverge.

### P3. Every alerts/saved-searches query relies solely on RLS — and the RLS schema for those tables is not in the repo
`app/lib/alerts.ts:62-65, 79, 90, 120, 134-137`

`saved_searches` select, the `save()` dedupe select, `remove()` delete, `markAllSeen`'s `update({seen:true}).eq('seen', false)`, and the unseen count all omit `.eq('user_id', user.id)`. `supabase/saved-lots.sql` proves RLS for `saved_lots` only; the `saved_searches`/`alerts` DDL was applied out-of-band, so RLS on them is **unverifiable from the repo**. If RLS is off or mis-scoped on either table, `markAllSeen` flips *every user's* alerts to seen and reads leak cross-user.

Failure scenario (if RLS gap exists): user A opens their inbox and clicks "Mark all read" → user B's badge silently clears; users see each other's searches/alerts.

Fix: before GA, confirm in the Supabase dashboard that RLS is enabled + owner-scoped on `saved_searches` and `alerts` (commit the DDL to `supabase/` as the record, like saved-lots.sql). Also add explicit `.eq('user_id', user.id)` to all five queries as defense-in-depth — one line each.

### P4. Phase-2/3 also go unversioned when meta.json fails or lacks lastCrawl — immutable-cache pinning again
`app/hooks/useRayData.ts:312, 367` (and 429, same class as P1)

`ver`/`fbVer` fall back to `''` when `metaData.lastCrawl` is empty (meta.json 4xx/5xx/malformed → `allSettled` gives `{}`). The lots shards are immutable-cached (`/data/ray/lots-*`), so a session that ever fetched them bare pins that corpus for a year on that browser; subsequent crawls never reach the user through that path. Silent stale data, no error state.

Failure scenario: one flaky meta.json response → the user's full-corpus pages (comps, maker pages, value) serve a frozen snapshot indefinitely, while the eager surfaces update — internally inconsistent numbers.

Fix: when `lastCrawl` is empty, fetch the shards with `cache: 'no-cache'` instead of default/force-cache (never let an unversioned URL hit the immutable cache), or refuse phase 2/3 and surface `fullError` so retry re-reads meta.

---

## POST-GA

### Q1. `useAlerts` wipes the list to empty on a query error
`app/lib/alerts.ts:105-110` — `(data as AlertRow[]) || []` on error sets `[]` + `ready=true`; user sees "no new matches yet" instead of their alerts (contradicts the keep-prior doctrine explicitly implemented in `useSavedSearches:66-67`). Fix: destructure `error` and keep prior state on failure.

### Q2. Nav badge doesn't react to "Mark all read" within the mounted page
`app/lib/alerts.ts:117-123` + `app/components/ArtistNav.tsx:20` — `useUnseenAlertCount` is an independent one-shot fetch per mount; `markAllSeen` in the inbox never notifies it. ArtistNav is per-page (not root layout) so the badge corrects on the next navigation, but on /profile itself the badge keeps glowing after the user clears everything. Fix: tiny module-level count store + notify (same pattern as useRayData's listeners), or have markAllSeen bump a shared version the count hook subscribes to.

### Q3. `markAllSeen` optimistic update has no rollback
`app/lib/alerts.ts:117-121` — local state flips seen, then the update runs unchecked; on failure the dots return on next load with no explanation. Fix: check `{ error }`, restore prior array, flash.

### Q4. `remove()` saved search: optimistic, no rollback, no error surface
`app/lib/alerts.ts:87-91` — failed delete resurrects the search on next refresh; user thinks delete didn't stick. Fix: check `{ error }` and restore + flash.

### Q5. `save()` dedupe is key-order-sensitive and racy
`app/lib/alerts.ts:76-85` — `JSON.stringify(query)` equality misses semantically equal queries with different key order (FeedFilters construction paths may differ); two rapid saves can both pass the check → duplicate searches. Fix: canonicalize (sort keys) client-side + a unique index server-side.

### Q6. `useSavedSearches.refresh` has no cancellation guard and swallows errors silently
`app/lib/alerts.ts:60-72` — setState after unmount (benign in React 18, but the file's other hooks all carry `dead` guards) and an error yields `ready=true` with an empty list, indistinguishable from "no searches". Fix: add the dead-flag + an error flag consumers can render.

### Q7. AccountProvider context value + open/closeLogin rebuilt every render
`app/lib/account.tsx:315-320` — `value` is a fresh object each render and `openLogin`/`closeLogin` fresh closures, so every `useAccount()` consumer re-renders on any provider state change, and `LoginModal`'s focus-trap effect (deps `[closeLogin]`, line 362-378) tears down/re-runs on each provider re-render while open — refocusing the Google button (focus steal) and re-adding listeners. Cleanup ordering keeps the body scroll-lock correct (verified), so this is churn, not a leak. Fix: `useCallback` the two, `useMemo` the value.

### Q8. Pending-save replay: localStorage entry deleted before upsert confirms; no rollback on failure
`app/lib/account.tsx:207-215` — `removeItem` runs before the upsert resolves; on upsert failure the save exists only in optimistic state (no rollback, unlike `toggle`'s doctrine at 255/262) and is gone after reload. Fix: remove the key only on success; on failure roll back `entries` + flash, mirroring toggle.

### Q9. `signInWithGoogle` swallows its error
`app/lib/account.tsx:308-311` — `signInWithOAuth` returns `{ error }` (popup blocked, provider misconfigured); it's discarded, so the button clicks into silence. Fix: surface via the flash toast.

### Q10. Impure setState updater in no-auth `toggle`
`app/lib/account.tsx:227-232` — `writeStored` + `navigator.vibrate` execute inside the updater; StrictMode double-invokes updaters (idempotent today, but a footgun). Fix: compute `next` from `entriesRef.current` outside, then `setEntries(next)`.

### Q11. Auth-session effect: no cancelled guard; notice timer never cleared
`app/lib/account.tsx:163-172, 155-160` — `getSession().then(setUser…)` after unmount, and `noticeTimer` survives unmount. Benign only because AccountProvider is root-mounted for the app's life; guard for hygiene.

### Q12. Fallback (no-upcoming.json) path never assigns `retryFull` → dead retry buttons
`app/hooks/useRayData.ts:363-394, 403-416, 252` — if the fallback path's shard load fails, `fullError=true` but `retryFull` is still null, so `retryFullLoad()` and the mount-time re-kick (line 252) are no-ops; gated pages show error + a retry that does nothing until a hard reload. Transition-window only (old deploy data), hence POST-GA. Fix: extract a `loadFull`-style retry for the fallback path too, or make `retryFullLoad` fall back to re-running the fallback loader.

### Q13. No fetch timeouts anywhere in the data layer
`app/hooks/useRayData.ts:231-235` (`fetchJson`), `app/hooks/useRefs.ts:26` — a stalled-but-open response (captive portal, dying proxy) hangs phase 1 for the browser's default timeout (minutes): app-wide skeleton, `loading=true`, no error state, no retry path. 4xx/5xx/malformed-JSON ARE all handled (verified below); only the hang is uncovered. Fix: `AbortSignal.timeout(20000)` in `fetchJson` — rejection then flows into the existing `allSettled`/retry/error machinery.

### Q14. `useRefs` has no inflight dedup
`app/hooks/useRefs.ts:23-31` — module cache dedups only *completed* loads; two surfaces mounting in the same window (or StrictMode's dev double-effect) each fetch the 1.9MB file. Second resolution harmlessly overwrites. Fix: module-level `inflight` promise shared by concurrent mounts.

### Q15. Popstate scroll restore can race async content height
`app/lib/market.tsx:163-167` — the double-rAF `scrollTo(0, y)` runs before phase-2/3-gated boards regain their height on a back-navigation; the scroll clamps short and no later correction runs. (The stamp/restore ledger itself is sound: `{...window.history.state}` spread preserves Next's internals, `{...null}` is safe, replaceState is try-caught for Safari's rate limit, listeners are removed on cleanup — verified.) Fix: retry the restore for a few frames until `document.documentElement.scrollHeight >= y + innerHeight` or ~500ms elapses.

### Q16. Archive-tier `fromCache`-style choreography note: archive lots never re-merge soldComp after late phase-1
Covered by P1's fix (rebuild `soldComps` after awaiting phase 1). Listed so the sub-symptom isn't re-reported separately.

### Q17. `useAlerts`/`useUnseenAlertCount` count-vs-list divergence at scale
`app/lib/alerts.ts:109` (`limit(200)`) + `:134-137` (exact count) + `AlertsInbox.tsx:73` (`slice(0,40)`) — a heavy user's badge count can exceed anything the inbox shows even without orphans. Cosmetic today; fold into the P2 fix (count what the inbox can show).

---

## VERIFIED-SOUND

**useRayData.ts**
- Phase-1 concurrent-mount dedup: `inflight` shared promise; `cached` short-circuit; every hook's `.then(listener)` guarded by `active` flag → no setState-after-unmount. Listener Sets (`listeners`, `archiveListeners`) always removed in cleanup — no listener leaks.
- notify sequencing: `notify(core)` (phase 1) → opt-in `loadFull` (phase 2) → `notify({...cached||core, allLots: merged})`; single-threaded, `cached` monotonic, no lost updates. Phase-3 state fully independent (own cache/inflight/error/listeners) — an archive arrival re-renders only archive subscribers, as documented.
- Phase-2 retry ladder: 3 attempts, backoff, `force-cache` first / `reload` on retry (covers truncated cached bodies), `fullError` surfaced to gated pages, error cleared on retry (`notify({...cached, fullError:false})`, line 317), auto re-kick on next mount (line 252), `inflightFull` set synchronously → StrictMode double `triggerFullLoad` safe. Same ladder verified for phase 3 (`inflightArchive` sync guard).
- `fullRequested` latch: a trigger arriving before phase 1 resolves fires phase 2 the moment the eager payload lands (line 357). Idempotent.
- Signal/soldComp/bidVelocity re-attach maps on the phase-2 merge (lines 331-345) — correct precedence, eager wins, no flicker path.
- 4xx/5xx/malformed JSON on every phase-1 file: `fetchJson` throws → `Promise.allSettled` → per-file degradation; all-fail → user-facing error string; partial-fail paths produce a working app. Fallback path versions its shard URLs (`fbVer`) when meta is present.
- `EMPTY_LOTS` stable identity; `allLotsWithArchive` memoized (documented infinite-loop guard); `fromCache` = phase-1 presence via lazy initializer (StrictMode-safe, matches audit-lifecycle #2).
- Total-failure path leaves `cached` null → next mount retries the whole load; earlier mounts recover via the shared notify when it succeeds.

**useRefs.ts** — `dead` flag guards both resolutions; failure clears on next mount (cache stays null → refetch); `refs.json` deliberately excluded from immutable headers (revalidates each crawl); `refsForMaker` null-safe.

**useSavedLots.ts** — pure adapter over `useAccount`; nothing to fail.

**useChartDraw.ts** — shared IO singleton: every observed element is unobserved either on fire or via the callback-ref cleanup (React always calls refs with null on unmount); `onFired` WeakMap entries deleted on both paths → no element retention. `firedRef` per-instance never-replay contract holds across filter remounts. Reduced-motion short-circuit never attaches the observer. StrictMode double ref-attach handled by `cleanupRef.current?.()` on re-entry. Module IO never disconnected — empty observer, negligible.

**account.tsx**
- StrictMode read-then-write guards all verified: `migratedRef` set before await + reset on failure (no double migration, no data loss — localStorage cleared ONLY after clean upsert, line 189); pending-save replay sits after the `cancelled` check (line 199) so the cancelled first effect run can't consume it; saved-lots load effect keyed on `user?.id` (not the object) so token refresh doesn't re-fetch — with `cancelled` guard on every setState.
- Optimistic toggle rollbacks: unsave failure re-adds the exact removed entry (dup-guarded), save failure removes by id, `toggleOwned` inverts on failure — each with a user-visible flash. The lazy-builder `.then()` execution bug (the original silent-save) is correctly worked around everywhere.
- `readStored`/`writeStored` and every other localStorage touch in the file are try-caught (private mode safe); legacy `string[]` migration shape-checked field by field.
- `entriesRef` mirror keeps `toggle`/`toggleOwned` reads current without rebinding; `toggleOwned`'s localStorage branch computes from `entriesRef.current` with the same transform → consistent with queued state.
- Pre-migration column fallback (`NEW_COLS` regex → `stripNewCols` retry) covers PostgREST rejection of `saved_title`/`saved_artist`.
- `savedReady` gate opens on BOTH success and error of the cloud load (line 198) — /saved can't hang; error path keeps prior entries (never blanks saves).
- `signOut` clears entries + resets `migratedRef` only in auth mode (localStorage list untouched); onAuthStateChange unsubscribed in cleanup; login modal closes on session arrival.
- LoginModal: focus trap correct (shift/forward wrap, outside-focus recapture), Escape closes, scroll-lock restore ordering safe across effect re-runs, prevFocus restored, portal SSR-guarded.
- `saved_lots` RLS verified in-repo (owner-scoped select/insert/update/delete, `on delete cascade` from auth.users).

**alerts.ts** — `useAlerts`/`useUnseenAlertCount` carry `dead` guards (no setState after unmount); `user?.id` deps prevent token-refresh re-fetch storms (documented); signed-out paths resolve `ready` immediately; `describeQuery` pure.

**supabase.ts** — module-scope singleton (one client per tab, no per-render construction); null when env unset with every consumer null-guarding (verified in account.tsx + alerts.ts); `persistSession`/`autoRefreshToken`/`detectSessionInUrl` correct for OAuth-redirect + magic-link flows.

**market.tsx**
- `segmentMarket` edge cases: unknown segment (`/analytics/foo`), extra depth (`/analytics/watches/x`), maker slugs (`/makers/<slug>` — one level above `/makers/m/`), the inert `/makers/m` bare path, and `all`-as-segment all correctly fall through to stored choice. All six vertical keys `live: true` in constants → resolvable.
- Path normalization: trailing slashes, `.html` static-hosting suffix, `''→'/'`, legacy `/collectibles` → all mapped.
- `MARKET_TITLE[urlMarket!]` safe (onLander ⇒ defined); title effect mirrors generateMetadata per the documented contract.
- localStorage: all three touches try-caught. Hydration effect validates the stored key against MARKETS before trusting it.
- Landing-on-vertical persistence effect idempotent (StrictMode-safe); `/` display no longer stomps the stored vertical (as documented).
- Scroll ledger: stamp debounce timer cleared on cleanup; scroll + popstate listeners removed; `{...history.state}` spread preserves Next internals; pushState-under-the-board pattern is the Next 14.1+ supported native-history sync; entries without a stamp untouched (browser default).
