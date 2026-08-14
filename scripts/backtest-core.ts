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
// median realized/hammer is 1.25. Kept as the last-resort constant; the
// per-house schedule (app/lib/premiums) now takes precedence at the use site.
export const PREMIUM_FALLBACK = 1.25;
import { houseAllInFactor } from '../app/lib/premiums';

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
export type CalObs = { m: string; cr: number; beat: boolean; r: number; conf: string; ageY: number; pf?: number; fl?: boolean; kt?: string };
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
  // per-house premium schedule (measured + published; flat 1.25 was up to
  // ~10% biased cross-house — REA runs 1.175, Bonhams low bands 1.28)
  const hammer = (lot.hammerUsd || 0) > 0 ? lot.hammerUsd! : realized / houseAllInFactor(lot.auctionHouse, realized);
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
      pf: realized / estMid - 1,
      fl: isBelow,
      // watches era-gate MEASUREMENT (spec 8a precondition): reference-keyed
      // vs model-name-keyed error splits fall out of the Sunday full replay
      kt: prep.marketBySlug[lot.artist] === 'watches' ? ((lot as L & { reference?: string | null }).reference ? 'ref' : 'model') : undefined,
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

// ── OUTCOME DISTRIBUTION ──
// A median is one number; it hides the tails. The about page has to show that the
// flagged edge is a whole SHIFTED DISTRIBUTION (and that plenty of flagged lots
// still sell under the estimate mid) rather than a single headline stat, so the
// summariser ships a binned histogram of the raw per-lot perfs alongside the
// medians. COUNTS ONLY — the raw perfs arrays live in the sidecar state file and
// must never reach a client (they are ~90k floats and they are the engine's
// working memory, not a published number).
//
// Bins are left-open / right-closed in PERCENT: (-inf,-50], (-50,-25], (-25,0],
// (0,25], (25,50], (50,100], (100,200], (200,500], (500,inf) — nine, in order,
// partitioning the whole line so the counts always sum to n.
const DIST_EDGES: { lo: number; hi: number; label: string }[] = [
  { lo: -Infinity, hi: -50, label: 'worse than −50%' },
  { lo: -50, hi: -25, label: '−50% to −25%' },
  { lo: -25, hi: 0, label: '−25% to est. mid' },
  { lo: 0, hi: 25, label: 'est. mid to +25%' },
  { lo: 25, hi: 50, label: '+25% to +50%' },
  { lo: 50, hi: 100, label: '+50% to +100%' },
  { lo: 100, hi: 200, label: '+100% to +200%' },
  { lo: 200, hi: 500, label: '+200% to +500%' },
  { lo: 500, hi: Infinity, label: 'better than +500%' },
];

const binOf = (pct: number) => { let b = 0; while (b < DIST_EDGES.length - 1 && pct > DIST_EDGES[b].hi) b++; return b; };
const belowPctOf = (perfs: number[]) => (perfs.length ? Math.round((perfs.filter(p => p < 0).length / perfs.length) * 1000) / 10 : 0);

/** Binned all-in (premium-inclusive) outcome histogram for the flagged vs.
 *  unflagged arms — `bins` are lot COUNTS, `summary` the headline shares. Uses
 *  `perfs` (all-in), NOT `hammerPerfs`, so it reads on the same basis as
 *  medianPerfPct. `lo`/`hi` are finite-clamped to -100/1e9 so the block is plain
 *  JSON (JSON.stringify turns ±Infinity into null). */
export function distributionOf(flagged: Bucket, unflagged: Bucket) {
  const f = new Array(DIST_EDGES.length).fill(0) as number[];
  const u = new Array(DIST_EDGES.length).fill(0) as number[];
  for (const p of flagged.perfs) f[binOf(p * 100)]++;
  for (const p of unflagged.perfs) u[binOf(p * 100)]++;
  return {
    bins: DIST_EDGES.map((e, i) => ({
      lo: e.lo === -Infinity ? -100 : e.lo,
      hi: e.hi === Infinity ? 1e9 : e.hi,
      label: e.label,
      flagged: f[i],
      unflagged: u[i],
    })),
    summary: {
      flaggedN: flagged.perfs.length,
      unflaggedN: unflagged.perfs.length,
      flaggedBelowPct: belowPctOf(flagged.perfs),
      unflaggedBelowPct: belowPctOf(unflagged.perfs),
      flaggedMedianPct: flagged.perfs.length ? Math.round(median([...flagged.perfs].sort((a, b) => a - b)) * 100) : 0,
      unflaggedMedianPct: unflagged.perfs.length ? Math.round(median([...unflagged.perfs].sort((a, b) => a - b)) * 100) : 0,
    },
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
  // PER-MARKET RECORD (Aug 13 value audit): the +41/+16 receipt was global-
  // only — a watches user read an art/design-dominant number. Split it.
  const byMarket: Record<string, { flagged: { n: number; medPct: number | null }; unflagged: { n: number; medPct: number | null } }> = {};
  {
    const medOf = (a: number[]) => { if (a.length < 50) return null; const x = [...a].sort((p, q) => p - q); return Math.round(x[Math.floor(x.length / 2)] * 1000) / 10; };
    const mkts = Array.from(new Set(calObs.map(o => o.m).filter(m => m && m !== 'all')));
    for (const m of mkts) {
      const rows = calObs.filter(o => o.m === m && typeof o.pf === 'number');
      byMarket[m] = {
        flagged: { n: rows.filter(o => o.fl).length, medPct: medOf(rows.filter(o => o.fl).map(o => o.pf!)) },
        unflagged: { n: rows.filter(o => !o.fl).length, medPct: medOf(rows.filter(o => !o.fl).map(o => o.pf!)) },
      };
    }
  }
  // WATCH KEY-TYPE SPLIT — the era-gate measurement (fills as replays run)
  const watchKt: Record<string, { n: number; medAbsErr: number | null }> = {};
  for (const kt of ['ref', 'model']) {
    const rows = calObs.filter(o => o.kt === kt && o.r > 0);
    const errs = rows.map(o => Math.abs(Math.log(o.r))).sort((a, b) => a - b);
    watchKt[kt] = { n: rows.length, medAbsErr: errs.length >= 50 ? Math.round(errs[Math.floor(errs.length / 2)] * 1000) / 1000 : null };
  }
  // CONFORMAL BAND COVERAGE — the honesty proof: what share of realized
  // prices actually landed inside the published band, per confidence tier
  const bandCoverage: Record<string, number | null> = {};
  for (const conf of ['high', 'medium', 'low']) {
    const b = bandFor(conf);
    const rows = calObs.filter(o => o.conf === conf && o.r > 0);
    bandCoverage[conf] = rows.length >= 100
      ? Math.round(100 * rows.filter(o => o.r >= b.lo && o.r <= b.hi).length / rows.length)
      : null;
  }
  const calibration = {
    edges: EDGES,
    watchKt,
    bandCoverage,
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
    byMarket,
    calibration,
    series,
    distribution: distributionOf(st.flagged, st.unflagged),
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
