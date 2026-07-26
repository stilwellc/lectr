<div align="center">

# lectr

**Auction-market intelligence for the collectibles market.**

Every estimate, read against every hammer.

[lectr.bid](https://lectr.bid)

</div>

---

lectr tracks the collectibles auction market — art, design, watches, sports, science, and pop culture — across seven auction houses. It calls whether a lot is trading below or above its true comparables, reads every upcoming lot against a price history it builds itself, precomputes a "below market / above market" signal, and replays those calls point-in-time to prove the record.

It also measures **price movement**, two ways: a confidence-gated hedonic index that surfaces only the makers whose returns clear a 95% confidence bar (the *verified movers*), and — for the estimate-less card market — a **repeat-sales index** that tracks the same physical card across its own resales. Both abstain everywhere the data can't defend a number. Where a market-level return isn't defensible, it drills to **sub-markets** — each shown at the strongest honest read its data supports.

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
- **Measures price movement** with a per-maker hedonic index (robust log-price regression, mix-controlled), confidence-gated so it publishes a return *only* when the 95% CI resolves the sign — the *verified movers*. Where estimates don't exist (the card market), a **Bailey-Muth-Nourse repeat-sales regression** takes over — same card, same grade, resold — under the same CI gate. Where neither can be defended, sub-markets fall to measured demand, else a descriptive read (typical price · record · volume) — never a fabricated appreciation.

The home page is a trading-floor terminal: the market switch, a **demand-led hero**, the **verified movers** (CI-bounded maker returns), the live feed of lots "on the block," the **sub-market board**, and the all-time record board. On desktop the hero is *the observatory*: an unboxed, full-width chart stage (the directional fill and glow are the composition), a right-hand **ledger rail** for the side metrics — Yearly ROI with the demand × ROI divergence flag, on-the-block, below-market, ⌘K — and the verified movers running beneath as a single hairline **ticker band**, all sized to land above the fold. Mobile keeps its own scene. Switching markets re-scopes every section.

## Architecture

lectr is a **pure static export** — there is no server.

```
 nightly.yml (GitHub Actions, 13:00 UTC)              push to main (deploy.yml)
   crawl     per-house matrix (7 houses)                next build → out/
             → segment artifacts (+ R2 last-good)       → wrangler pages deploy
   assemble  reunion → hygiene passes → engine                │
             → R2 versions/<stamp>/ (write-once)              │
               behind latest/pointer.txt                      │
             → same-run artifact handoff to ↓                 ▼
   ├─ deploy   build → Cloudflare Pages ────────►  lectr.bid  (Cloudflare Pages)
   ├─ sync     Supabase + alerts (non-blocking)
   └─ backtest incremental Mon–Sat · full replay Sunday
```

- **Framework:** Next.js (App Router), `output: 'export'` → ~113 prerendered static pages.
- **Hosting:** Cloudflare Pages (free tier, unlimited bandwidth — the right fit for a multi-MB dataset). No compute is metered because there is none.
- **Data:** flat JSON files served from `/data/ray/`, fetched by the client in tiers; the full corpus lives in **R2** (bucket `lectr-data`), not git.
- **The R2 store is write-once.** Every push lands under a unique `versions/<UTC>-<sha>/` prefix; only a tiny `latest/pointer.txt` is overwritten (written *last*, so readers never see a half-stored version). Freshness is polled on the pointer alone, which killed the old ~14-min R2 GET-lag on the big payloads — measured, the deploy job went **28m → 2m** and sync **28m → 36s**. Downstream jobs take a same-run artifact handoff from assemble first and touch R2 only as a fallback. A nightly prune keeps the newest 14 versions.
- **Automation:** three GitHub Actions — `nightly.yml` (the segmented crawl → assemble → {deploy, sync, backtest} pipeline), `deploy.yml` (code pushes), and `ray-crawl.yml` (the old monolith, demoted to a manual fallback).

### Client data tiers

The client never downloads everything up front:

1. **Eager** (`upcoming.json` + `market.json`) — upcoming lots with precomputed signals + the tape, plus the market payload: per-market demand, the **price-movement indices** (hedonic + repeat-sales), the per-maker verified indices, and the sub-markets. Paints instantly.
2. **Full history** (`lots-*.json` shards — the corpus outgrew Cloudflare's 25 MiB/file cap; `lots-index.json` names the shard count, fetched in parallel) — streams behind the paint for comps and results.
3. **Sold archive** (`sold-archive-*.json` shards) — the Goldin realized-price history, **lazy-loaded** only when a sports/science deep view needs it (comps modal, maker page, analytics). A cold home load fetches zero archive bytes.

## The markets

`Market = 'all' | 'art' | 'design' | 'watches' | 'sports' | 'science' | 'culture'` — all live.

| Market | Sources | Notes |
|---|---|---|
| **Art** | Phillips, Sotheby's, Christie's | paintings, editions, photography, sculpture |
| **Design** | Wright, Rago, Phillips | furniture & objects; model-keyed comps (an LC2 never comps a Chandigarh) |
| **Watches** | Bonhams, Phillips, Sotheby's, Christie's | reference-keyed (a Daytona never comps a Datejust) |
| **Sports** | Goldin, Sotheby's, Christie's | cards, game-worn, trophies, tickets |
| **Science** | Sotheby's, Christie's, Goldin | tech, fossils, space, instruments — **never video games** |
| **Pop Culture** | Goldin, Christie's, Sotheby's | screen-worn, stage-played, and the unrepeatable 1/1s |

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
- **Layer B — "that exact item":** `objectFingerprint` (a coarse **blocking key** built from title + structured attributes — never an image hash, since different houses photograph the same object differently), `editionOf`/`editionTotal`/`editionMarker`, `serialNo`, for sports `entity`/`objectType`/`eventKey`/`sportYear`/`photoMatched`, and for cards the parsed `_card` fingerprint (player + year + set + card number + grade + serial) that keys the repeat-sales index.

The same-vs-similar decision is a **scored percentage**, not an equality test — wording never matches exactly.

### 3. Every row is validated before it is published

A write-time gate ([`app/lib/validate.ts`](app/lib/validate.ts)) asserts invariants and **aborts the crawl rather than publish a bad row**: a sold lot must have a positive `realizedUsd` + a `priceBasis` + a real, non-future date; a non-sold lot must have null price fields; every `*Usd` must equal `native × fxRate`; ids and dates must be well-formed.

Legacy fields (`priceUsd`, `estimateLow/High`, `currency`) are retained as **USD-valued aliases**, so the UI (which renders everything in USD) stays correct while the engine reads the canonical fields.

## The data pipeline

```
scripts/ray-crawl.ts        crawl 7 houses → merge → classify → normalize (v2) → validate
      │                     └─ precompute signals (build-upcoming) + backtest (build-backtest*)
      ▼
scripts/corpus-io.ts        write the split:
      ├── data/corpus/*.json.gz      full v2 corpus (~76 fields/lot, gzipped) — pushed to R2, gitignored
      └── public/data/ray/*.json     slim projection (display fields, nulls omitted) — served to clients
```

- **`ray-crawl.ts`** — the crawler. Per-house parsers, item-level routing, the Goldin faceted `lots_v2` API (live + `show_only:Sold` results archive), currency conversion, identity stamping, and the validation gate. **Incremental by default Mon–Sat**: Christie's and Sotheby's skip sales whose every prior lot is terminal, non-pending, and >14 days past (the shared `lib/skip-set.ts` predicate — skip rates run ~99%, skipped lots are carried forward), with a **Sunday-UTC full sweep** as the weekly correctness backstop; `INCREMENTAL_CRAWL=1/0` forces either mode. Each house logs a `[health]` line (expected vs. fetched vs. parse errors) with tripwires on upcoming-count collapses; every parser validates required fields at parse time (a lot missing id/title/url is counted and dropped, never silently shipped); transient fetches retry via `lib/fetch-retry.ts`, and estimates parse through the range-aware `lib/estimate-range.ts`.
- **`corpus-io.ts`** — the corpus/served split. The full corpus is the source of truth (gzipped, persisted to R2); the served files are a null-omitted display projection, sharded under Cloudflare's 25 MB/file limit.
- **`data-store.sh`** — the R2 store: write-once `versions/<stamp>/` payloads behind `latest/pointer.txt`, legacy-path migration, and the keep-14 `prune`.
- **`lib/corpus-normalize.ts`** — deterministic, **idempotent corpus-hygiene passes** run in both assemble and build-market before anything is built or persisted: clamp impossible years, reroute/evict science misroutes (the 501 leaked art/watch lots → 0, using the detectors from `audit-data-quality.ts`), fill missing watch references via `lib/identity-enrich.ts` (coverage 63.5% → 71.5%), and reconcile `saleDate` down to `saleDateTime`'s day — killing the crawl-day fallback dates that made long-sold lots look live on the block.
- **`migrate-v2.ts`** — the one-time backfill that brought the existing corpus to v2 (`--dry-run` prints a diff report; `--commit` rewrites). Idempotent.
- **`build-upcoming.ts`** — the eager payload: upcoming lots + precomputed signals + the tape + per-market demand.
- **`build-backtest.ts`** / **`build-backtest-incremental.ts`** — the point-in-time replay of flagged vs. unflagged calls, split for speed: both are thin entries over the shared **`backtest-core.ts`** engine. The nightly (Mon–Sat) incremental rehydrates a gzipped sidecar accumulator state, scores *only* lots that closed since the last run, and republishes — **~17s where the full replay ran ~54min**, validated byte-identical against a full rebuild. Sunday runs the full replay as the correctness backstop (a late-ingested prior enters an already-scored target's pool only on a full pass; drift is bounded to one week).
- **`assemble.ts`** — reunions the per-segment crawl output into the full corpus, runs the hygiene passes and the sanity gate (refuses to publish a shrunken or empty book), then drives the market build.
- **`build-market.ts`** — per-market series (demand, sell-through, house calibration, seasonality) plus the **hedonic price-movement index**, the per-maker verified indices, market composites, and the sub-markets → `market.json`. Hot-path tuned — corpus pre-bucketed by maker, `parseCard` memoized, dates pre-parsed once, and repeat-sale candidate pairs pruned by a cheap structural pre-check (the similarity phase alone went 165s → 22s) — with the outputs verified semantically identical to the naive build.
- **`hedonic-index.ts`** — the confidence-gated hedonic engine: robust IRLS log-price regression, per-maker indices, and bottom-up composites, publishing only what the 95% CI resolves.
- **`repeat-sales.ts`** — the Bailey-Muth-Nourse repeat-sales engine (see [the value engine](#the-value-engine)).
- **`sub-markets.ts`** — the per-vertical sub-market reads (verified index — hedonic or repeat-sales — / demand / descriptive).
- **`audit-data-quality.ts`** — the read-only auditor: misroute detectors, field-completeness scorecard, integrity checks.
- **`build-og.tsx`** — pre-renders the share cards (the root card + one per maker) as static PNGs.

## The value engine

[`app/lib/comps.ts`](app/lib/comps.ts) is the single source of truth for comparability:

- A **26-form taxonomy** with hard gates on form + size + model — an item never comps across incompatible forms.
- **Model / reference keys** so a specific furniture series or watch reference only comps its own kind.
- **Same-edition fast path** and an **IQR dispersion guard** against noisy pools.
- **4-tier confidence** (very-high = the exact work sold 3+ times, down to low).

The comps result feeds the card signal, the comparables modal, and the crawl-time precompute — one number, one meaning, everywhere.

Demand ([`app/lib/demand.ts`](app/lib/demand.ts)) is a mix-proof *typical-sale-vs-estimate* index for markets with published estimates, and a *like-for-like realized-price cohort* for the estimate-less Goldin verticals — never a raw price average, which would be pure mix-noise.

### Price movement — the hedonic index

Demand answers "are lots beating their estimates?" — a *relative* read that houses can game by cutting estimates. So price movement is measured separately. [`scripts/hedonic-index.ts`](scripts/hedonic-index.ts) fits a **per-maker log-price hedonic regression** (robust Huber IRLS) that holds the mix constant — reference/model, form, size, object-decade, house — so a quarter's coefficient is *price movement*, not composition. Each horizon (1Y / 3Y / 5Y) publishes a return **only when its 95% CI resolves the sign**; otherwise it abstains. Market composites are built bottom-up from the publishable component makers, with honest gates (component coverage, degeneracy, and an outright refusal of collectible *buckets* that aren't makers). The output is the **verified movers** — the makers that clear the bar, each with its interval (e.g. Rolex `+25% 5Y [12, 39]`).

The lander pairs the two: the hero shows **demand**, the ledger rail shows **yearly ROI**, and it flags the divergence — lots beating a softening bar.

### Price movement — the repeat-sales index

The card vertical is the largest in the corpus and carries **no estimates** (Goldin publishes none), so neither demand nor the hedonic can run there. But the same physical card resold twice *is* its own control — no mix bias, no hedonic dummies. [`scripts/repeat-sales.ts`](scripts/repeat-sales.ts) implements the **Bailey-Muth-Nourse repeat-sales regression** (the Case-Shiller method): consecutive-sale pairs of the same object regress log-price relatives onto the period design, with the standard 3-stage GLS gap-weighting to de-bias long holding intervals, and the same honesty gates as the hedonic — a horizon publishes only past minimum pair and distinct-object counts *and* a sign-resolving 95% CI.

Objects are linked by a caller-supplied key, never guessed. For cards it's the composite `_card` fingerprint — **player + year + set + card number + grade + serial** — with grades parsed by [`scripts/lib/card-identity.ts`](scripts/lib/card-identity.ts) (a structured grader on ~87% of cards, a numeric grade on ~75%; grading-cert numbers are absent from the source data, so the fingerprint stands in). Live in production: **sports-cards publishes 3Y +87% [79, 95]** on 14,482 linked objects / 18,156 pairs — the estimate-less card market went from a descriptive read to a real, CI'd index.

**Sub-markets** ([`scripts/sub-markets.ts`](scripts/sub-markets.ts)) view every vertical as a hierarchy. A bucket like *meteorites* or *game-used* is a sub-market, not a maker — so it carries no hedonic index — but each sub-market shows the strongest honest read its data supports: a verified CI'd move (hedonic where a real maker clears the bar, **repeat-sales** where the card fingerprint links resales), else measured demand where it carries estimates, else a descriptive read (typical price · all-time record · volume). Each indexed row carries an `indexMethod` (`'hedonic' | 'repeat-sale'`) surfaced in the UI, so the two are never conflated. Nothing prints an appreciation the engine won't defend.

## Repository layout

```
app/
  page.tsx                 renders the Terminal home
  preview/terminal/        the Terminal implementation — IndexHero, SubMarketBoard,
                           MoversBoard, VerifiedMovers, RecordBoard, MarketChart, VerticalGhost
  [artist]/                per-maker market pages
  {art,design,watches,     market landers (static, re-scope the terminal)
   sports,science,culture,
   collectibles}/
  value/                   the calls + the backtest record
  artists/  analytics/     the roster · the rankings
  saved/                   watchlist
  components/              LotCard, ComparableModal, MarketSwitch, …
  hooks/useRayData.ts      the tiered client data loader
  lib/
    comps.ts               the comparability engine
    demand.ts              the demand / realized-cohort series
    normalize.ts           pure v2 normalization (FX, dims, year, identity)
    validate.ts            the write-time invariant gate
  types.ts                 the canonical AuctionLot (v2)
scripts/
  ray-crawl.ts             the crawler (incremental Mon–Sat, full sweep Sunday)
  corpus-io.ts             corpus/served split
  data-store.sh            R2 store — write-once versions/ + pointer + prune
  migrate-v2.ts            one-time v2 backfill
  assemble.ts              reunion + hygiene passes + sanity gate + market build
  build-market.ts          per-market series + indices + sub-markets
  hedonic-index.ts         confidence-gated hedonic price-movement engine
  repeat-sales.ts          Bailey-Muth-Nourse repeat-sales engine (cards)
  sub-markets.ts           per-vertical sub-market reads
  build-upcoming.ts        eager payload (signals, tape, demand)
  backtest-core.ts         shared point-in-time replay engine
  build-backtest.ts        full replay (Sunday) — thin entry over the core
  build-backtest-incremental.ts  nightly append over sidecar state (Mon–Sat)
  audit-data-quality.ts    misroute detectors + completeness scorecard
  build-og.tsx             static share cards
  lib/
    corpus-normalize.ts    idempotent corpus-hygiene passes
    card-identity.ts       card grader/grade parser (the _card fingerprint)
    identity-enrich.ts     objectFingerprint + watch reference extractor
    skip-set.ts            incremental-crawl "fully resolved sale" predicate
    fetch-retry.ts         transient-failure retry (5xx/network/timeout only)
    estimate-range.ts      range-aware estimate parsing
data/corpus/               full v2 corpus (gzipped) — persisted to R2, gitignored
public/data/ray/           slim served JSON (lots + sold-archive sharded)
public/brand/              the lectr script mark + icons
.github/workflows/
  nightly.yml              segmented crawl → assemble → {deploy, sync, backtest}
  deploy.yml               code push → build → Cloudflare Pages
  ray-crawl.yml            the old monolith — manual fallback only
```

> Historical note: internal names (`ray-*` CSS classes, `scripts/ray-crawl.ts`, `public/data/ray/`, `useRayData`) predate the rename to lectr and are kept for stability. Only the user-facing brand is lectr.

## Running locally

```bash
npm install
npm run dev            # http://localhost:3000

# rebuild the derived data from the corpus
npx tsx scripts/build-upcoming.ts
npx tsx scripts/build-backtest.ts              # full replay
npx tsx scripts/build-backtest-incremental.ts  # nightly append (needs prior state)

# run a crawl (writes corpus + served + rebuilds derived)
npm run crawl                     # incremental Mon–Sat, full sweep Sunday
INCREMENTAL_CRAWL=0 npm run crawl # force the full sweep
RAY_DEEP=1 npm run crawl          # deep backfill (full Goldin sold history, etc.)
RAY_ONLY=game-used npm run crawl  # scope to specific slugs

# preview the static export
npm run build && npx serve out
```

**Requirements:** Node 22+. The crawler and build scripts run under `tsx`.

## Deployment

Fully automated — a code push or the nightly pipeline ships the site:

- **`nightly.yml`** — the data path (13:00 UTC daily): the per-house crawl matrix → assemble (hygiene passes + sanity gate + engine) → push corpus + served payloads to R2 (write-once `versions/` + pointer, then prune to 14) → three parallel downstream jobs riding the **same-run artifact handoff** (R2 only as a fallback): **deploy** (build → Cloudflare Pages), **sync** (Supabase + alerts, non-blocking), and **backtest** (incremental Mon–Sat, full replay Sunday).
- **`deploy.yml`** — on every push to `main`: pull the served payload → `npm run build` (share cards + static export) → `wrangler pages deploy out` → Cloudflare Pages (`collectr` project, served at `lectr.bid`).
- **`ray-crawl.yml`** — the pre-segmentation monolith, kept as a manual (`workflow_dispatch`) fallback only.

Both paths need repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (the same token drives the `lectr-data` R2 bucket); sync additionally uses `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`. There is no server to provision.

## Doctrine & invariants

Non-negotiable rules enforced across the crawler and UI:

- **Auctions only.** Buy-it-now / fixed-price / retail listings are never crawled. An asking price is not market data.
- **Item-level routing.** Nothing is classified at the auction level; every routing decision is per lot.
- **Sports spans cards + objects.** Cards, game-worn, trophies, tickets. Estimate-less Goldin cards are indexed by **repeat sales** — the object is its own control — and fall back to a *descriptive* read (typical price · record · volume) where the CI can't resolve. Never a fabricated appreciation.
- **Science excludes video games.** Apple/computing + fossils/space/instruments only.
- **Data honesty.** The numeral is the line is the sentence. Red means down/loss only; green means up. Realized and hammer prices are facts. A mix-noise average is never presented as demand.
- **Never a return the data can't defend.** The hedonic index publishes a price-movement number *only* when its 95% CI resolves the sign; otherwise it abstains and says so. No maker- or market-level appreciation is asserted without a confidence interval behind it.
- **Native is the fact, USD is derived, dated.** No price-vs-estimate comparison ever crosses currency units.

## Roadmap

**Shipped — price-movement tracking.** The confidence-gated hedonic index (per-maker + composites), the verified movers, and the vertical → sub-market decomposition are live. Coverage is deliberately narrow — only makers that clear the 95% CI publish — so the next lever is *depth*, not a looser bar: semi-annual cohort pooling to lift thin makers over the n≥80/quarter gate, and form-banding to unlock the print-dominated art names (Warhol, Picasso).

**Shipped — the repeat-sales index.** The Bailey-Muth-Nourse engine is live on the card vertical (sports-cards: 3Y +87% [79, 95]), keyed on the composite `_card` fingerprint, surfaced in sub-markets with an honest `indexMethod` tag. The pipeline is likewise done: write-once R2 versioning, same-run artifact handoff, the incremental crawl/backtest cadence (fast Mon–Sat, full-truth Sunday), and the corpus-hygiene passes.

**Next — the deep similarity engine, and repeat-sales beyond cards.** The v2 foundation exists to support a scored `similarity(a, b)` over `titleTokens` + maker + model + year + dimensions + edition + sports tags, yielding "≳90% = the same item / 60–90% = very similar" from one number. The `objectFingerprint` blocking key already buckets ~7,300 candidate repeat-sale groups across the non-card verticals — the scored matcher is what turns those candidates into linked resales the repeat-sales engine can index. The features are clean, comparable, and persisted, so building it is weighting and threshold-tuning rather than re-deriving identity from raw strings.
