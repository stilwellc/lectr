# QA audit — lectr.bid loading & back-navigation render bugs

Date: 2026-08-02 · Method: black-box, playwright-core 1.62 (channel: chrome), production https://lectr.bid
Viewports: desktop 1280×900, mobile 390×844 (isMobile + hasTouch, iPhone UA)
Screenshots + repro scripts: `/private/tmp/claude-501/-Users-collin/761c6cf6-ce91-4aef-9574-4ec63e9f275e/scratchpad/qa/` (56 shots; scripts `f1-coldload.js` … `f8-mobile.js`, `modal-probe.js`, `verify-*.js`)

**Headline:** zero console errors / pageerrors were captured in ANY flow. Every defect below is a pure state/render/history problem, not a JS crash.

Severity totals: **2 broken · 3 degraded · 3 cosmetic**

---

## DEFECT 1 — Lot "pages" are history-less modals; browser Back abandons the page instead of closing them — **BROKEN**

(a) Repro:
1. Go to `/sports` (or `/`, `/value`). 2. Click any lot row (`<tbody><tr>` on desktop, `.ray-feeditem-row` on mobile) — a `comp-modal-overlay` opens. URL does **not** change (stays `/sports`), `history.length` does not change. 3. Press browser Back.

(b) What's wrong: Back does not close the modal — it leaves the page entirely. Coming from home you land back on `/`, losing the sports list + modal; on direct entry to `/sports` you exit the site (`about:blank`). On mobile, where the back-gesture is the universal "dismiss" action, every lot view punts the user off the page. The lot deep link exists (`Copy link` yields `https://lectr.bid/lot?id=goldin-202605-2214-4721-e4902f1f-...`, and that page renders fine cold) but no row click ever pushes it, so lots are unreachable by URL/history. Forward-nav after this does NOT restore the modal either (lot context permanently lost).

(c) Evidence: `mp-d-1-modal.png` (modal open, URL /sports), `mp-d-2-afterback.png` (about:blank after back), `mp-m-1-modal.png` (mobile same), `f2b-d-1-lot.png`. History probe: `open modal | url: /sports | hist.len: 3` (unchanged).

(d) Console: none.

(e) Severity: **broken** — this is the core "going back messes up" complaint.

---

## DEFECT 2 — Browser Back to home restores scroll to the page bottom (footer), not where you left — **BROKEN**

(a) Repro: 1. Cold load `/` (land at top, scrollY 0). 2. Click the "Sports" market pill (→ `/sports`). 3. Press Back.

(b) What's wrong: Home re-renders scrolled to **scrollY = previous scrollHeight − viewport** — desktop 4539 (= 5439−900 exactly), mobile 4459. The user left home at the top and returns staring at the footer / bottom of the feed. Deterministic — reproduced 4/4 attempts across three separate scripts, both viewports. `history.scrollRestoration` is `auto`; something in the home page scrolls to old-max-scroll during restore. (Back to `/sports` restores correctly, so this is home-specific.)

(c) Evidence: `f9-d-back2.png` (desktop mid-feed/settlement strip instead of hero), `f8-m-2-home-afterback.png` (mobile: footer links fill the screen), `f2b-d-2-back-sports.png`. Measurement log: `after back: {"y":4539,"sh":6270,"ih":900}` vs fresh-home max scroll 5439−900=4539.

(d) Console: none.

(e) Severity: **broken** — every back-to-home lands in the footer.

---

## DEFECT 3 — Global market context bleeds into back-navigation: /artists re-renders as a different market than you left — **DEGRADED**

(a) Repro: 1. Cold load `/artists` → "Total market" lit, "39 tracked names". 2. Click a maker (e.g. Andy Warhol → `/andy-warhol`, or Patek Philippe). 3. Press Back.

(b) What's wrong: `/artists` now renders with the **Art** pill lit and "17 artists" (or **Watches** / "All 5 makers" after Patek) — the maker page silently rewrote the persisted market context, and back-nav renders the new state instead of the one the user left. Same mechanism makes *cold* loads of `/analytics` and `/artists` open pre-filtered to whatever market was last touched in the session (observed: cold `/analytics` with Sports pill lit). Analytics→sub→back does NOT bleed (sub pages don't rewrite context), so this is specifically maker pages.

(c) Evidence: `vbleed-artists-afterback-top.png` (Art lit, 17 artists after back; cold shot said 39), `f4-d-3-back.png` (watches-only roster, body text 5444→2100, svg paths 96→28), `f8-m-6-analytics.png` (cold analytics, Sports pre-lit).

(d) Console: none.

(e) Severity: **degraded** — render is coherent but wrong state; reads as "back broke the page".

---

## DEFECT 4 — Slow, high-variance client data loads: 3–10s+ of skeleton/blank after the shell paints — **DEGRADED**

(a) Repro: cold load `/artists`, `/analytics`, `/value` repeatedly (both viewports).

(b) What's wrong: the static shell paints in <1s, then the entire body is branded skeleton blocks (artists/value) or **completely empty below the market pills** (analytics — no skeleton at all, just dead black page) until data arrives. Measured arrival times varied wildly run-to-run: `/artists` desktop 10.3s after `load` in one run, ~3s in another; mobile fresh sessions settled 3.2–4.6s; one warm mobile session still showed skeletons at 30s check-in. `/analytics` showed header + pills + nothing for 3s+ (entrance-anim `.ray-enter` panels sitting at opacity 0 until data resolves). This variance is almost certainly the owner's "lot of loading bugs" perception, compounded by Defects 2/3 on back-nav (return to a page → full refetch → skeleton wall again at a restored scroll offset where skeletons don't even exist yet).

(c) Evidence: `f4-d-1-artists.png` first run (pure skeleton wall at 3s) vs `vb-artists-25s.png` (loaded), `f5-d-1-analytics.png` (blank below pills), `f8-m-3-value.png` (mobile value all-skeleton at 2.8s), timing logs in `verify-blank.js` / `f4` output (`content-arrival ms after load: 10273`).

(d) Console: none — fetches succeed, just slow/late.

(e) Severity: **degraded**.

---

## DEFECT 5 — Search/command palette survives browser Back and sits open on the destination page — **DEGRADED**

(a) Repro: 1. On `/sports`, open the search palette (Find a maker / row area click). 2. Press browser Back.

(b) What's wrong: navigation completes to `/` but the palette overlay is still open, stacked over the home hero. Route changes don't dismiss open overlays; Back should close the dialog first (or at minimum the route change should unmount it).

(c) Evidence: `f2-d-2-lot.png` (palette open on /sports), `f2-d-3-afterback.png` (same palette still open on `/` after back).

(d) Console: none.

(e) Severity: **degraded**.

---

## DEFECT 6 — /value comp-modal content never stops moving; real clicks miss — **COSMETIC→DEGRADED**

(a) Repro: `/value` → click a signal card → comp modal opens → try to click "View lot" (external link) or comp rows.

(b) What's wrong: Playwright reported `element is not stable` continuously for a full 30s — the modal rows/images re-layout in a loop (comp rows and `comp-modal-img` keep intercepting/moving). An automated click never landed; human clicks will mis-hit while rows shift.

(c) Evidence: `f3-value.js` click log (30s of "element is not stable"/"intercepts pointer events" retries on `.comp-modal-overlay`), `f3-d-2-lot.png`.

(d) Console: none.

(e) Severity: cosmetic-to-degraded.

---

## DEFECT 7 — Home cold load: `load` blocked ~9.7s; third-party feed thumbnails die with ERR_BLOCKED_BY_ORB — **COSMETIC**

(a) Repro: cold load `/` with network log.

(b) What's wrong: content paints ~1.2s, but the browser `load` event hangs to ~9.7s (both viewports) on third-party auction-house images; 15+ wright20.com images fail `net::ERR_BLOCKED_BY_ORB` (hotlink/ORB-blocked) → missing thumbnails in the feed + the tab spinner runs ~10s, feeding the "slow site" impression.

(c) Evidence: `f1-coldload.js` output (`load ms: 9748` desktop / `9707` mobile; reqfail list), `f1-d-home-settled.png`.

(d) Console/net: `[reqfail] https://www.wright20.com/items/... :: net::ERR_BLOCKED_BY_ORB` ×15.

(e) Severity: cosmetic (perf/visual).

---

## DEFECT 8 — /ref and /player are orphan routes — **COSMETIC**

(a) Repro: crawl `/`, `/sports`, `/watches`, `/rolex`, `/sports-cards`, `/sub?id=rolex:daytona`, lot pages for `a[href^="/ref"]` / `a[href^="/player"]` → **zero links found anywhere**. Hand-typed: `/ref?id=...` → clean "Not in the reference book" empty state; `/player?id=lebron-james` → renders a full player page (3.9K chars).

(b) What's wrong: working pages that no UI path reaches (or ref ids never resolve). Not a render bug, but worth knowing for the audit.

(c) Evidence: `f7-d-probe_ref_id_rolex_3A116500.png`, `f7-d-probe_player_id_lebron_james.png`.

(e) Severity: cosmetic / product gap.

---

## Flows that are CLEAN (verified, both viewports unless noted)

- **/analytics → market switch → /sub?id=… → Back (×2 rows):** market selection preserved (Sports stays lit), scroll restored to the clicked row, all 161 svg paths re-render. `f5-d-4-back-a.png`/`-b.png`. Desktop verified; mobile analytics only suffers Defect 4 latency.
- **Cold direct loads of `/lot?id=<real>`, `/sub?id=rolex:daytona`, `/saved` (signed out):** single skeleton phase ≤1s, no double-flash, no content-appears-then-disappears, no infinite spinners. `/saved` shows a proper sign-in hero. `f6-d-*.png`, `f6-m-*.png`.
- **Reload (F5) on /sports → nav to /value → Back to /sports:** identical render pre/post, no stuck states. `f7-d-2-back-after-reload.png`.
- **Multi-back history order:** an earlier suspicion of history corruption in the / → sports → modal → sports-cards → back×3 chain was **disproven** with `history.length` instrumentation — order is correct (`/sports-cards → /sports → / → exit`); the only wrongness in the chain is Defect 2's scroll and Defect 1's lost modal.
- **Forward navigation:** `/sports` re-renders correctly with scroll restored (2840→2840) after Back/Forward.
- **Mobile hero chart after Back:** renders (366×200 svg, 7 paths) — not blank.
- **Mobile bottom tab bar:** none exists (hamburger top nav only) — nothing to regress.
- **Sparkline wall after Back on /artists:** sparklines themselves render (0 empty svgs) — the wall is *wrong-market-filtered* (Defect 3), not broken.
- **No NaN/undefined text, no stuck opacity-0 elements after settle, in any settled render.**

## Suggested fix priorities for the code-audit sibling

1. Lot modal: push a history entry (`/lot?id=…` or `?lot=` param) on open; close on popstate. Kills Defect 1 and makes lots shareable.
2. Home scroll restoration: find what scrolls to old-max-scroll on popstate re-entry (likely feed/hero remount effect vs `scrollRestoration: auto`).
3. Maker pages: stop persisting their market into the global context (or key /artists render off URL state, not the shared store).
4. Close all overlays (palette, comp modal) on route change.
5. Cache page data across client navs (back-nav currently refetches everything into skeletons).
