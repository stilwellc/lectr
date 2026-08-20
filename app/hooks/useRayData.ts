'use client';

import { useState, useEffect, useMemo } from 'react';
import { AuctionLot, MarketStats, RealizedPoint, BidCompetitionPoint } from '../types';

// Stable empty-array identity for pre-load fallbacks — a fresh `[]` each render
// would defeat downstream memoization (e.g. useSoldArchive's allLotsWithArchive).
const EMPTY_LOTS: AuctionLot[] = [];

export interface TapeItem { artist: string; title: string; price: string; house: string }
export type TapeByMarket = Record<string, TapeItem[]>;
export interface DemandPoint { date: string; value: number; n: number }
export type DemandByMarket = Record<string, DemandPoint[]>;
export type RealizedByMarket = Record<string, RealizedPoint[]>;
/** bid-competition (median bids/lot, quarterly) per market — sports/cards only.
    A DEMAND primitive from Goldin's bidCount; a bare count, distinct from both
    demand (%) and realized ($) so it never renders as a price or a percent. */
export type BidCompByMarket = Record<string, BidCompetitionPoint[]>;
export type RecentSoldByMarket = Record<string, unknown[]>;
export type DeepValueRow = { id: string; depth: number; allIn: number; floor: number; closes: string };
export type DeepValueByMarket = Record<string, DeepValueRow[]>;
export interface Backtest {
  flagged: BacktestBucket;
  unflagged: BacktestBucket;
  above: BacktestBucket;
  series: { year: number; flaggedMedianPct: number | null; unflaggedMedianPct: number | null; nFlagged: number }[];
  /** per-tier flagged records (main strict gate vs tier-b fallback) */
  flaggedTiers?: { main: BacktestBucket; fallback: BacktestBucket };
  /** auto-calibration emitted from the replay (beatRate steps + conformal bands) */
  calibration?: {
    edges: number[];
    beatRate: Record<string, number[]>;
    band: Record<string, { lo: number; hi: number }>;
    n?: number;
  };
}
export interface BacktestBucket {
  n: number;
  medianPerfPct: number;   // all-in (premium-inclusive) realized vs estimate-mid
  beatHighPct: number;     // sold-only, all-in basis
  /** hammer basis — estimates are hammer-basis, so this is the honest beat */
  hammerMedianPct?: number;
  hammerBeatPct?: number;
  /** bought-in outcomes */
  nBoughtIn?: number;
  failToSellPct?: number;
  beatHighHonestPct?: number;
}

interface RayData {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
  tape: TapeByMarket;
  demand: DemandByMarket;
  /** realized-cohort ($) series per market — sports only; distinct from demand
      (a %-over-estimate index). Eager, from upcoming.json. */
  realized: RealizedByMarket;
  /** bid-competition (bids/lot) series per market — sports/cards only; a demand
      primitive from Goldin's bidCount, distinct from demand (%) and realized
      ($). Eager, from upcoming.json. */
  bidComp: BidCompByMarket;
  /** lightweight last-N Goldin closes per sports/science market so the home
      Recent-results row paints without the 10MB archive. Eager. */
  recentSold: RecentSoldByMarket;
  deepValue: DeepValueByMarket;
  backtest: Backtest | null;
  market: MarketData | null;
  lastCrawl: string;
  sources: string[];
  /** honest full-corpus counts from meta.json (incl. the Goldin sold-archive
      the slim lots.json omits). page reads these before falling back to length. */
  totalLots?: number;
  totalSold?: number;
  loading: boolean;
  /** the full sold history has arrived (comps, analytics, artist pages) */
  fullLoaded: boolean;
  /** phase 2 (lots.json) failed after retries — fullLoaded-gated pages should
      show an error + retry, never an eternal skeleton */
  fullError: boolean;
  error: string | null;
  /** true when the module cache was already warm at mount —
      revisits render instantly, no arrival choreography. */
  fromCache: boolean;
}

export interface MarketData {
  generatedAt: string;
  markets: Record<string, MarketSeriesJson>;
  makers: Record<string, MarketSeriesJson>;
  /** per house×market estimate honesty (hammer-led medians, n≥40 cells) */
  houseCal?: Record<string, Record<string, { n: number; hammerMedPct: number; allInMedPct: number }>>;
  /** the empirical card grade ladder (within-card paired log-ratios, base
      grade 8 = 1.00) — fitted mult per rung + pair support + the old
      constant it replaced. Holdout-validated; drives the tier-2 card valuer. */
  gradeLadder?: { base: number; rungs: { grade: number; mult: number; fitted: boolean; pairs: number; old: number }[]; pairs?: number; groups?: number };
  /** per market calendar-month performance; cells with n<30 carry zeros and are UI-gated */
  seasonality?: Record<string, { n: number; hammerMedPct: number; allInMedPct: number; sellThroughPct: number | null }[]>;
  calibration: { directional: { method: string; buckets: [string, number][] }; valueError: Record<string, number> };
  /** per-maker hedonic index — the statistically-defensible price-movement read.
      A horizon publishes ONLY when its CI resolves the sign (else abstains). */
  makerIndex?: Record<string, MakerIndexResult>;
  /** VERTICAL repeat-sale — the read ladder's TOP rung (Collin's priority,
      Aug 2026: repeat-sale > hedonic > demand > typical price). Same engine and
      CI gates as the card drills, generalized: watches = same reference resold
      (20k+ pairs), art = same edition resold (prints & multiples), sports =
      same card+grade resold. `scope` is part of the read — a cards figure must
      never wear the whole sports vertical unlabeled. */
  repeatSale?: Record<string, VerticalRepeatSaleJson>;
  /** per-VERTICAL hedonic index — the same CI gate as makerIndex, one level
      up: each horizon carries changePct + 95% bounds + `publishable`, and an
      unpublishable horizon ships its abstention `reason` verbatim ("CI spans
      zero (-12.4%…18.4%) — direction unresolved"). Shipped by build-market
      since Jul 2026 but consumed nowhere until the hero tape (Aug 2026). */
  hedonic?: Record<string, HedonicEntry>;
  /** sub-market tracking: per vertical, each tracked slug with the STRONGEST
      honest read its data supports — a verified CI'd index where it's a real
      maker, else measured demand, else descriptive (typical/record/volume).
      Keyed by vertical market key ('science' → its sub-markets). */
  subMarkets?: Record<string, SubMarketRead[]>;
  /** sub-category drill rows (Jul 31 2026): per vertical, the approved A-vs-B
      splits — sports kind x sport, watch maker x model family, culture subject
      domains + kinds, space programs + flown, art/design kinds. Same read
      ladder + honesty gates as subMarkets; `parent` names the grouping. */
  drills?: Record<string, (SubMarketRead & { parent: string })[]>;
}
export interface VerticalRepeatSaleJson {
  method: 'repeat-sale';
  basis: string;
  scope: string | null;
  nPairs: number;
  nObjects: number;
  horizons: Record<string, {
    publishable: boolean; changePct: number | null;
    ciLoPct: number | null; ciHiPct: number | null; reason?: string;
  }>;
  series: { period: string; value: number; n: number }[];
}

export interface HedonicEntry {
  series?: { period: string; value: number; ciLo?: number; ciHi?: number; n?: number }[];
  horizons: Partial<Record<'1Y' | '3Y' | '5Y' | 'MAX', HedonicHorizon>>;
}

export interface SubMarketRead {
  slug: string;
  label: string;
  vertical: string;                 // the parent vertical market key
  readType: 'index' | 'demand' | 'descriptive';
  /** readType 'index': the verified move (longest resolving horizon) */
  index: { horizon: string; changePct: number; ciLoPct: number; ciHiPct: number } | null;
  /** how an index read was produced: 'hedonic' (makers w/ estimates) or
   *  'repeat-sale' (Bailey-Muth-Nourse, mix-immune, for card markets) */
  indexMethod?: 'hedonic' | 'repeat-sale' | null;
  /** readType 'demand': measured %-over-estimate */
  demandNow: number | null;
  demandSeries: { period: string; value: number; n: number }[];
  /** when an index was ATTEMPTED and abstained: the closest horizon's reason —
      the row's "distance to certify" (e.g. Daytona: "2026-Q2 thin (30 pairs
      < 40)"). Absent when no index path applies or one published. */
  indexAttempt?: string;
  /** bid-competition secondary read (cards): latest-quarter median bids/lot —
      a demand primitive from Goldin's bidCount, rides beside the headline read
      (never a price move / %-over-estimate). null where no bidCount is shipped. */
  bidCompNow?: number | null;
  /** always-available descriptive layer */
  typicalUsd: number | null;        // median price, last 12 months
  record: { usd: number; title: string; date: string | null; house: string | null } | null;
  lots: number;                     // volume tracked
  sellThroughPct: number | null;
  estCoverage: number;              // 0..1 — fraction of lots carrying estimates
  /** index rows: the BMN level series (base 100) behind the CI'd move */
  indexSeries?: { period: string; value: number; n: number }[];
  /** trailing quarterly sold-lot counts — volume facts, never price movement */
  volSeries?: { period: string; n: number }[];
  /** long-horizon YEARLY typical-price median (n-gated), for culture subject
      domains off the RR 23-year archive. Descriptive $ — never a %-change. */
  histSeries?: { period: string; value: number; n: number }[];
}
export interface HedonicHorizon {
  changePct: number | null;
  ciLoPct: number | null;
  ciHiPct: number | null;
  nStart: number;
  nEnd: number;
  publishable: boolean;
  reason: string;
}
export interface MakerIndexResult {
  series: { period: string; value: number; ciLo: number; ciHi: number; n: number }[];
  horizons: Record<string, HedonicHorizon>;
  lastCompleteQuarter: string;
  coverageMakerLots: number;
  note?: string;
}
export interface MarketSeriesJson {
  method: string; label: string; n: number;
  index: { period: string; value: number; n: number }[];
  volume: { period: string; value: number; n: number }[];
  sellThrough: { period: string; value: number; n: number }[];
  houseAccuracy: { period: string; value: number; n: number }[];
  analytics?: import('../types').MarketAnalytics;
}
interface RayPayload {
  market: MarketData | null;
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
  tape: TapeByMarket;
  demand: DemandByMarket;
  realized: RealizedByMarket;
  bidComp: BidCompByMarket;
  recentSold: RecentSoldByMarket;
  deepValue: DeepValueByMarket;
  backtest: Backtest | null;
  lastCrawl: string;
  sources: string[];
  // Full-corpus counts from meta.json — the honest aggregate incl. the Goldin
  // sold-archive that the slim lots.json omits. Falls back to allLots.length.
  totalLots?: number;
  totalSold?: number;
  fullLoaded: boolean;
  fullError: boolean;
  error: string | null;
}

// Module-level cache + subscriber list: the payloads are fetched once per
// session; phase 2 (the 9MB history) streams in behind the first paint and
// re-notifies every mounted route.
let cached: RayPayload | null = null;
let inflight: Promise<RayPayload> | null = null;
// Phase 2 gets its own inflight guard + retry hook: a single flaky fetch of
// the largest asset must never brick fullLoaded-gated routes for the session.
let inflightFull = false;
let retryFull: (() => void) | null = null;
// Phase 2 (the full history — 9 shards, ~152MB raw / ~28MB over the wire after
// brotli; the "~10MB" this comment used to claim has been wrong since the
// corpus passed 700K lots, and it masked the RR-archive leak that briefly put
// it at ~290MB) is now OPT-IN, mirroring
// phase 3: it fires only when a surface asks for it via useFullLots() /
// triggerFullLoad(). The home lander renders its feed from the eager
// upcoming.json alone, so it never pays this — the sold "Record" band lazy-
// mounts useFullLots() behind its reveal. This flag persists the request so a
// trigger that arrives before phase 1 resolves still kicks phase 2 the moment
// the eager payload lands.
let fullRequested = false;
// Phase 3 (the Goldin sold-archive, ~10MB) is NEVER auto-fetched. It only
// streams in when a surface mounts useSoldArchive(). Its own module cache +
// inflight guard + retry hook keep it independent of phases 1/2.
let cachedArchive: AuctionLot[] | null = null;
let archiveLoadedState = false;
let archiveErrorState = false;
let inflightArchive = false;
let retryArchive: (() => void) | null = null;
const listeners = new Set<(p: RayPayload) => void>();
// Archive subscribers get their own notify path — a soldComp-merged pool arrival
// re-renders only the mounted sports/science surfaces, not the whole app.
interface ArchiveState { soldArchive: AuctionLot[]; archiveLoaded: boolean; archiveError: boolean }
const archiveListeners = new Set<(s: ArchiveState) => void>();

function notify(p: RayPayload) {
  cached = p;
  listeners.forEach(fn => fn(p));
}

function notifyArchive() {
  const s: ArchiveState = {
    soldArchive: cachedArchive || [],
    archiveLoaded: archiveLoadedState,
    archiveError: archiveErrorState,
  };
  archiveListeners.forEach(fn => fn(s));
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

function parseStats(statsData: unknown, lots: AuctionLot[]): Record<string, MarketStats> {
  if (!statsData || typeof statsData !== 'object') return {};
  const d = statsData as Record<string, unknown>;
  if (d.lastUpdated) {
    // Old single-artist format — derive slug from lot data rather than hardcoding
    const artistSlug = lots[0]?.artist;
    return artistSlug ? { [artistSlug]: statsData as MarketStats } : {};
  }
  return statsData as Record<string, MarketStats>;
}

function loadRayData(): Promise<RayPayload> {
  if (cached) {
    // a requested-but-failed (or never-finished) phase 2 re-kicks on the next
    // mount instead of staying dead — but only once a surface has asked for it
    if (fullRequested && !cached.fullLoaded && retryFull && !inflightFull) retryFull();
    return Promise.resolve(cached);
  }
  if (inflight) return inflight;

  inflight = (async () => {
    // ── phase 1: the small eager payload — stats + meta + upcoming (w/ signals)
    const [statsR, metaR, upR, btR, mkR, cbR] = await Promise.allSettled([
      fetchJson('/data/ray/stats.json'),
      fetchJson('/data/ray/meta.json'),
      fetchJson('/data/ray/upcoming.json'),
      fetchJson('/data/ray/backtest.json'),
      fetchJson('/data/ray/market.json'),
      fetchJson('/data/ray/close-board.json'),
    ]);
    const market = mkR.status === 'fulfilled' ? (mkR.value as MarketData) : null;
    const statsData = statsR.status === 'fulfilled' ? statsR.value : null;
    const metaData = (metaR.status === 'fulfilled' ? metaR.value : {}) as { lastCrawl?: string; sources?: string[]; totalLots?: number; totalSold?: number };
    const backtest = btR.status === 'fulfilled' ? (btR.value as Backtest) : null;
    const up = upR.status === 'fulfilled'
      ? (upR.value as {
          tape?: TapeByMarket | TapeItem[];
          demand?: DemandByMarket | DemandPoint[];
          realized?: RealizedByMarket;
          bidComp?: BidCompByMarket;
          recentSold?: RecentSoldByMarket;
          deepValue?: DeepValueByMarket;
          lots?: AuctionLot[];
        })
      : null;

    // ── CLOSE-BOARD OVERLAY — intraday bid refresh for lots closing <24h.
    // Newer-generatedAt only; overrides currentBid/bidCount/bidProj and the
    // affected markets' deep-value rows so every surface reads close-fresh.
    const cb = cbR.status === 'fulfilled' ? (cbR.value as {
      generatedAt?: string;
      bids?: Record<string, { b: number; n: number; proj?: number; floor?: number; below?: boolean }>;
      deepValue?: Array<{ id: string; depth: number; allIn: number; floor: number; closes: string; m?: string }>;
    }) : null;
    const upGen = (up as { generatedAt?: string } | null)?.generatedAt;
    if (cb?.bids && up?.lots && (!upGen || !cb.generatedAt || cb.generatedAt > upGen)) {
      for (const l of up.lots) {
        const o = cb.bids[String((l as { id?: string }).id)];
        if (!o) continue;
        const lw = l as AuctionLot & { bidProj?: { g: number; allIn: number; floor?: number; below?: boolean } };
        if (o.b > 0) lw.currentBid = o.b;
        if (o.n > 0) lw.bidCount = o.n;
        if (o.proj) lw.bidProj = { g: lw.bidProj?.g ?? 1, allIn: o.proj, ...(o.floor ? { floor: o.floor, below: o.below } : {}) };
      }
      if (cb.deepValue?.length && up.deepValue) {
        const byM: Record<string, typeof cb.deepValue> = {};
        for (const r of cb.deepValue) { const m = r.m || 'sports'; (byM[m] || (byM[m] = [])).push(r); }
        for (const m of Object.keys(byM)) (up.deepValue as DeepValueByMarket)[m] = byM[m] as DeepValueRow[];
      }
    }

    // statsData may be null (a transient stats.json failure) — parseStats
    // handles it; requiring it here forced the full-corpus fallback (152MB)
    // and dropped every eager field over a one-request blip.
    if (up) {
      const core: RayPayload = {
        statsByArtist: parseStats(statsData, up.lots || []),
        allLots: up.lots || [],
        tape: Array.isArray(up.tape) ? { all: up.tape } : (up.tape || {}),
        demand: Array.isArray(up.demand) ? { art: up.demand } : (up.demand || {}),
        realized: up.realized || {},
        bidComp: up.bidComp || {},
        recentSold: up.recentSold || {},
        deepValue: up.deepValue || {},
        backtest,
        market,
        lastCrawl: metaData.lastCrawl || '',
        sources: metaData.sources || [],
        totalLots: metaData.totalLots,
        totalSold: metaData.totalSold,
        fullLoaded: false,
        fullError: false,
        error: null,
      };
      notify(core);

      // ── phase 2: stream the full history behind the paint; re-attach the
      // precomputed signals so upcoming cards never flicker to a recompute.
      // The URL is versioned by lastCrawl and fetched force-cache, so a
      // revisit on the same crawl day reuses the browser cache instead of
      // re-downloading the multi-MB archive; a new crawl is a new URL.
      // Failures retry with backoff, then surface fullError — the eager
      // payload keeps the app alive, but gated pages get a real error state.
      // lots.json is SHARDED (lots-0.json, lots-1.json, …) — a single file
      // outgrew Cloudflare Pages' 25 MiB/file hard cap. lots-index.json says
      // how many shards; they download in parallel and concat in order.
      const ver = metaData.lastCrawl ? `?v=${encodeURIComponent(metaData.lastCrawl)}` : '';
      const loadFull = () => {
        if (inflightFull || cached?.fullLoaded) return;
        inflightFull = true;
        // a retry after fullError returns gated pages to their loading state
        if (cached?.fullError) notify({ ...cached, fullError: false });
        (async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
            try {
              // first try trusts the cache; retries bypass it in case the
              // cached body itself was the problem (truncated download).
              // No version (meta.json failed → ver='') ⇒ never force-cache:
              // the shard paths are immutable-cached, and a bare force-cache
              // fetch would silently pin a stale corpus for a year.
              const cacheMode: RequestCache = attempt === 0 && ver ? 'force-cache' : 'reload';
              const idx = await fetchJson(`/data/ray/lots-index.json${ver}`, { cache: cacheMode }) as { shards: number };
              const shardArrs = await Promise.all(
                Array.from({ length: Math.max(1, idx.shards || 1) }, (_, i) =>
                  fetchJson(`/data/ray/lots-${i}.json${ver}`, { cache: cacheMode }) as Promise<AuctionLot[]>)
              );
              const full = ([] as AuctionLot[]).concat(...shardArrs);
              const signals = new Map((up.lots || []).map(l => [l.id, l.signal]));
              // soldComp is precomputed onto the SAME eager upcoming lots (sports/
              // science bands); re-attach it here too, or the feed cards — which
              // render from allLots, not upcoming.json — never see the band.
              const soldComps = new Map((up.lots || []).map(l => [l.id, (l as AuctionLot).soldComp]));
              // bidVelocity is stamped only on the eager upcoming lots (not the
              // corpus shards) — re-attach it or the shard version overwrites it
              // and LotPage's bid-velocity row never appears after phase 2.
              const bidVels = new Map((up.lots || []).map(l => [l.id, (l as AuctionLot).bidVelocity]));
              const merged = full.map(l => {
                let x = l;
                if (signals.get(l.id) != null) x = { ...x, signal: signals.get(l.id) };
                if (soldComps.get(l.id) != null) x = { ...x, soldComp: soldComps.get(l.id) };
                if (bidVels.get(l.id) != null) x = { ...x, bidVelocity: bidVels.get(l.id) };
                return x;
              });
              notify({ ...(cached || core), allLots: merged, fullLoaded: true, fullError: false });
              // phase 2 is done for the session — drop the retry closure so the
              // eager payload (up.lots et al) it captures can be collected.
              retryFull = null;
              return;
            } catch { /* retry, then surface */ }
          }
          notify({ ...(cached || core), fullError: true });
        })().finally(() => { inflightFull = false; });
      };
      retryFull = loadFull;
      // OPT-IN: only fire phase 2 if a surface has already asked (or asks
      // later, via triggerFullLoad, which will call retryFull directly).
      if (fullRequested) loadFull();

      inflight = null;
      return core;
    }

    // ── fallback: no upcoming.json yet (older deploy) — the classic single load.
    // Version the shard URLs by lastCrawl like the primary path: the shard paths
    // are immutable-cached (public/_headers), so an un-versioned fetch here could
    // pin a stale shard for a year.
    const fbVer = metaData.lastCrawl ? `?v=${encodeURIComponent(metaData.lastCrawl)}` : '';
    // unversioned (meta failed) ⇒ bypass the browser cache: the shard paths
    // are immutable-cached, and a default fetch would pin stale for a year.
    const fbCache: RequestCache | undefined = fbVer ? undefined : 'reload';
    const lotsR = await Promise.allSettled([(async () => {
      const idx = await fetchJson(`/data/ray/lots-index.json${fbVer}`, { cache: fbCache }) as { shards: number };
      const arrs = await Promise.all(Array.from({ length: Math.max(1, idx.shards || 1) }, (_, i) => fetchJson(`/data/ray/lots-${i}.json${fbVer}`, { cache: fbCache }) as Promise<AuctionLot[]>));
      return ([] as AuctionLot[]).concat(...arrs);
    })()]);
    const lotsData = (lotsR[0].status === 'fulfilled' ? lotsR[0].value : []) as AuctionLot[];
    const lotsOk = lotsR[0].status === 'fulfilled';
    const statsOk = statsR.status === 'fulfilled';
    const payload: RayPayload = {
      statsByArtist: parseStats(statsData, lotsData),
      allLots: lotsData,
      tape: {},
      demand: {},
      realized: {},
      bidComp: {},
      recentSold: {},
      deepValue: {},
      market: null,
      backtest,
      lastCrawl: metaData.lastCrawl || '',
      sources: metaData.sources || [],
      fullLoaded: lotsOk,
      fullError: !lotsOk,
      error: (!lotsOk && !statsOk) ? 'Unable to load auction data. Please try again later.' : null,
    };
    if (lotsOk || statsOk) cached = payload;
    inflight = null;
    return payload;
  })();

  return inflight;
}

/** Opt-in trigger for the phase-2 full history. Marks the request so it fires
    the moment phase 1 resolves (or immediately if phase 1 is already done),
    and survives a phase-1-not-yet-ready mount. Idempotent per session. */
export function triggerFullLoad() {
  fullRequested = true;
  // phase 1 already landed → kick now; otherwise loadRayData's phase-1 tail
  // reads fullRequested and fires loadFull itself.
  if (retryFull && !inflightFull && !cached?.fullLoaded) retryFull();
}

/** Re-attempt the phase-2 archive fetch after a fullError (no-op while a
    fetch is already inflight or once the archive has loaded). A retry implies
    the surface still wants the corpus, so it keeps the request latched. */
export function retryFullLoad() {
  fullRequested = true;
  if (retryFull && !inflightFull && !cached?.fullLoaded) retryFull();
}

// ── phase 3: the Goldin sold-archive tier. Mirrors loadFull (3-try backoff,
// force-cache first try, ?v=lastCrawl) but is never invoked from loadRayData —
// only from a mounted useSoldArchive(). On success it re-attaches the
// precomputed soldComp from the eager upcoming payload, exactly as phase 2
// re-attaches signal, so a sports card never flickers to a client recompute.
function loadSoldArchive() {
  if (inflightArchive || archiveLoadedState) return;
  inflightArchive = true;
  // a retry after archiveError returns gated surfaces to their loading state
  if (archiveErrorState) { archiveErrorState = false; notifyArchive(); }
  (async () => {
    // Phase 1 FIRST: on a cold session `cached` is null here, which used to
    // read lastCrawl as '' and fetch the archive shards UNVERSIONED — and the
    // shard paths are immutable-cached (public/_headers), so that pinned a
    // year-stale archive and latched the soldComp merge empty for the session.
    // Awaiting loadRayData also seats the eager soldComps map for re-attach.
    let core = cached;
    if (!core) { try { core = await loadRayData(); } catch { core = cached; } }
    const lastCrawl = core?.lastCrawl || '';
    const ver = lastCrawl ? `?v=${encodeURIComponent(lastCrawl)}` : '';
    // the precomputed soldComp lives on the eager upcoming lots, keyed by id
    const soldComps = new Map((core?.allLots || []).map(l => [l.id, l.soldComp]));
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      try {
        // first try trusts the cache; retries bypass it in case the cached
        // body itself was the problem (truncated download). No version ⇒
        // never force-cache (immutable-cached paths would pin stale a year).
        const cacheMode: RequestCache = attempt === 0 && ver ? 'force-cache' : 'reload';
        // SHARDED like phase 2 (the single file crossed 22MB against the CDN's
        // 25MB cap): index → shards in parallel. Single-file fallback covers
        // the transition window where a client has new code but cached old data.
        let archive: AuctionLot[];
        try {
          const idx = await fetchJson(`/data/ray/sold-archive-index.json${ver}`, { cache: cacheMode }) as { shards: number };
          const nShards = Number(idx?.shards) || 0;
          if (nShards < 1) throw new Error('bad sold-archive index');
          const parts = await Promise.all(Array.from({ length: nShards }, (_, i) =>
            fetchJson(`/data/ray/sold-archive-${i}.json${ver}`, { cache: cacheMode }) as Promise<AuctionLot[]>));
          archive = parts.flat();
        } catch {
          archive = await fetchJson(`/data/ray/sold-archive.json${ver}`, { cache: cacheMode }) as AuctionLot[];
        }
        const merged = archive.map(l => (soldComps.has(l.id) ? { ...l, soldComp: soldComps.get(l.id) } : l));
        cachedArchive = merged;
        archiveLoadedState = true;
        archiveErrorState = false;
        notifyArchive();
        return;
      } catch { /* retry, then surface */ }
    }
    archiveErrorState = true;
    notifyArchive();
  })().finally(() => { inflightArchive = false; });
}
retryArchive = loadSoldArchive;

/** Re-attempt the phase-3 sold-archive fetch after an archiveError (no-op
    while a fetch is inflight or once the archive has loaded). */
export function retryArchiveLoad() {
  if (retryArchive && !inflightArchive && !archiveLoadedState) retryArchive();
}

// ── the SOLD-OUTCOMES LEDGER (id → [priceUsd, saleDate]) — a slim on-demand
// tier the PROFILE loads to resolve saved lots that sold into the archive /
// corpus-only tiers, whose full rows are never shipped to the browser. Bounded
// to the last 24 months (the saveable window). Own module cache + inflight
// guard + 3-try backoff, independent of phases 1/2/3. ──
export type LedgerEntry = [number, string] | [number, string, 1]; // [priceUsd, saleDate, provisional?]
interface LedgerState { ledger: Map<string, LedgerEntry>; ledgerLoaded: boolean; ledgerError: boolean }
let cachedLedger: Map<string, LedgerEntry> | null = null;
let ledgerLoadedState = false;
let ledgerErrorState = false;
let inflightLedger = false;
const ledgerListeners = new Set<(s: LedgerState) => void>();
function notifyLedger() {
  const s: LedgerState = { ledger: cachedLedger || new Map(), ledgerLoaded: ledgerLoadedState, ledgerError: ledgerErrorState };
  ledgerListeners.forEach(fn => fn(s));
}
function loadSoldLedger() {
  if (inflightLedger || ledgerLoadedState) return;
  inflightLedger = true;
  if (ledgerErrorState) { ledgerErrorState = false; notifyLedger(); }
  (async () => {
    let core = cached;
    if (!core) { try { core = await loadRayData(); } catch { core = cached; } }
    const ver = core?.lastCrawl ? `?v=${encodeURIComponent(core.lastCrawl)}` : '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      try {
        const cacheMode: RequestCache = attempt === 0 && ver ? 'force-cache' : 'reload';
        const idx = await fetchJson(`/data/ray/sold-ledger-index.json${ver}`, { cache: cacheMode }) as { shards: number };
        const nShards = Number(idx?.shards) || 0;
        if (nShards < 1) throw new Error('bad sold-ledger index');
        const parts = await Promise.all(Array.from({ length: nShards }, (_, i) =>
          fetchJson(`/data/ray/sold-ledger-${i}.json${ver}`, { cache: cacheMode }) as Promise<Record<string, LedgerEntry>>));
        const map = new Map<string, LedgerEntry>();
        for (const p of parts) for (const k in p) map.set(k, p[k]);
        cachedLedger = map; ledgerLoadedState = true; ledgerErrorState = false; notifyLedger();
        return;
      } catch { /* retry, then surface */ }
    }
    ledgerErrorState = true; notifyLedger();
  })().finally(() => { inflightLedger = false; });
}
/** On-demand sold-outcomes ledger. Mounting fetches it (contract, like
    useSoldArchive) — only mount it behind a real need (saved-lot orphans). */
export function useSoldLedger(): LedgerState {
  const [state, setState] = useState<LedgerState>(() => ({ ledger: cachedLedger || new Map(), ledgerLoaded: ledgerLoadedState, ledgerError: ledgerErrorState }));
  useEffect(() => {
    let active = true;
    const listener = (s: LedgerState) => { if (active) setState(s); };
    ledgerListeners.add(listener);
    listener({ ledger: cachedLedger || new Map(), ledgerLoaded: ledgerLoadedState, ledgerError: ledgerErrorState });
    loadSoldLedger();
    return () => { active = false; ledgerListeners.delete(listener); };
  }, []);
  return state;
}

export function useRayData(): RayData {
  const [data, setData] = useState<RayPayload | null>(cached);
  // "cache warm at mount" per the doc contract — phase-1 presence, NOT
  // phase-2 completion (ANDing fullLoaded made entrance choreography replay
  // on warm revisits and flip behavior based on which pages had pulled the
  // full corpus; audit-lifecycle #2)
  const [fromCache] = useState(() => cached !== null);

  useEffect(() => {
    let active = true;
    const listener = (p: RayPayload) => { if (active) setData(p); };
    listeners.add(listener);
    loadRayData().then(listener);
    return () => { active = false; listeners.delete(listener); };
  }, []);

  return {
    statsByArtist: data?.statsByArtist || {},
    allLots: data?.allLots || EMPTY_LOTS,
    tape: data?.tape || {},
    demand: data?.demand || {},
    realized: data?.realized || {},
    bidComp: data?.bidComp || {},
    recentSold: data?.recentSold || {},
    deepValue: data?.deepValue || {},
    backtest: data?.backtest || null,
    market: data?.market || null,
    lastCrawl: data?.lastCrawl || '',
    sources: data?.sources || [],
    totalLots: data?.totalLots,
    totalSold: data?.totalSold,
    loading: data === null,
    fullLoaded: data?.fullLoaded || false,
    fullError: data?.fullError || false,
    error: data?.error || null,
    fromCache,
  };
}

/** Opt-in phase-2 tier: mounting this hook triggers the full-history fetch
    (once per session, module-cached) and otherwise returns the same view as
    useRayData(). The bare useRayData() mount NEVER pulls phase 2 — only routes
    that read the full corpus (artist, analytics, value, saved, lot permalinks)
    or a surface that lazy-reveals sold history mount this. fullLoaded flips
    true once the ~10MB shards land, exactly as before. */
export function useFullLots(): RayData {
  const base = useRayData();
  useEffect(() => { triggerFullLoad(); }, []);
  return base;
}

export interface SoldArchive {
  /** the Goldin sold history (~10MB) — populated only after mount */
  soldArchive: AuctionLot[];
  archiveLoaded: boolean;
  archiveError: boolean;
  /** the eager main lots concat the archive, so sports/science surfaces get a
      single full-corpus pool once the archive lands. */
  allLotsWithArchive: AuctionLot[];
}

/** Opt-in phase-3 tier: mounting this hook triggers the sold-archive fetch
    (once per session, module-cached) and returns the archive + a merged
    full-corpus pool. The default useRayData() mount NEVER pulls this — only
    sports/science deep views pay the 10MB. */
export function useSoldArchive(): SoldArchive {
  const base = useRayData();
  const [state, setState] = useState<ArchiveState>(() => ({
    soldArchive: cachedArchive || [],
    archiveLoaded: archiveLoadedState,
    archiveError: archiveErrorState,
  }));

  useEffect(() => {
    let active = true;
    const listener = (s: ArchiveState) => { if (active) setState(s); };
    archiveListeners.add(listener);
    // reflect any state that landed before this subscribe, then kick the fetch
    listener({ soldArchive: cachedArchive || [], archiveLoaded: archiveLoadedState, archiveError: archiveErrorState });
    loadSoldArchive();
    return () => { active = false; archiveListeners.delete(listener); };
  }, []);

  // Memoized so identity is stable across renders — an un-memoized new array
  // each render drives ArchiveLoader's effect into an infinite setState loop.
  const allLotsWithArchive = useMemo(
    () => (state.soldArchive.length ? [...base.allLots, ...state.soldArchive] : base.allLots),
    [base.allLots, state.soldArchive],
  );
  return {
    soldArchive: state.soldArchive,
    archiveLoaded: state.archiveLoaded,
    archiveError: state.archiveError,
    allLotsWithArchive,
  };
}
