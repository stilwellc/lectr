'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AuctionLot, MarketStats, RealizedPoint, BidCompetitionPoint } from '../types';
import { setCloseK, resetCloseK } from '../lib/close-k';
import { prepareEagerLots, type CloseBoardJson } from '../lib/eager-book';
import { fillHouseImages } from '../lib/house-images';
import { completeQuarters } from '../lib/maker-hero';
import { mergeCorpusOverEagerSliced, settleCorpusRow } from '../lib/live-pool';
import { fetchFirstScreen, fsVersion, type FirstScreenPayload } from '../lib/first-screen';
import { swGenCache } from '../lib/sw-register';
import { replaceBookTotals } from '../lib/book';
import { baselinesFromStats, houseBaselines, type BaselineStats, type HouseBaselines } from '../lib/feed-filters';
import { localToday } from '../utils';

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
  backtest: Backtest | null;
  lastCrawl: string;
  overlayAt?: string;
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
// THE LIVE POOL (r9, app/lib/live-pool): the eager book's ids, seated at
// phase 1. Every corpus row a surface resolves off the eager tape (the
// per-lot shard, a maker shard, Supabase) is settled against it, so a stale
// shard 'upcoming' can never print "Current bid" on a closed lot.
let eagerLiveIds: Set<string> | null = null;
/** A corpus row settled against the eager live book (live-pool.settleCorpusRow). */
export function settleLiveRow<T extends Pick<AuctionLot, 'id' | 'status'>>(row: T): T {
  return settleCorpusRow(row, eagerLiveIds);
}
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

// ── THE BOOK'S DEPLOY (W25, Oct 11 2026) ────────────────────────────────────
// Every tier above is ONE deploy's book. public/sw.js paints a returning
// visitor's last-seen book from its cache and, once a new deploy's phase-1
// book is downloaded, says so ('genReady'); swapNewBook (below) builds that
// whole book OFF-SCREEN and swaps every loaded tier at once. `bookEpoch`
// counts swaps: a load started under an older book drops its result instead
// of laying old rows over the new book. `bookVer` is the deploy the book on
// screen came from ('' = the deploy that built this page, fsVersion()).
let bookEpoch = 0;
let bookVer = '';
/** a swap adopted before any book loaded: phase 1 reads this generation */
let bookSource: string | null = null;

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

/** the phase-1 book, in this order (public/sw.js BOOK holds the same eight) */
export const BOOK_FILES = ['stats', 'meta', 'upcoming', 'backtest', 'market', 'close-board', 'receipts', 'close-k'] as const;
type BookFile = typeof BOOK_FILES[number];
type BookReader = (name: BookFile) => Promise<unknown>;
/** the network (through the worker, which serves this tab's own generation) */
const netBook: BookReader = name => fetchJson(`/data/ray/${name}.json`);

/** the service worker's cache of one deploy's book (app/lib/sw-register
 *  swGenCache) — null when the browser or the generation is gone */
async function genBook(ver: string): Promise<BookReader | null> {
  if (typeof caches === 'undefined' || !ver) return null;
  const name = swGenCache(ver);
  try {
    // caches.open would CREATE a missing generation — ask first
    if (!(await caches.has(name))) return null;
    const c = await caches.open(name);
    return async (file) => {
      const r = await c.match(`/data/ray/${file}.json`);
      if (!r || !r.ok) throw new Error(`${file}: not in generation ${ver}`);
      return r.json();
    };
  } catch { return null; }
}

type MetaJson = { lastCrawl?: string; sources?: string[]; totalLots?: number; totalSold?: number };
type UpcomingJson = {
  generatedAt?: string;
  tape?: TapeByMarket | TapeItem[];
  demand?: DemandByMarket | DemandPoint[];
  realized?: RealizedByMarket;
  bidComp?: BidCompByMarket;
  recentSold?: RecentSoldByMarket;
  lots?: AuctionLot[];
};
const settledValue = (r: PromiseSettledResult<unknown>): unknown => (r.status === 'fulfilled' ? r.value : null);

/** phase 1's payload off the eight settled reads — null without
 *  upcoming.json (the fallback path). Prepares the eager rows in place. */
function assembleCore(r: PromiseSettledResult<unknown>[], metaData: MetaJson): { core: RayPayload; up: UpcomingJson; closeK: unknown } | null {
  const [statsR, , upR, btR, mkR, cbR, rcR, ckR] = r;
  const up = settledValue(upR) as UpcomingJson | null;
  if (!up) return null;
  const statsData = settledValue(statsR);
  // close stamps + the close-board's intraday bid overlay — ONE function
  // (app/lib/eager-book) shared with the first-screen payloads, so a lot
  // prints the same bid whichever payload painted it first
  const cb = settledValue(cbR) as CloseBoardJson | null;
  const overlayAt = prepareEagerLots(up.lots, cb, up.generatedAt);
  // statsData may be null (a transient stats.json failure) — parseStats
  // handles it; requiring it here forced the full-corpus fallback (152MB)
  // and dropped every eager field over a one-request blip.
  const core: RayPayload = {
    statsByArtist: parseStats(statsData, up.lots || []),
    allLots: up.lots || [],
    tape: Array.isArray(up.tape) ? { all: up.tape } : (up.tape || {}),
    demand: Array.isArray(up.demand) ? { art: up.demand } : (up.demand || {}),
    realized: up.realized || {},
    bidComp: up.bidComp || {},
    recentSold: up.recentSold || {},
    backtest: (settledValue(btR) as Backtest | null) ?? null,
    market: (settledValue(mkR) as MarketData | null) ?? null,
    receipts: (settledValue(rcR) as ReceiptsData | null) ?? null,
    lastCrawl: metaData.lastCrawl || '',
    overlayAt,
    sources: metaData.sources || [],
    totalLots: metaData.totalLots,
    totalSold: metaData.totalSold,
    fullLoaded: false,
    fullError: false,
    error: null,
  };
  return { core, up, closeK: ckR.status === 'fulfilled' ? ckR.value : undefined };
}

const crawlVer = (lastCrawl: string | undefined) => (lastCrawl ? `?v=${encodeURIComponent(lastCrawl)}` : '');

/** three tries with backoff: the first trusts the browser cache, retries
 *  bypass it in case the cached body itself was the problem (a truncated
 *  download). No version ⇒ never force-cache: the shard paths are
 *  immutable-cached, and a bare force-cache fetch would pin a stale corpus
 *  for a year. */
async function threeTries<T>(ver: string, fn: (cache: RequestCache) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try { return await fn(attempt === 0 && ver ? 'force-cache' : 'reload'); } catch (e) { last = e; }
  }
  throw last;
}

// lots.json is SHARDED (lots-0.json, lots-1.json, …) — a single file
// outgrew Cloudflare Pages' 25 MiB/file hard cap. lots-index.json says
// how many shards; they download in parallel and concat in order.
async function fetchCorpus(ver: string, cache: RequestCache): Promise<AuctionLot[]> {
  const idx = await fetchJson(`/data/ray/lots-index.json${ver}`, { cache }) as { shards: number };
  const shardArrs = await Promise.all(
    Array.from({ length: Math.max(1, idx.shards || 1) }, (_, i) =>
      fetchJson(`/data/ray/lots-${i}.json${ver}`, { cache }) as Promise<AuctionLot[]>)
  );
  return ([] as AuctionLot[]).concat(...shardArrs);
}

/** phase 2 for one book: the corpus with that book's eager rows laid over it */
async function loadCorpusFor(up: Pick<UpcomingJson, 'lots'>, ver: string): Promise<AuctionLot[]> {
  const full = await threeTries(ver, cache => fetchCorpus(ver, cache));
  fillHouseImages(full);   // the shards' RR rows without a photo (app/lib/house-images)
  // THE LIVE POOL IS THE EAGER BOOK (r9, QA4 B1 — app/lib/live-pool).
  // Each eager lot is laid OVER its shard row: the eager copy wins on
  // every field it carries (signal incl. explicit null, soldComp,
  // bidVelocity, saleDateTime, gapOk/currentBid/bidCount/overlayAt —
  // all stripped from or nightly-stale on the shards), the shard only
  // fills what the eager row lacks. A shard row still saying
  // 'upcoming' for a lot the eager book closed out settles to
  // 'unknown-result' — it used to keep its status, and opening any
  // comps modal grew the live book 9,662 → 10,842 (Oct 10).
  // (desk pass 6) sliced: the same array, never one ~100 ms task on the main thread
  return mergeCorpusOverEagerSliced(up.lots || [], full);
}

/** the phase-2 loader for one book (the retry hook triggerFullLoad calls) */
function makeLoadFull(core: RayPayload, upLots: AuctionLot[]): () => void {
  const ver = crawlVer(core.lastCrawl);
  const epoch = bookEpoch;
  return () => {
    if (epoch !== bookEpoch || inflightFull || cached?.fullLoaded) return;
    inflightFull = true;
    // a retry after fullError returns gated pages to their loading state
    if (cached?.fullError) notify({ ...cached, fullError: false });
    loadCorpusFor({ lots: upLots }, ver).then(merged => {
      if (epoch !== bookEpoch) return; // a newer book took the screen meanwhile
      notify({ ...(cached || core), allLots: merged, fullLoaded: true, fullError: false });
      // phase 2 is done for the session — drop the retry closure so the
      // eager payload (up.lots et al) it captures can be collected.
      retryFull = null;
    }, () => {
      if (epoch === bookEpoch) notify({ ...(cached || core), fullError: true });
    }).finally(() => { if (epoch === bookEpoch) inflightFull = false; });
  };
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
    // a route painting its first screen holds the book back until that paint
    // lands (or the payload misses) — the slice gets the phone's bandwidth
    if (phase1Gate) await phase1Gate;
    // ── phase 1: the small eager payload — stats + meta + upcoming (w/ signals)
    // + backtest, market, close-board, receipts, and the bid rooms' close
    // multiples (close-k.json, refit with the book every night —
    // app/lib/close-k.ts), installed BEFORE the first paint so the priority
    // order never reshuffles after it. Missing or malformed → the compiled
    // table stands. A swap adopted before any book loaded reads its deploy
    // from the worker's cache (whole, or not at all).
    const adopted = bookSource ? await genBook(bookSource) : null;
    let settled = adopted ? await Promise.allSettled(BOOK_FILES.map(adopted)) : null;
    if (settled && (settled[1].status !== 'fulfilled' || settled[2].status !== 'fulfilled')) settled = null;
    if (settled) { bookVer = bookSource as string; replaceBookTotals(settled[1].status === 'fulfilled' ? settled[1].value as MetaJson : {}); }
    bookSource = null;
    if (!settled) settled = await Promise.allSettled(BOOK_FILES.map(netBook));
    const [, metaR, , , , , , ckR] = settled;
    if (ckR.status === 'fulfilled') setCloseK(ckR.value);
    let metaData = (metaR.status === 'fulfilled' ? metaR.value : {}) as MetaJson;
    // DATA-VERSION SKEW CHECK (Sep 2 2026): next.config bakes the served
    // meta.json's lastCrawl into the build (NEXT_PUBLIC_DATA_VERSION). If the
    // meta.json we just fetched disagrees, either the CDN handed us a cached
    // meta.json from before the last deploy (the shard URLs below would then
    // be versioned by a stale crawl) or the HTML and the data come from
    // different deploys. Re-fetch meta with a cache-bust: a fresher answer
    // replaces the stale one (and versions the shards correctly); a matching
    // answer means genuine build/data skew — log it, no UI change. (An
    // adopted newer book is SUPPOSED to differ from the build — skip it.)
    const builtVersion = process.env.NEXT_PUBLIC_DATA_VERSION || '';
    if (!adopted && builtVersion && metaData.lastCrawl && metaData.lastCrawl !== builtVersion) {
      try {
        const fresh = await fetchJson(`/data/ray/meta.json?cb=${Date.now()}`, { cache: 'reload' }) as MetaJson;
        if (fresh?.lastCrawl && fresh.lastCrawl !== metaData.lastCrawl) {
          console.warn(`[ray-data] meta.json was cache-stale (${metaData.lastCrawl} → ${fresh.lastCrawl}); build stamped ${builtVersion}`);
          metaData = fresh;
        } else {
          console.warn(`[ray-data] build/data skew: HTML built against crawl ${builtVersion}, served meta.json says ${metaData.lastCrawl}`);
        }
      } catch { /* the first meta stands; the skew is logged next visit */ }
    }
    const statsR = settled[0];
    const btR = settled[3];
    const statsData = statsR.status === 'fulfilled' ? statsR.value : null;
    const backtest = btR.status === 'fulfilled' ? (btR.value as Backtest) : null;

    const built = assembleCore(settled, metaData);
    if (built) {
      const { core, up } = built;
      eagerLiveIds = new Set((up.lots || []).map(l => l.id));
      notify(core);
      if (process.env.NODE_ENV !== 'production' && fsShown) {
        const shown = fsShown;
        fsShown = null;
        import('../lib/first-screen-select').then(m => m.verifyFirstScreen(shown.key, shown.lots, core.allLots)).catch(() => {});
      }

      // ── phase 2: stream the full history behind the paint; re-attach the
      // precomputed signals so upcoming cards never flicker to a recompute.
      // The URL is versioned by lastCrawl and fetched force-cache, so a
      // revisit on the same crawl day reuses the browser cache instead of
      // re-downloading the multi-MB archive; a new crawl is a new URL.
      // Failures retry with backoff, then surface fullError — the eager
      // payload keeps the app alive, but gated pages get a real error state.
      retryFull = makeLoadFull(core, up.lots || []);
      // OPT-IN: only fire phase 2 if a surface has already asked (or asks
      // later, via triggerFullLoad, which will call retryFull directly).
      if (fullRequested) retryFull();

      inflight = null;
      return core;
    }

    // ── fallback: no upcoming.json yet (older deploy) — the classic single load.
    // Version the shard URLs by lastCrawl like the primary path: the shard paths
    // are immutable-cached (public/_headers), so an un-versioned fetch here could
    // pin a stale shard for a year.
    const fbVer = crawlVer(metaData.lastCrawl);
    // unversioned (meta failed) ⇒ bypass the browser cache: the shard paths
    // are immutable-cached, and a default fetch would pin stale for a year.
    const fbCache: RequestCache = fbVer ? 'default' : 'reload';
    const lotsR = await Promise.allSettled([fetchCorpus(fbVer, fbCache)]);
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
      market: null,
      receipts: null,
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
    the surface still wants the corpus, so it keeps the request latched.
    FALLBACK PATH (no upcoming.json): loadRayData never assigns retryFull, so
    a fullError there previously left this a dead button — now it resets the
    cached payload and re-runs the load from the top. */
export function retryFullLoad() {
  fullRequested = true;
  if (retryFull && !inflightFull && !cached?.fullLoaded) { retryFull(); return; }
  if (!retryFull && !inflight && !inflightFull && (!cached || cached.fullError)) {
    cached = null;
    loadRayData().then(p => notify(p)).catch(() => { /* surfaces keep their error state */ });
  }
}

/** Re-attempt the sold-outcomes ledger after a failure (loadSoldLedger clears
    its own error state on entry and is guarded against double-fires). */
export function retrySoldLedger() {
  loadSoldLedger();
}

// ── phase 3: the Goldin sold-archive tier. Mirrors loadFull (3-try backoff,
// force-cache first try, ?v=lastCrawl) but is never invoked from loadRayData —
// only from a mounted useSoldArchive(). On success it re-attaches the
// precomputed soldComp from the eager upcoming payload, exactly as phase 2
// re-attaches signal, so a sports card never flickers to a client recompute.
async function fetchArchiveFor(core: RayPayload | null): Promise<AuctionLot[]> {
  const ver = crawlVer(core?.lastCrawl);
  // the precomputed soldComp lives on the eager upcoming lots, keyed by id
  const soldComps = new Map((core?.allLots || []).map(l => [l.id, l.soldComp]));
  const archive = await threeTries(ver, async cache => {
    // SHARDED like phase 2 (the single file crossed 22MB against the CDN's
    // 25MB cap): index → shards in parallel. Single-file fallback covers
    // the transition window where a client has new code but cached old data.
    try {
      const idx = await fetchJson(`/data/ray/sold-archive-index.json${ver}`, { cache }) as { shards: number };
      const nShards = Number(idx?.shards) || 0;
      if (nShards < 1) throw new Error('bad sold-archive index');
      const parts = await Promise.all(Array.from({ length: nShards }, (_, i) =>
        fetchJson(`/data/ray/sold-archive-${i}.json${ver}`, { cache }) as Promise<AuctionLot[]>));
      return parts.flat();
    } catch {
      return await fetchJson(`/data/ray/sold-archive.json${ver}`, { cache }) as AuctionLot[];
    }
  });
  // DEDUPE (Sep 2 2026): the archive can carry ids the main shards also
  // ship (17 goldin-2026* ids were duplicated main↔archive in the audit)
  // and, across a shard boundary, itself. Drop self-duplicates here;
  // main-wins against allLots happens in useSoldArchive's merge, which
  // is the only place that sees phase 2 land AFTER the archive did.
  const seenIds = new Set<string>();
  const merged: AuctionLot[] = [];
  for (const l of archive) {
    if (seenIds.has(l.id)) continue;
    seenIds.add(l.id);
    merged.push(soldComps.has(l.id) ? { ...l, soldComp: soldComps.get(l.id) } : l);
  }
  return merged;
}

function loadSoldArchive() {
  if (inflightArchive || archiveLoadedState) return;
  inflightArchive = true;
  const epoch = bookEpoch;
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
    try {
      const merged = await fetchArchiveFor(core);
      if (epoch !== bookEpoch) return; // a newer book took the screen meanwhile
      cachedArchive = merged;
      archiveLoadedState = true;
      archiveErrorState = false;
      notifyArchive();
    } catch {
      if (epoch !== bookEpoch) return;
      archiveErrorState = true;
      notifyArchive();
    }
  })().finally(() => { if (epoch === bookEpoch) inflightArchive = false; });
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
async function fetchLedgerFor(core: RayPayload | null): Promise<Map<string, LedgerEntry>> {
  const ver = crawlVer(core?.lastCrawl);
  return threeTries(ver, async cache => {
    const idx = await fetchJson(`/data/ray/sold-ledger-index.json${ver}`, { cache }) as { shards: number };
    const nShards = Number(idx?.shards) || 0;
    if (nShards < 1) throw new Error('bad sold-ledger index');
    const parts = await Promise.all(Array.from({ length: nShards }, (_, i) =>
      fetchJson(`/data/ray/sold-ledger-${i}.json${ver}`, { cache }) as Promise<Record<string, LedgerEntry>>));
    const map = new Map<string, LedgerEntry>();
    for (const p of parts) for (const k in p) map.set(k, p[k]);
    return map;
  });
}
function loadSoldLedger() {
  if (inflightLedger || ledgerLoadedState) return;
  inflightLedger = true;
  const epoch = bookEpoch;
  if (ledgerErrorState) { ledgerErrorState = false; notifyLedger(); }
  (async () => {
    let core = cached;
    if (!core) { try { core = await loadRayData(); } catch { core = cached; } }
    try {
      const map = await fetchLedgerFor(core);
      if (epoch !== bookEpoch) return;
      cachedLedger = map; ledgerLoadedState = true; ledgerErrorState = false; notifyLedger();
    } catch {
      if (epoch !== bookEpoch) return;
      ledgerErrorState = true; notifyLedger();
    }
  })().finally(() => { if (epoch === bookEpoch) inflightLedger = false; });
}

// ── A NEW BOOK IN THE SAME VISIT (W25, Oct 11 2026) ─────────────────────────
// public/sw.js broadcasts `{ type: 'lectr-sw', genReady: <ver>, lastCrawl }`
// once a new deploy's phase-1 book sits whole in its cache
// (`lectr-sw1-data-<ver>`). prepareNewBook builds THAT book — the eight files
// from that one cache, never the network — plus every tier this session has
// loaded (the corpus, the sold archive, the ledger, at the new crawl's
// versioned URLs), entirely off-screen. Nothing on screen changes until
// commit(), which swaps every tier in one tick: a page never shows rows of
// two deploys. app/components/ServiceWorker decides WHEN (silently for a
// visitor who has not touched the page, on a tap otherwise).

/** what the tiers on screen need from a new book */
function tiersNow() {
  return {
    full: fullRequested || !!cached?.fullLoaded,
    archive: archiveLoadedState || inflightArchive,
    ledger: ledgerLoadedState || inflightLedger,
  };
}

export interface PreparedBook {
  ver: string;
  lastCrawl: string;
  /** swap it onto the screen; false = the tiers on screen grew since
   *  prepare (call prepareNewBook again) or a newer book already landed */
  commit(): boolean;
}

/** the deploy whose book is on screen ('' = unknown: a build without a
 *  first-screen version) */
export function bookOnScreen(): string {
  return bookVer || fsVersion();
}

const preparing = new Map<string, Promise<PreparedBook | 'adopted' | null>>();

/**
 * Build deploy `ver`'s book off-screen. Resolves:
 *   null       nothing to do (already on screen, no worker cache, a broken
 *              generation, the fallback book shape) — the next visit has it
 *   'adopted'  no book was loaded yet: phase 1 will read `ver` when it runs
 *   PreparedBook  ready to commit
 */
export function prepareNewBook(ver: string): Promise<PreparedBook | 'adopted' | null> {
  if (!ver || ver === bookOnScreen()) return Promise.resolve(null);
  let p = preparing.get(ver);
  if (!p) {
    p = prepareImpl(ver).catch(() => null).finally(() => preparing.delete(ver));
    preparing.set(ver, p);
  }
  return p;
}

async function prepareImpl(ver: string): Promise<PreparedBook | 'adopted' | null> {
  if (!cached && !inflight) {
    // nothing on screen reads the book yet: the first load reads the new one
    if (!(await genBook(ver))) return null;
    if (cached || inflight) return prepareImpl(ver);
    bookSource = ver;
    return 'adopted';
  }
  if (!cached && inflight) { try { await inflight; } catch { /* below */ } }
  if (!cached || !eagerLiveIds) return null; // the fallback book shape never swaps
  if (ver === bookOnScreen()) return null;
  const read = await genBook(ver);
  if (!read) return null;
  const settled = await Promise.allSettled(BOOK_FILES.map(read));
  // a generation the worker stored is whole; a hole means it was evicted or
  // replaced mid-read — no swap (the next visit reads it from the start)
  if (settled[1].status !== 'fulfilled' || settled[2].status !== 'fulfilled') return null;
  const metaData = settled[1].value as MetaJson;
  const built = assembleCore(settled, metaData);
  if (!built) return null;
  const { core, up, closeK } = built;
  const need = tiersNow();
  const upLots = up.lots || [];
  const [full, archive, ledger] = await Promise.all([
    need.full ? loadCorpusFor(up, crawlVer(core.lastCrawl)) : null,
    need.archive ? fetchArchiveFor(core) : null,
    need.ledger ? fetchLedgerFor(core) : null,
  ]);
  const epochAtPrepare = bookEpoch;
  return {
    ver,
    lastCrawl: core.lastCrawl,
    commit() {
      if (bookEpoch !== epochAtPrepare || ver === bookOnScreen()) return false;
      const now = tiersNow();
      if ((now.full && !full) || (now.archive && !archive) || (now.ledger && !ledger)) return false;
      bookEpoch++;
      bookVer = ver;
      bookSource = null;
      inflightFull = false;
      inflightArchive = false;
      inflightLedger = false;
      if (closeK !== undefined) setCloseK(closeK); else resetCloseK();
      eagerLiveIds = new Set(upLots.map(l => l.id));
      const payload: RayPayload = full ? { ...core, allLots: full, fullLoaded: true } : core;
      retryFull = full ? null : makeLoadFull(core, upLots);
      if (archive) { cachedArchive = archive; archiveLoadedState = true; archiveErrorState = false; }
      if (ledger) { cachedLedger = ledger; ledgerLoadedState = true; ledgerErrorState = false; }
      // one tick: every subscriber of every tier re-renders off the new book
      // (the colophon's totals + crawl date too — app/lib/book)
      replaceBookTotals(metaData);
      notify(payload);
      if (archive) notifyArchive();
      if (ledger) notifyLedger();
      return true;
    },
  };
}

/** tests only: drop every module tier back to a cold session */
export function __resetRayDataForTests() {
  cached = null; inflight = null; inflightFull = false; retryFull = null; fullRequested = false;
  eagerLiveIds = null; cachedArchive = null; archiveLoadedState = false; archiveErrorState = false;
  inflightArchive = false; cachedLedger = null; ledgerLoadedState = false; ledgerErrorState = false;
  inflightLedger = false; bookEpoch = 0; bookVer = ''; bookSource = null; preparing.clear();
  phase1Gate = null; openGate = null;
}

/** (r7, QA2 N3/Q9) THE DEMAND READ IS A COMPLETE QUARTER: the build's
 *  series ends on the quarter in progress (a trailing year to today), which
 *  swung on ten days of tape — home printed Pop Culture −20% (Q4, Oct 10)
 *  while Q3 read +8%, and /value's pulse read "2026 Q4". Every surface reads
 *  demand through this hook, so the quarter in progress is dropped here once
 *  (maker-hero completeQuarters — the rule /makers' group heads already use). */
const demandTrim = new WeakMap<object, DemandByMarket>();
const NO_DEMAND: DemandByMarket = {};
function completeDemand(d: DemandByMarket | undefined): DemandByMarket {
  if (!d) return NO_DEMAND;
  const hit = demandTrim.get(d);
  if (hit) return hit;
  const out: DemandByMarket = {};
  for (const k of Object.keys(d) as (keyof DemandByMarket)[]) {
    const s = d[k];
    if (Array.isArray(s)) (out as Record<string, unknown>)[k as string] = completeQuarters(s);
  }
  demandTrim.set(d, out);
  return out;
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

// ── PHASE 0: THE FIRST SCREEN (perf wave W13, Oct 11 2026) ─────────────────
// A route with a first-screen payload (app/lib/first-screen) paints from a
// slice of the book's own rows — tens of KB instead of ~1.6MB — while phase 1
// waits behind a gate, so on a slow phone the slice and the page's code get
// the whole pipe. The gate opens once the first screen has painted (the page
// hook releases it from an effect), when the payload misses, or after
// FS_GATE_MS whatever happens. Phase 1 then loads exactly as before and its
// notify REPLACES the slice for every subscriber.
const FS_GATE_MS = 6000;
let phase1Gate: Promise<void> | null = null;
let openGate: (() => void) | null = null;
/** let phase 1 start (idempotent; a no-op when no first screen armed it) */
export function releasePhase1() {
  if (openGate) { openGate(); openGate = null; }
}
export type FirstScreenData = RayData & {
  /** this view is a first-screen slice: rows and their own numbers are the
   *  book's, but any count over the whole live book is not known yet — print
   *  it as loading ('—'), never as the slice's count */
  partial: boolean;
  /** the whole book's house baselines (a slice must not derive its own) */
  baselineStats: BaselineStats | null;
};
type FsPayload = RayPayload & { baselineStats: BaselineStats };
const fsReady = new Map<string, FsPayload | null>();
const fsPending = new Map<string, Promise<FsPayload | null>>();
/** the slice a page actually painted (the development cross-check reads it) */
let fsShown: { key: string; lots: AuctionLot[] } | null = null;

function payloadToRay(p: FirstScreenPayload): FsPayload {
  if (p.closeK) setCloseK(p.closeK);
  const lots = p.lots;
  const overlayAt = prepareEagerLots(lots, p.closeBoard, p.upGen);
  const up = p.up || {};
  return {
    statsByArtist: {},
    allLots: lots,
    tape: {},
    demand: (up.demand as DemandByMarket | undefined) || {},
    realized: (up.realized as RealizedByMarket | undefined) || {},
    bidComp: (up.bidComp as BidCompByMarket | undefined) || {},
    recentSold: {},
    backtest: (p.backtest as Backtest | null | undefined) ?? null,
    market: (p.market as unknown as MarketData | null | undefined) ?? null,
    receipts: (p.receipts as unknown as ReceiptsData | null | undefined) ?? null,
    lastCrawl: p.meta.lastCrawl || '',
    overlayAt,
    sources: p.meta.sources || [],
    totalLots: p.meta.totalLots,
    totalSold: p.meta.totalSold,
    fullLoaded: false,
    fullError: false,
    error: null,
    baselineStats: p.baselines,
  };
}

/** start a route's first screen (called while the page renders, before any
 *  effect can start phase 1). Never arms once phase 1 is running or done. */
function armFirstScreen(key: string): Promise<FsPayload | null> | null {
  if (cached || (inflight && !phase1Gate)) return null;
  // an adopted newer book (W25) is the one this page paints: this build's
  // slice is the older deploy's, and would be swapped out under the reader
  if (bookSource) return null;
  if (!phase1Gate) {
    phase1Gate = new Promise<void>(res => { openGate = res; });
    setTimeout(releasePhase1, FS_GATE_MS);
  }
  let p = fsPending.get(key);
  if (!p) {
    p = fetchFirstScreen(key).then(j => {
      const r = j ? payloadToRay(j) : null;
      fsReady.set(key, r);
      if (!r) releasePhase1();
      return r;
    });
    fsPending.set(key, p);
  }
  return p;
}

/**
 * useRayData() for a route that can paint its FIRST SCREEN from a slice
 * (`key` from app/lib/first-screen fsKeyOf; null = no slice, plain
 * useRayData). Until phase 1 lands it returns the slice with
 * `partial: true` and `loading: false`; from then on, the whole book.
 * Only the page that asked sees the slice — every other useRayData()
 * consumer keeps its loading state until the book lands.
 */
export function useRayDataFirst(key: string | null): FirstScreenData {
  // armed DURING render: a child's effect may start phase 1 before ours runs
  const pending = key ? armFirstScreen(key) : null;
  const base = useRayDataImpl(true);
  const [fs, setFs] = useState<FsPayload | null>(() => (key ? fsReady.get(key) ?? null : null));
  useEffect(() => {
    if (!pending || fs) return;
    let on = true;
    pending.then(r => { if (on && r) setFs(r); });
    return () => { on = false; };
  }, [pending, fs]);
  const partial = base.loading && !!fs;
  // the first screen is on screen: let the book come
  useEffect(() => {
    if (!partial || !fs || !key) return;
    if (!fsShown || fsShown.key !== key) fsShown = { key, lots: fs.allLots };
    const raf = requestAnimationFrame(() => { setTimeout(releasePhase1, 0); });
    return () => cancelAnimationFrame(raf);
  }, [partial, fs, key]);
  if (!partial || !fs) return { ...base, partial: false, baselineStats: null };
  return fsView(fs);
}

/** the view a page paints from a first-screen slice — ONE shape for the
 *  live hook (useRayDataFirst) and the build's prerendered first paint
 *  (app/components/FirstPaint), so the two can never drift */
function fsView(fs: FsPayload): FirstScreenData {
  return {
    statsByArtist: fs.statsByArtist,
    allLots: fs.allLots,
    tape: fs.tape,
    demand: completeDemand(fs.demand),
    realized: fs.realized,
    bidComp: fs.bidComp,
    recentSold: fs.recentSold,
    backtest: fs.backtest,
    market: fs.market,
    receipts: fs.receipts,
    lastCrawl: fs.lastCrawl,
    overlayAt: fs.overlayAt,
    sources: fs.sources,
    totalLots: fs.totalLots,
    totalSold: fs.totalSold,
    loading: false,
    fullLoaded: false,
    fullError: false,
    error: null,
    fromCache: false,
    partial: true,
    baselineStats: fs.baselineStats,
  };
}

/** a first-screen payload as the page paints it (app/components/FirstPaint) */
export function firstScreenView(p: FirstScreenPayload): FirstScreenData {
  return fsView(payloadToRay(p));
}

/** the house baselines a page passes its feed: the whole book's — from the
 *  slice's shipped stats while partial, else off the loaded book */
export function useHouseBaselines(ray: Pick<FirstScreenData, 'allLots' | 'partial' | 'baselineStats'>): HouseBaselines {
  const { allLots, partial, baselineStats } = ray;
  return useMemo(
    () => (partial && baselineStats ? baselinesFromStats(baselineStats, localToday()) : houseBaselines(allLots)),
    [allLots, partial, baselineStats],
  );
}

export function useRayData(): RayData {
  return useRayDataImpl(true);
}

/** The same view as useRayData(), but it never STARTS the phase-1 load on
 *  its own until `enabled`: it subscribes, so it fills the moment any other
 *  surface (or a later `enabled`) loads the book. For chrome mounted on every
 *  page — the ⌘K palette, closed — so a page that reads no live data (/about,
 *  /blog) never pays the ~1.7 MB eager payload for a palette nobody opened
 *  (perf wave W1, Oct 11). */
export function useRayDataWhen(enabled: boolean): RayData {
  return useRayDataImpl(enabled);
}

function useRayDataImpl(load: boolean): RayData {
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
    // a payload that landed between render and subscribe still reaches us
    if (load || cached || inflight) loadRayData().then(listener);
    return () => { active = false; listeners.delete(listener); };
  }, [load]);

  return {
    statsByArtist: data?.statsByArtist || {},
    allLots: data?.allLots || EMPTY_LOTS,
    tape: data?.tape || {},
    demand: completeDemand(data?.demand),
    realized: data?.realized || {},
    bidComp: data?.bidComp || {},
    recentSold: data?.recentSold || {},
    backtest: data?.backtest || null,
    market: data?.market || null,
    receipts: data?.receipts || null,
    lastCrawl: data?.lastCrawl || '',
    overlayAt: data?.overlayAt,
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

/** The on-demand shape of the phase-2 tier: everything useRayData() returns,
    plus the trigger and its request state — so a surface can hold the corpus
    back until a section that actually reads it is reachable. */
export interface OnDemandLots extends RayData {
  /** a surface has ASKED for the corpus this session. NOT arrival — the
      fetch may still be in flight; `fullLoaded` is arrival. */
  fullRequested: boolean;
  /** ask for the corpus now. Idempotent per session; safe from an event
      handler, an effect, or an IntersectionObserver callback. */
  requestFullLots: () => void;
}

/**
 * THE ONE LAZY MECHANISM (Sep 2026 perf pass).
 *
 * `useFullLots()` streams the entire sold corpus (14 `lots-*.json` shards,
 * ~257MB raw / ~35MB brotli) the moment it mounts. Four surfaces paid that on
 * FIRST PAINT — /profile, /lot/*, /makers, /receipts — for figures most
 * visits never reach (a signed-out desk, a lot whose certificate already
 * resolved from Supabase, a maker face photo, a settled-flags tape three
 * screens down). This hook is the same tier, DEMAND-DRIVEN:
 *
 *   const { allLots, fullLoaded, fullRequested, requestFullLots } =
 *     useFullLotsOnDemand(needItNow);
 *
 * `enabled` requests immediately — pass a CHEAP, CORPUS-FREE predicate ("this
 * desk has saved lots", "this lot carries no stamped engine call"). The
 * returned trigger covers everything else: a section scrolling into view
 * (useVisibilityTrigger below), a dossier opening, a hover pre-warm.
 *
 * The eager `useFullLots()` is unchanged for callers that legitimately need
 * the corpus at mount (/analytics, /makers/[slug], ComparableModal), and
 * `retryFullLoad()` still works from either.
 *
 * HONESTY LAW: `fullRequested` is not `fullLoaded`. Any count, median or
 * total derived from the corpus must still gate on `fullLoaded` — a pool that
 * is still arriving must abstain (quiet loading state), never print small.
 */
export function useFullLotsOnDemand(enabled = false): OnDemandLots {
  const base = useRayData();
  // seeded from the module flag so a second surface in the same session
  // (or a warm back-nav) renders its arrived state rather than replaying a
  // "not asked yet" frame
  const [requested, setRequested] = useState(() => fullRequested);
  const requestFullLots = useCallback(() => {
    triggerFullLoad();
    setRequested(true);
  }, []);
  useEffect(() => { if (enabled) requestFullLots(); }, [enabled, requestFullLots]);
  return { ...base, fullRequested: requested, requestFullLots };
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
  const allLotsWithArchive = useMemo(() => {
    if (!state.soldArchive.length) return base.allLots;
    // MAIN WINS: an id present in the main pool (eager lots, then the phase-2
    // shards once they land) is dropped from the archive side — the main row
    // carries the live signal/bid state and the archive copy is stale history
    // of the same lot. Recomputed only when either pool changes.
    const mainIds = new Set<string>();
    for (const l of base.allLots) mainIds.add(l.id);
    const archiveOnly = state.soldArchive.filter(l => !mainIds.has(l.id));
    return [...base.allLots, ...archiveOnly];
  }, [base.allLots, state.soldArchive]);
  return {
    soldArchive: state.soldArchive,
    archiveLoaded: state.archiveLoaded,
    archiveError: state.archiveError,
    allLotsWithArchive,
  };
}

/** tests only: phase 1 as the hooks start it */
export function __loadRayDataForTests(): Promise<unknown> {
  return loadRayData();
}
