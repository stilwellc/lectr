# C3 — GA-readiness performance audit

**Date:** 2026-08-03 (evening, crawl v=2026-08-03T10:47:45Z) · **Method:** live CDP measurement on https://lectr.bid (playwright-core, channel `chrome`, fresh contexts = cold cache) + static-export/bundle analysis of the repo. Mobile = Pixel-8 emulation, 4× CPU throttle, Fast-4G (9 Mbps down / 150 ms RTT). Desktop = 1440×900, unthrottled on a fast pipe. All wire bytes are CDP `encodedDataLength` (what actually crossed the network, post-brotli).

---

## 1. Measured Core Web Vitals (cold cache)

### Desktop

| Page | TTFB | FCP | LCP | LCP element | CLS | Reqs | Wire to settle | Long tasks >200 ms |
|---|---|---|---|---|---|---|---|---|
| `/` (home) | 166 ms | 608 ms | **1,640 ms** | hero number `+2.5%` (span) | 0.000 | 53 | 2.18 MB | 0 |
| `/value` | 142 ms | 496 ms | 496 ms † | nav text (content still gated) | 0.000 | 49 | 2.18 MB (+32 MB in flight) | 0 |
| `/makers` | 187 ms | 444 ms | **5,528 ms** | H1 masthead (corpus-gated) | 0.000 | 96 | **32.3 MB** | **4** (359/317/233/229 ms shard parse) |
| `/analytics` | 151 ms | 480 ms | 480 ms | H1 masthead | **0.647** | 65 | **32.0 MB** | **1 × 1,205 ms** |
| `/lot/wright-295567~` | 169 ms | 436 ms | 436 ms | H1 | 0.007 | 63 | **32.0 MB** | 0 |
| `/ref/rolex/oysterperpetual` (dossier) | 191 ms | 412 ms | 764 ms | H1 | **0.434** | 88 | 6.66 MB | 0 |
| `/makers/kaws` | 132 ms | 392 ms | 392 ms † | H1 (sparklines still filling) | 0.085 | 62 | 2.35 MB (+32 MB in flight) | 0 |

### Mobile (Pixel 8 emu, 4× CPU, Fast 4G)

| Page | TTFB | FCP | LCP | LCP element | CLS | Wire to settle | Notes |
|---|---|---|---|---|---|---|---|
| `/` (home) | 141 ms | 688 ms | **2,972 ms** | mobile hero number `+3.0%` | 0.000 | 2.25 MB | LCP waits on 974 KB upcoming.json + hydrate |
| `/value` | 165 ms | 656 ms | 656 ms † (bogus: nav logo) | — | 0.000 | 1.7 MB + 32 MB streaming | **Real content paint: 31.4 s** |
| `/makers` | 150 ms | 624 ms | 624 ms † (bogus: nav logo) | — | 0.000 | 2.2 MB + 32 MB streaming | **Real content paint: 31.2 s** |
| `/analytics` | 136 ms | 680 ms | 680 ms | intro paragraph | **0.529** | 2.3 MB + streaming | shift at 2.5 s when data lands |
| `/lot/…` | 183 ms | 680 ms | 680 ms | lot photo (Supabase fast path works) | 0.001 | 1.9 MB + streaming | good — but still pulls 32 MB behind |
| dossier `/ref/…` | 159 ms | 636 ms | 2,200 ms | stats paragraph | **0.635** | 5.9 MB | 3.6 MB of that is images for 40×40 avatars |
| `/makers/kaws` | 131 ms | 772 ms | 772 ms | hero value `—` (placeholder!) | 0.222 | 1.8 MB + streaming | hero LCP'd on an em-dash |

† = LCP API reported a pre-content element because the real content is fetch-gated; treat the "gated content" columns as the honest number.

**Static-file serving is healthy:** TTFB 130–190 ms everywhere, HTTP/2, brotli on everything ≥ 1 KB, `cf-cache-status: DYNAMIC` is normal for Pages' asset layer.

---

## 2. The phase-1 payload (what every route pays before paint)

Measured wire bytes (brotli, `accept-encoding: br`):

| File | Raw (prod) | Wire (br) | Cache-Control | Verdict |
|---|---|---|---|---|
| `upcoming.json` | **7.01 MB** | **973 KB** | `max-age=0, must-revalidate` | dominates phase 1 |
| `market.json` | 1.31 MB | 268 KB | must-revalidate | ok |
| `stats.json` | 613 KB | 73 KB | must-revalidate | ok |
| `backtest.json` | 3 KB | 0.7 KB | must-revalidate | ok |
| `meta.json` | 3 KB | 0.9 KB | must-revalidate | ok |
| **Phase-1 total** | ~9 MB | **~1.32 MB** | | acceptable wire, heavy parse |
| `lots-0…15.json` (phase 2) | 16 × ~18.9 MB = **302 MB raw** | 16 × ~2.2 MB ≈ **32 MB wire** | `immutable` + `?v=` ✅ | the structural problem |
| `sold-archive-0.json` (phase 3) | 18.8 MB | 3.3 MB | immutable ✅ | opt-in, fine |
| `players.json` / `refs.json` | 2.2 / 1.9 MB | 479 / 312 KB | must-revalidate | on-demand, fine |

**The honest upcoming.json number:** the "~8 MB" claim is 7.01 MB raw today; **the wire cost is 973 KB brotli**. CF serves br on every JSON (verified `content-encoding: br`).

**What's inside upcoming.json (measured field weights, local copy 6.41 MB):**

| Field | Raw MB | Share |
|---|---|---|
| **`value.poolIds`** (1,256 lots × ~2.4 KB of comp-lot ids) | **2.97 MB** | **46%** |
| `value` (everything else) | 0.24 MB | 4% |
| `imageUrl` | 0.49 MB | 8% |
| `title` | 0.40 MB | 6% |
| `url` + `id` + `saleName` | 0.65 MB | 10% |
| all other lot fields | ~1.6 MB | 26% |
| tape/demand/realized/recentSold | 0.09 MB | 1% |

Measured directly: stripping `poolIds` → **6.41 MB → 3.44 MB raw, 817 KB → 418 KB brotli (q5)**. Half the phase-1 flagship file is comp-pool id lists that only ComparableModal ever reads.

**Cache header correctness: PASS.** Shards + sold-archive are `immutable` and every client fetch is `?v=<lastCrawl>`-busted (verified in `useRayData.ts` L312/L325/L429); phase-1 files correctly `must-revalidate`. `public/_headers` globs match exactly the versioned families and nothing else. One nit: `lots-index.json` (13 B) is served uncompressed — irrelevant.

---

## 3. The phase-2 corpus pull (the structural finding)

`/value`, `/makers`, `/makers/[slug]`, `/analytics`, `/lot/[id]`, `/profile` all mount `useFullLots()` → **16 shards, 32 MB wire, 302 MB of JSON to parse**.

- **Mobile Fast-4G: 31.2–31.4 s of skeleton** before `/makers` and `/value` show any content (measured; 31.8 MB downloaded to get there). `/value` is the flagship "see how we called it" route.
- Desktop: content at ~5–9 s ( `/makers` LCP 5.5 s, `/analytics` 1.2 s main-thread stall while crunching).
- **JS heap after corpus load on `/value`: 427 MB** (measured `performance.memory`). Low-RAM Android will OOM-kill the tab.
- Repeat visits within a crawl day are free (immutable + `?v=` — verified). But **every new crawl day = a fresh 32 MB** for returning users; on cellular that's data-plan-hostile.
- `/lot` permalinks paint instantly off the Supabase fast path (mobile LCP 680 ms — good) but still stream the full 32 MB in the background for one lot.

---

## 4. Other measured findings

- **CLS is the worst live vital.** `/analytics` **0.53–0.65** (single shift when data lands under `.ray-desk-cell2` cells / `.ray-vm-card`), dossier `/ref` **0.43–0.63** (the `FOOTER.ray-close` colophon sits in the first viewport during load, then gets shoved down when content arrives), `/makers/[slug]` mobile **0.22** (`.ray-loading` swap). Home and `/value` are 0.000 — the skeleton geometry there is right.
- **Dossier images: 2880×2880 originals for 40×40 avatars.** `/ref/rolex/oysterperpetual` fetched 8+ full-res Bonhams images (672 KB each) = **3.6 MB (mobile) / 5+ MB (desktop) of its wire is thumbnails**. Verified: `images1.bonhams.com/image?src=…&width=120` returns **3.3 KB** (205× smaller) — the resizer already exists, the URL just never asks.
- **Brand PNGs ship at master resolution.** `lectr-ink.png` = 1146×735 / **214 KB**, rendered at 34×22 in the nav-adjacent slot; `lectr.png` = 1146×735 / **185 KB** rendered at 184×118. ~380 KB/page of decorative PNG on home, lot, dossier.
- **wright20 thumbnails: still ORB-blocked, but not hanging.** 15 requests on desktop home die fast with `net::ERR_BLOCKED_BY_ORB`; `TonightsWall`'s `onError` → `drop()` backfills the plate, so the cost is 15 wasted requests + wall churn, not a hung load. (Mobile home happened to draw a wall without wright20 candidates: 0 failures.)
- **Fonts: 5 files, 197 KB**, all `display: swap`, preloaded (`.p.woff2`) — no FOIT, loaded 28/28 by settle. The heavy one is **Fraunces variable at 118 KB** (opsz+SOFT+WONK axes); Inter var 48 KB; 3 Plex Mono cuts 30 KB.
- **Bruun-Rasmussen wall thumbnails** load `BRFull` originals for 38×40 plates (several still incomplete at 5 s settle on desktop home). Same class of problem as Bonhams, smaller exposure.
- **Home mobile LCP 2,972 ms** = hero number, sequenced JS-load → hydrate → fetch upcoming.json (973 KB) → render. Nothing tells the browser about upcoming.json until hydration; a `<link rel="preload">` would start it at t≈0.

## 5. Bundle analysis (from `next build` + static export)

Shared first-load **85.2 kB gz** (Next's table). Real script bytes per page (gz, sum of emitted script tags): home/landers **305 kB**, `/value` 245 kB, `/makers` 243 kB, `/analytics` 266 kB, `/lot` 232 kB, maker dossier **340 kB**.

- **recharts (chunk `8759`, 94.6 kB gz) is correctly isolated** — only `/makers/[slug]` pages load it; the analytics panels behind `next/dynamic` (`Distributions.tsx` etc.) keep it out of `/analytics` first load. ✅
- **supabase-js is in every page's critical path**: chunk `8074` 47.6 kB gz (GoTrue + **RealtimeClient — never used**) + `44530001` 13.3 kB gz, pulled by the static `import { supabase } from './supabase'` in `app/lib/account.tsx` mounted from the root layout (`app/layout.tsx` → `AccountProvider`). ~60 kB gz on every route for an auth session check.
- **framer-motion** (chunk `6793`, 31.4 kB gz) loads on home + all 8 market landers via `IndexHero`/`SubMarketBoard` (already `LazyMotion`/`domAnimation` — this is the slim form; fine).
- polyfills 30.4 kB gz still ships (Next 14 default), react-dom 52 kB — normal.
- Dynamic-import coverage is otherwise good: `next/dynamic` in makers, makers/[slug], value, analytics, Distributions.

---

## 6. Ranked findings

### [BLOCKER]
1. **31-second mobile skeleton on `/value` and `/makers`** (32 MB corpus gate; §3). Multi-second is the bar — this is 31 s on the route the proof line links to ("See how we called it"). A first-time mobile visitor from a share link will assume the site is broken. Cheapest credible pre-GA mitigation (hours, not the payload diet):
   - `/value`: the engine call is already precomputed on upcoming.json lots (`lot.value`, `signal`) — render the call plate + feed from phase 1 and let corpus-dependent extras (pool drill-ins) hydrate in behind, instead of `!fullLoaded → skeleton` (app/value/page.tsx L362).
   - `/makers`: paint the masthead + maker table from `stats.json`/phase-1 (already loaded at t≈1 s) and let sparklines fill per-row (app/makers/page.tsx L72 gates the entire page).
   - Risk: medium (two gate refactors on flagship pages the night before GA — scope to these two `!fullLoaded` ternaries only; every downstream component already tolerates `fullLoaded=false` states elsewhere).

### [PRE-GA] cheap wins (ranked by value/effort)
2. **CLS 0.43–0.65 on `/analytics` + `/ref` dossiers + maker mobile.** Give the gated content containers a `min-height` (~`100dvh` on the loading wrapper) so the `.ray-close` footer never renders in the first viewport and `.ray-desk-cell2` cells don't reflow the rail. Savings: CLS → <0.1, fixes the two worst-scoring vitals on the site. Effort: ~30 min CSS. Risk: minimal.
3. **Bonhams thumbnail resizing.** Append `&width=160` (2× for retina 40px slots) when `imageUrl` matches `images1.bonhams.com/image?src=`. Measured 672 KB → 3.3 KB per image; saves **~3–5 MB per dossier view** and shrinks watch-heavy feeds everywhere. Effort: one helper at the `<img src>` call sites (RefPage/feed cards). Risk: low (param verified live).
4. **Right-size the brand PNGs.** Export `lectr-ink.png` and `lectr.png` at 2× display size (≤ 400 px wide) → ~380 KB → ~25 KB on home/lot/dossier. Effort: 15 min. Risk: none.
5. **Preload phase-1 JSON.** `<link rel="preload" href="/data/ray/upcoming.json" as="fetch" crossorigin>` (+ market.json, stats.json) in the root layout head. Starts the 973 KB fetch at t=0 instead of post-hydration; expected **−500–800 ms home mobile LCP** (2.97 s → ~2.2 s). Effort: 3 lines. Risk: low (same-origin, must-revalidate semantics unchanged).
6. **Stop requesting wright20 images from the browser.** Known-ORB domain: filter `wright20.com` out of `TonightsWall` candidates (and any feed card `<img>`) until the crawl-time image proxy exists. Saves 15 dead requests + wall backfill churn on home. Effort: small skip-list. Risk: none (those plates never render anyway).
7. **Bruun-Rasmussen wall thumbs**: swap `BRFull` → their thumbnail path if one exists, else include in the same skip/resize helper as #3/#6. Effort: small. Risk: low.

### [POST-GA] structural (the payload diet)
8. **`value.poolIds` out of upcoming.json** — 46% of the file; ship the pool per-lot on demand (Supabase query or a `pools/` shard keyed by lot id, fetched when ComparableModal opens). Wire: 973 KB → ~500 KB, raw 7 MB → 3.4 MB (halves phase-1 parse too).
9. **Kill the 32 MB corpus habit** — the real fix behind finding #1. Options in order of leverage: (a) move comp-pool/appraisal reads to Supabase (the DB already holds every lot; `/lot` fast path proves the pattern), (b) split shards by market so a route pulls only its vertical, (c) a slim "engine projection" shard set (id, maker, form, price, date — the fields comps.ts actually gates on) instead of full slim lots. Also fixes the 427 MB heap.
10. **supabase-js out of the shared bundle** (~60 kB gz/page): dynamic-import the client inside `AccountProvider` after first paint (or on first auth interaction); drop RealtimeClient via `@supabase/auth-js` + `postgrest-js` direct imports.
11. **Fraunces diet** (118 KB → ~40 KB): drop the SOFT/WONK axes if the dossier heads don't use them, or subset to the display weights actually rendered.
12. **Image proxy at crawl time** (already on the committee backlog) — permanently ends ORB blocks, mixed-CDN sizing roulette, and third-party hostname coupling.

---

## Appendix — measurement artifacts
- Raw run data: `scratchpad/perf-desktop.json`, `perf-mobile.json` (per-request bytes, LCP candidate chains, CLS sources, font/img inventories), harness `perf.js`, gated-paint prober `gated.js`, field-weight script `upweight.js` (session scratchpad `/private/tmp/claude-501/-Users-collin/761c6cf6-ce91-4aef-9574-4ec63e9f275e/scratchpad/`).
- Bundle table source: `npx next build` route table + gz sums of emitted script tags in `out/*.html`.
