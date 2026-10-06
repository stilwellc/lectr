/**
 * demand.ts — the Demand Index: how the typical sale performs against its own
 * estimate, trailing twelve months, evaluated at each quarter.
 *
 * This is the mix-proof market read. Price-level series are hostage to WHAT
 * sold (a quarter of prints vs a quarter of canvases); performance-vs-estimate
 * normalizes every lot by its own ask, so a $900 print selling 60% over and a
 * $3M canvas selling 60% over count identically. Houses set estimates tracking
 * prices, which makes over-estimate performance the LEADING demand signal —
 * price levels follow. Median (not mean) keeps single freak results out.
 */
import { AuctionLot, RealizedPoint, BidCompetitionPoint } from '../types';
import { isSportsScienceObject, sportsForm, classifyForm } from './comps';
import { medianSorted } from './stats';
import { inferHammerUsd } from './premiums';

export interface DemandPoint {
  date: string;
  /** median % over estimate midpoint for the trailing year, e.g. +46 */
  value: number;
  /** sales with estimates inside the window */
  n: number;
}

const MIN_WINDOW_SALES = 5;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

type DemandLot = Pick<AuctionLot, 'status' | 'priceUsd' | 'saleDate' | 'estimateLow' | 'estimateHigh' | 'estLowUsd' | 'estHighUsd' | 'auctionHouse'> & {
  hammerUsd?: number | null; realizedUsd?: number | null; buyerPremiumPct?: number | null;
};

/**
 * THE demand-read primitive: a sold lot's HAMMER-basis % over its estimate
 * midpoint, or null when the lot cannot be read. Every demand read — the
 * market hero curve (demandSeries, via build-upcoming) and the sub-market /
 * drill rows (scripts/sub-markets.ts) — goes through here, so one lot can
 * never read two different numbers on two surfaces.
 *
 * BASIS (Oct 2026): hammer vs estimate. Houses quote estimates on hammer;
 * the published sold price carries the buyer's premium (~20–28%), so the old
 * all-in read sat ~25–30pts above a like-for-like comparison (art TTM: +28%
 * all-in vs ~0% hammer). The hammer is the published one where the house
 * prints it, else realized ÷ the lot's OWN premium schedule
 * (premiums.inferHammerUsd — stamped premium, then the house schedule in
 * force on the sale date). The Aug 4 all-in call was made because only a
 * flat ÷1.25 existed; the real per-house schedules are wired now.
 *
 * RANGE ESTIMATES ONLY: a single-figure estimate (RR Auction's "$500+",
 * stored low-only) is a FLOOR, not a midpoint — reading it as the mid
 * inflated culture's demand to ~+37% when the range-estimate tape read ~+5%.
 * Single-figure lots are dropped from the midpoint math (and from the
 * coverage that gates a demand read — see sub-markets.ts hasRangeEstimate).
 */
export function hammerOverEstimatePct(l: DemandLot): number | null {
  const lo = (l.estLowUsd ?? l.estimateLow) || 0;
  const hi = (l.estHighUsd ?? l.estimateHigh) || 0;
  if (!(lo > 0) || !(hi > 0)) return null;
  const mid = (lo + hi) / 2;
  const hammer = inferHammerUsd(l);
  if (!(hammer > 0)) return null;
  return (hammer / mid - 1) * 100;
}

/** a lot whose estimate is a real RANGE (both bounds) — the only kind the
 *  demand read can midpoint */
export function hasRangeEstimate(l: Pick<AuctionLot, 'estimateLow' | 'estimateHigh' | 'estLowUsd' | 'estHighUsd'>): boolean {
  return ((l.estLowUsd ?? l.estimateLow) || 0) > 0 && ((l.estHighUsd ?? l.estimateHigh) || 0) > 0;
}

/**
 * Quarterly demand: median hammerOverEstimatePct over the trailing twelve
 * calendar months, evaluated at each quarter end — and for the IN-PROGRESS
 * quarter, at `now` (the window always spans a true twelve months: the old
 * read ended the current quarter's window at the quarter's future end, so
 * on Oct 5 the "2026 Q4" point was really Jan 1 → today, nine months wearing
 * a trailing-year label). Sales dated after `now` are dropped.
 */
export function demandSeries(lots: DemandLot[], opts: { now?: number } = {}): DemandPoint[] {
  const now = opts.now ?? Date.now();
  const sales: { t: number; perf: number }[] = [];
  // quarter key -> exclusive end of that quarter's window (first ms of the
  // next quarter, clamped to now for the quarter in progress)
  const quarterEnd: Record<string, number> = {};
  for (const l of lots) {
    if (l.status !== 'sold') continue;
    const perf = hammerOverEstimatePct(l);
    if (perf == null) continue;
    const d = new Date(l.saleDate);
    const t = d.getTime();
    if (isNaN(t) || t > now) continue;
    const q = Math.floor(d.getUTCMonth() / 3);
    const key = `${d.getUTCFullYear()} Q${q + 1}`;
    sales.push({ t, perf });
    quarterEnd[key] = quarterEnd[key] ?? Math.min(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1), now + 1);
  }
  const quarters = Object.keys(quarterEnd).sort();
  const points: DemandPoint[] = [];
  for (const qk of quarters) {
    // Trailing twelve CALENDAR months from the window end — never adjacent
    // array keys. A sparse vertical can have years-old quarters sitting right
    // next to current ones; slicing keys would smuggle decade-old sales into
    // a "trailing year" read.
    const end = quarterEnd[qk];
    const window = sales
      .filter(s => s.t < end && s.t >= end - YEAR_MS)
      .map(s => s.perf)
      .sort((a, b) => a - b);
    if (window.length < MIN_WINDOW_SALES) continue;
    points.push({ date: qk, value: medianSorted(window), n: window.length });
  }
  return points;
}

export function formatDemand(n: number): string {
  const r = Math.round(n);
  return `${r >= 0 ? '+' : ''}${r}%`;
}

/* ══════════════════════════════════════════════════════════════════════════
   REALIZED-COHORT SERIES (W8) — the honest sports read.

   Goldin publishes no estimates, so the Demand Index above (median % over
   estimate) cannot run on sports — and a raw all-sports median is pure mix
   noise (a $6 ticket and a $4M jersey in the same quarter). Instead: a
   quarterly MEDIAN REALIZED PRICE inside a TIGHT like-for-like cohort (a
   single object-slug + a price band), so every point compares the same kind
   of object. Typed distinctly (RealizedPoint, a `$` level) from DemandPoint (a
   `%`) so the two can never be rendered through the same caption.

   This reuses demandSeries's trailing-calendar-window + quarter-key SHAPE but
   does NOT call or edit demandSeries — it is a separate, additive path.
   ══════════════════════════════════════════════════════════════════════════ */

export interface RealizedCohortOpts {
  /** the object-slug the cohort is drawn from (carried as lot.artist), e.g.
      'tickets-passes'. Required — a cohort is single-slug by construction. */
  slug: string;
  /** inclusive price band bounding the cohort, e.g. [100, 2000]. Points below
      MIN_COHORT_QUARTER within-band sales are dropped. */
  band: [number, number];
  /** optional sports Form filter (e.g. 'sports-jersey') to tighten further. */
  form?: string;
  /** evaluation "now" — defaults to Date.now(). Sales after it are clamped out
      (kills phantom future rows). */
  now?: number;
}

const MIN_COHORT_QUARTER = 15;

const CULTURE_COHORT_SLUGS = new Set(['entertainment-memorabilia', 'music-memorabilia', 'movie-tv']);

export function realizedCohortSeries(lots: AuctionLot[], opts: RealizedCohortOpts): RealizedPoint[] {
  const now = opts.now ?? Date.now();
  const [lo, hi] = opts.band;
  const sales: { t: number; price: number }[] = [];
  const quarterEnd: Record<string, number> = {};

  for (const l of lots) {
    if (l.status !== 'sold' || !l.priceUsd) continue;
    if (l.artist !== opts.slug) continue;
    // gate every cohort member through the single choke point — widened for
    // the culture realized cohorts (the same category:'object' discipline;
    // sports/science paths are unchanged because the slug filter above
    // already scoped the pool)
    const cultureObject = l.category === 'object' && CULTURE_COHORT_SLUGS.has(l.artist);
    if (!isSportsScienceObject(l) && !cultureObject) continue;
    if (opts.form) {
      const f = sportsForm(l) ?? classifyForm(l);
      if (f !== opts.form) continue;
    }
    if (l.priceUsd < lo || l.priceUsd > hi) continue;
    const d = new Date(l.saleDate);
    if (isNaN(d.getTime())) continue;
    const t = d.getTime();
    if (t > now) continue; // clamp future/phantom rows
    const q = Math.floor(d.getUTCMonth() / 3);
    const key = `${d.getUTCFullYear()} Q${q + 1}`;
    sales.push({ t, price: l.priceUsd });
    quarterEnd[key] = quarterEnd[key] ?? Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1);
  }

  const quarters = Object.keys(quarterEnd).sort();
  const points: RealizedPoint[] = [];
  for (const qk of quarters) {
    const end = quarterEnd[qk];
    // trailing twelve CALENDAR months (same discipline as demandSeries — never
    // adjacent array keys), clamped so we never read past 'now'
    if (end - YEAR_MS > now) continue;
    const window = sales
      .filter(s => s.t < end && s.t >= end - YEAR_MS)
      .map(s => s.price)
      .sort((a, b) => a - b);
    if (window.length < MIN_COHORT_QUARTER) continue;
    const m = Math.floor(window.length / 2);
    const med = window.length % 2 === 0 ? (window[m - 1] + window[m]) / 2 : window[m];
    points.push({ date: qk, value: med, n: window.length });
  }

  // isStale gate: if the newest quarter's trailing window closed more than a
  // year before 'now', the cohort has gone dark — emit nothing rather than a
  // stale flat line pretending to be current.
  if (points.length) {
    const lastEnd = quarterEnd[points[points.length - 1].date];
    if (now - lastEnd > YEAR_MS) return [];
  }

  return points;
}

/* ══════════════════════════════════════════════════════════════════════════
   BID-COMPETITION SERIES — the honest cards demand read.

   Goldin publishes NO house estimate, so neither the Demand Index (%-over-
   estimate) nor a hedonic move can run on the cards vertical — but every Goldin
   lot carries `bidCount`, the number of bids it drew. That is a genuine DEMAND
   primitive: how much competitive tension the object attracted. This series is
   the quarterly MEDIAN bidCount per SOLD lot, over the same trailing-twelve-
   calendar-month window + quarter-key discipline as demandSeries/
   realizedCohortSeries (never adjacent array keys).

   Coverage (measured on the full corpus, sports-cards slug): 288,237 sold lots,
   287,834 (99.9%) carry bidCount>0, spanning 2022-07 → 2026-07 — so sold lots
   RETAIN a final bidCount and a real SERIES over time is supported (not just a
   live-book snapshot). Quarterly median steps ~8 → ~21 bids/lot across 2023→2026.

   WHAT IT IS NOT — the honesty doctrine:
   - NOT a price return, NOT %-over-estimate, NOT appreciation. `value` is a bare
     bids-per-lot count (typed BidCompetitionPoint, distinct from the `%`
     DemandPoint and the `$` RealizedPoint) so it can never render through a
     price/percent caption.
   LIMITS:
   - A SOLD lot's final bidCount is the whole auction's competition on that lot,
     not a live snapshot — it measures realized tension, not current book depth.
   - More bids/lot need not mean higher prices: a flood of cheap lots can draw
     many small competing bids. It reads competitive INTEREST, not value.
   - Goldin-only (the only house that ships bidCount); it describes the bid-
     auction cards market, not the estimate houses' curated-sale cards.

   This is ADDITIVE — it does not call, edit, or feed demandSeries or the CI'd
   repeat-sale index; it is a separate demand signal alongside them.
   ══════════════════════════════════════════════════════════════════════════ */

export interface BidCompetitionOpts {
  /** the object-slug the series is drawn from (carried as lot.artist), e.g.
      'sports-cards'. Required — the read is single-slug by construction. */
  slug: string;
  /** evaluation "now" — defaults to Date.now(). Sales after it are clamped out. */
  now?: number;
}

// per-quarter trailing-window floor — same gate spirit as demandSeries; bid
// auctions are high-volume so this clears easily on any live quarter.
const MIN_BIDCOMP_QUARTER = 15;

export function bidCompetitionSeries(lots: AuctionLot[], opts: BidCompetitionOpts): BidCompetitionPoint[] {
  const now = opts.now ?? Date.now();
  const sales: { t: number; bids: number }[] = [];
  const quarterEnd: Record<string, number> = {};

  for (const l of lots) {
    if (l.status !== 'sold' || l.artist !== opts.slug) continue;
    const bids = (l as { bidCount?: number }).bidCount ?? 0;
    if (!(bids > 0)) continue; // only lots that actually drew bids
    const d = new Date(l.saleDate);
    if (isNaN(d.getTime())) continue;
    const t = d.getTime();
    if (t > now) continue; // clamp future/phantom rows
    const q = Math.floor(d.getUTCMonth() / 3);
    const key = `${d.getUTCFullYear()} Q${q + 1}`;
    sales.push({ t, bids });
    quarterEnd[key] = quarterEnd[key] ?? Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1);
  }

  const quarters = Object.keys(quarterEnd).sort();
  const points: BidCompetitionPoint[] = [];
  for (const qk of quarters) {
    const end = quarterEnd[qk];
    if (end - YEAR_MS > now) continue;
    const window = sales
      .filter(s => s.t < end && s.t >= end - YEAR_MS)
      .map(s => s.bids)
      .sort((a, b) => a - b);
    if (window.length < MIN_BIDCOMP_QUARTER) continue;
    const m = Math.floor(window.length / 2);
    const med = window.length % 2 === 0 ? (window[m - 1] + window[m]) / 2 : window[m];
    points.push({ date: qk, value: med, n: window.length });
  }

  // isStale gate (mirrors realizedCohortSeries): a series whose freshest quarter
  // closed over a year before 'now' has gone dark — emit nothing rather than
  // wear a stale count as today's read.
  if (points.length) {
    const lastEnd = quarterEnd[points[points.length - 1].date];
    if (now - lastEnd > YEAR_MS) return [];
  }

  return points;
}

/** Format a bids-per-lot count for display — e.g. "21 bids/lot". Never a % or $. */
export function formatBidComp(n: number): string {
  return `${Math.round(n)} bids/lot`;
}
