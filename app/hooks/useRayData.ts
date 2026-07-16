'use client';

import { useState, useEffect, useMemo } from 'react';
import { AuctionLot, MarketStats, RealizedPoint } from '../types';

// Stable empty-array identity for pre-load fallbacks — a fresh `[]` each render
// would defeat downstream memoization (e.g. useSoldArchive's allLotsWithArchive).
const EMPTY_LOTS: AuctionLot[] = [];

export interface TapeItem { artist: string; title: string; price: string; house: string }
export type TapeByMarket = Record<string, TapeItem[]>;
export interface DemandPoint { date: string; value: number; n: number }
export type DemandByMarket = Record<string, DemandPoint[]>;
export type RealizedByMarket = Record<string, RealizedPoint[]>;
export type RecentSoldByMarket = Record<string, unknown[]>;
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
  /** lightweight last-N Goldin closes per sports/science market so the home
      Recent-results row paints without the 10MB archive. Eager. */
  recentSold: RecentSoldByMarket;
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
  calibration: { directional: { method: string; buckets: [string, number][] }; valueError: Record<string, number> };
}
export interface MarketSeriesJson {
  method: string; label: string; n: number;
  index: { period: string; value: number; n: number }[];
  volume: { period: string; value: number; n: number }[];
  sellThrough: { period: string; value: number; n: number }[];
  houseAccuracy: { period: string; value: number; n: number }[];
}
interface RayPayload {
  market: MarketData | null;
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
  tape: TapeByMarket;
  demand: DemandByMarket;
  realized: RealizedByMarket;
  recentSold: RecentSoldByMarket;
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
    // a failed (or never-finished) phase 2 re-kicks on the next mount instead
    // of staying dead for the rest of the session
    if (!cached.fullLoaded && retryFull && !inflightFull) retryFull();
    return Promise.resolve(cached);
  }
  if (inflight) return inflight;

  inflight = (async () => {
    // ── phase 1: the small eager payload — stats + meta + upcoming (w/ signals)
    const [statsR, metaR, upR, btR, mkR] = await Promise.allSettled([
      fetchJson('/data/ray/stats.json'),
      fetchJson('/data/ray/meta.json'),
      fetchJson('/data/ray/upcoming.json'),
      fetchJson('/data/ray/backtest.json'),
      fetchJson('/data/ray/market.json'),
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
          recentSold?: RecentSoldByMarket;
          lots?: AuctionLot[];
        })
      : null;

    if (up && statsData) {
      const core: RayPayload = {
        statsByArtist: parseStats(statsData, up.lots || []),
        allLots: up.lots || [],
        tape: Array.isArray(up.tape) ? { all: up.tape } : (up.tape || {}),
        demand: Array.isArray(up.demand) ? { art: up.demand } : (up.demand || {}),
        realized: up.realized || {},
        recentSold: up.recentSold || {},
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
              // cached body itself was the problem (truncated download)
              const cacheMode: RequestCache = attempt === 0 ? 'force-cache' : 'reload';
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
              const merged = full.map(l => {
                let x = l;
                if (signals.has(l.id)) x = { ...x, signal: signals.get(l.id) };
                if (soldComps.get(l.id) != null) x = { ...x, soldComp: soldComps.get(l.id) };
                return x;
              });
              notify({ ...(cached || core), allLots: merged, fullLoaded: true, fullError: false });
              return;
            } catch { /* retry, then surface */ }
          }
          notify({ ...(cached || core), fullError: true });
        })().finally(() => { inflightFull = false; });
      };
      retryFull = loadFull;
      loadFull();

      inflight = null;
      return core;
    }

    // ── fallback: no upcoming.json yet (older deploy) — the classic single load
    const lotsR = await Promise.allSettled([(async () => {
      const idx = await fetchJson('/data/ray/lots-index.json') as { shards: number };
      const arrs = await Promise.all(Array.from({ length: Math.max(1, idx.shards || 1) }, (_, i) => fetchJson(`/data/ray/lots-${i}.json`) as Promise<AuctionLot[]>));
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
      recentSold: {},
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

/** Re-attempt the phase-2 archive fetch after a fullError (no-op while a
    fetch is already inflight or once the archive has loaded). */
export function retryFullLoad() {
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
  const lastCrawl = cached?.lastCrawl || '';
  const archiveUrl = lastCrawl
    ? `/data/ray/sold-archive.json?v=${encodeURIComponent(lastCrawl)}`
    : '/data/ray/sold-archive.json';
  // the precomputed soldComp lives on the eager upcoming lots, keyed by id
  const soldComps = new Map((cached?.allLots || []).map(l => [l.id, l.soldComp]));
  (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      try {
        // first try trusts the cache; retries bypass it in case the cached
        // body itself was the problem (truncated download)
        const archiveData = await fetchJson(archiveUrl, { cache: attempt === 0 ? 'force-cache' : 'reload' });
        const archive = archiveData as AuctionLot[];
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

export function useRayData(): RayData {
  const [data, setData] = useState<RayPayload | null>(cached);
  const [fromCache] = useState(() => cached !== null && cached.fullLoaded);

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
    recentSold: data?.recentSold || {},
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
