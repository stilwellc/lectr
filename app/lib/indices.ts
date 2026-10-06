/**
 * indices.ts — market performance over time, computed to be TRUE at the data's
 * density. Individual-lot valuation is noisy; AGGREGATES are robust, so this is
 * where "tracking markets over time" honestly lives. Every series carries its
 * method and n, and thin cohorts are suppressed rather than faked.
 *
 * Four series per market (and per maker where dense):
 *  1. price index — like-for-like cohort median over time (Case-Shiller-lite
 *     via repeat/model cohorts where present; else tight cohort medians).
 *  2. volume — count of sold lots per period.
 *  3. sell-through — sold / (sold + bought_in): real market-health signal from
 *     the 6,097 bought-in lots almost nobody publishes.
 *  4. house accuracy — realized vs the house's own estimate mid, per period:
 *     "the houses ran their art estimates N% light."
 */
import type { AuctionLot } from '../types';
import { inferHammerUsd } from './premiums';
import { median as statsMedian, weightedMedian } from './stats';
import { knownKey, quarterKey, type TimeIndex, type HouseBias } from './value';

export interface IndexPoint { period: string; value: number; n: number; }
export interface MarketSeries {
  method: string;
  label: string;
  index: IndexPoint[];          // rebased to 100 at the first point
  volume: IndexPoint[];
  sellThrough: IndexPoint[];    // 0–100
  houseAccuracy: IndexPoint[];  // realized/est-mid median, per period (>1 = houses light)
  n: number;
  analytics?: import('../types').MarketAnalytics;  // build-time distribution aggregates (full corpus)
}

const QUARTER = (d: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(d);
  if (!m) return null;
  return `${m[1]} Q${Math.ceil(+m[2] / 3)}`;
};
/** stats.median with this module's historical 0-on-empty contract */
const median = (a: number[]) => {
  const m = statsMedian(a);
  return Number.isNaN(m) ? 0 : m;
};

/** A tight like-for-like cohort key: same maker + form + coarse size band.
 *  Sport cards carry no form/size (they're a lean data asset) — cohort them by
 *  sport instead, so the index tracks per-sport card price movement rather than
 *  lumping 300k cards into one meaningless blob. */
function cohortKey(l: AuctionLot): string {
  if (l.artist === 'sports-cards') return `sports-cards|${(l as { sport?: string | null }).sport || 'na'}`;
  const size = l.sizeClass || 'na';
  return `${l.artist}|${l.formKey || l.category}|${size}`;
}

const MIN_PER_QUARTER = 8;   // below this a quarter's median is noise → dropped

/**
 * Build the four series for a set of a market's lots. Quarterly granularity
 * (monthly is too sparse for stable medians on this corpus). The index is a
 * chained cohort-median: within each cohort, quarter-over-quarter median-price
 * relatives, geometric-averaged across cohorts, chained and rebased to 100 —
 * so a shift in WHICH lots sell (a whale quarter) can't masquerade as a market
 * move.
 */
export function buildMarketSeries(lots: AuctionLot[], label: string): MarketSeries {
  const soldPriced = lots.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate);

  // ── volume + sell-through ──
  // volume counts ALL sold (cards included — the real market size). sell-through
  // EXCLUDES cards: we only ingest SOLD cards (Goldin publishes no bought-in for
  // them), so counting them would read a false 100%. Objects have real
  // sold+bought_in, so their sell-through stays honest.
  const volByQ = new Map<string, number>();
  const soldByQ = new Map<string, number>();
  const biByQ = new Map<string, number>();
  for (const l of lots) {
    const q = QUARTER(l.saleDate); if (!q) continue;
    if (l.status === 'sold' && (l.realizedUsd || 0) > 0) {
      volByQ.set(q, (volByQ.get(q) || 0) + 1);
      if (l.artist !== 'sports-cards') soldByQ.set(q, (soldByQ.get(q) || 0) + 1);
    } else if (l.status === 'bought_in') {
      biByQ.set(q, (biByQ.get(q) || 0) + 1);
    }
  }
  const quarters = Array.from(volByQ.keys()).sort();
  const volume = quarters.map(q => ({ period: q, value: volByQ.get(q) || 0, n: volByQ.get(q) || 0 }));
  const sellThrough = Array.from(new Set(Array.from(soldByQ.keys()).concat(Array.from(biByQ.keys())))).sort().map(q => {
    const s = soldByQ.get(q) || 0, b = biByQ.get(q) || 0, tot = s + b;
    return { period: q, value: tot >= 6 ? Math.round((s / tot) * 100) : 0, n: tot };
  }).filter(p => p.n >= 6);

  // ── house accuracy ──
  // HAMMER basis: estimates are hammer-basis while realized is premium-inclusive
  // (~1.25×), so realized/mid ran ~1.18 from premium alone and could never say
  // the houses "missed". hammerUsd where published, else realized ÷ the
  // per-house premium schedule (app/lib/premiums.inferHammerUsd).
  const accByQ = new Map<string, number[]>();
  for (const l of soldPriced) {
    if (!l.estLowUsd || !l.estHighUsd) continue;
    const mid = (l.estLowUsd + l.estHighUsd) / 2;
    if (!(mid > 0)) continue; // guard against corrupt (negative/zero) estimates
    const q = QUARTER(l.saleDate); if (!q) continue;
    // ONE hammer inference (premiums.inferHammerUsd): published hammer, else
    // realized ÷ the lot's own premium factor — never a flat /1.25 (P1-5)
    const hammer = inferHammerUsd(l as { auctionHouse?: string | null; buyerPremiumPct?: number | null; hammerUsd?: number | null; realizedUsd?: number | null });
    if (!(hammer > 0)) continue;
    (accByQ.get(q) || accByQ.set(q, []).get(q)!).push(hammer / mid);
  }
  const houseAccuracy = Array.from(accByQ.entries()).filter(([, v]) => v.length >= MIN_PER_QUARTER)
    .map(([q, v]) => ({ period: q, value: +median(v).toFixed(2), n: v.length }))
    .sort((a, b) => a.period.localeCompare(b.period));

  // ── chained cohort-median price index ──
  // cohort → quarter → median price
  const cohorts = new Map<string, Map<string, number[]>>();
  for (const l of soldPriced) {
    const q = QUARTER(l.saleDate); if (!q) continue;
    const ck = cohortKey(l);
    const cm = cohorts.get(ck) || cohorts.set(ck, new Map()).get(ck)!;
    (cm.get(q) || cm.set(q, []).get(q)!).push(l.realizedUsd!);
  }
  // FIXED-BASE, drift-free: normalize each stable cohort to its OWN long-run
  // median, then average the relatives per quarter. A cohort trading above its
  // own average lifts the index; one below drags it. No chaining → no compounding
  // drift. Only cohorts with real depth (≥8 sales across ≥3 quarters) count, so
  // a thin cohort can't swing the market.
  const RECENT_Q = 24;
  const recentSet = new Set(quarters.slice(-RECENT_Q));
  const cohortAvg = new Map<string, number>();          // cohort → its median over the window
  const cohortQMed = new Map<string, Map<string, number>>();
  for (const [ck, cm] of Array.from(cohorts.entries())) {
    const all: number[] = [];
    const qmed = new Map<string, number>();
    let quartersSeen = 0;
    for (const [q, arr] of Array.from(cm.entries())) {
      if (arr.length < 3) continue;
      qmed.set(q, median(arr)); for (const x of arr) all.push(x); quartersSeen++; // (loop, not push(...arr): a spread past ~120k args overflows the call stack)
    }
    if (all.length >= 8 && quartersSeen >= 3) { cohortAvg.set(ck, median(all)); cohortQMed.set(ck, qmed); }
  }
  const index: IndexPoint[] = [];
  for (const q of quarters) {
    if (!recentSet.has(q)) continue;
    const rels: number[] = [];
    for (const [ck, base] of Array.from(cohortAvg.entries())) {
      const m = cohortQMed.get(ck)!.get(q);
      if (m && base > 0) rels.push(m / base);
    }
    if (rels.length >= 3 && (volByQ.get(q) || 0) >= MIN_PER_QUARTER) {
      const geo = Math.exp(rels.reduce((s, r) => s + Math.log(r), 0) / rels.length);
      index.push({ period: q, value: geo, n: volByQ.get(q) || 0 });
    }
  }
  // rebase to 100 at the window start
  if (index.length) { const base0 = index[0].value; for (const p of index) p.value = p.value / base0 * 100; }
  // 3-quarter trailing smooth — auction prices are quarter-lumpy; the average
  // makes the trend legible without hiding a real move (labeled as smoothed).
  const smoothed = index.map((p, i) => {
    const win = index.slice(Math.max(0, i - 2), i + 1);
    return { ...p, value: Math.round(win.reduce((s, x) => s + x.value, 0) / win.length) };
  });
  index.length = 0; for (const p of smoothed) index.push(p);

  const method = index.length >= 4
    ? 'like-for-like cohort index (maker × form × size, each normalized to its own average), 3-quarter smoothed'
    : 'insufficient like-for-like depth for a price index';

  return { method, label, index, volume, sellThrough, houseAccuracy, n: soldPriced.length };
}

/* ── THE TIME INDEX (Sep 27 2026 engine pass) ─────────────────────────────
   The comp time-adjustment's index: the SAME fixed-base cohort method as the
   dashboard series above (maker × form × size cohorts, each normalized to its
   own median over the window, geometric mean of the relatives per quarter,
   3-quarter trailing smooth) — but POINT-IN-TIME: an index built for `asOf`
   reads only sales KNOWN before asOf (value.knownKey — month/year-precision
   dates count from the end of their period; year-precision sales carry no
   quarter and never enter), never a `compExclude` lot, and its levels stop
   at the last complete quarter before asOf's own. The backtest replay
   rebuilds it at every quarter boundary; build-market builds it for today. */
type TIRow = { q: string; k: string; ck: string; p: number };
const TI_WINDOW_Q = 24;
const TI_MIN_COHORT_Q = 3;
const TI_MIN_Q_N = 8;
const TI_EXCLUDED = new Set(['sports-cards', 'graded-cards', 'pokemon']);

/** the n quarters strictly before fromQ ('2026Q3'), ascending */
function quarterSeq(fromQ: string, n: number): string[] {
  let y = +fromQ.slice(0, 4), q = +fromQ.slice(5);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { q--; if (q < 1) { q = 4; y--; } out.push(`${y}Q${q}`); }
  return out.reverse();
}

/** Pre-bucket the corpus once; the returned function builds the index for any
 *  asOf in O(rows). */
export function makeTimeIndexer(lots: AuctionLot[], marketBySlug: Record<string, string>): (asOf: string) => TimeIndex {
  const byMarket = new Map<string, TIRow[]>();
  for (const l of lots) {
    if (l.status !== 'sold' || !((l.realizedUsd || 0) > 0) || !l.saleDate) continue;
    // the index adjusts HEDONIC comps, so it is built from the engine's own
    // population — never the mass-produced card slugs (300k+ cards would
    // otherwise BE the sports index) or the thin algolia backfill
    if (TI_EXCLUDED.has(l.artist) || (l as AuctionLot & { source?: string }).source === 'sothebys-algolia') continue;
    const lx = l as AuctionLot & { datePrecision?: string | null; compExclude?: string | null };
    if (lx.compExclude || lx.datePrecision === 'year' || lx.datePrecision === 'unknown') continue;
    const m = marketBySlug[l.artist];
    if (!m) continue;
    const q = quarterKey(l.saleDate);
    if (!q) continue;
    const arr = byMarket.get(m) || byMarket.set(m, []).get(m)!;
    arr.push({ q, k: knownKey(lx), ck: cohortKey(l), p: l.realizedUsd! });
  }
  return (asOf: string): TimeIndex => {
    const asOfQ = quarterKey(asOf);
    const window = new Set(quarterSeq(asOfQ, TI_WINDOW_Q));
    const levels: Record<string, Record<string, number>> = {};
    const lastQ: Record<string, string> = {};
    byMarket.forEach((rows, m) => {
      const cohorts = new Map<string, Map<string, number[]>>();
      const volByQ = new Map<string, number>();
      for (const r of rows) {
        if (!window.has(r.q) || !(r.k < asOf)) continue;
        const cm = cohorts.get(r.ck) || cohorts.set(r.ck, new Map()).get(r.ck)!;
        (cm.get(r.q) || cm.set(r.q, []).get(r.q)!).push(r.p);
        volByQ.set(r.q, (volByQ.get(r.q) || 0) + 1);
      }
      const rels = new Map<string, number[]>();
      cohorts.forEach(cm => {
        const all: number[] = [];
        const qmed = new Map<string, number>();
        cm.forEach((arr, q) => { if (arr.length >= 3) { qmed.set(q, median(arr)); for (const x of arr) all.push(x); } });
        if (all.length < 8 || qmed.size < TI_MIN_COHORT_Q) return;
        const base = median(all);
        if (!(base > 0)) return;
        qmed.forEach((v, q) => { if (v > 0) (rels.get(q) || rels.set(q, []).get(q)!).push(Math.log(v / base)); });
      });
      const raw: { q: string; v: number }[] = [];
      for (const q of Array.from(window).sort()) {
        const r = rels.get(q);
        if (!r || r.length < 3 || (volByQ.get(q) || 0) < TI_MIN_Q_N) continue;
        raw.push({ q, v: Math.exp(r.reduce((s, x) => s + x, 0) / r.length) });
      }
      if (raw.length < 4) return;
      const lv: Record<string, number> = {};
      raw.forEach((p, i) => {
        const win = raw.slice(Math.max(0, i - 2), i + 1);
        lv[p.q] = win.reduce((s, x) => s + x.v, 0) / win.length;
      });
      levels[m] = lv;
      lastQ[m] = raw[raw.length - 1].q;
    });
    return { asOf, marketBySlug, levels, lastQ };
  };
}

/** One-shot time index for `asOf` (see makeTimeIndexer). */
export function buildTimeIndex(lots: AuctionLot[], marketBySlug: Record<string, string>, asOf: string): TimeIndex {
  return makeTimeIndexer(lots, marketBySlug)(asOf);
}

/* ── THE HOUSE-BIAS INDEX (Oct 3 2026 engine pass) ────────────────────────
   Each house prints its estimates with its own habit: RR Auction posts a
   single low "$500+" by policy and clears ~3× it; the big three band their
   estimates to sell through. The Flags compare comps to the estimate, so an
   un-normalized flag partly reads the house's POLICY, not the lot (Oct 3
   audit: the top-50 Flags were 50/50 RR lots at 3–8×). This index learns the
   habit POINT-IN-TIME: the recency-weighted median of log(realized all-in /
   estimate mid) over sales KNOWN strictly before `asOf` (value.knownKey),
   per estimate kind (band 'b' / single-point 'p'), in a shrinkage ladder
     global:et → market:et, house:et → market×house:et
   (each cell shrunk toward its parent by HB_K effective weight). Read through
   value.houseFactorOf as a multiplier RELATIVE TO THE GLOBAL BAND HABIT, so a
   typical band-estimate house reads ≈1 and the flag ratio is unchanged
   there. Never a `compExclude` lot, never an undated/year-precision sale. */
type HBRow = { k: string; m: string; h: string; et: 'b' | 'p'; y: number; sf: boolean };
const HB_WINDOW_Y = 6;
const HB_HL_Y = 2;
const HB_K = 20;
const HB_MIN_N = 10;

/** Pre-bucket every sold estimate lot once; the returned function builds the
 *  index for any asOf (exclusive) in O(rows · log rows). */
export function makeHouseBiasIndexer(lots: AuctionLot[], marketBySlug: Record<string, string>): (asOf: string) => HouseBias {
  const rows: HBRow[] = [];
  for (const l of lots) {
    if (l.status !== 'sold' || !((l.realizedUsd || 0) > 0) || !l.saleDate || !l.auctionHouse) continue;
    const lx = l as AuctionLot & { datePrecision?: string | null; compExclude?: string | null };
    if (lx.compExclude || lx.datePrecision === 'year' || lx.datePrecision === 'unknown') continue;
    const lo = l.estLowUsd || 0, hi = l.estHighUsd || 0;
    const mid = lo && hi ? (lo + hi) / 2 : (lo || hi);
    if (!(mid > 0)) continue;
    const y = Math.log(l.realizedUsd! / mid);
    if (!Number.isFinite(y) || Math.abs(y) > 4) continue; // ×55 either way is a unit/FX fault, not a habit
    // sf (Oct 6): a single printed figure (low == high) — also indexed under
    // its own kind 's', and true ranges under 'r', for the single-figure engine
    rows.push({ k: knownKey(lx), m: marketBySlug[l.artist] || 'other', h: String(l.auctionHouse), et: lo && hi ? 'b' : 'p', y, sf: !!(lo && hi && lo === hi) });
  }
  rows.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const cache = new Map<string, HouseBias>();
  return (asOf: string): HouseBias => {
    const hit = cache.get(asOf);
    if (hit) return hit;
    const t = Date.parse(asOf);
    const winStart = new Date(t - HB_WINDOW_Y * 31_557_600_000).toISOString().slice(0, 10);
    const acc = new Map<string, [number, number][]>();
    const push = (key: string, y: number, w: number) => { const a = acc.get(key); if (a) a.push([y, w]); else acc.set(key, [[y, w]]); };
    for (const r of rows) {
      if (r.k >= asOf) break;              // rows are knownKey-sorted: nothing later is known yet
      if (r.k < winStart) continue;
      // a month-precision key ('2025-06-32') ages from the end of its month
      const age = (t - Date.parse(r.k.slice(8, 10) > '31' ? `${r.k.slice(0, 7)}-28` : r.k.slice(0, 10))) / 31_557_600_000;
      const w = Math.pow(0.5, Math.max(0, Number.isFinite(age) ? age : HB_WINDOW_Y) / HB_HL_Y);
      for (const et of r.et === 'b' ? [r.et, r.sf ? 's' : 'r'] : [r.et]) {
        push(`g:${et}`, r.y, w);
        push(`m:${r.m}:${et}`, r.y, w);
        push(`h:${r.h}:${et}`, r.y, w);
        push(`mh:${r.m}|${r.h}:${et}`, r.y, w);
      }
    }
    const raw = new Map<string, { med: number; W: number; n: number }>();
    acc.forEach((pairs, key) => {
      if (pairs.length < HB_MIN_N) return;
      raw.set(key, { med: weightedMedian(pairs), W: pairs.reduce((s, p) => s + p[1], 0), n: pairs.length });
    });
    const cells: Record<string, number> = {};
    const n: Record<string, number> = {};
    const shrink = (key: string, parent: number | undefined) => {
      const c = raw.get(key);
      if (!c) return;
      cells[key] = Math.round((parent == null ? c.med : (c.W * c.med + HB_K * parent) / (c.W + HB_K)) * 10000) / 10000;
      n[key] = c.n;
    };
    for (const et of ['b', 'p', 'r', 's']) shrink(`g:${et}`, undefined);
    raw.forEach((_, key) => {
      const et = key.slice(-1);
      if (key.startsWith('m:') || key.startsWith('h:')) shrink(key, cells[`g:${et}`]);
    });
    raw.forEach((_, key) => {
      if (!key.startsWith('mh:')) return;
      const et = key.slice(-1);
      const [m, h] = key.slice(3, -2).split('|');
      shrink(key, cells[`h:${h}:${et}`] ?? cells[`m:${m}:${et}`] ?? cells[`g:${et}`]);
    });
    const out: HouseBias = { asOf, ref: cells['g:b'] ?? 0, cells, n };
    cache.set(asOf, out);
    return out;
  };
}

/** One-shot house-bias index for `asOf` (see makeHouseBiasIndexer). */
export function buildHouseBias(lots: AuctionLot[], marketBySlug: Record<string, string>, asOf: string): HouseBias {
  return makeHouseBiasIndexer(lots, marketBySlug)(asOf);
}
