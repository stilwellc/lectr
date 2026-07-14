<div align="center">

# lectr

**Auction-market intelligence for the collectibles market.**

Every estimate, read against every hammer.

[lectr.bid](https://lectr.bid)

</div>

---

lectr tracks the collectibles auction market — art, design, watches, sports, and science — across seven auction houses, and calls whether a lot is trading below or above its true comparables. It reads every upcoming lot against a price history it builds itself, precomputes a "below market / above market" signal, and replays those calls point-in-time to prove the record.

It is a read-only intelligence terminal: **auctions only, never fixed-price listings** — an asking price is not market data.

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [The markets](#the-markets)
- [The data model (v2)](#the-data-model-v2)
- [The data pipeline](#the-data-pipeline)
- [The value engine](#the-value-engine)
- [Repository layout](#repository-layout)
- [Running locally](#running-locally)
- [Deployment](#deployment)
- [Doctrine & invariants](#doctrine--invariants)
- [Roadmap](#roadmap)

---

## What it does

- **Aggregates** live and historical auction results from Phillips, Sotheby's, Christie's, Bonhams, Wright, Rago, and Goldin.
- **Comps** every lot against same-maker / same-form / size-banded sales, with a 4-tier confidence rating.
- **Signals** each upcoming lot as *Below Market* or *Above Market* vs. its comparables, precomputed at crawl time.
- **Backtests** those calls point-in-time: what would you have known that day, and how did the lot actually hammer?
- **Tracks demand** per market as a typical-sale-vs-estimate index (and, for the estimate-less Goldin verticals, a like-for-like realized-price cohort).

The home page is a trading-floor terminal: a market switch, the demand board with today's highest-conviction call in the fold, the live feed of lots "on the block," and the record.

## Architecture

lectr is a **pure static export** — there is no server.

```
 daily crawl (GitHub Actions)          push to main (GitHub Actions)
   scripts/ray-crawl.ts                  next build → out/
   → data/corpus  (full v2, gz)          → wrangler pages deploy
   → public/data/ray (slim, served)      → Cloudflare Pages
   → commit                                    │
        └───────── triggers deploy ────────────┘
                                                ▼
                                    lectr.bid  (Cloudflare Pages)
```

- **Framework:** Next.js (App Router), `output: 'export'` → 50 prerendered static pages.
- **Hosting:** Cloudflare Pages (free tier, unlimited bandwidth — the right fit for a multi-MB dataset). No compute is metered because there is none.
- **Data:** flat JSON files served from `/data/ray/`, fetched by the client in tiers.
- **Automation:** two GitHub Actions — one crawls daily and commits fresh data, one deploys on every push.

### Client data tiers

The client never downloads everything up front:

1. **Eager** (`upcoming.json`, ~750 KB) — upcoming lots with precomputed signals + the tape. Paints instantly.
2. **Full history** (`lots.json`, ~21 MB) — streams behind the paint for comps and results.
3. **Sold archive** (`sold-archive.json`, ~10 MB) — the Goldin realized-price history, **lazy-loaded** only when a sports/science deep view needs it (comps modal, maker page, analytics). A cold home load fetches zero archive bytes.

## The markets

`Market = 'all' | 'art' | 'design' | 'watches' | 'sports' | 'science'` — all live.

| Market | Sources | Notes |
|---|---|---|
| **Art** | Phillips, Sotheby's, Christie's | paintings, editions, photography, sculpture |
| **Design** | Wright, Rago, Phillips | furniture & objects; model-keyed comps (an LC2 never comps a Chandigarh) |
| **Watches** | Bonhams, Phillips, Sotheby's, Christie's | reference-keyed (a Daytona never comps a Datejust) |
| **Sports** | Goldin, Sotheby's, Christie's | game-worn, trophies, tickets — **never cards** |
| **Science** | Sotheby's, Christie's, Goldin | tech, fossils, space, instruments — **never video games** |

Markets split **by maker/entity**, not by source. Switching markets re-scopes every section of the site.

## The data model (v2)

The heart of lectr is a canonical `AuctionLot` (see [`app/types.ts`](app/types.ts)). It was rebuilt from the ground up to be a trustworthy foundation for value comparison. Three principles:

### 1. Native currency is the fact; USD is a derived view

Prices arrive in seven currencies. Storing a USD price against a native-currency estimate silently corrupts every price-vs-estimate comparison. Instead:

- `nativeCurrency`, `hammerNative`, `premiumNative`, `realizedNative` — the transaction, as it happened.
- `fxRate` / `fxAsOf` — a **dated** rate from a static, checked-in per-year table (`FX_BY_YEAR` in [`app/lib/normalize.ts`](app/lib/normalize.ts)). A 2015 London sale converts at 2015's rate, so cross-year series are honest.
- `realizedUsd`, `estLowUsd`, `estHighUsd` — the derived USD view all downstream math reads.
- `priceBasis` — `realized` (hammer + buyer's premium) · `hammer-only` · `final-bid-plus-bp` (Goldin) · `last-tracked-bid`. Required on every sold lot.

### 2. Identity is persisted, in two tiers

For the value engine to answer *"has this exact item sold before?"* and *"what similar items sold?"*, identity is decomposed and stored (not re-derived at runtime):

- **Layer A — "very similar":** `modelKey` (Eames 670, a watch reference), `normalizedTitle`, `titleTokens`, parsed `{heightCm, widthCm, depthCm, sizeClass}`, `yearNum` (+ `yearSource`), `mediumCanon`, `materialTokens`.
- **Layer B — "that exact item":** `objectFingerprint` (a coarse **blocking key** built from title + structured attributes — never an image hash, since different houses photograph the same object differently), `editionOf`/`editionTotal`/`editionMarker`, `serialNo`, and for sports `entity`/`objectType`/`eventKey`/`sportYear`/`photoMatched`.

The same-vs-similar decision is a **scored percentage**, not an equality test — wording never matches exactly.

### 3. Every row is validated before it is published

A write-time gate ([`app/lib/validate.ts`](app/lib/validate.ts)) asserts invariants and **aborts the crawl rather than publish a bad row**: a sold lot must have a positive `realizedUsd` + a `priceBasis` + a real, non-future date; a non-sold lot must have null price fields; every `*Usd` must equal `native × fxRate`; ids and dates must be well-formed.

Legacy fields (`priceUsd`, `estimateLow/High`, `currency`) are retained as **USD-valued aliases**, so the UI (which renders everything in USD) stays correct while the engine reads the canonical fields.

## The data pipeline

```
scripts/ray-crawl.ts        crawl 7 houses → merge → classify → normalize (v2) → validate
      │                     └─ precompute signals (build-upcoming) + backtest (build-backtest)
      ▼
scripts/corpus-io.ts        write the split:
      ├── data/corpus/*.json.gz      full v2 corpus (~76 fields/lot, gzipped for git) — build + engine
      └── public/data/ray/*.json     slim projection (display fields, nulls omitted) — served to clients
```

- **`ray-crawl.ts`** — the crawler. Per-house parsers, item-level routing, the Goldin faceted `lots_v2` API (live + `show_only:Sold` results archive), currency conversion, identity stamping, and the validation gate.
- **`corpus-io.ts`** — the corpus/served split. The full corpus is the source of truth (gzipped, git-tracked); the served files are a null-omitted display projection kept under Cloudflare's 25 MB/file limit.
- **`migrate-v2.ts`** — the one-time backfill that brought the existing corpus to v2 (`--dry-run` prints a diff report; `--commit` rewrites). Idempotent.
- **`build-upcoming.ts`** — the eager payload: upcoming lots + precomputed signals + the tape + per-market demand.
- **`build-backtest.ts`** — the point-in-time replay of flagged vs. unflagged calls.
- **`build-og.tsx`** — pre-renders the share cards (the root card + one per maker) as static PNGs.

## The value engine

[`app/lib/comps.ts`](app/lib/comps.ts) is the single source of truth for comparability:

- A **26-form taxonomy** with hard gates on form + size + model — an item never comps across incompatible forms.
- **Model / reference keys** so a specific furniture series or watch reference only comps its own kind.
- **Same-edition fast path** and an **IQR dispersion guard** against noisy pools.
- **4-tier confidence** (very-high = the exact work sold 3+ times, down to low).

The comps result feeds the card signal, the comparables modal, and the crawl-time precompute — one number, one meaning, everywhere.

Demand ([`app/lib/demand.ts`](app/lib/demand.ts)) is a mix-proof *typical-sale-vs-estimate* index for markets with published estimates, and a *like-for-like realized-price cohort* for the estimate-less Goldin verticals — never a raw price average, which would be pure mix-noise.

## Repository layout

```
app/
  page.tsx                 the terminal (home)
  [artist]/                per-maker market pages
  {art,design,watches,     market landers (static, re-scope the terminal)
   sports,science,
   collectibles}/
  value/                   the calls + the backtest record
  artists/  analytics/     the roster · the rankings
  saved/                   watchlist
  components/              Terminal, LotCard, ComparableModal, BoardDemand, …
  lib/
    comps.ts               the comparability engine
    demand.ts              the demand / realized-cohort series
    normalize.ts           pure v2 normalization (FX, dims, year, identity)
    validate.ts            the write-time invariant gate
  types.ts                 the canonical AuctionLot (v2)
scripts/
  ray-crawl.ts             the crawler
  corpus-io.ts             corpus/served split
  migrate-v2.ts            one-time v2 backfill
  build-upcoming.ts        eager payload
  build-backtest.ts        point-in-time replay
  build-og.tsx             static share cards
data/corpus/               full v2 corpus (gzipped) — the engine's source of truth
public/data/ray/           slim served JSON
public/brand/              the lectr script mark + icons
.github/workflows/
  ray-crawl.yml            daily crawl → commit
  deploy.yml               push → build → Cloudflare Pages
```

> Historical note: internal names (`ray-*` CSS classes, `scripts/ray-crawl.ts`, `public/data/ray/`, `useRayData`) predate the rename to lectr and are kept for stability. Only the user-facing brand is lectr.

## Running locally

```bash
npm install
npm run dev            # http://localhost:3000

# rebuild the derived data from the corpus
npx tsx scripts/build-upcoming.ts
npx tsx scripts/build-backtest.ts

# run a crawl (writes corpus + served + rebuilds derived)
npm run crawl                     # incremental
RAY_DEEP=1 npm run crawl          # deep backfill (full Goldin sold history, etc.)
RAY_ONLY=game-used npm run crawl  # scope to specific slugs

# preview the static export
npm run build && npx serve out
```

**Requirements:** Node 22+. The crawler and build scripts run under `tsx`.

## Deployment

Fully automated — a code push or a data commit ships the site:

- **`deploy.yml`** — on every push to `main`: `npm run build` (share cards + static export) → `wrangler pages deploy out` → Cloudflare Pages (`collectr` project, served at `lectr.bid`).
- **`ray-crawl.yml`** — daily: crawl → commit fresh data → which triggers `deploy.yml`.

Both need repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. There is no server to provision.

## Doctrine & invariants

Non-negotiable rules enforced across the crawler and UI:

- **Auctions only.** Buy-it-now / fixed-price / retail listings are never crawled. An asking price is not market data.
- **Item-level routing.** Nothing is classified at the auction level; every routing decision is per lot.
- **Sports = objects, never cards.** Game-worn, trophies, tickets — Topps/Panini/PSA slabs/TCG never pass the gates.
- **Science excludes video games.** Apple/computing + fossils/space/instruments only.
- **Data honesty.** The numeral is the line is the sentence. Red means down/loss only; green means up. Realized and hammer prices are facts. A mix-noise average is never presented as demand.
- **Native is the fact, USD is derived, dated.** No price-vs-estimate comparison ever crosses currency units.

## Roadmap

**Part 2 — the deep similarity & value engine.** The v2 foundation exists to support it: a scored `similarity(a, b)` over `titleTokens` + maker + model + year + dimensions + edition + sports tags, yielding "≳90% = the same item / 60–90% = very similar" from one number — plus a repeat-sale index (same physical object linked across dates and houses) and market-wide value tracking. The features are clean, comparable, and persisted, so building the engine is weighting and threshold-tuning rather than re-deriving identity from raw strings.
