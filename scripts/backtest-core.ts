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
 *
 * ── Sep 2 2026 engine audit (P0-1 / P1-1 / P1-2 / P1-7) ──
 *  · EXACT CANDIDATE PRE-FILTER (the rate-collapse fix). valueOne used to hand
 *    resolveComps EVERY strictly-earlier same-maker prior — O(roster) similarity
 *    calls per target. The RR archive made entertainment-memorabilia a 228k
 *    roster: 94k culture targets × 228k priors ≈ 10^10 cosines, which is the
 *    "40→4 targets/s past 160k" collapse (targets are replayed in corpus order
 *    and the archive sits at the end). Now a per-maker inverted index yields
 *    only priors that CAN pass the admission gate: a comp needs cosine ≥
 *    FALLBACK_GATE.cosFloor (0.45) or an exact ref/edition identity (cosine ≥
 *    0.2), and cosine ≤ ‖a_shared‖/‖a‖, so any prior sharing NO token from the
 *    target's heaviest-IDF prefix (the prefix whose suffix norm fraction drops
 *    under the floor) is provably inadmissible. Identity keys get their own
 *    posting list. This is a NECESSARY-condition filter: the admitted set is
 *    identical to the unfiltered replay's (verified on a 3k-target sample:
 *    byte-identical ValueResults), only the wasted cosines are gone.
 *  · POINT-IN-TIME CALIBRATION (P1-1). Production stamps labels with the
 *    previous backtest's calibration loaded (setCalibration in build-market);
 *    the replay ran uncalibrated, so the record measured a different engine.
 *    Targets are now replayed in saleDate order and, at every calendar-quarter
 *    boundary, the calibration is refit from the observations accumulated
 *    STRICTLY BEFORE that quarter — never the rows being scored. Labels in the
 *    record now match what production would have emitted on the day.
 *  · REHYDRATION (P0-1a). A legacy state lacking calObs.pf/fl/et is repaired
 *    arithmetically (pf = r·cr − 1, fl = cr ≥ 1.3 under the uncalibrated
 *    legacy labeler, et = 'b' pre-single-point) instead of forcing a full
 *    replay that cannot finish inside the job cap.
 *  · OOS BAND COVERAGE (P1-2). bandCoverage was in-sample by construction;
 *    bandCoverageOOS fits on the older half of each market's rows and tests on
 *    the newer half. Bands are per-market where n allows (global fallback).
 *  · ENGINE VERSION (P1-7). Every observation carries `ev`; the state and the
 *    record carry ENGINE_VERSION; the summary reports the share of rows scored
 *    on the current version so drift is visible instead of silent.
 */
import { buildIdf, buildVectors } from '../app/lib/similarity';
import { resolveComps, estimateValue, setCalibration, FALLBACK_GATE, quantile, type EngineCalibration } from '../app/lib/value';
import { numericWatchRef, editionIdentityKey, isEditionLot, WATCH_SLUGS } from '../app/lib/identity';
import { ARTISTS } from '../app/constants';
import type { AuctionLot } from '../app/types';

export type L = AuctionLot & { _v?: Record<string, number>; _vn?: number; estLowUsd?: number; estHighUsd?: number; realizedUsd?: number; hammerUsd?: number | null };

/** Bump whenever scoring/labeling logic changes in a way that makes older
 *  rows non-comparable. The summary reports the share of rows on this version;
 *  a per-market full leg (build-backtest --market) refreshes a market. */
export const ENGINE_VERSION = '2026.09.02-pit-cal';

// global premium fallback where the house didn't publish a hammer — measured
// median realized/hammer is 1.25. Kept as the last-resort constant; the
// per-house schedule (app/lib/premiums) now takes precedence at the use site.
export const PREMIUM_FALLBACK = 1.25;
import { inferHammerUsd } from '../app/lib/premiums';

export function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

export const hasEst = (l: L) => (l.estLowUsd || 0) > 0 && (l.estHighUsd || 0) > 0 && (l.estLowUsd! + l.estHighUsd!) / 2 > 0;
// SINGLE-POINT estimates (Aug 14): RR publishes "Estimate: $500+" — low only.
// 90k sold science/culture lots carry one, and requiring a band made the
// entire RR mass invisible to measurement while production flags it daily.
// Point lots are scored into calObs (calibration, byMarket record, band
// coverage) but NOT the certified global flagged/unflagged buckets — those
// stay band-basis so the flagship receipt's meaning doesn't shift.
export const hasAnyEst = (l: L) => (l.estLowUsd || 0) > 0 || (l.estHighUsd || 0) > 0;
export const estMidOf = (l: L) => { const lo = l.estLowUsd || 0, hi = l.estHighUsd || 0; return lo && hi ? (lo + hi) / 2 : (lo || hi); };
export const estTopOf = (l: L) => (l.estHighUsd || l.estLowUsd || 0);
export const estKindOf = (l: L): 'b' | 'p' => ((l.estLowUsd || 0) > 0 && (l.estHighUsd || 0) > 0 ? 'b' : 'p');

// ── ACCUMULATOR STATE ──
// Every published number derives from these raw arrays/counts. The full build
// fills them from scratch; the incremental REHYDRATES them from the sidecar
// state file, appends the new lots' observations, and re-summarises. Keeping the
// raw arrays (not the rounded summary) is what lets the incremental reproduce a
// median / weighted rate / conformal quantile that a full replay would compute.
export type Bucket = { perfs: number[]; hammerPerfs: number[]; beat: number; hammerBeat: number; n: number; boughtIn: number };
export type CalObs = {
  m: string; cr: number; beat: boolean; r: number; conf: string; ageY: number;
  pf?: number; fl?: boolean; kt?: string; et?: 'b' | 'p';
  /** lot id + sale day + engine version (Sep 2): self-describing rows, so a
   *  future field can be rehydrated by lookup instead of arithmetic. */
  id?: string; sd?: string; ev?: string;
};
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
  /** ids ATTEMPTED that produced no observation (pool<3 / abstain). Lets the
   *  incremental key "new" on "never tried" instead of a close-date compare
   *  (which dropped any result crawled after its close day) without
   *  re-attempting the same abstentions every night. */
  triedIds?: string[];
  engineVersion?: string;
}

export const mkBucket = (): Bucket => ({ perfs: [], hammerPerfs: [], beat: 0, hammerBeat: 0, n: 0, boughtIn: 0 });

export function mkState(nowMs: number): BacktestState {
  return {
    flagged: mkBucket(), unflagged: mkBucket(), above: mkBucket(),
    flaggedMain: mkBucket(), flaggedFallback: mkBucket(),
    byYear: {}, calObs: [], nowMs, scoredIds: [], triedIds: [], engineVersion: ENGINE_VERSION,
  };
}

/** Concatenate per-market leg states into one. Buckets/arrays are order-free
 *  (the summariser sorts), so a leg-split replay merges exactly. */
export function mergeStates(states: BacktestState[]): BacktestState {
  const out = mkState(Math.max(...states.map(s => s.nowMs)));
  const mb = (a: Bucket, b: Bucket) => {
    for (const p of b.perfs) a.perfs.push(p);
    for (const p of b.hammerPerfs) a.hammerPerfs.push(p);
    a.beat += b.beat; a.hammerBeat += b.hammerBeat; a.n += b.n; a.boughtIn += b.boughtIn;
  };
  for (const s of states) {
    mb(out.flagged, s.flagged); mb(out.unflagged, s.unflagged); mb(out.above, s.above);
    mb(out.flaggedMain, s.flaggedMain); mb(out.flaggedFallback, s.flaggedFallback);
    for (const y of Object.keys(s.byYear)) {
      const yb = out.byYear[+y] || (out.byYear[+y] = { flagged: [], unflagged: [] });
      for (const p of s.byYear[+y].flagged) yb.flagged.push(p);
      for (const p of s.byYear[+y].unflagged) yb.unflagged.push(p);
    }
    for (const o of s.calObs) out.calObs.push(o);
    for (const id of s.scoredIds) out.scoredIds.push(id);
    for (const id of s.triedIds || []) out.triedIds!.push(id);
  }
  return out;
}

// ── PREPARED CORPUS ──
// IDF table, attached vectors, and the per-artist time-sorted sold roster — the
// inputs valueOne needs. Built identically by both entry points (over the SAME
// full corpus), so the comp pool an incremental sees for a new lot is exactly
// the pool a full replay would see for it.
//
// POINT-IN-TIME IDF (P2, documented decision): the IDF table is built over the
// WHOLE sold corpus, not per-target from priors only. Rebuilding vectors per
// target (or per period) would multiply the replay's cost by the number of
// periods and, more importantly, production ITSELF values an upcoming lot with
// the full-corpus IDF of the build day — so the full-corpus table is what makes
// replay rows comparable to live rows. The leak is a token WEIGHTING effect on
// the cosine (a word that later became common reads slightly less rare), never
// a price leak: no later sale's price can enter a target's pool (resolveComps
// filters saleDate < target strictly). Measured proxy: the same-maker vocab is
// stable year over year for the rosters that matter (makers/refs), so the
// admission set is insensitive to it. Revisit only if a yearly-IDF replay is
// ever cheap enough to A/B.
interface ArtistIndex {
  roster: L[];                       // time-sorted sold, same array valueOne walks
  dates: string[];                   // roster[i].saleDate — for the cutoff bisect
  posting: Map<string, number[]>;    // token → ascending roster indices
  idPosting: Map<string, number[]>;  // exact identity key → ascending roster indices
  mark: Int32Array;                  // generation-stamped visited marks
  gen: number;
}

export interface Prepared {
  lots: L[];
  tbl: ReturnType<typeof buildIdf>;
  byArtist: Map<string, L[]>;
  sold: L[];
  marketBySlug: Record<string, string>;
  index: Map<string, ArtistIndex>;
}

/** Exact structured identity key (the idExact path in similarity.ts): numeric
 *  watch reference for watch makers, edition identity for art editions. */
export function identityKeyOf(l: L): string | null {
  if (WATCH_SLUGS.has(l.artist)) return numericWatchRef(l);
  return isEditionLot(l) ? editionIdentityKey(l) : null;
}

export function prepare(allLots: AuctionLot[], log: (m: string) => void, elapsed: () => string): Prepared {
  const lots = allLots as L[];
  const sold = lots.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length);
  const tbl = buildIdf(sold);
  buildVectors(lots as AuctionLot[], tbl); // attach _v/_vn to every lot (priors need it)

  // same-maker sold, time-sorted — comp pools are always SOLD priors
  const byArtist = new Map<string, L[]>();
  for (const s of sold) (byArtist.get(s.artist) || byArtist.set(s.artist, []).get(s.artist)!).push(s);
  byArtist.forEach(g => g.sort((a, b) => (a.saleDate < b.saleDate ? -1 : 1)));

  const marketBySlug: Record<string, string> = {};
  for (const a of ARTISTS) marketBySlug[a.slug] = a.market;

  // per-maker inverted index (see header: the exact candidate pre-filter)
  const index = new Map<string, ArtistIndex>();
  let postings = 0;
  byArtist.forEach((roster, artist) => {
    const posting = new Map<string, number[]>();
    const idPosting = new Map<string, number[]>();
    const dates = new Array<string>(roster.length);
    roster.forEach((l, i) => {
      dates[i] = l.saleDate;
      for (const t of Array.from(new Set(l.titleTokens || []))) { (posting.get(t) || posting.set(t, []).get(t)!).push(i); postings++; }
      const k = identityKeyOf(l);
      if (k) (idPosting.get(k) || idPosting.set(k, []).get(k)!).push(i);
    });
    index.set(artist, { roster, dates, posting, idPosting, mark: new Int32Array(roster.length), gen: 0 });
  });

  log(`[backtest] vectors built (${elapsed()}) — corpus ${lots.length} lots, ${sold.length} sold, ${index.size} maker indices (${postings} postings)`);
  return { lots, tbl, byArtist, sold, marketBySlug, index };
}

/** first index i with dates[i] >= d (all j < i are STRICTLY earlier). */
function lowerBound(dates: string[], d: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; }
  return lo;
}

/** Candidate priors for `lot` that can possibly pass the admission gate,
 *  newest first — the exact subset of the unfiltered prior roster that
 *  resolveComps could ever admit (see header proof). */
export function candidatePriors(prep: Prepared, lot: L): { priors: number; cands: L[] } {
  const ix = prep.index.get(lot.artist);
  if (!ix) return { priors: 0, cands: [] };
  const cut = lowerBound(ix.dates, lot.saleDate);
  if (cut < 3) return { priors: cut, cands: [] };
  const v = lot._v || {};
  const vn = lot._vn || 0;
  ix.gen++;
  if (ix.gen === 0x7fffffff) { ix.mark.fill(0); ix.gen = 1; }
  const gen = ix.gen;
  const hits: number[] = [];
  const visit = (list: number[] | undefined) => {
    if (!list) return;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (i >= cut) break;
      if (ix.mark[i] !== gen) { ix.mark[i] = gen; hits.push(i); }
    }
  };
  if (vn > 0) {
    // heaviest-IDF prefix: stop once the remaining suffix can no longer carry
    // the cosine floor on its own
    const toks = Object.keys(v).sort((a, b) => v[b] - v[a]);
    const floor = FALLBACK_GATE.cosFloor - 1e-9;
    let suffix2 = vn * vn;
    for (const t of toks) {
      if (Math.sqrt(Math.max(0, suffix2)) / vn < floor) break;
      visit(ix.posting.get(t));
      suffix2 -= v[t] * v[t];
    }
  }
  const idk = identityKeyOf(lot);
  if (idk) visit(ix.idPosting.get(idk));
  hits.sort((a, b) => b - a);   // newest first — the order the unfiltered walk produced
  const cands: L[] = [];
  for (const i of hits) { const s = ix.roster[i]; if (s.id !== lot.id) cands.push(s); }
  return { priors: cut, cands };
}

/** Score a single lot exactly as production would have called it on its sale
 *  day: full strictly-earlier same-maker sold roster (no leak, no cap) →
 *  resolveComps → estimateValue. Returns null if the pool is too thin. THE hot
 *  path — O(candidates) per call after the exact pre-filter. */
export function valueOne(prep: Prepared, lot: L) {
  const { priors, cands } = candidatePriors(prep, lot);
  if (priors < 3) return null;
  const comps = resolveComps(lot, cands, prep.tbl, lot.saleDate);
  return estimateValue(lot, comps, prep.tbl);
}

/** The pre-filter-free reference path (kept for the equivalence harness only —
 *  O(roster) per call; never on the nightly path). */
export function valueOneUnfiltered(prep: Prepared, lot: L) {
  const roster = prep.byArtist.get(lot.artist) || [];
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
  const estMid = estMidOf(lot);
  const estTop = estTopOf(lot);
  const et = estKindOf(lot);
  const realized = lot.realizedUsd!;
  // per-house premium schedule via the ONE hammer-inference helper
  // (app/lib/premiums.inferHammerUsd — P1-5: no flat /1.25 anywhere)
  const hammer = inferHammerUsd(lot);
  const isBelow = v.signal.label.startsWith('below');
  const isAbove = v.signal.label.startsWith('above');
  // point-estimate lots (RR "$500+") feed calObs ONLY — the certified global
  // buckets + byYear stay band-basis so their published meaning never shifts
  if (et === 'b') {
    const bucket = isBelow ? st.flagged : isAbove ? st.above : st.unflagged;
    const push = (b: Bucket) => {
      b.perfs.push(realized / estMid - 1);
      b.hammerPerfs.push(hammer / estMid - 1);
      if (realized > estTop) b.beat++;
      if (hammer > estTop) b.hammerBeat++;
      b.n++;
    };
    push(bucket);
    if (isBelow) push(v.tier === 'fallback' ? st.flaggedFallback : st.flaggedMain);
  }

  if (v.compRatio != null && v.compValueUsd > 0) {
    st.calObs.push({
      m: prep.marketBySlug[lot.artist] || 'all',
      cr: v.compRatio,
      beat: realized > estTop,
      r: realized / v.compValueUsd,
      conf: v.confidence,
      ageY: Math.max(0, (st.nowMs - new Date(lot.saleDate).getTime()) / 31_557_600_000),
      pf: realized / estMid - 1,
      fl: isBelow,
      // watches era-gate MEASUREMENT (spec 8a precondition): reference-keyed
      // vs model-name-keyed error splits fall out of the Sunday full replay
      kt: prep.marketBySlug[lot.artist] === 'watches' ? ((lot as L & { reference?: string | null }).reference ? 'ref' : 'model') : undefined,
      et,
      id: lot.id,
      sd: lot.saleDate.slice(0, 10),
      ev: ENGINE_VERSION,
    });
  }

  if (et === 'b') {
    const y = +lot.saleDate.slice(0, 4);
    if (y >= 2000) {
      const yb = st.byYear[y] || { flagged: [], unflagged: [] };
      if (isBelow) yb.flagged.push(realized / estMid - 1);
      else if (!isAbove) yb.unflagged.push(realized / estMid - 1);
      st.byYear[y] = yb;
    }
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

// ── POINT-IN-TIME REPLAY ──
const quarterOf = (sd: string) => `${sd.slice(0, 4)}Q${Math.floor((+sd.slice(5, 7) - 1) / 3) + 1}`;
const quarterStart = (q: string) => `${q.slice(0, 4)}-${String((+q.slice(5) - 1) * 3 + 1).padStart(2, '0')}-01`;

/** Sale day of an observation — stamped `sd` when present, else recovered
 *  from the frozen nowMs anchor and the row's age (day-exact by construction). */
export function obsDate(o: CalObs, nowMs: number): string {
  if (o.sd) return o.sd;
  return new Date(nowMs - o.ageY * 31_557_600_000).toISOString().slice(0, 10);
}

/** Replay a mixed sold + bought-in target list in saleDate order, refitting the
 *  engine calibration at every calendar-quarter boundary from the observations
 *  dated strictly before that quarter (P1-1: the record scores the engine that
 *  production would have run, never the rows it is scoring). Returns counts. */
export function replayTargets(
  prep: Prepared, st: BacktestState, soldTargets: L[], biTargets: L[],
  log: (m: string) => void = () => {}, heartbeatEvery = 20000,
): { scored: number; tried: number } {
  type T = { l: L; bi: boolean };
  const all: T[] = [];
  for (const l of soldTargets) all.push({ l, bi: false });
  for (const l of biTargets) all.push({ l, bi: true });
  all.sort((a, b) => (a.l.saleDate < b.l.saleDate ? -1 : a.l.saleDate > b.l.saleDate ? 1 : 0));
  let curQ = '';
  let scored = 0, tried = 0, done = 0;
  const t0 = Date.now();
  for (const t of all) {
    const q = quarterOf(t.l.saleDate);
    if (q !== curQ) {
      curQ = q;
      setCalibration(calibrationFor(st, quarterStart(q), prep.marketBySlug));
    }
    const ok = t.bi ? scoreBoughtIn(prep, st, t.l) : scoreSold(prep, st, t.l);
    if (ok) { st.scoredIds.push(t.l.id); scored++; }
    else { (st.triedIds || (st.triedIds = [])).push(t.l.id); tried++; }
    if (++done % heartbeatEvery === 0) log(`[backtest] replay ${done}/${all.length} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${(done / ((Date.now() - t0) / 1000)).toFixed(1)}/s) — ${curQ}`);
  }
  setCalibration(null);
  return { scored, tried };
}

/** Calibration production would have loaded on day `before` (exclusive):
 *  the summariser's calibration block refit over observations dated earlier.
 *  Under 500 rows → null (the engine's hardcoded holdout fallback applies). */
export function calibrationFor(st: BacktestState, before: string, marketBySlug: Record<string, string>): EngineCalibration | null {
  const rows = st.calObs.filter(o => obsDate(o, st.nowMs) < before);
  if (rows.length < 500) return null;
  const c = calibrationOf(rows);
  return { edges: c.edges, beatRate: c.beatRate, band: c.band, bandByMarket: c.bandByMarket, mdape: c.mdape, marketBySlug };
}

// ── REHYDRATION (P0-1a) ──
/** Repair a legacy state whose calObs rows predate a field. pf/fl/et are
 *  arithmetic identities of the row itself (pf = realized/estMid − 1 =
 *  r·cr − 1, up to the ±$0.5 rounding of compValueUsd; fl under the
 *  uncalibrated legacy replay was exactly cr ≥ 1.3; et = 'b' before single-
 *  point support landed Aug 14). kt is a lot property, recovered where the
 *  (market, saleDate) cohort is unambiguous. Never forces a full rebuild. */
export function rehydrateState(st: BacktestState, prep: Prepared | null, log: (m: string) => void): { pf: number; fl: number; et: number; sd: number; kt: number } {
  const n = { pf: 0, fl: 0, et: 0, sd: 0, kt: 0 };
  const watchKtByDay = new Map<string, string | null>();
  if (prep) {
    const byId = new Map<string, L>();
    for (const l of prep.lots) byId.set(String(l.id), l);
    for (const id of st.scoredIds) {
      const l = byId.get(String(id));
      if (!l || prep.marketBySlug[l.artist] !== 'watches' || l.status !== 'sold') continue;
      const kt = (l as L & { reference?: string | null }).reference ? 'ref' : 'model';
      const day = l.saleDate.slice(0, 10);
      const prev = watchKtByDay.get(day);
      watchKtByDay.set(day, prev === undefined ? kt : prev === kt ? kt : null);
    }
  }
  for (const o of st.calObs) {
    if (typeof o.pf !== 'number' && o.r > 0 && o.cr > 0) { o.pf = o.r * o.cr - 1; n.pf++; }
    if (typeof o.fl !== 'boolean') { o.fl = o.cr >= 1.3; n.fl++; }
    if (o.et !== 'b' && o.et !== 'p') { o.et = 'b'; n.et++; }
    if (!o.sd) { o.sd = obsDate(o, st.nowMs); n.sd++; }
    if (o.m === 'watches' && !o.kt) { const kt = watchKtByDay.get(o.sd); if (kt) { o.kt = kt; n.kt++; } }
  }
  if (!st.triedIds) st.triedIds = [];
  if (n.pf || n.fl || n.et || n.sd || n.kt) log(`[backtest] rehydrated legacy state: pf ${n.pf} · fl ${n.fl} · et ${n.et} · sd ${n.sd} · kt ${n.kt} (of ${st.calObs.length} rows)`);
  return n;
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

// ── CALIBRATION (factored so the point-in-time replay and the summary share it) ──
export const CAL_EDGES = [0.6, 0.9, 1.3, 2.0, 10];
export const CONFS = ['high', 'medium', 'low'] as const;
const BAND_MIN_N = 150;
const bucketOf = (cr: number) => { let b = 0; for (const e of CAL_EDGES) { if (cr < e) break; b++; } return b; }; // 0..5
const wOf = (o: { ageY: number }) => Math.pow(0.5, o.ageY / 3);
const marketsOf = (obs: CalObs[]) => Array.from(new Set(obs.map(o => o.m).filter(m => m && m !== 'all')));

/** Split-conformal 15/85 band from a sorted realized/compValue array (lerp
 *  quantile — the ONE quantile convention, app/lib/value.quantile). */
function bandOfSorted(src: number[]) {
  return { lo: Math.round(Math.min(1, Math.max(0.3, quantile(src, 0.15))) * 1000) / 1000, hi: Math.round(Math.min(4, Math.max(1, quantile(src, 0.85))) * 1000) / 1000 };
}

export type Band = { lo: number; hi: number };
export function calibrationOf(calObs: CalObs[]) {
  const rate = (obs: CalObs[]) => {
    const acc = Array.from({ length: 6 }, () => ({ w: 0, wb: 0, n: 0 }));
    for (const o of obs) { const b = bucketOf(o.cr); const w = wOf(o); acc[b].w += w; acc[b].wb += o.beat ? w : 0; acc[b].n++; }
    return acc;
  };
  const globalAcc = rate(calObs);
  const globalLevels = globalAcc.map(a => (a.w > 0 ? a.wb / a.w : 0.55));
  const K = 60;
  const levelsOf = (obs: CalObs[]) => {
    const acc = rate(obs);
    const lv = acc.map((a, b) => {
      if (a.n < 100) return globalLevels[b];
      return (a.wb + K * globalLevels[b]) / (a.w + K);
    });
    for (let b = 1; b <= 4; b++) lv[b] = Math.max(lv[b], lv[b - 1]);
    return lv.map(x => Math.round(Math.min(0.85, Math.max(0.3, x)) * 100));
  };
  const allR = calObs.map(o => o.r).sort((a, b) => a - b);
  const bandFor = (conf: string, rows: CalObs[] = calObs, fallback: number[] = allR): Band => {
    const rs = rows.filter(o => o.conf === conf).map(o => o.r).sort((a, b) => a - b);
    const src = rs.length >= BAND_MIN_N ? rs : fallback;
    if (!src.length) return { lo: 0.3, hi: 4 };
    return bandOfSorted(src);
  };
  const band: Record<string, Band> = { high: bandFor('high'), medium: bandFor('medium'), low: bandFor('low') };
  // PER-MARKET BANDS (P1-2): a market's own 15/85 where it has ≥150 rows for
  // that tier; otherwise the global tier band. Only markets with at least one
  // own band are emitted (the engine falls back to `band` for the rest).
  const bandByMarket: Record<string, Record<string, Band>> = {};
  for (const m of marketsOf(calObs)) {
    const rows = calObs.filter(o => o.m === m);
    const own: Record<string, Band> = {};
    let any = false;
    for (const c of CONFS) {
      const rs = rows.filter(o => o.conf === c);
      if (rs.length >= BAND_MIN_N) { own[c] = bandFor(c, rows); any = true; } else own[c] = band[c];
    }
    if (any) bandByMarket[m] = own;
  }
  // PER-MARKET MdAPE by tier (P2): median |1/r − 1| — the error a buyer
  // experiences (|value − realized| / realized). The engine reads it to keep
  // 'high' honest (≤30% MdAPE) per market.
  const mdape: Record<string, Record<string, number | null>> = {};
  for (const m of marketsOf(calObs).concat('all')) {
    const rows = m === 'all' ? calObs : calObs.filter(o => o.m === m);
    mdape[m] = {};
    for (const c of CONFS) {
      const errs = rows.filter(o => o.conf === c && o.r > 0).map(o => Math.abs(1 / o.r - 1)).sort((a, b) => a - b);
      mdape[m][c] = errs.length >= 100 ? Math.round(quantile(errs, 0.5) * 1000) / 1000 : null;
    }
  }
  const beatRate: Record<string, number[]> = {
    global: globalLevels.map(x => Math.round(Math.min(0.85, Math.max(0.3, x)) * 100)),
  };
  // EVERY market present gets a row (science/culture/sports ran on the
  // global fallback before), plus a ':pt' split where single-point (RR)
  // observations are deep enough — "beat" means beating the LOW estimate
  // there, a different claim that must never blend into the band rows.
  for (const m of marketsOf(calObs)) {
    const bandRows = calObs.filter(o => o.m === m && o.et !== 'p');
    if (bandRows.length >= 100) beatRate[m] = levelsOf(bandRows);
    const pt = calObs.filter(o => o.m === m && o.et === 'p');
    if (pt.length >= 200) beatRate[`${m}:pt`] = levelsOf(pt);
  }
  return { edges: CAL_EDGES, beatRate, band, bandByMarket, mdape, bandFor, n: calObs.length };
}

/** OUT-OF-SAMPLE band coverage (P1-2): per market, fit the 15/85 tier bands on
 *  the OLDER half of that market's rows (by sale day) and measure how many of
 *  the NEWER half's realized prices landed inside. Fit uses the market's own
 *  tier band when it has ≥150 fit rows, else the global fit-half band. */
export function bandCoverageOOS(calObs: CalObs[], nowMs: number) {
  const dated = calObs.filter(o => o.r > 0).map(o => ({ o, d: obsDate(o, nowMs) })).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const out: Record<string, { high: number | null; medium: number | null; low: number | null; nFit: number; nTest: number; split: string | null }> = {};
  if (!dated.length) return out;
  for (const m of marketsOf(calObs).concat('all')) {
    const rows = m === 'all' ? dated : dated.filter(x => x.o.m === m);
    if (!rows.length) continue;
    // the split is THIS market's median sale day, so every market is tested on
    // its own newer half (a global split left thin/recent markets all-test)
    const split = rows[Math.floor(rows.length / 2)].d;
    const fit = rows.filter(x => x.d < split).map(x => x.o);
    const test = rows.filter(x => x.d >= split).map(x => x.o);
    const cell: (typeof out)[string] = { high: null, medium: null, low: null, nFit: fit.length, nTest: test.length, split: fit.length && test.length ? split : null };
    if (fit.length && test.length) {
      // global fallback bands are fit on EVERY market's rows before this split
      const globalFit = calibrationOf(dated.filter(x => x.d < split).map(x => x.o));
      for (const c of CONFS) {
        const fitRows = fit.filter(o => o.conf === c);
        const b = fitRows.length >= BAND_MIN_N ? globalFit.bandFor(c, fit) : globalFit.band[c];
        const t = test.filter(o => o.conf === c);
        cell[c] = t.length >= 100 ? Math.round(100 * t.filter(o => o.r >= b.lo && o.r <= b.hi).length / t.length) : null;
      }
    }
    out[m] = cell;
  }
  return out;
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

  const calObs = st.calObs;
  const cal = calibrationOf(calObs);
  // PER-MARKET RECORD (Aug 13 value audit): the +41/+16 receipt was global-
  // only — a watches user read an art/design-dominant number. Split it.
  const byMarket: Record<string, { flagged: { n: number; medPct: number | null }; unflagged: { n: number; medPct: number | null } }> = {};
  {
    const medOf = (a: number[]) => { if (a.length < 50) return null; const x = [...a].sort((p, q) => p - q); return Math.round(x[Math.floor(x.length / 2)] * 1000) / 10; };
    for (const m of marketsOf(calObs)) {
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
  // CONFORMAL BAND COVERAGE — IN-SAMPLE (kept for continuity; the honest
  // number is bandCoverageOOS below, which the UI must cite)
  const bandCoverage: Record<string, number | null> = {};
  for (const conf of CONFS) {
    const b = cal.band[conf];
    const rows = calObs.filter(o => o.conf === conf && o.r > 0);
    bandCoverage[conf] = rows.length >= 100
      ? Math.round(100 * rows.filter(o => o.r >= b.lo && o.r <= b.hi).length / rows.length)
      : null;
  }
  const onVersion = calObs.filter(o => o.ev === ENGINE_VERSION).length;
  const calibration = {
    edges: cal.edges,
    watchKt,
    bandCoverage,
    bandCoverageOOS: bandCoverageOOS(calObs, st.nowMs),
    beatRate: cal.beatRate,
    band: cal.band,
    bandByMarket: cal.bandByMarket,
    mdape: cal.mdape,
    n: calObs.length,
  };

  return {
    generatedAt,
    engineVersion: ENGINE_VERSION,
    stateEngineVersion: st.engineVersion || null,
    /** share of observations scored on the current engine version — <100 means
     *  the record still carries rows from an older labeler (refresh with a
     *  per-market full leg) */
    rowsOnVersionPct: calObs.length ? Math.round(1000 * onVersion / calObs.length) / 10 : 0,
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
    `| rowsOnVersion ${out.rowsOnVersionPct}%`,
  ].join(' ');
}

/** A record is publishable only if it carries observations. Throws otherwise
 *  so the entry points exit non-zero instead of shipping an empty summary. */
export function assertRecord(out: ReturnType<typeof summarizeState>): void {
  if (!(out.calibration.n > 0) || !(out.flagged.n + out.unflagged.n + out.above.n > 0)) {
    throw new Error(`[backtest] refusing to publish an empty record (calObs ${out.calibration.n}, buckets ${out.flagged.n}/${out.unflagged.n}/${out.above.n})`);
  }
}

/** Split the corpus into the sold + bought-in TARGET sets (concluded lots with
 *  a usable estimate). Shared so both entry points draw targets from the same
 *  predicate; the incremental just filters these by close-date afterward. */
export function targetsOf(prep: Prepared, market?: string | null): { soldTargets: L[]; biTargets: L[] } {
  const inMarket = (l: L) => !market || (prep.marketBySlug[l.artist] || 'other') === market;
  const soldTargets = prep.sold.filter(l => hasAnyEst(l) && inMarket(l));   // band + single-point (RR)
  const biTargets = prep.lots.filter(l => l.status === 'bought_in' && l.saleDate && l.titleTokens && l.titleTokens.length && hasEst(l) && inMarket(l));
  return { soldTargets, biTargets };
}
