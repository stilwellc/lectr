'use client';

import { useState, useEffect } from 'react';
import { AuctionLot, MarketStats } from '../types';

export interface TapeItem { artist: string; title: string; price: string; house: string }
export type TapeByMarket = Record<string, TapeItem[]>;
export interface DemandPoint { date: string; value: number; n: number }
export type DemandByMarket = Record<string, DemandPoint[]>;
export interface Backtest {
  flagged: { n: number; medianPerfPct: number; beatHighPct: number };
  unflagged: { n: number; medianPerfPct: number; beatHighPct: number };
  above: { n: number; medianPerfPct: number; beatHighPct: number };
  series: { year: number; flaggedMedianPct: number | null; unflaggedMedianPct: number | null; nFlagged: number }[];
}

interface RayData {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
  tape: TapeByMarket;
  demand: DemandByMarket;
  backtest: Backtest | null;
  lastCrawl: string;
  sources: string[];
  loading: boolean;
  /** the full sold history has arrived (comps, analytics, artist pages) */
  fullLoaded: boolean;
  error: string | null;
  /** true when the module cache was already warm at mount —
      revisits render instantly, no arrival choreography. */
  fromCache: boolean;
}

interface RayPayload {
  statsByArtist: Record<string, MarketStats>;
  allLots: AuctionLot[];
  tape: TapeByMarket;
  demand: DemandByMarket;
  backtest: Backtest | null;
  lastCrawl: string;
  sources: string[];
  fullLoaded: boolean;
  error: string | null;
}

// Module-level cache + subscriber list: the payloads are fetched once per
// session; phase 2 (the 9MB history) streams in behind the first paint and
// re-notifies every mounted route.
let cached: RayPayload | null = null;
let inflight: Promise<RayPayload> | null = null;
const listeners = new Set<(p: RayPayload) => void>();

function notify(p: RayPayload) {
  cached = p;
  listeners.forEach(fn => fn(p));
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url);
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
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = (async () => {
    // ── phase 1: the small eager payload — stats + meta + upcoming (w/ signals)
    const [statsR, metaR, upR, btR] = await Promise.allSettled([
      fetchJson('/data/ray/stats.json'),
      fetchJson('/data/ray/meta.json'),
      fetchJson('/data/ray/upcoming.json'),
      fetchJson('/data/ray/backtest.json'),
    ]);
    const statsData = statsR.status === 'fulfilled' ? statsR.value : null;
    const metaData = (metaR.status === 'fulfilled' ? metaR.value : {}) as { lastCrawl?: string; sources?: string[] };
    const backtest = btR.status === 'fulfilled' ? (btR.value as Backtest) : null;
    const up = upR.status === 'fulfilled'
      ? (upR.value as { tape?: TapeByMarket | TapeItem[]; demand?: DemandByMarket | DemandPoint[]; lots?: AuctionLot[] })
      : null;

    if (up && statsData) {
      const core: RayPayload = {
        statsByArtist: parseStats(statsData, up.lots || []),
        allLots: up.lots || [],
        tape: Array.isArray(up.tape) ? { all: up.tape } : (up.tape || {}),
        demand: Array.isArray(up.demand) ? { art: up.demand } : (up.demand || {}),
        backtest,
        lastCrawl: metaData.lastCrawl || '',
        sources: metaData.sources || [],
        fullLoaded: false,
        error: null,
      };
      notify(core);

      // ── phase 2: stream the full history behind the paint; re-attach the
      // precomputed signals so upcoming cards never flicker to a recompute.
      fetchJson('/data/ray/lots.json')
        .then(lotsData => {
          const full = lotsData as AuctionLot[];
          const signals = new Map((up.lots || []).map(l => [l.id, l.signal]));
          const merged = full.map(l => (signals.has(l.id) ? { ...l, signal: signals.get(l.id) } : l));
          notify({ ...core, allLots: merged, fullLoaded: true });
        })
        .catch(() => { /* the eager payload keeps the app alive */ });

      inflight = null;
      return core;
    }

    // ── fallback: no upcoming.json yet (older deploy) — the classic single load
    const lotsR = await Promise.allSettled([fetchJson('/data/ray/lots.json')]);
    const lotsData = (lotsR[0].status === 'fulfilled' ? lotsR[0].value : []) as AuctionLot[];
    const lotsOk = lotsR[0].status === 'fulfilled';
    const statsOk = statsR.status === 'fulfilled';
    const payload: RayPayload = {
      statsByArtist: parseStats(statsData, lotsData),
      allLots: lotsData,
      tape: {},
      demand: {},
      backtest,
      lastCrawl: metaData.lastCrawl || '',
      sources: metaData.sources || [],
      fullLoaded: lotsOk,
      error: (!lotsOk && !statsOk) ? 'Unable to load auction data. Please try again later.' : null,
    };
    if (lotsOk || statsOk) cached = payload;
    inflight = null;
    return payload;
  })();

  return inflight;
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
    allLots: data?.allLots || [],
    tape: data?.tape || {},
    demand: data?.demand || {},
    backtest: data?.backtest || null,
    lastCrawl: data?.lastCrawl || '',
    sources: data?.sources || [],
    loading: data === null,
    fullLoaded: data?.fullLoaded || false,
    error: data?.error || null,
    fromCache,
  };
}
