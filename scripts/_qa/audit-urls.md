# URL / Route Architecture Audit — lectr.bid

Audited 2026-08-02 against `app/` at HEAD. Constraints in force: `output: 'export'`
(next.config.js — no server, `trailingSlash` **unset** → default `false`, pages emit as
`out/<route>.html`, e.g. `out/art.html`, `out/lot.html`, `out/lot/<id>.html`), deployed on
Cloudflare Pages serving `out/` with `public/_redirects` + `public/_headers`.

Verified Cloudflare Pages `_redirects` semantics (developers.cloudflare.com/pages/configuration/redirects/):

- **Redirects take precedence over static assets** — "Redirects are always followed,
  regardless of whether or not an asset matches the incoming request." (Opposite of
  Netlify. A naive `/lot/*` rewrite WOULD clobber the static flagged lot pages.)
- **Only the first matching rule applies** (no cascading) — this is also the escape
  hatch: a per-file "pin" rule listed above a catch-all wins.
- **200 proxy rewrites supported** (`/blog/* /news/:splat 200` serves destination
  content at the original URL).
- **Query strings CANNOT be matched** ("Query Parameters ❌") — `/lot?id=X` can never
  be 301'd to `/lot/X` in `_redirects`. Query→path migration must be client-side.
- Budget: 2,000 static + 100 dynamic (splat/placeholder) rules.

Current deploy: **334 files** in `out/` (78 html). Cloudflare cap is 20,000 files —
enormous headroom for enumerated static params.

---

## 1. Inventory

Corpus facts used below: 39 makers (`ARTISTS` in app/constants.ts), 95 drill slugs in
`market.json` `drills` (29 watches, 29 sports, 17 culture, 8 design, 7 science, 5 art —
all `group:part` form, e.g. `rolex:daytona`, `cards-era:classic`), 613 refs
(`refs.json`), 1,185 players (`players.json`), ~14 flagged lots this build (≤500 cap in
`app/lot/flagged.ts`), 500K+ total lots (not enumerable).

| Route | File | State carried by | Shareable? (pasted URL reproduces view) | Back/forward | sitemap.ts | Metadata / OG |
|---|---|---|---|---|---|---|
| `/` | app/page.tsx → preview/terminal/TerminalHome | Path (market='all' display) + localStorage `ray-market` for the *stored* choice | Yes for the all-market view | OK — market switch is `history.pushState`, Next 14.1 syncs router on popstate (app/lib/market.tsx) | ✅ | Root layout + static `/opengraph-image` (content-type forced in `_headers`) |
| `/art` `/design` `/watches` `/science` `/sports` `/culture` | Each is a 9-line **re-export of `../page`** with its own `metadata` (e.g. app/art/page.tsx) | **Path IS the market** — `PATH_MARKET` in app/lib/market.tsx; landing also writes localStorage | ✅ Yes — these are the good citizens | OK (pushState/popstate synced) | ✅ | ✅ per-market title/desc/OG |
| `/collectibles` | app/collectibles/page.tsx — another re-export, mapped to market `'all'` | Path | Yes, but it is a **duplicate of `/`** with different metadata | OK | ❌ **not in sitemap** | Own metadata (duplicate content vs `/`) |
| `/artists` (nav says **"Makers"**) | app/artists/page.tsx | **localStorage** (`useMarket()` off-lander → stored value) | ❌ Pasted `/artists` shows the *reader's* last market, not the sharer's | ❌ Market switch writes no history entry — Back exits the page instead of undoing the switch | ✅ | Generic layout metadata, site OG |
| `/[artist]` — makers at ROOT, e.g. `/kaws`, `/fossils`, `/entertainment-memorabilia` | app/[artist]/{layout,page}.tsx; `dynamicParams=false`, `generateStaticParams` over 39 `ARTISTS` slugs | Path (and the page *sets* the stored market via `setMarket(marketOf(slug))`) | ✅ | OK | ✅ (all 39) | ✅ real: per-maker title + prebuilt `/og/<slug>.png` |
| `/analytics` | app/analytics/page.tsx | **localStorage** market | ❌ same failure as `/artists` | ❌ same | ✅ | Generic layout metadata |
| `/value` | app/value/page.tsx | **localStorage** market (filters the calls by market, line 42) | ❌ same | ❌ same | ✅ | Generic layout metadata |
| `/lot?id=<lotId>` — universal | app/lot/page.tsx (`useSearchParams` in Suspense) | **Query param** | ✅ works, but ugly, and `canonical: './'` (root layout) collapses **every lot to canonical `/lot`** | OK (soft navs, `key={id}` remount) | ❌ (unlistable) | ❌ generic "Lot" layout metadata; **no per-lot OG** |
| `/lot/[id]` — flagged static set | app/lot/[id]/page.tsx, `generateStaticParams` over `flaggedLots()` (Below-Market, ≤500) | Path | ✅ | OK | ✅ | ✅ real per-lot title/desc/lot-photo OG + explicit canonical |
| `/sub?id=<drill>` e.g. `/sub?id=rolex:daytona` | app/sub/page.tsx → SubPage | **Query param**, slug contains `:` (URL-encodes to `%3A` when shared) | ✅ resolves, but canonical collapses to `/sub` | OK | ❌ | ❌ generic "Sub-market" metadata, no per-dossier OG |
| `/ref?id=rolex:6263` | app/ref/page.tsx | **Query param**, `:` slug | Same as /sub | OK | ❌ | ❌ generic "Reference" |
| `/player?id=michael-jordan` | app/player/page.tsx | **Query param** | Same | OK | ❌ | ❌ generic "Player" |
| `/saved` (nav says **"My profile"**) | app/saved/page.tsx (1,055 lines; tab state is component state, not URL) | localStorage/account | Private page — fine | Tabs not in URL (acceptable) | ❌ (correct — `robots: noindex`) | noindex ✅ |
| `/blog`, `/blog/<slug>` ×6 | app/blog/* | Path | ✅ | OK | ✅ | ✅ |
| `/about` | app/about/page.tsx | Path | ✅ | OK | ✅ | ✅ |
| `/preview/terminal` | legacy | — | 301 → `/` via `_redirects` (only rule in the file) | — | — | — |

Static-export disambiguation of the root catch-all: safe **today** because
`dynamicParams=false` + explicit `generateStaticParams` — the build emits exactly
`kaws.html`… for the 39 slugs, and literal routes (`art/page.tsx` etc.) win at build
level. There is no runtime ambiguity, only a **namespace** hazard (below).

## 2. Inconsistencies, ranked by user pain

1. **Query-param dossiers with collapsed canonicals.** `/sub?id=`, `/ref?id=`,
   `/player?id=`, universal `/lot?id=` are the *product* (95 sub-markets, 613 refs,
   1,185 players) yet: root layout's `alternates: { canonical: './' }` makes every one
   of them canonicalize to the bare shell (`/sub`, `/ref`…) — Google sees four pages,
   not 1,900; none are in the sitemap; all share one generic title/OG so every share
   card is identical; `:` in slugs encodes to `%3A` in shared links. The flagged-lot
   static pages prove the fix works — nothing else got it.
2. **Market invisible in URL on `/analytics`, `/artists`, `/value`.** Pasting
   `/analytics` while reading watches sends the recipient to *their* stored market (or
   'all'). Back doesn't undo a market switch on these pages (no history entry). The
   landers solved this (path IS market); the three analysis surfaces regressed to
   localStorage.
3. **Makers at root.** `/kaws` collides conceptually with `/art`, `/about`, `/value` —
   `/fossils` and `/entertainment-memorabilia` are *makers* while `/collectibles` is a
   *market* and `/artists` is an *index*. One future maker slug equal to a reserved
   word breaks the build (or silently shadows). Also unbrandable: a bare root slug
   gives crawlers and humans zero context.
4. **Nav label ≠ path.** "Makers" → `/artists` (and the page's own copy says the
   roster is "not all artists"); "My profile" → `/saved`.
5. **Dual lot scheme.** Same entity, two URL shapes: `/lot?id=X` (universal, no
   metadata) and `/lot/X` (flagged only, full metadata). A flagged lot can circulate
   under both forms; the query form of a flagged lot loses its OG card.
6. **`/collectibles` duplicate.** Re-export of `/` mapped to market `'all'`, own
   metadata, not in sitemap, nothing links to it (zero hrefs found) — pure duplicate
   content.
7. **Sitemap/canonical drift.** sitemap.ts lists 40 URLs; the actual addressable
   surface is ~1,900+. `canonical: './'` also self-canonicalizes the 8 lander aliases
   of the same TerminalHome component (defensible since metadata differs, but worth a
   decision, not an accident).

## 3. Target scheme

Principles: path = identity, query = nothing durable, one URL per entity, market is a
path segment wherever it changes what you're reading, every enumerable set becomes
`generateStaticParams` (all fit the 20K cap: 334 files today + ~3,800 worst case).

| Today | Target | Mechanism |
|---|---|---|
| `/` | `/` (all-market lander) — keep | — |
| `/art` `/design` `/watches` `/science` `/sports` `/culture` | keep as-is (already correct) | — |
| `/collectibles` | **kill** → 301 `/` | `_redirects` |
| `/kaws` … (39 root maker pages) | **`/makers/kaws`** | move `app/[artist]` → `app/makers/[maker]`; 39 static 301s |
| `/artists` | **`/makers`** (label already "Makers") | move dir; 301 `/artists → /makers` |
| `/artists`, `/analytics`, `/value` (market via localStorage) | **`/makers/m/<market>`, `/analytics/<market>`, `/value/<market>`** — base path = 'all' | `[market]` segment, `generateStaticParams` over 6 verticals (7×3 ≈ 18 extra pages). `/makers/m/<market>` avoids colliding with `/makers/<slug>`; alternatively reserve the 6 market keys against maker slugs and use `/makers/<market>` |
| `/sub?id=rolex:daytona` | **`/sub/rolex/daytona`** — path-safe form: `group:part` → `group/part` (deterministic both ways; `:` never appears in group or part) | `app/sub/[group]/[part]` + `generateStaticParams` reading `market.json` drills at build (95 pages), per-dossier metadata; shell `/sub?id=` kept one release as client-side redirect |
| `/ref?id=rolex:6263` | **`/ref/rolex/6263`** | same pattern, 613 pages from refs.json |
| `/player?id=michael-jordan` | **`/player/michael-jordan`** | `app/player/[slug]`, 1,185 pages from players.json (phase 2 if build time hurts — it's the least-shared surface) |
| `/lot/<id>` (flagged) | keep — already canonical | — |
| `/lot?id=<id>` (universal) | **`/lot/<id>` universal** via `_redirects` 200 rewrite to the shell; `/lot?id=` becomes a client-side redirect | see mechanics — the pin trick is required |
| `/saved` ("My profile") | **`/profile`** | 301 `/saved → /profile` (noindex, zero SEO risk) |
| `/blog/*`, `/about`, `/preview/terminal` 301 | keep | — |

Canonical/OG: each new static dossier page sets explicit `alternates.canonical` +
title/description (drill/ref/player names are all in the JSON at build time); OG images
optional phase 2 via the existing `scripts/build-og.tsx` pipeline. sitemap.ts adds
`/makers`, 39 `/makers/<slug>`, 95 subs, 613 refs (players when built), market variants
of analytics/value/makers.

## 4. Migration mechanics (output:'export' + CF Pages)

**A. `_redirects`** (all static rules; budget 2,000 static / 100 dynamic — we use ~560/2):

```
# legacy → canonical (301s; inbound links + OG cards keep working)
/collectibles        /                301
/artists             /makers          301
/saved               /profile         301
/preview/terminal    /                301
# 39 root maker slugs, generated at build from ARTISTS:
/kaws                /makers/kaws     301
…                                     (×39)

# universal lot permalinks — ORDER MATTERS (first match wins, redirects
# shadow assets on CF Pages):
# 1) pin every flagged static page to itself (200 self-proxy serves the
#    asset; ≤500 rules, generated from flaggedLots() at build)
/lot/bonhams-brk_1008730-99F544FD154A  /lot/bonhams-brk_1008730-99F544FD154A  200
…
# 2) then the catch-all rewrite to the SPA shell (1 dynamic rule)
/lot/*               /lot             200
```

`public/_redirects` must become build-generated (a small script merging the static
header above with the flagged-set pins — same `flaggedLots()` source sitemap.ts already
uses). **Verify the self-proxy pin on a preview deploy before shipping** — docs say
"only the first redirect applies" (no cascade/loop), but this exact self-referential
200 isn't documented.

**B. Query→path legacy handling.** `_redirects` cannot see query strings (verified).
Keep `app/lot/page.tsx`, `app/sub/page.tsx`, `app/ref/page.tsx`, `app/player/page.tsx`
as thin client redirectors for one release: read `?id=`, `router.replace()` to the path
form. Old shares keep resolving; new canonical propagates.

**C. `generateStaticParams` additions.**
- `app/sub/[group]/[part]` — read `public/data/ray/market.json` with `node:fs` at
  build (the `flagged.ts` server-only pattern already establishes this), emit 95.
- `app/ref/[maker]/[refKey]` — 613 from refs.json.
- `app/player/[slug]` — 1,185 from players.json (optional phase).
- `app/analytics/[market]`, `app/value/[market]`, `app/makers/m/[market]` — 6 each,
  re-exporting the base page; the page reads `useParams().market` and feeds
  `setMarket` on mount (same pattern `app/[artist]/page.tsx` already uses).
  MarketSwitch on these pages switches via the lander-style pushState (extend
  `MARKET_PATH` handling in app/lib/market.tsx to a per-basepath map) so back/forward
  undoes the switch — same mounted-board, URL-moves-underneath doctrine.
- New page counts: ~95+613+18(+1,185) html+txt pairs ⇒ out/ stays ≤ ~4,200 files, far
  under the 20K cap.

**D. Universal `/lot/<id>` shell.** The shell hydrates `lot.html` under a foreign URL;
`useSearchParams` is replaced by reading `window.location.pathname` (the app-router's
`usePathname` will report `/lot` from the embedded payload — read `location` directly).
In-app `<Link href="/lot/<id>">` to a non-flagged id will miss the client route table
and fall back to a full-document navigation (Next MPA fallback) → hits the rewrite →
shell. That is the one real UX cost of this migration (full reload instead of soft nav
on non-flagged lot clicks; the page already force-remounts via `key={id}` and
`useRayData` has a `fromCache` fast path, so the perceived cost is a reload flash). If
that's unacceptable, the fallback position is: keep `?id=` as the in-app *transport*
and `history.replaceState` to `/lot/<id>` on mount — one canonical, soft navs kept.

**E. Link sweep scope** (from the href inventory): `href={\`/${lot.artist}\`}` ×6 and
`/${m.slug}`, `/${s.maker}`, `/${entry.maker}`, `/${artist.slug}`, `/${row.slug}` ×2 →
`/makers/…` (9 call sites); `/lot?id=` ×10 call sites; `/sub?id=` ×5; `/ref?id=` ×1;
`/player?id=` ×1; `/artists` ×3 + ArtistNav/CommandK path tables; `/saved` ×2.
Also: `MARKET_PATH`/`PATH_MARKET` in app/lib/market.tsx, CommandK item paths,
sitemap.ts, app/[artist] OG references (`/og/<slug>.png` filenames unchanged).

**F. Scroll/back.** Path-segment market pages get real history entries → Back undoes a
market switch everywhere, matching the landers. Next scroll restoration handles the
rest; the pushState-under-mounted-board switch keeps its no-remount behavior.

## 5. What NOT to change (blast radius)

- **`/art` `/design` `/watches` `/science` `/sports` `/culture` and `/`** — already
  the correct pattern; every inbound market link and OG card stays byte-identical.
- **`/lot/<id>` flagged static form** — it is already the canonical shape; the
  universal scheme converges *on it*, never moves it.
- **`/blog/*`, `/about`** — correct, indexed, linked externally. Untouched.
- **`/og/<slug>.png`, `/opengraph-image`** and the `_headers` content-type/cache rules
  — share cards in the wild keep resolving.
- **`/data/ray/*` shard paths** — the `_headers` immutable-cache globs and
  `useRayData` `?v=` busting depend on these exact names.
- **localStorage `ray-market` key** — still the cross-visit memory; URL becomes truth
  *on* a page, storage remains the default *between* visits. Don't rename the key.
- **Hash anchors** (`/#on-the-block`, `#upcoming`, `/analytics#artist-rankings`) —
  carried along automatically, no rewrites needed.
- Sequencing: ship C+E (new static pages + link sweep) and A (redirects) in ONE
  deploy — a deploy with new links but no rewrite 404s every non-flagged lot path.
  Keep B (query shells) for at least one crawl cycle before deleting.
