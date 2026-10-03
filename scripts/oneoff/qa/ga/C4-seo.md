# C4 — GA-Readiness SEO / Meta / Routes Audit

Date: 2026-08-03 · Target: https://lectr.bid (live) + repo `/Users/collin/Dev/Ray` (code + `out/` build)
Method: source review (`app/layout.tsx`, per-route layouts/pages, `app/sitemap.ts`, `public/_redirects`, `public/_headers`, `public/robots.txt`), built-HTML inspection of `out/`, and live `curl` verification.

**Verdict: GA-shippable. 0 BLOCKERs. 6 PRE-GA items (2 that matter: sitemap ref-bug, www duplicate host). 6 POST-GA.**

---

## 1. Metadata by route family

Root (`app/layout.tsx`): `metadataBase = https://lectr.bid`, title default `lectr — auction intelligence`, template `%s — lectr`, full OG + twitter `summary_large_image`. **Global canonical correctly removed** — verified live: `/` emits NO canonical, and no page collapses onto a shell. `og:image`/`twitter:image` on root resolve absolute (`https://lectr.bid/opengraph-image?<hash>`), served `200 image/png` live (the `_headers` content-type fix works).

| Route family | Title (built HTML, verified) | Description | Canonical | OG/Twitter | Notes |
|---|---|---|---|---|---|
| `/` | `lectr — auction intelligence` | own (uses ARTISTS.length) | none (by design) | full, abs image | OK |
| Landers `/art /design /watches /science /sports /culture` | `Art — lectr` etc., no doubling | own per-vertical | none | own og:title `X — lectr` | OK |
| `/collectibles` (emitted but 301'd) | `Collectibles — lectr` | own | none | own | orphaned file — see POST-GA |
| `/value` | `Buy signals — lots priced below their comps — lectr` | own | none | inherited image | OK |
| `/value/[m]` (6) | `Art buy signals — lectr` | own per-market | ✅ abs `https://lectr.bid/value/art` | inherited image | OK |
| `/analytics` + `/[m]` | own; per-market | own | ✅ abs on `[m]`, none on index | inherited | OK |
| `/makers` | `The roster — … — lectr` | own | none | inherited | OK |
| `/makers/[slug]` (39) | **bare `KAWS`** (no brand suffix in `<title>`) | **inherited roster description — 39 identical** | **none** | ✅ `og:image` = abs `https://lectr.bid/og/kaws.png` (all 39 pngs exist, live 200 image/png); og:title `KAWS — lectr`; twitter:title bare `KAWS` | see PRE-GA-3 |
| `/makers/m/[market]` (6) | `Art makers — lectr` | own | ✅ abs | inherited | OK |
| `/sub/[a]/[b]` (95 built) | `Objects — sub-market · lectr` (`title.absolute` — **no template doubling**, verified) | own per-row | ✅ abs | own | OK |
| `/ref/[maker]/[key]` (613 built) | `Cartier Ref. 2324 — reference · lectr` (absolute, no doubling) | own w/ real medians | ✅ abs | own | OK — but absent from sitemap (PRE-GA-1) |
| `/sub`, `/ref` shells | `Sub-market — lectr` / `Reference — lectr` | own generic | none | inherited | legacy `?id=` client redirectors — intentional |
| `/lot` shell | `Lot — lectr` | own generic | **none, no noindex** | inherited | catch-all for every `/lot/*` — see PRE-GA-6 |
| `/lot/[id]` static (14 local / 18 live) | real, e.g. `Haïtienne — Henri Matisse` | rich (signal, est., house, date) | ✅ abs self | ✅ house photo https-forced, `og:type article`, falls back to site card | OK — verified live on both current (`wright-413240`) and deployed-set (`rago-402401/413597/413952`) lots |
| `/player` | `Player — lectr` | own generic | none | inherited | not in sitemap (intentional); query-param page |
| `/profile` | `Your watchlist — lectr` | own | none | — | ✅ `robots: noindex, nofollow` present in built HTML |
| `/blog` + 6 posts | own editorial titles, templated once | own per-post | none on posts | inherited | OK |
| `/blog/corrections` | own | own | ✅ abs self | inherited | not in sitemap (PRE-GA-4) |
| `/about` | own | own | none | inherited | OK |
| 404 (`not-found`) | `lectr — auction intelligence` (site default) | inherited | none | inherited | POST-GA nit |

No page anywhere carries an unwanted noindex (only `/profile`, which should). No title doubling anywhere (the `title.absolute` escapes on `/sub` + `/ref` dossiers work as commented).

## 2. Sitemap

Live `https://lectr.bid/sitemap.xml`: **200**, 187 URLs. Local build emits 184 (delta = lot-set rotation + one drill `sub/memorabilia/boxing-mma`, expected data-vintage drift; resolves on tomorrow's deploy).

- **Live-status sample: 30/30 URLs → 200**, spanning `/`, all 6 landers, `/value(+6)`, `/analytics(+6)`, `/makers(+slugs)`, `/makers/m/*`, `/sub/*/*` (8 incl. `cartier/panthere`, `space/flown`), blog posts, and 6 `/lot/<id>` incl. tilde ids (`wright-295955~`). Codec ref path verified live separately: `/ref/patek-philippe/2438~2f1` → 200.
- **No legacy URLs** in it (`/artists`, `/saved`, `/collectibles`, `/preview/terminal`, root maker slugs all absent). ✅
- **Family coverage gap: `/ref/*/*` — 0 of 613 emitted ref pages are in the sitemap** (live AND local). Root cause is a real bug — see PRE-GA-1.
- `/blog/corrections` emitted + canonicalized but missing from `staticRoutes` (PRE-GA-4).
- Intentionally absent: `/player`, `/profile` (noindex), `/lot|/sub|/ref` shells, `/collectibles`. Fine.

## 3. `_redirects` live behavior (all `curl -I`)

- `/artists → /makers` **301** ✅ · `/saved → /profile` **301** ✅ · `/collectibles → /` **301** ✅ · `/kaws → /makers/kaws` **301** ✅ · `/preview/terminal → /` **301** ✅
- **No chains**: every `curl -L` lands in exactly 1 hop (`hops=1`). `http://` → `https://` is a single direct 301 to the final scheme+path. ✅
- `/lot/wright-413240` (flagged) → 200 **static** with real title `Haïtienne — Henri Matisse` in HTML source ✅. `/lot/totally-made-up-123` → 200 shell (`Lot — lectr`) ✅ (see PRE-GA-6 for the indexing caveat).
- Trailing slashes: `/makers/`, `/value/`, `/makers/kaws/`, `/analytics/art/` → **308 → non-slash, single hop** (CF Pages default). ✅ Edge case: trailing slash on a *redirect-only* legacy path (`/kaws/`) → hard **404** (no chain, just dead) — negligible, noted POST-GA.

## 4. Crawlability

- **robots.txt: exists, 200**, `Allow: /`, `Disallow: /saved`, `Sitemap: https://lectr.bid/sitemap.xml` ✅. Cloudflare prepends its managed AI-crawler block (GPTBot/ClaudeBot/CCBot etc. + `ai-train=no`) — deliberate or not, Googlebot/Bingbot are unaffected. `/profile` is correctly NOT disallowed (its meta-noindex needs crawlability to be seen).
- **First-HTML link discovery is dead on the money pages**: `out/index.html` contains exactly one internal anchor (`/`); `art.html` only `/art`; `makers.html` **zero**. But `value.html`, `blog.html`, `about.html` server-render a full footer/nav (`/value /makers /analytics /blog/* /about` + all landers). So a no-JS crawler entering at `/` discovers nothing except via the sitemap; PageRank from the homepage flows nowhere. (PRE-GA-5.)
- **Structured data: none anywhere** (zero `application/ld+json` in `out/`). Opportunity — POST-GA-1.

## 5. 404 handling

`curl -I https://lectr.bid/nonsense-zzz` → **real HTTP 404** (no CF soft-404). ✅ Only soft-404 surface is the deliberate `/lot/*` shell rewrite (200 by design for client permalinks).

## Host-level finding

`https://www.lectr.bid/` → **200, serves the full site** (same title, robots.txt 200, sitemap 200). No www→apex redirect exists. See PRE-GA-2.

---

## Findings by severity

### [BLOCKER] — none
Canonicals resolve correctly and absolutely, no redirect loops/chains, 404 is a real 404, sampled sitemap is 100% live.

### [PRE-GA]
1. **Sitemap omits all 613 `/ref/*/*` pages — parsing bug in `app/sitemap.ts:24`.** `refs.json` is `{generatedAt, refs:[{key,…}]}`; `Object.keys(refs.refs ?? refs)` on an *array* yields `"0","1",…` which the `includes(':')` filter drops → `refPaths()` returns `[]` silently. Fix: `const keys = Array.isArray(refs?.refs) ? refs.refs.map(r => r.key) : Array.isArray(refs) ? refs.map(r => r.key) : Object.keys(refs.refs ?? refs);`. One-line, ship before GA — it's the largest indexable family on the site and currently discoverable by nothing (no HTML links either).
2. **`www.lectr.bid` is a live 200 duplicate of the whole site.** Most pages (/, landers, `/makers`, `/makers/[slug]`, `/about`, blog posts) declare no canonical, so www duplicates are uncontrolled; only `/value/[m]`, `/analytics/[m]`, `/makers/m/[m]`, `/sub`, `/ref`, `/lot/[id]` self-heal via apex canonicals. Add a Cloudflare Redirect Rule (or Bulk Redirect): `www.lectr.bid/* → https://lectr.bid/$1` 301. Five-minute dashboard change.
3. **`/makers/[slug]` (39 pages, the flagship dossiers) ship weak head metadata**: `<title>` is the bare label (`KAWS` — root template not applied to the layout-level title), description is the inherited roster boilerplate (39 identical), no canonical, `twitter:title` bare vs `og:title` branded. Fix in `app/makers/[slug]/layout.tsx` `generateMetadata`: add `description` per maker, `alternates: { canonical: '/makers/' + slug }`, and title via `{ absolute: label + ' — lectr' }`. OG images themselves are correct (all 39 `/og/<slug>.png` exist, absolute, 200 image/png).
4. **`/blog/corrections` missing from sitemap** `staticRoutes` (it is canonicalized and linked from `/blog`, so it will still be found — low).
5. **Homepage + landers + `/makers` expose no crawlable `<a>` links in first HTML** (see §4). The sitemap papers over discovery but not internal-link equity. Cheapest fix: render the same static footer `value.html`/`blog.html` already have on `/`, landers, and `/makers`. Acceptable to ship as-is if time is short — then promote to first post-GA task.
6. **`/lot/*` catch-all serves 200 shell with no canonical and no noindex** — as flagged sets rotate daily, yesterday's sitemap lot URLs decay into indexable generic duplicates (`Lot — lectr`). Add `robots: { index: false }` to `app/lot/layout.tsx` with `robots: { index: true }` (or a canonical) re-asserted in `lot/[id]/generateMetadata` for the static set.

### [POST-GA]
1. **Structured data**: `Product`/`Offer` (or `Article`) JSON-LD on `/lot/[id]`, `Dataset` on `/analytics` + `/ref` dossiers, `Article` on blog posts, `BreadcrumbList` on `/sub` + `/ref`. None exists today.
2. 404 page title is the site default — give `app/not-found.tsx` its own `title: 'Not found'`.
3. Orphaned `out/collectibles.html` builds every night while `_redirects` 301s the path — delete `app/collectibles/page.tsx` or drop the redirect (redirect currently wins; harmless but dead weight).
4. Trailing-slash variants of legacy redirect paths (`/kaws/`) 404 instead of redirecting — only matters if such links exist in the wild.
5. `/player` has generic metadata and query-param identity — if player dossiers should rank, they need the same static-path treatment `/ref` got.
6. Decide on the Cloudflare managed AI-crawler block in robots.txt (currently denies GPTBot/ClaudeBot/CCBot/etc. and declares `ai-train=no`) — fine for GA, but it's a policy choice worth making consciously.

## Worst 5 (ranked)
1. **[PRE-GA-1]** sitemap.ts:24 silently drops all 613 `/ref` pages — one-line fix, biggest index-coverage win available before GA.
2. **[PRE-GA-2]** www.lectr.bid full duplicate host, no redirect, most pages canonical-less.
3. **[PRE-GA-3]** 39 maker dossiers with duplicate descriptions / bare titles / no canonicals.
4. **[PRE-GA-5]** `/`, landers, `/makers` are internal-link dead in first HTML (sitemap-only discovery).
5. **[PRE-GA-6]** `/lot/*` 200-shell soft-404 decay as flagged lots rotate out nightly.

Counts: **0 BLOCKER · 6 PRE-GA · 6 POST-GA.** Everything verified live returned expected behavior: 30/30 sitemap sample 200, all five legacy 301s correct and single-hop, real 404 status, og assets `image/png`, profile noindexed, no title doubling, no legacy URLs in sitemap.
