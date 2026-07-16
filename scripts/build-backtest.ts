/**
 * build-backtest.ts — the signal's measured record, point-in-time correct,
 * computed with the REAL production engine (resolveComps + estimateValue), not a
 * proxy. For every concluded lot that carried an estimate, replay the buy signal
 * as it would have been called ON THAT DAY: the comp pool is the lot's FULL
 * same-maker sold history restricted to sales that had already happened (no
 * prior cap — production build-market passes the full roster, and a cap was
 * measured to understate shipped coverage by ~7pp), scored through the exact
 * production similarity + gate the live site uses. Then score the outcome:
 *  - sold lots: realized vs estimate, on BOTH bases — all-in (premium-inclusive
 *    realized, the number a buyer pays) and HAMMER (hammerUsd, or realized/1.25
 *    where the house didn't publish it) — because estimates are hammer-basis,
 *    the hammer read is the honest "beat the estimate" test.
 *  - bought-in lots: counted as failures-to-sell per bucket (a below-market flag
 *    on a lot that then failed to sell is a miss the old backtest hid).
 * No hindsight leaks: a lot's own result never participates in its own call,
 * and neither does anything dated on/after it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { readCorpus as readCorpusShared } from './corpus-io';
import { buildIdf, buildVectors } from '../app/lib/similarity';
import { resolveComps, estimateValue } from '../app/lib/value';
import type { AuctionLot } from '../app/types';

type L = AuctionLot & { _v?: Record<string, number>; estLowUsd?: number; estHighUsd?: number; realizedUsd?: number; hammerUsd?: number | null };

// global premium fallback where the house didn't publish a hammer — measured
// median realized/hammer is 1.25, flat 22–26% across houses and price bands.
const PREMIUM_FALLBACK = 1.25;

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

  // same-maker sold, time-sorted — comp pools are always SOLD priors
  const byArtist = new Map<string, L[]>();
  for (const s of sold) (byArtist.get(s.artist) || byArtist.set(s.artist, []).get(s.artist)!).push(s);
  byArtist.forEach(g => g.sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1)));

  const hasEst = (l: L) => (l.estLowUsd || 0) > 0 && (l.estHighUsd || 0) > 0 && (l.estLowUsd! + l.estHighUsd!) / 2 > 0;
  // held-out targets: every concluded lot with a usable estimate — sold AND bought-in
  const soldTargets = sold.filter(hasEst);
  const biTargets = lots.filter(l => l.status === 'bought_in' && l.saleDate && l.titleTokens && l.titleTokens.length && hasEst(l));

  type Bucket = { perfs: number[]; hammerPerfs: number[]; beat: number; hammerBeat: number; n: number; boughtIn: number };
  const mk = (): Bucket => ({ perfs: [], hammerPerfs: [], beat: 0, hammerBeat: 0, n: 0, boughtIn: 0 });
  const flagged = mk(), unflagged = mk(), above = mk();
  // per-tier flagged rows — the headline stays truthful only unblended
  const flaggedMain = mk(), flaggedFallback = mk();
  const byYear = new Map<number, { flagged: number[]; unflagged: number[] }>();

  const valueOne = (lot: L) => {
    const roster = byArtist.get(lot.artist) || [];
    // ALL strictly-earlier same-maker sold (no same-day → no leak) — no cap,
    // matching what production build-market feeds the engine.
    const priors: L[] = [];
    for (let i = roster.length - 1; i >= 0; i--) {
      const s = roster[i];
      if (s.id === lot.id) continue;
      if (!(s.saleDate < lot.saleDate)) continue;
      priors.push(s);
    }
    if (priors.length < 3) return null;
    const comps = resolveComps(lot, priors, tbl, lot.saleDate);
    return estimateValue(lot, comps, tbl);
  };

  for (const lot of soldTargets) {
    const v = valueOne(lot);
    if (!v || !v.signal) continue;
    const estMid = (lot.estLowUsd! + lot.estHighUsd!) / 2;
    const realized = lot.realizedUsd!;
    const hammer = (lot.hammerUsd || 0) > 0 ? lot.hammerUsd! : realized / PREMIUM_FALLBACK;
    const isBelow = v.signal.label.startsWith('below');
    const isAbove = v.signal.label.startsWith('above');
    const bucket = isBelow ? flagged : isAbove ? above : unflagged;
    const push = (b: Bucket) => {
      b.perfs.push(realized / estMid - 1);
      b.hammerPerfs.push(hammer / estMid - 1);
      if (realized > lot.estHighUsd!) b.beat++;
      if (hammer > lot.estHighUsd!) b.hammerBeat++;
      b.n++;
    };
    push(bucket);
    if (isBelow) push(v.tier === 'fallback' ? flaggedFallback : flaggedMain);

    const y = +lot.saleDate.slice(0, 4);
    if (y >= 2000) {
      const yb = byYear.get(y) || { flagged: [], unflagged: [] };
      if (isBelow) yb.flagged.push(realized / estMid - 1);
      else if (!isAbove) yb.unflagged.push(realized / estMid - 1);
      byYear.set(y, yb);
    }
  }

  // bought-ins: same replay, outcome = failed to sell (a flag that bought in is a miss)
  for (const lot of biTargets) {
    const v = valueOne(lot);
    if (!v || !v.signal) continue;
    const isBelow = v.signal.label.startsWith('below');
    const isAbove = v.signal.label.startsWith('above');
    (isBelow ? flagged : isAbove ? above : unflagged).boughtIn++;
  }

  const summarize = (b: Bucket) => {
    const s = [...b.perfs].sort((x, y) => x - y);
    const h = [...b.hammerPerfs].sort((x, y) => x - y);
    const concluded = b.n + b.boughtIn;
    return {
      n: b.n,
      medianPerfPct: b.n ? Math.round(median(s) * 100) : 0,
      beatHighPct: b.n ? Math.round((b.beat / b.n) * 100) : 0,
      // hammer basis — estimates are hammer-basis, so this is the honest beat
      hammerMedianPct: b.n ? Math.round(median(h) * 100) : 0,
      hammerBeatPct: b.n ? Math.round((b.hammerBeat / b.n) * 100) : 0,
      // bought-in outcomes — the sell-through read
      nBoughtIn: b.boughtIn,
      failToSellPct: concluded ? Math.round((b.boughtIn / concluded) * 1000) / 10 : 0,
      beatHighHonestPct: concluded ? Math.round((b.beat / concluded) * 100) : 0,
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
    // per-tier flagged records (main = strict gate; fallback = relaxed tier-b)
    flaggedTiers: { main: summarize(flaggedMain), fallback: summarize(flaggedFallback) },
    series,
  };
  fs.writeFileSync(path.join(dataDir, 'backtest.json'), JSON.stringify(out));
  console.log('backtest.json:',
    `flagged n=${out.flagged.n} median +${out.flagged.medianPerfPct}% (hammer +${out.flagged.hammerMedianPct}%) beatHigh ${out.flagged.beatHighPct}% (hammer ${out.flagged.hammerBeatPct}%) failToSell ${out.flagged.failToSellPct}%`,
    `| unflagged n=${out.unflagged.n} median +${out.unflagged.medianPerfPct}% (hammer +${out.unflagged.hammerMedianPct}%) failToSell ${out.unflagged.failToSellPct}%`,
    `| above n=${out.above.n} median +${out.above.medianPerfPct}% (hammer +${out.above.hammerMedianPct}%) failToSell ${out.above.failToSellPct}%`);
}

if (require.main === module) {
  buildBacktest(path.join(process.cwd(), 'public', 'data', 'ray'));
}
