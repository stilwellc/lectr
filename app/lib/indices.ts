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

export interface IndexPoint { period: string; value: number; n: number; }
export interface MarketSeries {
  method: string;
  label: string;
  index: IndexPoint[];          // rebased to 100 at the first point
  volume: IndexPoint[];
  sellThrough: IndexPoint[];    // 0–100
  houseAccuracy: IndexPoint[];  // realized/est-mid median, per period (>1 = houses light)
  n: number;
}

const QUARTER = (d: string) => {
  const m = /^(\d{4})-(\d{2})/.exec(d);
  if (!m) return null;
  return `${m[1]} Q${Math.ceil(+m[2] / 3)}`;
};
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
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
  // the houses "missed". hammerUsd where published, else realized/1.25.
  const accByQ = new Map<string, number[]>();
  for (const l of soldPriced) {
    if (!l.estLowUsd || !l.estHighUsd) continue;
    const mid = (l.estLowUsd + l.estHighUsd) / 2;
    if (!(mid > 0)) continue; // guard against corrupt (negative/zero) estimates
    const q = QUARTER(l.saleDate); if (!q) continue;
    const hammer = ((l as { hammerUsd?: number | null }).hammerUsd || 0) > 0
      ? (l as { hammerUsd?: number | null }).hammerUsd!
      : l.realizedUsd! / 1.25;
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
      qmed.set(q, median(arr)); all.push(...arr); quartersSeen++;
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
  index.length = 0; index.push(...smoothed);

  const method = index.length >= 4
    ? 'like-for-like cohort index (maker × form × size, each normalized to its own average), 3-quarter smoothed'
    : 'insufficient like-for-like depth for a price index';

  return { method, label, index, volume, sellThrough, houseAccuracy, n: soldPriced.length };
}
