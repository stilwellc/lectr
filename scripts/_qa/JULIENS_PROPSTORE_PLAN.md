# Julien's + Propstore — Wayback backfill plan (recon, Sep 3 2026)

Verified today by direct GETs (real Chrome UA) and Wayback CDX queries. Every
number below is measured, not estimated from memory. Where a path is a dead
end it says so plainly.

---

## 0. TL;DR

| | Julien's | Propstore |
| --- | --- | --- |
| live site today | `juliensauctions.com` → **403, Cloudflare "Just a moment"** | `propstoreauction.com` → **202, empty body (AWS WAF)** |
| old bid host | `julienslive.com` → 301 → `bid.juliensauctions.com`, which **does not resolve (NXDOMAIN)** | n/a |
| un-walled sold source | **Wayback captures of `julienslive.com/lot-details/…`** | Wayback captures of `propstoreauction.com/lot-details/…` |
| captured lot pages (CDX, status 200, deduped by catalog+lot) | **14,038** across 243 catalogs | **6,899** across 80 catalogs |
| measured sold-rate on the LATEST capture per lot | **16/21 = 76%** | **3/22 = 14%** |
| **estimated sold rows recoverable** | **≈ 10,000–11,000** | **≈ 1,000–2,900** (see §1b) |
| money | USD only (all 16 sampled sold rows `$`; pre-2012 pages print no symbol → default USD) | **MIXED $ and £** per sale — must read per lot, `fxRateFor`/`toUsdDated` |

**The headline:** the two houses share one Struts platform and therefore ONE
parser, but their Wayback value is wildly asymmetric. Julien's is worth
building. Propstore's Wayback path yields a fraction of its 6,899 captured
pages because the crawler that fed the Archive captured many Propstore
catalogues **before** their sales closed and never re-captured them (§1b).

**Two clear negatives, so nobody re-walks them:**

1. **`propstore.com` Sold Archive is NOT a price source.** The marketing host
   is not WAF'd (`https://propstore.com/products/archive/?sortType=5` → 200,
   plain curl) and advertises **68,753 results** with sale name, sale date
   ("Sold Dec 11 2023"), lot number, title, estimate and a full description.
   But the realized figure is replaced by **"Login to see sold price"**.
   Metadata-rich, price-blind — useless as a comp source without an account.
2. **`propstore.com/product/*` (48,587 Wayback captures, 2004–2026) is the
   BUY-NOW retail shop**, not auction results — the archived pages print a
   fixed ask ("£495 … Add to cart"). Excluded under lectr's auctions-only
   doctrine.

---

## 1. Evidence

### CDX queries run

```
http://web.archive.org/cdx/search/cdx?url=<enc>&output=json&limit=200000
  &fl=timestamp,original,statuscode,mimetype&collapse=urlkey&filter=statuscode:200
```

| url pattern | rows returned | unique (catalog,lot) | catalog id range | capture years |
| --- | --- | --- | --- | --- |
| `julienslive.com/lot-details*` | 24,660 | **14,038** | 3 – 518 (243 distinct) | 2021 (4,831) · 2022 (9,659) · 2023 (4,156) · 2024 (6,013) |
| `propstoreauction.com/lot-details*` | 15,183 | **6,899** | 4 – 540 (80 distinct) | 2022 (6,908) · 2023 (2,512) · 2024 (3,131) · 2025 (2,115) · 2026 (516) |
| `juliensauctions.com/lot*` | **0** | — | — | the modern host has no captured lot pages |
| `propstore.com/product/*` | 48,587 | — | — | 2004–2026 — buy-now retail, see negative #2 |

Capture *years* are when the Archive crawled, not when the sale happened: the
oldest sale reached in the sample is **Julien's catalog #1, 06/24/2010**, so the
lot-details set spans Julien's entire auction history.

Densest catalogs — Julien's `394` (404 lots captured), `163` (267), `72` (245),
`34` (240), `370` (225); Propstore `318` (1,238), `319` (771), `347` (363),
`138` (273), `342` (268).

### Snapshot parse test

57 snapshots fetched at a random (catalog,lot); then 43 more at the **latest**
capture per lot — the strategy a real backfill would use. Outcomes on the
latest-capture set:

```
Julien's   : SOLD 16 | still-open 5                                  (n=21)
Propstore  : SOLD  3 | unsold "N/A" 4 | closed-no-figure 1 | still-open 14  (n=22)
```

### 1b. Propstore yield, measured again on the real manifest

The random-capture sample (14%) and four contiguous manifest slices run through
the finished walker disagree, because **capture completeness is clustered by
catalog** — the Archive either crawled a whole catalog after it closed or it
did not:

```
manifest rows 3000–3023 (24)  → sold 14 | still-open 6 | unsold 4
manifest rows  500– 519 (20)  → sold  0 | unsold 20      (catalog 22, a 2015 sale
                                                          the platform now serves
                                                          as "Winning bid: N/A")
manifest rows 5200–5219 (20)  → sold 20
manifest rows 6400–6419 (20)  → sold  1 | still-open 19
                        total → 35/84 = 42% on contiguous slices
```

Contiguous slices are not independent draws, so the honest read is a **range,
not a point**: the unbiased random-latest estimator says ~950 rows, the slice
aggregate says up to ~2,900. Budget **1,000–2,900**, and note that the walk is
cheap enough (6,899 pages) to simply run and find out.

"still-open" = the Archive's only capture of that lot predates the sale close,
so the page says *"lots are sold sequentially via live auctioneer"* and carries
no result. That single fact is the whole Propstore yield story.

Real parsed rows (latest-capture set):

```
Julien's  #3268 11/30/2020  lot 41   $6,400   2 bids  est $150–$300     OLIVIA NEWTON-JOHN GREASE GLEN HANSON SIGNED…
Julien's  #3281 10/24/2020  lot 28   $1,250  11 bids  est $100–$200     ROBERT EVANS OCTAGONAL COLUMN
Julien's  #160  11/17/2016  lot 16   $2,240   6 bids  est $300–$500     MARILYN MONROE NUDE STOCKINGS AND PARKSIDE…
Julien's  #1    06/24/2010  lot 32     437.50 9 bids  est 300–500       EDDIE VEDDER HANDWRITTEN LYRICS      ← no currency symbol pre-2012
Julien's  #3292 02/13/2021  lot 311    $375   3 bids  est $200–$300     RUSSIAN FSB SPY COMPUTER MEMORY CARD
Propstore #397  08/15/2024  lot 673  $5,040   5 bids  est $3,000–$6,000 673. Buck Rogers' (Gil Gerard) Screen-Ma…
Propstore #386  03/12/2024  lot 13  $10,080   4 bids  est $8,000–$16,000 Lot #13 - Clarence Doolittle's (Frank Si…
Propstore #405  02/05/2024  lot 26     $375   8 bids  est —             Lot # 26: The Umbrella Academy (2019-20…
Propstore #394  02/08/2024  lot 27    £156.25 2 bids  est £100–£200     Lot #27 - ARNOLD SCHWARZENEGGER - VARIOUS…   ← GBP
Propstore #138  09/20/2018  lot 259  N/A (unsold)     est £800–£1,200   JAMES BOND: YOU ONLY LIVE TWICE (1967)…
```

---

## 2. The parser (ONE parser, both houses)

Both hosts run the same Struts/Java auction app, so a single module handles
them. All three reads below are **subject-anchored by construction**: a
lot-details page renders exactly one `div.message-closed` and one
`div.tle-lot` — verified `message-closed` count == 1 on every sampled page.
There is no related-lot rail carrying a second price, so the NFL/Memory-Lane
price-bleed shape cannot occur here; the batch poison detector still runs.

### 2a. Price + bid count — `div.message-closed`

```html
<div class="message-closed">
  Lot closed - Winning bid:<span class="exratetip" rev="cur:1" rel="cur:5,2,4,3,6">$27,500</span>
  <a class="biddingHistoryLink" data-id="88819" href="…/bidding-history/id/319/lot/88819">(9 bids)</a>
  <span class="estimate">Estimate:</span>
  <span class="estimate-val">$<span class="exratetip" …>20,000</span> - $<span class="exratetip" …>30,000</span></span>
</div>
```

Julien's prints the same block with the label **`Lot Closed - Sold Price:`**
(sometimes wrapped in `<span id="lac28">`). So:

```ts
const CLOSED_BLOCK = /class="message-closed">([\s\S]{0,1200}?)(?:<\/div>\s*<\/div>|<div class="clear">)/;
// then, on the TAG-STRIPPED block text:
const RESULT = /(?:Winning bid|Sold Price)\s*:\s*([£$€])?\s*([\d,]+(?:\.\d+)?|N\/A)/;
const BIDS   = /\((\d+)\s*bids?\)/;
const EST    = /Estimate:\s*([£$€])\s*([\d,]+)\s*-\s*([£$€])?\s*([\d,]+)/;
```

* `N/A` → **unsold**, drop (do not mint a row).
* no `message-closed` at all → the capture predates the close → **drop** (this
  is the 14/22 Propstore case; never guess a price from a live "current bid").
* `Lot closed - unsold` → drop.

**Currency** — the symbol in front of the figure is the native currency
(`rev="cur:N"` on the `exratetip` span is the platform's currency id and
corroborates it: `cur:1`/`cur:12` = USD, `cur:2` = GBP). Fall back in order:
figure symbol → `estimate-val` symbol → house default (Julien's `USD`;
Propstore has **no safe default — drop the row** rather than guess, since its
sales alternate LA/USD and London/GBP).

### 2b. Header — sale name, sale no, sale date, lot number, title

Two markup generations, both under `div.tle-lot`:

```html
<!-- gen 1 -->
<div class="tle-lot"><h3> Hannibal Auction <span class="sale-no">(#23)</span>
  <span class="sale-date">06/18/2015 9:00 AM PDT - 06/25/2015 1:10 PM PDT</span>
  <span class="sale-closed"> CLOSED!</span></h3></div>
<h3> Lot #69<span class="lot-name">HANNIBAL - "Entrée" Bloody Slotted Angle Bar</span></h3>

<!-- gen 2 (Julien's, ~2023+) -->
<div class="tle-lot"><section id="customheader" …><div class="tle"><h3>
  <span class="sale-name">HOLLYWOOD: CLASSIC &amp; CONTEMPORARY</span>
  <span class="sale-no">(#3359)</span>
  <span class="start-end-dates"> 04/22/2023 10:00 AM PDT </span>
  <span class="auction-closed"> Closed </span></h3></div></section></div>
<h3> Lot #992<span class="lot-name">MEN IN BLACK: TOMMY LEE JONES "AGENT KAY" SUIT</span></h3>
```

so: `saleName` = `span.sale-name` else the text before `span.sale-no`;
`saleNo` = `span.sale-no`; date = `span.sale-date` **or**
`span.start-end-dates`, taking the **END** of a `A - B` range and the single
date otherwise (`MM/DD/YYYY` → `YYYY-MM-DD`); `lotNumber` from `Lot #(\w+)`;
`title` from `span.lot-name` (fall back to `<title>`, which mirrors it).
A header that matches neither generation → drop the row (11/21 of my first
probe's Julien's pages hit gen 2 before I added it; the alternation is not
optional).

### 2c. Description / provenance

The long body copy sits after the header in the lot detail column; take the
tag-stripped text between the header block and `Tell a friend`, cap 1,200 chars.

---

## 3. Id scheme, house wiring, money

Both houses are already registered end to end — nothing in `app/` needs a
patch:

* `app/types.ts` `AuctionHouse` already has `"Julien's"` and `'Propstore'`.
* `app/lib/validate.ts` `HOUSE_PREFIXES` already has `"Julien's": ['juliens']`
  and `Propstore: ['propstore']`.
* `scripts/corpus-io.ts` `HOUSE_TO_SEGMENT` already maps both to the `juliens`
  / `propstore` segments.

**Ids:** `juliens-<catalogId>-<lotId>` / `propstore-<catalogId>-<lotId>`. The
lot id alone is globally unique on this platform (the prev/next links walk
`lot/N±1` inside a catalog), but the pair is what the URL carries and what the
CDX manifest keys on — keep both so a row is re-derivable from its id.

**Money.** Julien's is USD → `stampRealizedUsd(amount, saleDate)` like the
other US houses. **Propstore is NOT** — it must use the currency-aware path
(`fxRateFor(cur, saleDate)` + `toUsdDated(amount, cur, saleDate)`, exactly how
the art houses stamp a GBP Christie's lot), because a £ sale stamped as USD is
the v2 money-bug class all over again. `stampRealizedUsd` is USD-only by
construction — do not reach for it here.

**Basis.** The platform's figure is the **hammer/winning bid**, not the all-in:
`propstore.com/auctions.action` states *"a Buyer's Premium will be added to all
winning bids in each Live Auction"*, and the block's own label is "Winning
bid". So stamp `basis: 'hammer'` (`stampRealizedUsd`'s non-`realized` branch /
the equivalent for the FX path), and let `premiums.ts` supply the all-in
factor. **Neither house's premium rate was read off a page today** — do not add
a `premiums.ts` line for them until someone reads the actual schedule.

**Julien's trust gate** (standing, from the expansion doctrine): a Julien's
"signed" lot without an inline provenance/estate paragraph is an untrusted
standalone autograph — stamp `authConfidence:'low'` rather than dropping, in
line with how every other expansion house handles a failed auth gate.

---

## 4. Build shape

```
scripts/backfill-struts-wayback.ts --house juliens|propstore
    --manifest scripts/data/<house>-wayback-lots.csv   # catalogId,lotId,timestamp
    --skip N --cap M --conc 2 --delay 400 --write
```

1. **Manifest** (one-off, checked into `scripts/data/`): the CDX query above,
   reduced to the **latest** capture per `(catalog,lot)` — that single choice is
   what lifted the Julien's sold-rate from 23/28-at-a-random-capture to
   16/21-at-the-latest, and is the only way Propstore clears 14%.
2. **Fetch** `https://web.archive.org/web/<ts>id_/<original>` (the `id_` suffix
   returns the ORIGINAL bytes, no Archive toolbar injection — every sample above
   used it).
3. Parse per §2; drop unsold / still-open / header-miss; count each reason.
4. Union into the segment with `writeMergedSegment`, incremental flush every
   ~500 rows, poison detector **before every flush**, silent-zero guard (pages
   fetched but nothing parsed ⇒ exit non-zero, prior segment rides).
5. Workflow `backfill-<house>.yml` on the `backfill-rea.yml` pattern: strict
   `pull-segment` (no `|| echo`), job cap ~350 min, `--delay` input,
   `concurrency: { group: segments-<house>, cancel-in-progress: false }`, and
   add that group name to the list in `docs/data-pipeline.md`.

**Rate limits are the real constraint.** web.archive.org refused connections in
bursts throughout this recon (`curl: (7) Failed to connect … port 443`) at 3-way
concurrency, and its CDX endpoint served `503 Internal Archive: Temporarily
Offline` twice. Budget **conc ≤ 2, delay ≥ 400 ms, 3 retries with a 4–5 s
backoff**, and expect the Julien's walk to need several dispatches
(`--skip`/`--cap` slices, the `backfill-mlbauction` idwalk pattern) rather than
one job.

---

## 5. Recommendation

* **Build Julien's.** ~10K sold rows of music/Hollywood/pop provenance material,
  one currency, 76% yield, and the corpus has no comparable coverage.
* **Propstore is marginal on this path** — worth running because the parser is
  free (same module, one config) and the walk is only 6,899 pages, but set
  expectations at 1–3K rows, not the 6,899 captured pages.

**Status: BUILT.** `scripts/lib/struts-auction.ts` (parser + dated-FX hammer
stamp), `scripts/backfill-struts-wayback.ts` (manifest + walk, both houses),
`.github/workflows/backfill-struts-wayback.yml` (dispatch, house input,
`segments-<house>` concurrency). Verified end to end on Propstore: manifest
6,899 rows built from the live CDX, 84 pages walked, 35 sold rows parsed with
correct per-lot currency (GBP 156.25 → $199.84 at the 2024 dated rate) and
`priceBasis: 'hammer'`. Julien's rides the same script (`--house juliens`).
* **Do NOT build a Julien's live crawler here.** `juliensauctions.com` is a hard
  Cloudflare challenge and `bid.juliensauctions.com` (the 301 target) does not
  even resolve — a stealth-headless decision is required first, and it is not
  this session's to make.
* **Do NOT chase `propstore.com`.** Its 68,753-row Sold Archive is
  login-gated on price and its `/product/*` pages are buy-now retail.
