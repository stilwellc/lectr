/**
 * build-backtest.ts — the signal's measured record, point-in-time correct,
 * computed with the REAL production engine (resolveComps + estimateValue), not a
 * proxy. For every concluded sale that carried an estimate, replay the buy signal
 * as it would have been called ON THAT DAY: the comp pool is the lot's same-maker
 * sold history restricted to sales that had already happened, scored through the
 * exact production similarity + gate the live site uses, and the call is the exact
 * directional signal estimateValue emits. Then score the outcome the lot actually
 * delivered against its own estimate. No hindsight leaks: a lot's own result never
 * participates in its own call, and neither does anything dated on/after it.
 *
 * Emits public/data/ray/backtest.json — small summary + per-year series. Because
 * it runs the same engine as build-market, the "flagged beat estimates by +X%"
 * numbers on the site now describe the model users actually see.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus as readCorpusShared } from './corpus-io';
import { buildIdf, buildVectors } from '../app/lib/similarity';
import { resolveComps, estimateValue } from '../app/lib/value';
import type { AuctionLot } from '../app/types';

type L = AuctionLot & { _v?: Record<string, number>; estLowUsd?: number; estHighUsd?: number; realizedUsd?: number };

// cap same-maker priors per target — the most-recent N. estimateValue only keeps
// its TOP_K by score, which the recent window essentially always contains, so this
// tracks production while keeping the O(targets × pool) replay tractable.
const PRIOR_CAP = 500;

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

export function buildBacktest(dataDir: string, allLots?: AuctionLot[]): void {
  const lots: L[] = (allLots ?? (readCorpusShared() as unknown as AuctionLot[])) as L[];

  const sold = lots.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length);
  const tbl = buildIdf(sold);
  buildVectors(lots as AuctionLot[], tbl); // attach _v to every lot (priors need it)

  // same-maker sold, time-sorted, for O(1) prior slicing
  const byArtist = new Map<string, L[]>();
  for (const s of sold) (byArtist.get(s.artist) || byArtist.set(s.artist, []).get(s.artist)!).push(s);
  byArtist.forEach(g => g.sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1)));

  // held-out targets: sold lots that carried a usable estimate
  const targets = sold.filter(l => (l.estLowUsd || 0) > 0 && (l.estHighUsd || 0) > 0 && (l.estLowUsd! + l.estHighUsd!) / 2 > 0);

  type Bucket = { perfs: number[]; beat: number; n: number };
  const mk = (): Bucket => ({ perfs: [], beat: 0, n: 0 });
  const flagged = mk(), unflagged = mk(), above = mk();
  const byYear = new Map<number, { flagged: number[]; unflagged: number[] }>();

  for (const lot of targets) {
    const estMid = (lot.estLowUsd! + lot.estHighUsd!) / 2;
    const roster = byArtist.get(lot.artist) || [];
    // strictly-earlier same-maker sold (no same-day → no leak), most-recent PRIOR_CAP
    const priors: L[] = [];
    for (let i = roster.length - 1; i >= 0 && priors.length < PRIOR_CAP; i--) {
      const s = roster[i];
      if (s.id === lot.id) continue;
      if (!(s.saleDate < lot.saleDate)) continue;
      priors.push(s);
    }
    if (priors.length < 3) continue;

    const comps = resolveComps(lot, priors, tbl, lot.saleDate);
    const v = estimateValue(lot, comps, tbl);
    if (!v || !v.signal) continue;

    const realized = lot.realizedUsd!;
    const perf = realized / estMid - 1;
    const beatHigh = realized > lot.estHighUsd!;
    const isBelow = v.signal.label.startsWith('below');
    const isAbove = v.signal.label.startsWith('above');
    const bucket = isBelow ? flagged : isAbove ? above : unflagged;
    bucket.perfs.push(perf); if (beatHigh) bucket.beat++; bucket.n++;

    const y = +lot.saleDate.slice(0, 4);
    if (y >= 2000) {
      const yb = byYear.get(y) || { flagged: [], unflagged: [] };
      if (isBelow) yb.flagged.push(perf);
      else if (!isAbove) yb.unflagged.push(perf);
      byYear.set(y, yb);
    }
  }

  const summarize = (b: Bucket) => {
    const s = [...b.perfs].sort((x, y) => x - y);
    return {
      n: b.n,
      medianPerfPct: b.n ? Math.round(median(s) * 100) : 0,
      beatHighPct: b.n ? Math.round((b.beat / b.n) * 100) : 0,
    };
  };

  const series = Array.from(byYear.keys()).sort()
    .map(y => {
      const v = byYear.get(y)!;
      const f = [...v.flagged].sort((a, b) => a - b);
      const u = [...v.unflagged].sort((a, b) => a - b);
      return {
        year: y,
        flaggedMedianPct: f.length >= 5 ? Math.round(median(f) * 100) : null,
        unflaggedMedianPct: u.length >= 5 ? Math.round(median(u) * 100) : null,
        nFlagged: f.length,
      };
    })
    .filter(p => p.flaggedMedianPct !== null || p.unflaggedMedianPct !== null);

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    flagged: summarize(flagged),
    unflagged: summarize(unflagged),
    above: summarize(above),
    series,
  };
  fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
  console.log('backtest.json:',
    `flagged n=${out.flagged.n} median +${out.flagged.medianPerfPct}% beatHigh ${out.flagged.beatHighPct}%`,
    `| unflagged n=${out.unflagged.n} median +${out.unflagged.medianPerfPct}% beatHigh ${out.unflagged.beatHighPct}%`,
    `| above n=${out.above.n} median +${out.above.medianPerfPct}%`);
}

if (require.main === module) {
  buildBacktest(path.join(process.cwd(), 'public', 'data', 'ray'));
}
