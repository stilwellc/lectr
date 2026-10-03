'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AuctionLot, MarketStats, RealizedPoint, BidCompetitionPoint } from '../types';

// Stable empty-array identity for pre-load fallbacks — a fresh `[]` each render
// would defeat downstream memoization.
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

export interface RayData {
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
  /** the forward calls ledger's public accrual meter (receipts.json, 1KB,
      eager): counts + graded only — medians publish at 20 graded, and the
      served file carries none until then. Never blended with the replay. */
  receipts: ReceiptsData | null;
  lastCrawl: string;
  /** the close-board overlay's generatedAt, when one was applied — the
      board's intraday freshness stamp (nightly-only sessions omit it) */
  overlayAt?: string;
  sources: string[];
  /** honest full-corpus counts from meta.json (incl. the Goldin sold-archive
      the slim lots.json omits). page reads these before falling back to length. */
  totalLots?: number;
  totalSold?: number;
  loading: boolean;
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
export interface ReceiptsData {
  record: {
    card: { n: number; graded: number; medRatio: number | null; within30Pct: number | null };
    vsbid: { n: number; graded: number; medRatio: number | null; belowHit: number | null };
    gap?: { n: number; graded: number; medRatio: number | null; floorHit: number | null };
    quiet?: { n: number; graded: number; medRatio: number | null; underPct: number | null };
    asOf: string;
  };
  rows: { id: string; k: string; d: string; sd: string; p: number; r: number; f: number; m: string; t: string; a: string; h: string }[];
}

interface RayPayload {
  market: MarketData | null;
  receipts: ReceiptsData | null;
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
  overlayAt?: string;
  sources: string[];
  // Full-corpus counts from meta.json — the honest aggregate incl. the Goldin
  // sold-archive that the slim lots.json omits. Falls back to allLots.length.
  totalLots?: number;
  totalSold?: number;
  error: string | null;
}

// Module-level cache + subscriber list: the eager payloads are fetched once
// per session and re-notify every mounted route.
//
// THE FULL CORPUS IS NEVER DOWNLOADED (Oct 2026). Phases 2 and 3 — the whole
// served book (lots-*.json, ~257MB raw) and the Goldin sold-archive
// (sold-archive-*.json) — are retired from the client. Every surface that
// read lot-level history now asks the lot API (app/lib/api.ts → functions/api,
// R2-backed) for exactly the rows or the answer it needs: one lot, one lot's
// comps, one page of a table, one maker's/market's book in columns.
let cached: RayPayload | null = null;
let inflight: Promise<RayPayload> | null = null;
const listeners = new Set<(p: RayPayload) => void>();

function notify(p: RayPayload) {
  cached = p;
  listeners.forEach(fn => fn(p));
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
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  inflight = (async () => {
    // ── phase 1: the small eager payload — stats + meta + upcoming (w/ signals)
    const [statsR, metaR, upR, btR, mkR, cbR, rcR] = await Promise.allSettled([
      fetchJson('/data/ray/stats.json'),
      fetchJson('/data/ray/meta.json'),
      fetchJson('/data/ray/upcoming.json'),
      fetchJson('/data/ray/backtest.json'),
      fetchJson('/data/ray/market.json'),
      fetchJson('/data/ray/close-board.json'),
      fetchJson('/data/ray/receipts.json'),
    ]);
    const market = mkR.status === 'fulfilled' ? (mkR.value as MarketData) : null;
    const receipts = rcR.status === 'fulfilled' ? (rcR.value as ReceiptsData) : null;
    const statsData = statsR.status === 'fulfilled' ? statsR.value : null;
    let metaData = (metaR.status === 'fulfilled' ? metaR.value : {}) as { lastCrawl?: string; sources?: string[]; totalLots?: number; totalSold?: number };
    // DATA-VERSION SKEW CHECK (Sep 2 2026): next.config bakes the served
    // meta.json's lastCrawl into the build (NEXT_PUBLIC_DATA_VERSION). If the
    // meta.json we just fetched disagrees, either the CDN handed us a cached
    // meta.json from before the last deploy (the shard URLs below would then
    // be versioned by a stale crawl) or the HTML and the data come from
    // different deploys. Re-fetch meta with a cache-bust: a fresher answer
    // replaces the stale one (and versions the shards correctly); a matching
    // answer means genuine build/data skew — log it, no UI change.
    const builtVersion = process.env.NEXT_PUBLIC_DATA_VERSION || '';
    if (builtVersion && metaData.lastCrawl && metaData.lastCrawl !== builtVersion) {
      try {
        const fresh = await fetchJson(`/data/ray/meta.json?cb=${Date.now()}`, { cache: 'reload' }) as typeof metaData;
        if (fresh?.lastCrawl && fresh.lastCrawl !== metaData.lastCrawl) {
          console.warn(`[ray-data] meta.json was cache-stale (${metaData.lastCrawl} → ${fresh.lastCrawl}); build stamped ${builtVersion}`);
          metaData = fresh;
        } else {
          console.warn(`[ray-data] build/data skew: HTML built against crawl ${builtVersion}, served meta.json says ${metaData.lastCrawl}`);
        }
      } catch { /* the first meta stands; the skew is logged next visit */ }
    }
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
    // ACCEPT RULE (Sep 2 2026). The overlay used to be applied only when its
    // generatedAt beat upcoming.json's — but close-board reads PROD's
    // upcoming.json while the nightly rebuilds a newer base, so for up to ~4h
    // after every push the whole overlay was discarded even though its bids
    // were captured hours after the base's crawl. Now a lot takes the overlay
    // when (a) the overlay as a whole is newer, OR (b) the entry carries its
    // own timestamp `t` newer than the base, OR (c) the entry's bid is
    // STRICTLY NEWER INFORMATION — a higher current bid or a higher bid
    // count (both are monotone on a live lot, so "higher" ⇒ "later"). A bid
    // that is strictly newer is never discarded; an older overlay can never
    // LOWER a bid the base already knows.
    const overlayNewer = !!cb?.bids && (!upGen || !cb.generatedAt || cb.generatedAt > upGen);
    if (cb?.bids && up?.lots) {
      for (const l of up.lots) {
        const o = cb.bids[String((l as { id?: string }).id)] as (typeof cb.bids)[string] & { t?: string } | undefined;
        if (!o) continue;
        const lw = l as AuctionLot & { bidProj?: { g: number; allIn: number; floor?: number; below?: boolean } };
        const baseBid = lw.currentBid ?? 0;
        const baseN = lw.bidCount ?? 0;
        const entryNewer = overlayNewer
          || (!!o.t && (!upGen || o.t > upGen))
          || o.b > baseBid
          || o.n > baseN;
        if (!entryNewer) continue;
        if (o.b > 0 && o.b >= baseBid) lw.currentBid = o.b;
        if (o.n > 0 && o.n >= baseN) lw.bidCount = o.n;
        if (o.proj) lw.bidProj = { g: lw.bidProj?.g ?? 1, allIn: o.proj, ...(o.floor ? { floor: o.floor, below: o.below } : {}) };
        // the lot's bid state is now INTRADAY-fresh — stamp the overlay's
        // generatedAt so surfaces can say "LIVE · refreshed Nh ago" instead
        // of letting close-day bids read as last night's numbers
        const stamp = o.t || cb.generatedAt;
        if (stamp) lw.overlayAt = stamp;
      }
      // the market-level deep-value rows are a snapshot of the overlay's
      // moment — only a newer overlay may replace the base's per-market lists
      if (overlayNewer && cb.deepValue?.length && up.deepValue) {
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
        receipts,
        lastCrawl: metaData.lastCrawl || '',
        overlayAt: cb?.generatedAt || undefined,
        sources: metaData.sources || [],
        totalLots: metaData.totalLots,
        totalSold: metaData.totalSold,
        error: null,
      };
      notify(core);
      inflight = null;
      return core;
    }

    // no upcoming.json (a data-less or broken deploy): say so — the old
    // fallback streamed the whole corpus here, which is exactly what this
    // layer no longer does.
    const payload: RayPayload = {
      statsByArtist: parseStats(statsData, []),
      allLots: [],
      tape: {}, demand: {}, realized: {}, bidComp: {}, recentSold: {}, deepValue: {},
      market, receipts, backtest,
      lastCrawl: metaData.lastCrawl || '',
      sources: metaData.sources || [],
      totalLots: metaData.totalLots,
      totalSold: metaData.totalSold,
      error: 'Unable to load auction data. Please try again later.',
    };
    inflight = null;
    return payload;
  })();

  return inflight;
}

/** Re-attempt the sold-outcomes ledger after a failure (loadSoldLedger clears
    its own error state on entry and is guarded against double-fires). */
export function retrySoldLedger() {
  loadSoldLedger();
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
/** On-demand sold-outcomes ledger. Mounting fetches it (by contract) — only
    mount it behind a real need (saved-lot orphans). */
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
    receipts: data?.receipts || null,
    lastCrawl: data?.lastCrawl || '',
    overlayAt: data?.overlayAt,
    sources: data?.sources || [],
    totalLots: data?.totalLots,
    totalSold: data?.totalSold,
    loading: data === null,
    error: data?.error || null,
    fromCache,
  };
}

/**
 * Attach the returned ref to the element that GATES a lazy read (the comps
 * section, the settled-flags block): `onVisible` fires ONCE, `rootMargin`
 * ahead of that element entering the viewport, so a multi-second stream
 * starts before the reader arrives instead of at first paint.
 *
 * `onVisible` must be stable (useCallback / requestFullLots). Where
 * IntersectionObserver is absent (old Safari, jsdom) it fires immediately —
 * degrading to today's eager behaviour rather than withholding content.
 */
export function useVisibilityTrigger(
  onVisible: () => void,
  { enabled = true, rootMargin = '600px 0px' }: { enabled?: boolean; rootMargin?: string } = {},
): (el: Element | null) => void {
  const fired = useRef(false);
  const ioRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => { ioRef.current?.disconnect(); ioRef.current = null; }, []);
  return useCallback((el: Element | null) => {
    // React hands null on unmount / re-attach — drop the old observer first
    if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null; }
    if (!el || fired.current || !enabled) return;
    if (typeof IntersectionObserver === 'undefined') { fired.current = true; onVisible(); return; }
    const io = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      fired.current = true;
      io.disconnect();
      ioRef.current = null;
      onVisible();
    }, { rootMargin });
    io.observe(el);
    ioRef.current = io;
  }, [enabled, rootMargin, onVisible]);
}
