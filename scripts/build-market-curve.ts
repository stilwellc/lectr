/**
 * build-market-curve.ts — THE CLOSE-DAY GROWTH CURVE (Aug 13 value audit;
 * conditioned Sep 27 2026). How much of the final hammer arrives between a
 * nightly bid snapshot and the close, fitted from Goldin's own nightly
 * bidHistory on SOLD lots: growth = finalBid / bidAtSnapshot.
 *
 * Sep 27: the single median per days-out bucket averaged a $40 bid (which
 * routinely closes 5-10× higher) with a $40,000 bid (which barely moves), so
 * the projection was wrong in opposite directions at the two ends of the book
 * — and the Gap's forming shelf, which by construction SELECTS low bids far
 * from close, graded at realized/projected 6.46. The curve is now a GRID:
 * days-out bucket × bid-level band (hammer USD), each cell the median growth
 * of its own population (≥ GRID_MIN_N observations), falling back to the
 * days-out bucket median where a cell is thin. `buckets`/`edges`/`n` keep
 * their exact prior meaning (back-compat for every reader); `grid`/`bidEdges`
 * are additive. Readers project through app/lib/lanes.closeGrowth.
 */
import type { AuctionLot } from '../app/types';
import { lotAllInFactor } from '../app/lib/premiums';
import { medianSorted } from '../app/lib/stats';
import type { CloseCurve } from '../app/lib/lanes';

export const CURVE_EDGES = [1, 2, 4, 8];
/** hammer-USD bid bands (<25 · 25-50 · 50-100 · 100-250 · 250-500 · 500-2k ·
 *  2k-10k · 10k+). Out-of-sample (fit on bid histories closing before Sep 5,
 *  tested on the 25.8k snapshots after): median abs error 1.08 → 0.76, the
 *  per-band realized/projected spread 0.45–3.72 → 0.93–1.59, and the
 *  forming-like cohort (3.5–8d out, bid < $500) 1.78 → 1.23. */
export const CURVE_BID_EDGES = [25, 50, 100, 250, 500, 2000, 10000];
const BUCKET_MIN_N = 200;
const GRID_MIN_N = 100;

const binOf = (x: number, edges: number[]) => { let b = 0; for (const e of edges) { if (x < e) break; b++; } return b; };

/** Fit the curve from sold lots' bidHistory. `closedBefore` (exclusive) bounds
 *  the population for point-in-time evaluation; absent = every sold lot. */
export function fitCloseCurve(all: AuctionLot[], opts: { closedBefore?: string } = {}): CloseCurve {
  const nD = CURVE_EDGES.length + 1, nB = CURVE_BID_EDGES.length + 1;
  const perBucket: number[][] = Array.from({ length: nD }, () => []);
  const perCell: number[][][] = Array.from({ length: nB }, () => Array.from({ length: nD }, () => [] as number[]));
  for (const l of all) {
    if (l.status !== 'sold' || !(l.realizedUsd! > 0)) continue;
    const bh = (l as AuctionLot & { bidHistory?: Array<{ d: string; b: number; n: number }> }).bidHistory;
    if (!Array.isArray(bh) || bh.length < 2) continue;
    const closeIso = (l as AuctionLot & { saleDateTime?: string | null }).saleDateTime || l.saleDate || '';
    if (opts.closedBefore && !(closeIso.slice(0, 10) < opts.closedBefore)) continue;
    const closeMs = new Date(closeIso).getTime();
    if (isNaN(closeMs)) continue;
    const finalBid = l.realizedUsd! / lotAllInFactor(l, l.realizedUsd);
    for (const snap of bh) {
      if (!(snap.b > 0)) continue;
      const daysOut = (closeMs - new Date(snap.d).getTime()) / 86400000;
      if (daysOut < 0 || daysOut > 30) continue;
      const g = finalBid / snap.b;
      if (!(g >= 1 && g < 50)) continue;
      const d = binOf(daysOut, CURVE_EDGES);
      perBucket[d].push(g);
      perCell[binOf(snap.b, CURVE_BID_EDGES)][d].push(g);
    }
  }
  const med = (a: number[], min: number) => {
    if (a.length < min) return null;
    a.sort((x, y) => x - y);
    return Math.round(medianSorted(a) * 1000) / 1000;
  };
  return {
    buckets: perBucket.map(a => med(a, BUCKET_MIN_N)),
    edges: CURVE_EDGES,
    n: perBucket.map(a => a.length),
    bidEdges: CURVE_BID_EDGES,
    grid: perCell.map(row => row.map(a => med(a, GRID_MIN_N))),
    gridN: perCell.map(row => row.map(a => a.length)),
  };
}
