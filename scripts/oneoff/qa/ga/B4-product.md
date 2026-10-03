# B4 — GA-Readiness Audit: PRODUCT COMPONENTS
Audited 2026-08-03 · every line of app/components/{LotPage, LotCard, ComparableModal, Terminal, PastResults, ArtistHero, RecordPlate, FollowButton, CommandK, ArtistNav, AlertsInbox, SaveSearch, SubMarketDirectory, RefPage, PlayerPage, FeedToolbar}.tsx + all 21 files in app/components/analytics/. Cross-checked against app/hooks/useRayData.ts, app/hooks/useSavedLots.ts, app/lib/account.tsx, app/utils.ts, app/types.ts, app/lot/page.tsx, public/_redirects, next.config.js.

**Counts: 0 BLOCKER · 6 PRE-GA · 14 POST-GA · dead-code inventory of 10 items · 14 verified-sound.**

---

## PRE-GA

### P1 · ComparableModal save drops the lot payload — lost saves for signed-out users, meta-less watchlist rows
- `app/components/ComparableModal.tsx:396` (prop type `onToggleSave?: (lotId: string) => void`) and `:785` (`onClick={() => onToggleSave(lot.id)}`)
- The account layer's `toggle(lotId, lot?)` (app/lib/account.tsx:224) uses the second arg for two things: (a) `entryFromLot(lotId, lot)` — without it the saved entry has `title/artist/estMid/signalPct/bidCount` all null, so the /profile watching ledger row for a modal-saved lot is a bare id; (b) the signed-out path (account.tsx:238-241) only stashes `lectr-pending-save` **`if (lot)`** — a signed-out reader who clicks Save in the comps modal gets the login sheet, completes OAuth, and **the save is silently lost**. LotCard/LotPage/PastResults all pass the lot; only the modal doesn't.
- Severity: **[PRE-GA]** — Save is a core CTA on the modal, and the sign-in-to-save funnel loses the action.
- Fix (2 lines): widen the prop to `(lotId: string, lot?: AuctionLot) => void` and call `onToggleSave(lot.id, lot)`. LotCard already forwards a compatible handler.

### P2 · CommandK + ArtistNav still navigate the retired root maker routes
- `app/components/CommandK.tsx:82` (`path: '/${a.slug}'`, also flows into browse groups at :96) and `app/components/ArtistNav.tsx:135, :167, :626` (`navigate('/${first.slug}')` / `navigate('/${a.slug}')`)
- The Aug-2 migration moved makers to `/makers/<slug>`; no `app/[slug]` route exists anymore. In production the client router misses, hard-navigates, and rides the Cloudflare `_redirects` 301 — a full page reload plus two network hops on the single most common navigation (picking a maker). In `next dev` (no `_redirects`) these land on the branded 404.
- Severity: **[PRE-GA]** — works via redirect but degrades the core nav to MPA reloads; trivial to fix, and the memory doctrine says in-app links must use the new forms.
- Fix: replace all four sites with `/makers/${slug}`.

### P3 · AlertsInbox thumbnails: no referrerPolicy, no onError
- `app/components/AlertsInbox.tsx:137` — `<img className="lectr-inbox-thumb" src={httpsImg(lot.imageUrl)} alt="" loading="lazy" />`
- Every other product `<img>` (LotPage, LotCard, ComparableModal, CallPlate, RecordPlate, RefPage) sends `referrerPolicy="no-referrer"` because the houses hotlink-block on referer, and handles onError. The inbox rows on /profile will show broken-image glyphs for blocked/dead house photos.
- Severity: **[PRE-GA]** — first surface a returning collector sees.
- Fix: add `referrerPolicy="no-referrer"` + `onError={e => e.currentTarget.remove()}` (background var already provides the fallback tile).

### P4 · Engine-pool `priceUsd!` assertions can print "$NaN" and NaN SVG coordinates
- `app/components/ComparableModal.tsx:586` (`comparables.map(c => c.lot.priceUsd!)` into compStats), `:987` (into PriceBand `prices`), `:1219` (`formatPrice(comp.priceUsd!)`); same shape in `app/components/LotPage.tsx:814` (guarded there by ternary — fine) and PriceBand itself (`ComparableModal.tsx:184-188`: `Math.min(...)` of an array containing `undefined` → NaN, and `lo <= 0 || hi <= lo` is false for NaN, so the guard passes and every `x(p)` emits `cx="NaN%"`).
- Trigger: an `ev.poolIds` entry resolving (via the `byId` map at :494) to a lot that is in the client corpus but not `sold`-with-price (e.g. a repeat-sale sibling now relisted, or a data fault). Build-side discipline makes this rare, not impossible.
- Severity: **[PRE-GA]** — one bad pool id turns the flagship proof surface into $NaN.
- Fix: filter the resolved pool once: `.filter(l => l.status === 'sold' && l.priceUsd)` at ComparableModal.tsx:495 and LotPage.tsx:360.

### P5 · CallPlate full-density: `<button>` nested inside `<Link>`
- `app/components/Terminal.tsx:271` (whole plate is a `<Link href="/value">`) wrapping `saveBtn` (`:209-222`, a `<button>`).
- Invalid HTML (interactive inside interactive): screen readers announce the save control as part of the link, and browsers/React can re-parent or warn during hydration. Click behavior is patched with preventDefault/stopPropagation, but keyboard/AT behavior is undefined.
- Severity: **[PRE-GA]** (a11y + markup validity on the board's headline panel).
- Fix: absolutely position the save button as a sibling over the plate (LotCard's stretched-action pattern, already used at LotCard.tsx:226-254), not a descendant.

### P6 · ComparableModal renders crawler strings the sibling surfaces sanitize
- `app/components/ComparableModal.tsx:924` — `{lot.saleName}` raw (LotPage.tsx:468 runs it through `cleanText`); `:1183` — `{comp.title}` raw while the thumb letter at :1165 uses `craftTitle`. Auction feeds leak markup fragments/entities into these fields (that's why cleanText exists); React escapes them so this is **not** XSS, but "&amp;#39;" / "</p>" debris prints verbatim in the modal.
- Severity: **[PRE-GA]** (cosmetic but on the highest-traffic overlay; two one-word fixes).
- Fix: `cleanText(lot.saleName)`, `craftTitle(comp.title)`.

---

## POST-GA

1. **`href={lot.url}` / `comp.url` scheme never validated** — LotPage.tsx:737,798; LotCard.tsx:243; PastResults.tsx:349; ComparableModal.tsx:949,1125; Terminal.tsx:262. All carry `target="_blank" rel="noopener noreferrer"` (good), but a crawler-derived `javascript:` URL would still execute on click. The crawlers build URLs from house domains so the risk is data-fault-shaped, not attacker-shaped. Fix belongs in the pipeline: assert `^https?:` at build; optionally a one-line client guard in the shared card actions.
2. **Stale `called`/`sig` computed against the partial eager corpus** — LotPage.tsx:363-364, ComparableModal.tsx:509. When the engine declined and phase-2 is still streaming, `signalWithPool` runs on the eager slice; if it returns a read, the comps header prints an n from a truncated pool and silently swaps when full data lands. `compsPending` only covers the *no-read* case. Consistent across both surfaces; tighten by gating the client fallback on `fullLoaded`.
3. **RecordPlate stale `imgOk` across deck replacement** — RecordPlate.tsx:64-71: `imgOk` resets on `idx` change only. If upstream swaps the deck (lens change in ArtistHero) while `idx` stays put, a prior failure keeps the new sale's healthy image hidden. Reset on `cur.imageUrl` instead of `idx`.
4. **LotCard timer leaks** — LotCard.tsx:151-154: `setTimeout(revokeObjectURL, 1000)` and `setTimeout(() => setReminded(false), 2500)` never cleared on unmount (state-set-after-unmount no-op, but the timers accumulate on fast feed re-keys). SaveSearch.tsx:45 `revert` timeout likewise never cleared on unmount.
5. **FollowButton unhandled rejection** — FollowButton.tsx:27-34: `try/finally` without `catch`; a failed `save/remove` resets `busy` but surfaces nothing and rejects unhandled. Add a catch → error flash.
6. **ArtistRankingsTable sentinels participate in ascending sorts** — ArtistRankingsTable.tsx:95,103,131,171: `-999/-9999` "no data" rows rank first when the reader flips demand/% over est./movement to ascending. Sort should push sentinels last regardless of direction.
7. **a11y toggle semantics** — PastResults.tsx:250-264 Date/Price pills and category chips have `data-active` but no `aria-pressed`; LotCard save buttons (:344,:441) rely on label-swap without `aria-pressed` (LotPage's save at :745 does it right); ArtistSparklines sort segs (:511-521) + "Compare on one axis" (:523-531) same. FeedToolbar's sheet/lead-row pills are mostly correct (aria-pressed/radio) — mirror that.
8. **CommandK combobox wiring** — CommandK.tsx:189-231: input drives a `role="listbox"` of `role="option"` buttons but the input lacks `role="combobox"`/`aria-activedescendant`/`aria-expanded`, so SR users don't hear the highlighted row. Also no body-scroll lock while open.
9. **ArtistNav mobile sheet: no focus trap; `role="menuitem"` without a `menu` container** — ArtistNav.tsx:571-667 (dialog is labeled + Escape works + scroll locks; focus can still tab to the page behind), :154-176 menuitem buttons live in plain divs.
10. **Circular import chain** — LotCard → ComparableModal → LotPage → LotCard (and Terminal → LotCard). Works today (no module-eval-time cross-references), but any future top-level use of a late binding hard-crashes. Extract `formatEstimate/confidenceMeter/CopyLinkButton` into a leaf module.
11. **LotCard `todayIso` from `new Date()` during render** — LotCard.tsx:168 (no `mounted` gate, unlike LotPage.tsx:329). Only matters if a LotCard ever prerenders with `lastCrawl` unset — currently client-only feeds, so latent.
12. **DeskNote quarter staleness** — DeskNote.tsx:10-16 pins `q2-2026-*` slugs (all exist in app/blog/ ✓) with hardcoded "in Q2" copy; it's August (Q3). By design ("update when new notes publish") but worth a publish-or-hide check at GA.
13. **ArtistSparklines cross-page hash anchor** — ArtistSparklines.tsx:493 `<a href="/analytics#artist-rankings">` (mounted on /makers) forces a full document load; use `<Link>`.
14. **PlayerPage raw `{l.title}`** — PlayerPage.tsx:194 skips `craftTitle` (RefPage.tsx:153 uses it). Cosmetic consistency.

---

## DEAD-CODE INVENTORY (confirmed by mount grep: analytics components import only from app/analytics/page.tsx, app/makers/page.tsx, app/makers/[slug]/page.tsx, plus Distributions' internal dynamic imports)

1. **CategoryBreakdown.tsx:136-162** — standalone `<section>` frame (`if (embedded) return card` fallthrough). Only mount is Distributions.tsx:179 with `embedded` — **never-mounted frame, confirmed**.
2. **AuctionHouseDistribution.tsx:113-139** — same standalone frame; only mount Distributions.tsx:180 with `embedded` — **never-mounted, confirmed**.
3. **PriceDistribution.tsx:104-129** — same; only mount Distributions.tsx:181 with `embedded` — **never-mounted, confirmed**. (SportBreakdown has no standalone frame — clean.)
4. **VerifiedMovers.tsx:26,57 `variant: 'panel'` branch** — both mounts (analytics/page.tsx:86, makers/page.tsx:113) pass `variant="card"`; the panel styling in VerifiedStyles rides along. Self-documented as legacy.
5. **Colophon `lotCount`/`houseCount` props** — Terminal.tsx:355-359: accepted, never rendered. Callers still compute/pass them: LotPage.tsx:823, RefPage.tsx:107,197 (with a hardcoded `houseCount={7}` that PlayerPage.tsx:83-87 explicitly fixed on its side — harmless only because the prop is dead), PlayerPage.tsx:117,255.
6. **LotCard.tsx:5** — `MarketStats` imported, never used (single grep hit is the import line).
7. **RefPage.tsx:32,39,44** — module `refsFailed` flag written, never read. **PlayerPage.tsx:41,47,52** — same pattern (`failed` module var).
8. **ArtistSparklines.tsx:106,380** — `ArtistCardData.totalLots` computed per card, never rendered; **:535** unused map index `i`.
9. **ComparableModal.tsx:238-366** — `parseFrac/parseDims/parseArea/parseYear/mediumSimilarity/mediumClass/scoreComparable` are live (context-comps ranking path :571) — *not* dead; listed here to pre-empt a false positive.
10. **PortfolioHeader.tsx:10** — build-time `meta.json` import kept deliberately as first-paint fallback (`liveTotalLots ?? meta.totalLots` :86); per backend-state it goes stale between deploys — acceptable as fallback-only, keep an eye on it.

---

## VERIFIED-SOUND

- **LotPage multi-source resolution state machine** — the audit's prime suspect is clean: settle logic (LotPage.tsx:425-428) requires phase-1 (`!loading`), phase-2 (`fullLoaded||fullError`), the Supabase row (`dbSettled`, set in `finally` on every path incl. missing env), and — goldin-ids only — the phase-3 archive (`archiveLoaded||archiveError`, with `wantsArchive` correctly deferred until the main corpus settles so the probe actually mounts before "not on the book" can print). The goldin-prefix gate matches the archive's actual contents (useRayData.ts:203+: phase-3 is the Goldin sold-archive; RR's 252K rows live corpus-side). And the stale-state leak on client nav between lots is already defended: **app/lot/page.tsx:38 remounts LotPage with `key={id}`**, explicitly for dbLot/dbSettled/imgFailed.
- **ComparableModal dialog discipline** — Escape close (:429), focus moved in + Tab trap + focus restore (:437-468), body-scroll lock restoring the *prior* value (:472-476), overlay-click close with stopPropagation on the panel, `aria-modal` + label. Portal-after-hooks ordering correct (:621).
- **Image failure handling** on LotPage/LotCard/CallPlate/RecordPlate: `onError` + the cached-failure check (`complete && naturalWidth === 0` in the ref callback) + `referrerPolicy="no-referrer"` + honest monogram/plate fallbacks. (AlertsInbox is the one gap — P3.)
- **Hydration-safe style injection** — every quoted/attribute-selector CSS block goes through `dangerouslySetInnerHTML` or is deliberately quote-free (documented at LotPage.tsx:42, ArtistNav.tsx:272, ComparableModal.tsx:639, FeedToolbar.tsx:415); no user/crawler-derived string reaches any `__html` (all constants) — **XSS surface via innerHTML: none**.
- **External-link hygiene** — every `target="_blank"` in scope carries `rel="noopener noreferrer"` (checked all 8 sites).
- **×5 comp-ratio sanity** mirrored identically at LotPage.tsx:350-353, ComparableModal.tsx:38 and :490 — a build-killed fault can't resurrect on any surface.
- **Number formatting on optionals** — systematic guards found at every `.toLocaleString/.toFixed` site checked: SubMarketRead's `index` object types `changePct/ciLoPct/ciHiPct` as non-null numbers when present (useRayData.ts:116), `demandNow`/`typicalUsd` null-checked at all 6 consumer sites (SubMarketDirectory, SubMarketDrills, RelativeStrength, LongHorizon, LotPage, ComparableModal); `beatRatePct` non-optional when `signal` exists (types.ts:300); `cardComps.lastSales[].p`/`gradeLadder[].med` non-null (types.ts:290-293); PastResults gates `overEstimatePct` on price+both estimates and caps |pct|>2000 (:437-441). The one asserted-non-null residual is P4.
- **daysWord/daysUntil/localToday** — calendar-day arithmetic in one frame; malformed dates return 'scheduled'/null instead of NaN.
- **pickCall actionability** — live-day predicate + resultsPending + close-time-in-future gating (Terminal.tsx:54-63); `signal!` assertions are safe (filter guarantees them).
- **PastResults** — the house round-robin weave terminates (max queue length bound); keys are lot ids; sold-only price printing, resultsPending "Pending", tracked-bid honesty label on `goldin-final-bid`/legacy spelling.
- **FeedToolbar** — lens on/off sort memory (preLensSort), sheet Escape + focus return + scroll lock, cat-menu outside-click without the scroll-close footgun, `hasFirstSeen` defensive read, Clear preserving the reader's sort.
- **RecordPlate deck clamping** — idx re-clamped on shrink, `cur` bounded, auto-rotate paused on hover/focus, interval cleaned up, reduced-motion respected.
- **CountUp/Colophon hydration** — `suppressHydrationWarning` on the year, IO cleanup correct.
- **Data-freshness doctrine** — PortfolioHeader/TopSales/Distributions/SportBreakdown/ArtistSparklines/ArtistRankingsTable all prefer full-corpus build-time stats over the loaded sample, with labeled bases; honesty gates (n floors, abstain-instead-of-fabricate) present in RelativeStrength (≥4 verified), SeasonalityStrip (n≥30/≥8 months), HouseMatrix (n≥40), GradeLadderPanel (unfitted rungs disclosed), DeskNote/VerifiedMovers empty states.

---

## WORST 5
1. **P1** ComparableModal save drops the lot payload — signed-out saves are lost after login; watchlist rows saved from the modal are meta-less.
2. **P2** CommandK/ArtistNav push retired `/<slug>` maker routes — full-reload through a 301 in prod, 404 in dev, on the most common navigation.
3. **P4** `priceUsd!` in the modal's stats/PriceBand — one bad pool id prints $NaN on the flagship proof surface.
4. **P3** AlertsInbox thumbnails missing referrerPolicy/onError — broken-image rows on /profile.
5. **P5** CallPlate button-inside-link — invalid interactive nesting on the board's headline panel.
