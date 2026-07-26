/**
 * backtest-core.ts — the SHARED replay engine behind BOTH backtest entry points.
 *
 * Extracted verbatim from build-backtest.ts so the full weekly rebuild and the
 * fast nightly incremental call BYTE-IDENTICAL scoring, accumulation, and
 * summarisation code. The only thing that differs between the two entry points
 * is WHICH targets they score (all of them vs. only the newly-closed ones) —
 * every target that IS scored flows through the exact same valueOne → scoreTarget
 * path, so an incremental row is indistinguishable from the row a full replay
 * would have produced for that same lot.
 *
 * WHY a shared module instead of the incremental importing build-backtest.ts:
 * the accumulate/summarise step is not decomposable from the PUBLISHED summary
 * (medians, recency-weighted beat rates, split-conformal quantiles all need the
 * raw per-observation arrays, not the rounded outputs). So the incremental has
 * to (a) reconstitute the raw accumulator state, (b) fold ONLY the new lots in,
 * and (c) re-derive the summary. Factoring the accumulator + summariser here is
 * what makes that possible without forking a single line of scoring logic.
 */
import { buildIdf, buildVectors } from '../app/lib/similarity';
import { resolveComps, estimateValue } from '../app/lib/value';
import { ARTISTS } from '../app/constants';
import type { AuctionLot } from '../app/types';

export type L = AuctionLot & { _v?: Record<string, number>; estLowUsd?: number; estHighUsd?: number; realizedUsd?: number; hammerUsd?: number | null };

// global premium fallback where the house didn't publish a hammer — measured
// median realized/hammer is 1.25, flat 22–26% across houses and price bands.
export const PREMIUM_FALLBACK = 1.25;

export function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

export const hasEst = (l: L) => (l.estLowUsd || 0) > 0 && (l.estHighUsd || 0) > 0 && (l.estLowUsd! + l.estHighUsd!) / 2 > 0;

// ── ACCUMULATOR STATE ──
// Every published number derives from these raw arrays/counts. The full build
// fills them from scratch; the incremental REHYDRATES them from the sidecar
// state file, appends the new lots' observations, and re-summarises. Keeping the
// raw arrays (not the rounded summary) is what lets the incremental reproduce a
// median / weighted rate / conformal quantile that a full replay would compute.
export type Bucket = { perfs: number[]; hammerPerfs: number[]; beat: number; hammerBeat: number; n: number; boughtIn: number };
export type CalObs = { m: string; cr: number; beat: boolean; r: number; conf: string; ageY: number };
export type YearObs = { flagged: number[]; unflagged: number[] };

export interface BacktestState {
  flagged: Bucket;
  unflagged: Bucket;
  above: Bucket;
  flaggedMain: Bucket;
  flaggedFallback: Bucket;
  byYear: Record<number, YearObs>;
  calObs: CalObs[];
  // the anchoring wall-clock used for calObs recency weighting + lot age. Frozen
  // in state so an incremental re-weights against the SAME "now" the full build
  // used — otherwise every incremental would silently re-decay the whole history.
  nowMs: number;
  // ids already folded in, so an incremental can never double-count a lot that
  // straddles the generatedAt boundary (or a re-scored backfill).
  scoredIds: string[];
}

export const mkBucket = (): Bucket => ({ perfs: [], hammerPerfs: [], beat: 0, hammerBeat: 0, n: 0, boughtIn: 0 });

export function mkState(nowMs: number): BacktestState {
  return {
    flagged: mkBucket(), unflagged: mkBucket(), above: mkBucket(),
    flaggedMain: mkBucket(), flaggedFallback: mkBucket(),
    byYear: {}, calObs: [], nowMs, scoredIds: [],
  };
}

// ── PREPARED CORPUS ──
// IDF table, attached vectors, and the per-artist time-sorted sold roster — the
// inputs valueOne needs. Built identically by both entry points (over the SAME
// full corpus), so the comp pool an incremental sees for a new lot is exactly
// the pool a full replay would see for it.
export interface Prepared {
  lots: L[];
  tbl: ReturnType<typeof buildIdf>;
  byArtist: Map<string, L[]>;
  sold: L[];
  marketBySlug: Record<string, string>;
}

export function prepare(allLots: AuctionLot[], log: (m: string) => void, elapsed: () => string): Prepared {
  const lots = allLots as L[];
  const sold = lots.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length);
  const tbl = buildIdf(sold);
  buildVectors(lots as AuctionLot[], tbl); // attach _v to every lot (priors need it)

  // same-maker sold, time-sorted — comp pools are always SOLD priors
  const byArtist = new Map<string, L[]>();
  for (const s of sold) (byArtist.get(s.artist) || byArtist.set(s.artist, []).get(s.artist)!).push(s);
  byArtist.forEach(g => g.sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1)));

  const marketBySlug: Record<string, string> = {};
  for (const a of ARTISTS) marketBySlug[a.slug] = a.market;

  log(`[backtest] vectors built (${elapsed()}) — corpus ${lots.length} lots, ${sold.length} sold`);
  return { lots, tbl, byArtist, sold, marketBySlug };
}

/** Score a single lot exactly as production would have called it on its sale
 *  day: full strictly-earlier same-maker sold roster (no leak, no cap) →
 *  resolveComps → estimateValue. Returns null if the pool is too thin. THE hot
 *  path — O(priors) per call; the whole backtest is O(targets × priors). */
export function valueOne(prep: Prepared, lot: L) {
  const roster = prep.byArtist.get(lot.artist) || [];
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
  const comps = resolveComps(lot, priors, prep.tbl, lot.saleDate);
  return estimateValue(lot, comps, prep.tbl);
}

/** Fold ONE sold target into the accumulators — the body of the sold-replay
 *  loop, extracted so both entry points score a sold lot identically. Records
 *  the id and returns true when the lot produced a scored (signal) observation. */
export function scoreSold(prep: Prepared, st: BacktestState, lot: L): boolean {
  const v = valueOne(prep, lot);
  if (!v || !v.signal) return false;
  const estMid = (lot.estLowUsd! + lot.estHighUsd!) / 2;
  const realized = lot.realizedUsd!;
  const hammer = (lot.hammerUsd || 0) > 0 ? lot.hammerUsd! : realized / PREMIUM_FALLBACK;
  const isBelow = v.signal.label.startsWith('below');
  const isAbove = v.signal.label.startsWith('above');
  const bucket = isBelow ? st.flagged : isAbove ? st.above : st.unflagged;
  const push = (b: Bucket) => {
    b.perfs.push(realized / estMid - 1);
    b.hammerPerfs.push(hammer / estMid - 1);
    if (realized > lot.estHighUsd!) b.beat++;
    if (hammer > lot.estHighUsd!) b.hammerBeat++;
    b.n++;
  };
  push(bucket);
  if (isBelow) push(v.tier === 'fallback' ? st.flaggedFallback : st.flaggedMain);

  if (v.compRatio != null && v.compValueUsd > 0) {
    st.calObs.push({
      m: prep.marketBySlug[lot.artist] || 'all',
      cr: v.compRatio,
      beat: realized > lot.estHighUsd!,
      r: realized / v.compValueUsd,
      conf: v.confidence,
      ageY: Math.max(0, (st.nowMs - new Date(lot.saleDate).getTime()) / 31_557_600_000),
    });
  }

  const y = +lot.saleDate.slice(0, 4);
  if (y >= 2000) {
    const yb = st.byYear[y] || { flagged: [], unflagged: [] };
    if (isBelow) yb.flagged.push(realized / estMid - 1);
    else if (!isAbove) yb.unflagged.push(realized / estMid - 1);
    st.byYear[y] = yb;
  }
  return true;
}

/** Fold ONE bought-in target: outcome = failed to sell (a flag that bought in
 *  is a miss). Extracted so both entry points count bought-ins identically. */
export function scoreBoughtIn(prep: Prepared, st: BacktestState, lot: L): boolean {
  const v = valueOne(prep, lot);
  if (!v || !v.signal) return false;
  const isBelow = v.signal.label.startsWith('below');
  const isAbove = v.signal.label.startsWith('above');
  (isBelow ? st.flagged : isAbove ? st.above : st.unflagged).boughtIn++;
  return true;
}

// ── SUMMARISE ──  (identical math to the original inline block)
function summarize(b: Bucket) {
  const s = [...b.perfs].sort((x, y) => x - y);
  const h = [...b.hammerPerfs].sort((x, y) => x - y);
  const concluded = b.n + b.boughtIn;
  return {
    n: b.n,
    medianPerfPct: b.n ? Math.round(median(s) * 100) : 0,
    beatHighPct: b.n ? Math.round((b.beat / b.n) * 100) : 0,
    hammerMedianPct: b.n ? Math.round(median(h) * 100) : 0,
    hammerBeatPct: b.n ? Math.round((b.hammerBeat / b.n) * 100) : 0,
    nBoughtIn: b.boughtIn,
    failToSellPct: concluded ? Math.round((b.boughtIn / concluded) * 1000) / 10 : 0,
    beatHighHonestPct: concluded ? Math.round((b.beat / concluded) * 100) : 0,
  };
}

/** Assemble the published backtest.json object from accumulator state. This is
 *  the ENTIRE derivation: auto-calibration (beat-rate step levels + conformal
 *  band) + the annual series, byte-for-byte the original. `generatedAt` is
 *  passed in so the caller controls the stamp (full = today; incremental = the
 *  day it appended through). */
export function summarizeState(st: BacktestState, generatedAt: string) {
  const byYear = new Map<number, YearObs>();
  for (const k of Object.keys(st.byYear)) byYear.set(+k, st.byYear[+k]);

  const series = Array.from(byYear.keys()).sort((a, b) => a - b)
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

  // ── AUTO-CALIBRATION ── (verbatim from build-backtest.ts)
  const calObs = st.calObs;
  const EDGES = [0.6, 0.9, 1.3, 2.0, 10];
  const bucketOf = (cr: number) => { let b = 0; for (const e of EDGES) { if (cr < e) break; b++; } return b; }; // 0..5
  const wOf = (o: { ageY: number }) => Math.pow(0.5, o.ageY / 3);
  const rate = (obs: CalObs[]) => {
    const acc = Array.from({ length: 6 }, () => ({ w: 0, wb: 0, n: 0 }));
    for (const o of obs) { const b = bucketOf(o.cr); const w = wOf(o); acc[b].w += w; acc[b].wb += o.beat ? w : 0; acc[b].n++; }
    return acc;
  };
  const globalAcc = rate(calObs);
  const globalLevels = globalAcc.map(a => (a.w > 0 ? a.wb / a.w : 0.55));
  const K = 60;
  const levelsFor = (mkt: string) => {
    const acc = rate(calObs.filter(o => o.m === mkt));
    const lv = acc.map((a, b) => {
      if (a.n < 100) return globalLevels[b];
      return (a.wb + K * globalLevels[b]) / (a.w + K);
    });
    for (let b = 1; b <= 4; b++) lv[b] = Math.max(lv[b], lv[b - 1]);
    return lv.map(x => Math.round(Math.min(0.85, Math.max(0.3, x)) * 100));
  };
  const bandFor = (conf: string) => {
    const rs = calObs.filter(o => o.conf === conf).map(o => o.r).sort((a, b) => a - b);
    const src = rs.length >= 150 ? rs : calObs.map(o => o.r).sort((a, b) => a - b);
    const q = (p: number) => src[Math.min(src.length - 1, Math.max(0, Math.floor(p * (src.length - 1))))];
    return { lo: Math.round(Math.min(1, Math.max(0.3, q(0.15))) * 1000) / 1000, hi: Math.round(Math.min(4, Math.max(1, q(0.85))) * 1000) / 1000 };
  };
  const calibration = {
    edges: EDGES,
    beatRate: {
      global: levelsFor('__none__').map((_, b) => Math.round(Math.min(0.85, Math.max(0.3, globalLevels[b])) * 100)),
      art: levelsFor('art'), design: levelsFor('design'), watches: levelsFor('watches'),
    },
    band: { high: bandFor('high'), medium: bandFor('medium'), low: bandFor('low') },
    n: calObs.length,
  };

  return {
    generatedAt,
    flagged: summarize(st.flagged),
    unflagged: summarize(st.unflagged),
    above: summarize(st.above),
    flaggedTiers: { main: summarize(st.flaggedMain), fallback: summarize(st.flaggedFallback) },
    calibration,
    series,
  };
}

/** The one-line console summary both entry points print on completion. */
export function summaryLine(out: ReturnType<typeof summarizeState>): string {
  return [
    `flagged n=${out.flagged.n} median +${out.flagged.medianPerfPct}% (hammer +${out.flagged.hammerMedianPct}%) beatHigh ${out.flagged.beatHighPct}% (hammer ${out.flagged.hammerBeatPct}%) failToSell ${out.flagged.failToSellPct}%`,
    `| unflagged n=${out.unflagged.n} median +${out.unflagged.medianPerfPct}% (hammer +${out.unflagged.hammerMedianPct}%) failToSell ${out.unflagged.failToSellPct}%`,
    `| above n=${out.above.n} median +${out.above.medianPerfPct}% (hammer +${out.above.hammerMedianPct}%) failToSell ${out.above.failToSellPct}%`,
  ].join(' ');
}

/** Split the corpus into the sold + bought-in TARGET sets (concluded lots with
 *  a usable estimate). Shared so both entry points draw targets from the same
 *  predicate; the incremental just filters these by close-date afterward. */
export function targetsOf(prep: Prepared): { soldTargets: L[]; biTargets: L[] } {
  const soldTargets = prep.sold.filter(hasEst);
  const biTargets = prep.lots.filter(l => l.status === 'bought_in' && l.saleDate && l.titleTokens && l.titleTokens.length && hasEst(l));
  return { soldTargets, biTargets };
}
