# Sports + pop-culture expansion — crawl recon & build status (Aug 2026)

Nine new houses, category-scoped, per-category auth-gated (game-used→photo-match,
wax→BBCE, cards→slab, autographs→PSA-DNA/JSA). Shared helpers in
`scripts/lib/sports-crawl.ts`. **Every crawler writes an ISOLATED segment** — none
is in `SEGMENT_NAMES`, the nightly matrix, or the assemble list until it clears
verification. Enable a house by adding its segment to those three places.

## WAVE 1 — curl-accessible, BUILT + TESTED (isolated)
| House | Script | Segment | Path | Status |
|---|---|---|---|---|
| REA | `crawl-rea.ts` | `rea` | `bid.collectrea.com/lots/{id}` (Laravel, `<dt>/<dd>`) | ✅ tested, 0 FATALs |
| Huggins & Scott | `crawl-hugginsscott.ts` | `hugginsscott` | `hugginsandscott.com/auction/{yr}/{mo}/{lot#}/{slug}` (`<li>`) — reuses `parseReaLot` | ✅ tested, full category spread |
| SCP | `crawl-scp.ts` | `scp` | `catalogs.scpauctions.com` Bidsquare, JSON-LD `Product` + `#tcb_` price | ✅ tested, 0 FATALs |

Run: `RAY_SKIP_MAIN=1 npx tsx scripts/crawl-<house>.ts [args] --write`

### Wave 1 debug items (tomorrow)
- grade regex drops the trailing number (`PSA NM 7`→`PSA NM`) — extend `GRADE_RE`.
- season→date is month-approximate (`2018 Spring`→`2018-04-15`); fine for indexing.
- id-enumeration needs a high-water-mark for incremental nightly runs (REA), and
  H&S/SCP need the current-vs-settled auction split wired (H&S `--oldest` proves it).
- REA "Sold For" basis: treat as realized (premium-incl); confirm BP handling.

## WAVE 2 — headless required (Playwright); build tomorrow with these specs

### CreateAuction trio — Lelands + Memory Lane + Love of the Game (ONE crawler)
- Engine: **CreateAuction.com** (ASP.NET WebForms + Telerik). Identical DOM across all three.
- Bot wall: **Cloudflare full JS challenge** — curl 403 everywhere; needs headless + cf-clearance.
- Hosts: `auction.lelands.com`, `bid.memorylaneinc.com`, `bid.loveofthegameauctions.com`
- Lot URL: `/bids/bidplace.aspx?itemid={N}` (numeric, enumerable)
- Selectors: price `h3#MainContent_currentBidBox` (class `alert-success` = SOLD, text "SOLD FOR $X");
  desc `div#lot-desc`; `Category:` labeled row; title/grade in `Lot # N:` heading; date `End:` line.
- Bulk shortcut: per-auction **Price Grid** view + `/Lots/Gallery?page=N&size=250` list realized prices inline.
- Enumerate auctions via the `ctl00$Auction` dropdown (all historical auction IDs in-page; WebForms postback → session-scoped).
- Images: `/images_items/item_{itemid}_{n}_{imgid}.jpg`
- robots: allow-all but `ai-train=no` content-signal; **ClaudeBot named-blocked → use neutral UA, reference-use only.**
- Archives: Lelands→Dec 2000; ML→~2011; LOTG→2013.

### Hake's — SimpleAuctionSite (auction.io family), separate crawler
- Engine: **SimpleAuctionSite** (ASP.NET). Bot wall: **Akamai Bot Manager** (`csidetm.com` sensor) — harder than CF; needs headless minting a valid `_abck` cookie.
- Host: `www.hakes.com`. Lot URL: **slug-based** `/{TITLE_SLUG}-LOT{id}.aspx`.
- Price: `Price Realized: $581` / `Final prices include buyers premium: $581`. Also `Estimate:`, `Number Bids:`.
- Category: **breadcrumb** `All > Featured Collections > Rex & Patti Stark Collection`; `Category/{Name}-{catid}.html`.
- Provenance: breadcrumb + description (featured-collection consignments are first-class).
- Enumerate: `/pastauctionlanding.aspx` (archive back to 2004) → `catalog.aspx?auctionid={id}` → `Category/All_Items-1.html?auctionid={id}` (inline `Final Price` — id alone won't build the slug URL, harvest hrefs). Date: `Bidding ended on M/D/YYYY`.

### Julien's + Propstore — Wayback backfill VERIFIED (no headless needed for the archive)
- Fetch: `http://web.archive.org/web/2id_/<liveUrl>` returns the full server-rendered lot (200).
- Enumerate: Wayback CDX — `http://web.archive.org/cdx/search/cdx?url=propstoreauction.com/lot-details*&output=json&filter=statuscode:200` (Julien's: `julienslive.com/lot-details*`). Both have deep coverage.
- Sold price selector (EXACT): within `<div class="message-closed"> Lot Closed - Sold Price:<span class="exratetip" …>US$1,920</span>` — take the exratetip text INSIDE message-closed, strip currency prefix. Propstore label is "Winning bid" and value is **£16,250 → GBP, needs fxRateFor/toUsdDated conversion** (NOT stampRealizedUsd — that's USD-only; use the currency-aware path or the index inherits a money bug). "Lot Closed - unsold" = skip.
- Julien's trust gate: require an inline `PROVENANCE` string in the description (estate-anchored). A "signed"/"autograph" title WITHOUT it = untrusted standalone autograph → drop.
- Propstore COA: literal "comes with a Propstore Certificate of Authenticity."
- Date: `Date: M/D/YYYY` on the lot. Category: from parent catalog/section (not per-lot).
- NOTE: Wayback = BACKFILL (historical). Live incremental still needs headless (Julien's CF-Turnstile severe; Propstore AWS-WAF moderate) OR a Wayback re-crawl (lags live by days).

### Julien's + Propstore — shared Struts/Java platform (ONE parser)
- Engine: shared white-label (`sam.serverData`, `m_lotDetails_index.js`, `.action`). Lot URL both:
  `/lot-details/index/catalog/{catalogId}/lot/{lotId}` (both ids numeric-enumerable).
- Julien's host `bid.juliensauctions.com` — **Cloudflare Turnstile, SEVERE** (curl connection-reset; needs stealth headless).
- Propstore host `propstoreauction.com` — **AWS WAF 202 challenge, MODERATE** (standard headless usually clears). `Crawl-delay: 120` — throttle hard.
- **BACKFILL WITHOUT HEADLESS: the Wayback Machine serves both houses' full server-rendered HTML with realized prices, un-walled** — viable for the ~20-yr archive; live sitemaps only cover current sales.
- Price: `div.message-closed span.exratetip` — label "Sold Price" (Julien's) vs "Winning bid" (Propstore).
- Estimate: `span.estimate-val`. Date: `Date: M/D/YYYY` on lot / parent catalog.
- **Julien's trust gate: require an inline `<p>PROVENANCE …</p>` paragraph** (estate-anchored = trusted); a "signed/autograph" title with NO provenance paragraph = the untrusted standalone-autograph lot to exclude. No structured autograph field.
- Propstore COA: literal "comes with a Propstore Certificate of Authenticity." in description.
- Category: not per-lot; derive from parent catalog/section.

## Nationality / doctrine flags carried forward
- **Classic Auctions** (best game-used photo-match jerseys, hockey) = Montreal → excluded under US-only.
- **Heritage** = excluded on access (DataDome + sued a scraper for $1.75M).
- Julien's standalone autographs untrusted (provenance-gate above). Propstore UK-HQ — Collin kept it in.
