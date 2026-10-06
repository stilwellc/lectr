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
import { resolveComps, estimateValue, setCalibration, setTimeIndex, setHouseBias, getEngineFlags, houseFactorOf, adjustedTop, BAND_TOP_RATIO, knownKey, FALLBACK_GATE, APPLY_NOEST_BIAS, MAXBID_Q, ENGINE_VERSION, quantile, type EngineCalibration, type TimeIndex, type HouseBias } from '../app/lib/value';
import { makeTimeIndexer, makeHouseBiasIndexer } from '../app/lib/indices';
import { gateCell, type CardGateCell } from '../app/lib/cards-gate';
import { weightedMedian, weightedQuantile, medianSorted } from '../app/lib/stats';
import { isCompExcluded } from '../app/lib/comps';
import { numericWatchRef, editionIdentityKey, isEditionLot, WATCH_SLUGS } from '../app/lib/identity';
import { ARTISTS } from '../app/constants';
import type { AuctionLot } from '../app/types';

export type L = AuctionLot & { _v?: Record<string, number>; _vn?: number; estLowUsd?: number; estHighUsd?: number; realizedUsd?: number; hammerUsd?: number | null };

/** THE engine version (defined in app/lib/value.ts — ENGINE_FLAGS_CURRENT —
 *  so every served value can stamp it; re-exported here for the record).
 *  Bump whenever scoring/labeling logic changes in a way that makes older
 *  rows non-comparable. The summary reports the share of rows on this version;
 *  a per-market full leg (build-backtest --market) refreshes a market.
 *  2026.09.27: time-adjusted comps + the estimate-lot blend + no-estimate
 *  bias + form/part gate + compExclude + month/year-precision PIT cuts.
 *  2026.10.03: house-normalized Flags (flag ratio vs the house-adjusted
 *  estimate) + the house-habit anchor + the buyer's fields + card gate. */
export { ENGINE_VERSION };
/** the version stamped on a row scored NOW (the flag set in force — the
 *  candidate's when a comparison harness switched it in) */
const evNow = () => getEngineFlags().version;

// global premium fallback where the house didn't publish a hammer — measured
// median realized/hammer is 1.25. Kept as the last-resort constant; the
// per-house schedule (app/lib/premiums) now takes precedence at the use site.
export const PREMIUM_FALLBACK = 1.25;
import { inferHammerUsd } from '../app/lib/premiums';

/** median of an ascending-sorted array — stats.medianSorted with the record's
 *  historical 0-on-empty contract (summaries print 0 for an empty bucket) */
export function median(sorted: number[]): number {
  const m = medianSorted(sorted);
  return Number.isNaN(m) ? 0 : m;
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
  /** (Sep 27) time-adjusted comps / estimate mid — the blend's comp input
   *  (absent on legacy rows → cr) */
  ca?: number;
  /** (Sep 27) realized / the PUBLISHED value (compValueUsd) */
  rp?: number;
  /** (Sep 27) the published band as multiples of the published value (the
   *  band the lot WOULD have shown — its coverage is measured, not refit) */
  bl?: number; bh?: number;
  /** (Sep 27) auction house — the blend's house × market intercept */
  h?: string;
  /** (Oct 3) the FLAG ratio the signal was called on (comps / house-adjusted
   *  estimate mid); absent on legacy rows → cr. The beat-rate calibration
   *  buckets on fr ?? cr. */
  fr?: number;
  /** (Oct 3) the buyer's fields as multiples of the expected hammer: actual
   *  hammer (xh), and the max bid (bm). bl/bh are the band multiples. */
  xh?: number; bm?: number;
  /** (Oct 3) the house habit (house-bias index cell, log realized / estimate
   *  mid) the lot was anchored on — the anchor blend's refit input */
  hl?: number;
  /** (Oct 3) realized beat the HOUSE-ADJUSTED top (value.adjustedTop) */
  ba?: boolean;
  /** (Oct 6) the call was 'above comparable market' (absent on older rows →
   *  isAboveObs recovers it from the label rule) */
  ab?: boolean;
};
/** (Sep 27) a NO-ESTIMATE hedonic observation — the pure comp path's record
 *  (Goldin/no-estimate objects). Feeds the no-estimate bias correction and
 *  the 'n' value band; never the beat-rate/flag record (no estimate, no flag). */
export type NoEstObs = {
  m: string; conf: string;
  /** realized / the pure (time-adjusted) comp value */
  rn: number;
  /** realized / the published value */
  rp?: number;
  /** the published band as multiples of the published value */
  bl?: number; bh?: number;
  /** (Oct 3) actual hammer / expected hammer, max bid / expected hammer */
  xh?: number; bm?: number;
  sd: string; id: string; ev: string;
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
  /** (Sep 27) no-estimate observations (trailing window only — see targetsOf) */
  noEst?: NoEstObs[];
}

export const mkBucket = (): Bucket => ({ perfs: [], hammerPerfs: [], beat: 0, hammerBeat: 0, n: 0, boughtIn: 0 });

export function mkState(nowMs: number): BacktestState {
  return {
    flagged: mkBucket(), unflagged: mkBucket(), above: mkBucket(),
    flaggedMain: mkBucket(), flaggedFallback: mkBucket(),
    byYear: {}, calObs: [], nowMs, scoredIds: [], triedIds: [], engineVersion: ENGINE_VERSION,
    noEst: [],
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
    for (const o of s.noEst || []) out.noEst!.push(o);
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
  /** point-in-time market index builder (value.timeFactor's input) — the
   *  replay sets the index for each quarter from sales known before it */
  timeIndexer?: (asOf: string) => TimeIndex;
  /** (Oct 3) point-in-time house-bias index builder (value.houseFactorOf's
   *  input) — refit per quarter alongside the time index */
  houseBiasIndexer?: (asOf: string) => HouseBias;
}

/** SPORTS markets value a lot against its SAME-PLAYER comps only (build-market
 *  §1 doctrine — a Jordan jersey never comps a LeBron one). The replay mirrors
 *  it on the build-stamped identity (playerSlug, else entity). */
const SPORTS_MARKET = 'sports';
const playerIdOf = (l: L): string | null => {
  const x = l as L & { playerSlug?: string | null; entity?: string | null };
  return x.playerSlug || (x.entity ? x.entity.toLowerCase().trim() : null);
};

/** Exact structured identity key (the idExact path in similarity.ts): numeric
 *  watch reference for watch makers, edition identity for art editions. */
export function identityKeyOf(l: L): string | null {
  if (WATCH_SLUGS.has(l.artist)) return numericWatchRef(l);
  return isEditionLot(l) ? editionIdentityKey(l) : null;
}

export function prepare(allLots: AuctionLot[], log: (m: string) => void, elapsed: () => string): Prepared {
  const lots = allLots as L[];
  // compExclude-stamped lots (data contract: junk price, duplicate listing)
  // are never a comp and never a target
  const sold = lots.filter(l => l.status === 'sold' && (l.realizedUsd || 0) > 0 && l.saleDate && l.titleTokens && l.titleTokens.length && !isCompExcluded(l));
  const tbl = buildIdf(sold);
  buildVectors(lots as AuctionLot[], tbl); // attach _v/_vn to every lot (priors need it)

  // same-maker sold, sorted by the day each sale became KNOWN (knownKey: a
  // month-precision sale is known once its month ends) — comp pools are
  // always SOLD priors, and the cutoff bisect below runs on this order
  const byArtist = new Map<string, L[]>();
  for (const s of sold) (byArtist.get(s.artist) || byArtist.set(s.artist, []).get(s.artist)!).push(s);
  const kk = new Map<L, string>();
  for (const s of sold) kk.set(s, knownKey(s as L & { datePrecision?: string | null }));
  byArtist.forEach(g => g.sort((a, b) => (kk.get(a)! < kk.get(b)! ? -1 : kk.get(a)! > kk.get(b)! ? 1 : 0)));

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
      dates[i] = kk.get(l)!;
      for (const t of Array.from(new Set(l.titleTokens || []))) { (posting.get(t) || posting.set(t, []).get(t)!).push(i); postings++; }
      const k = identityKeyOf(l);
      if (k) (idPosting.get(k) || idPosting.set(k, []).get(k)!).push(i);
    });
    index.set(artist, { roster, dates, posting, idPosting, mark: new Int32Array(roster.length), gen: 0 });
  });

  log(`[backtest] vectors built (${elapsed()}) — corpus ${lots.length} lots, ${sold.length} sold, ${index.size} maker indices (${postings} postings)`);
  const timeIndexer = makeTimeIndexer(lots as AuctionLot[], marketBySlug);
  const houseBiasIndexer = makeHouseBiasIndexer(lots as AuctionLot[], marketBySlug);
  return { lots, tbl, byArtist, sold, marketBySlug, index, timeIndexer, houseBiasIndexer };
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
  const comps = compsOne(prep, lot);
  return comps ? estimateValue(lot, comps, prep.tbl) : null;
}

/** The resolved comp pool valueOne prices from (null under 3 priors) — split
 *  out so a comparison harness can price ONE pool under two engines. */
export function compsOne(prep: Prepared, lot: L) {
  const { priors, cands } = candidatePriors(prep, lot);
  if (priors < 3) return null;
  return resolveComps(lot, samePlayerOnly(prep, lot, cands), prep.tbl, lot.saleDate);
}

/** Sports: a KNOWN player comps same-player only (build-market §1). */
function samePlayerOnly(prep: Prepared, lot: L, cands: L[]): L[] {
  if (prep.marketBySlug[lot.artist] !== SPORTS_MARKET) return cands;
  const pid = playerIdOf(lot);
  return pid ? cands.filter(c => playerIdOf(c) === pid) : cands;
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
  const comps = resolveComps(lot, samePlayerOnly(prep, lot, priors), prep.tbl, lot.saleDate);
  return estimateValue(lot, comps, prep.tbl);
}

/** Fold ONE sold target into the accumulators — the body of the sold-replay
 *  loop, extracted so both entry points score a sold lot identically. Records
 *  the id and returns true when the lot produced a scored (signal) observation. */
/** (Oct 3) the buyer's-field observation: actual hammer and max bid as
 *  multiples of the expected hammer the lot would have worn */
function buyerObs(v: { expectedHammerUsd?: number; maxBidUsd?: number }, hammer: number): { xh?: number; bm?: number } {
  const x = v.expectedHammerUsd || 0;
  if (!(x > 0) || !(hammer > 0)) return {};
  const r4b = (n: number) => Math.round(n * 10000) / 10000;
  return { xh: r4b(hammer / x), ...((v.maxBidUsd || 0) > 0 ? { bm: r4b(v.maxBidUsd! / x) } : {}) };
}

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
  // the house's estimate habit at scoring time (house-bias index for this
  // quarter) — the adjusted top the Flags' odds are graded against
  const hfx = houseFactorOf(prep.marketBySlug[lot.artist], lot.auctionHouse, et);
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
    // r stays "realized / the COMP value" (the pool's own error — mdape and
    // the legacy conformal band read it); rp is realized / the PUBLISHED
    // prediction; ca is the time-adjusted comp ratio the blend learns from
    const compMed = v.compAdjUsd && v.compAdjUsd > 0 ? v.compAdjUsd : v.compValueUsd;
    st.calObs.push({
      m: prep.marketBySlug[lot.artist] || 'all',
      cr: v.compRatio,
      ...(v.flagRatio != null ? { fr: v.flagRatio } : {}),
      ...(hfx ? { hl: Math.round(hfx.log * 10000) / 10000 } : {}),
      ba: realized > adjustedTop(lot.estLowUsd, lot.estHighUsd, hfx?.f),
      beat: realized > estTop,
      r: realized / compMed,
      ca: compMed / estMid,
      rp: realized / v.compValueUsd,
      bl: v.low / v.compValueUsd,
      bh: v.high / v.compValueUsd,
      ...buyerObs(v, hammer),
      ...(lot.auctionHouse ? { h: String(lot.auctionHouse) } : {}),
      conf: v.confidence,
      ageY: Math.max(0, (st.nowMs - new Date(lot.saleDate).getTime()) / 31_557_600_000),
      pf: realized / estMid - 1,
      fl: isBelow,
      ab: isAbove,
      // watches era-gate MEASUREMENT (spec 8a precondition): reference-keyed
      // vs model-name-keyed error splits fall out of the Sunday full replay
      kt: prep.marketBySlug[lot.artist] === 'watches' ? ((lot as L & { reference?: string | null }).reference ? 'ref' : 'model') : undefined,
      et,
      id: lot.id,
      sd: lot.saleDate.slice(0, 10),
      ev: evNow(),
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

/** Fold ONE sold NO-ESTIMATE target (Sep 27): the pure comp path's outcome —
 *  realized vs the time-adjusted comp value and vs the published value. */
export function scoreNoEst(prep: Prepared, st: BacktestState, lot: L): boolean {
  const v = valueOne(prep, lot);
  if (!v || !(v.compValueUsd > 0)) return false;
  const compMed = v.compAdjUsd && v.compAdjUsd > 0 ? v.compAdjUsd : v.compValueUsd;
  (st.noEst || (st.noEst = [])).push({
    m: prep.marketBySlug[lot.artist] || 'all',
    conf: v.confidence,
    rn: lot.realizedUsd! / compMed,
    rp: lot.realizedUsd! / v.compValueUsd,
    bl: v.low / v.compValueUsd,
    bh: v.high / v.compValueUsd,
    ...buyerObs(v, inferHammerUsd(lot)),
    sd: lot.saleDate.slice(0, 10), id: lot.id, ev: evNow(),
  });
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
  noEstTargets: L[] = [],
): { scored: number; tried: number } {
  type T = { l: L; k: 'sold' | 'bi' | 'noest' };
  const all: T[] = [];
  for (const l of soldTargets) all.push({ l, k: 'sold' });
  for (const l of biTargets) all.push({ l, k: 'bi' });
  for (const l of noEstTargets) all.push({ l, k: 'noest' });
  all.sort((a, b) => (a.l.saleDate < b.l.saleDate ? -1 : a.l.saleDate > b.l.saleDate ? 1 : 0));
  let curQ = '';
  let scored = 0, tried = 0, done = 0;
  const t0 = Date.now();
  for (const t of all) {
    const q = quarterOf(t.l.saleDate);
    if (q !== curQ) {
      curQ = q;
      // the calibration AND the market time index production would have had
      // loaded that quarter — both from data strictly before it
      setCalibration(calibrationFor(st, quarterStart(q), prep.marketBySlug));
      setTimeIndex(prep.timeIndexer ? prep.timeIndexer(quarterStart(q)) : null);
      setHouseBias(prep.houseBiasIndexer ? prep.houseBiasIndexer(quarterStart(q)) : null);
    }
    const ok = t.k === 'bi' ? scoreBoughtIn(prep, st, t.l) : t.k === 'noest' ? scoreNoEst(prep, st, t.l) : scoreSold(prep, st, t.l);
    if (ok) { st.scoredIds.push(t.l.id); scored++; }
    else { (st.triedIds || (st.triedIds = [])).push(t.l.id); tried++; }
    if (++done % heartbeatEvery === 0) log(`[backtest] replay ${done}/${all.length} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${(done / ((Date.now() - t0) / 1000)).toFixed(1)}/s) — ${curQ}`);
  }
  setCalibration(null);
  setTimeIndex(null);
  setHouseBias(null);
  return { scored, tried };
}

/** Calibration production would have loaded on day `before` (exclusive):
 *  the summariser's calibration block refit over observations dated earlier.
 *  Under 500 rows → null (the engine's hardcoded holdout fallback applies). */
export function calibrationFor(st: BacktestState, before: string, marketBySlug: Record<string, string>): EngineCalibration | null {
  const rows = st.calObs.filter(o => obsDate(o, st.nowMs) < before);
  if (rows.length < 500) return null;
  const ne = (st.noEst || []).filter(o => o.sd < before);
  const c = calibrationOf(rows, ne, before);
  return {
    edges: c.edges, beatRate: c.beatRate, band: c.band, bandByMarket: c.bandByMarket, mdape: c.mdape, marketBySlug,
    blend: c.blend, bias: c.bias, valueBand: c.valueBand, valueBandByMarket: c.valueBandByMarket,
    noEstGate: c.noEstGate,
  };
}

// ── REHYDRATION (P0-1a) ──
/** Repair a legacy state whose calObs rows predate a field. pf/fl/et are
 *  arithmetic identities of the row itself (pf = realized/estMid − 1 =
 *  r·cr − 1, up to the ±$0.5 rounding of compValueUsd; fl under the
 *  uncalibrated legacy replay was exactly cr ≥ 1.3; et = 'b' before single-
 *  point support landed Aug 14). kt is a lot property, recovered where the
 *  (market, saleDate) cohort is unambiguous. Never forces a full rebuild. */
export function rehydrateState(
  st: BacktestState, prep: Prepared | null, log: (m: string) => void,
  houseBiasIndexer: ((asOf: string) => HouseBias) | null = prep?.houseBiasIndexer ?? null,
): { pf: number; fl: number; et: number; sd: number; kt: number; hb: number } {
  const n = { pf: 0, fl: 0, et: 0, sd: 0, kt: 0, hb: 0 };
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
    // (Oct 3) the house habit + adjusted beat for rows scored before the
    // house-bias index existed: the index as of the row's quarter, read at the
    // row's own house cell when it carries one, else its MARKET cell (legacy
    // rows carry no house; every single-point row is RR's, whose market cell
    // it is). The band top is approximated by BAND_TOP_RATIO × mid. The next
    // full replay replaces every approximation with the exact figure.
    if (houseBiasIndexer && (typeof o.hl !== 'number' || typeof o.ba !== 'boolean') && typeof o.pf === 'number' && o.sd) {
      const hf = houseFactorOf(o.m, o.h ?? null, o.et === 'p' ? 'p' : 'b', houseBiasIndexer(quarterStart(quarterOf(o.sd))));
      if (hf) {
        if (typeof o.hl !== 'number') o.hl = Math.round(hf.log * 10000) / 10000;
        if (typeof o.ba !== 'boolean') o.ba = (o.pf + 1) > BAND_TOP_RATIO * hf.f;
        n.hb++;
      }
    }
  }
  if (!st.triedIds) st.triedIds = [];
  if (!st.noEst) st.noEst = [];
  if (n.pf || n.fl || n.et || n.sd || n.kt || n.hb) log(`[backtest] rehydrated legacy state: pf ${n.pf} · fl ${n.fl} · et ${n.et} · sd ${n.sd} · kt ${n.kt} · house habit ${n.hb} (of ${st.calObs.length} rows)`);
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
export function calibrationOf(calObs: CalObs[], noEst: NoEstObs[] = [], asOf?: string) {
  // (Oct 3) under the house-normalized Flags the odds are P(realized beats
  // the HOUSE-ADJUSTED top | flag-ratio bucket) — `ba`; legacy rows without
  // it (and the legacy engine) read the raw beat
  const normed = getEngineFlags().houseNormFlags;
  const beatOf = (o: CalObs) => (normed && typeof o.ba === 'boolean' ? o.ba : o.beat);
  const rate = (obs: CalObs[]) => {
    const acc = Array.from({ length: 6 }, () => ({ w: 0, wb: 0, n: 0 }));
    for (const o of obs) { const b = bucketOf(normed ? (o.fr ?? o.cr) : o.cr); const w = wOf(o); acc[b].w += w; acc[b].wb += beatOf(o) ? w : 0; acc[b].n++; }
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
  // (Sep 27) the published-value layer: estimate-lot blend, no-estimate bias,
  // and the outcome bands of the PUBLISHED value — all recency-weighted and
  // fit only on the rows handed in (the replay hands in rows before the quarter)
  const ref = asOf || latestDate(calObs, noEst);
  const blend = fitBlend(calObs, ref);
  const bias = fitNoEstBias(noEst, ref);
  const vb = fitValueBands(calObs, noEst, blend, bias, ref);
  return {
    edges: CAL_EDGES, beatRate, band, bandByMarket, mdape, bandFor, n: calObs.length,
    blend: blend ?? undefined, bias, valueBand: vb.valueBand, valueBandByMarket: vb.valueBandByMarket,
    noEstGate: fitNoEstGate(noEst, ref),
  };
}

/* ── THE PUBLISHED-VALUE CALIBRATION (Sep 27 2026) ─────────────────────── */
const PV_HL_Y = 1.5;          // recency half-life for every fit below
const PV_WINDOW_Y = 6;        // blend/band fit window
const BIAS_WINDOW_Y = 4;
const BLEND_K = 30;           // intercept shrink (effective weight) toward the global:et intercept
const BIAS_K = 30;            // no-estimate bias shrink toward 1
const VB_MIN_N = 100;         // a path×tier band needs this many rows
const VB_MARKET_MIN_N = 150;  // a market's own band needs this many rows
const VB_PER_MARKET = false;  // measured worse out of sample (see fitValueBands)
const VB_WINDOW_Y = 6;        // band residual window
const VB_HL_Y = 1.5;          // band residual recency half-life
/** lower quantile (upper = 1 − VB_Q) of the in-sample residuals. 0.15/0.85
 *  is nominally 70%, but out of sample (local PIT replay, test year Oct 25 →
 *  Sep 26, n=8,554 estimate lots) it covered 65.7% (high 68 / medium 67 /
 *  low 65) — residual spread grows out of sample. 0.13/0.87 delivered 70.1%
 *  (72 / 72 / 69.5); window (3y vs 6y) and half-life (0.75y vs 1.5y) moved
 *  coverage < 1pt. */
const VB_Q = 0.13;
const yrsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 31_557_600_000;
const wmedian = (pairs: [number, number][]) => weightedMedian(pairs);

function latestDate(calObs: CalObs[], noEst: NoEstObs[]): string {
  let d = '';
  for (const o of calObs) if (o.sd && o.sd > d) d = o.sd;
  for (const o of noEst) if (o.sd > d) d = o.sd;
  return d || new Date().toISOString().slice(0, 10);
}

type BlendPt = { cell: string; et: 'b' | 'p'; m: string; h?: string; conf: string; x: number; y: number; wt: number; hl?: number };
function blendPoints(rows: CalObs[], ref: string): BlendPt[] {
  const out: BlendPt[] = [];
  for (const o of rows) {
    const x0 = o.ca ?? o.cr;
    if (!o.sd || typeof o.pf !== 'number' || !(o.pf > -1) || !(x0 > 0)) continue;
    const age = yrsBetween(o.sd, ref);
    if (!(age >= 0) || age > PV_WINDOW_Y) continue;
    const et = o.et === 'p' ? 'p' : 'b';
    out.push({ cell: `${o.m}:${et}`, et, m: o.m, h: o.h, conf: o.conf, x: Math.log(x0), y: Math.log(o.pf + 1), wt: Math.pow(0.5, age / PV_HL_Y), ...(typeof o.hl === 'number' ? { hl: o.hl } : {}) });
  }
  return out;
}
/** blend intercept key for a house within a market (value.blendPredict reads it) */
export const houseCellKey = (market: string, house: string, et: string) => `${market}|${house}:${et}`;

/** Point-in-time LAD fit of log(realized/estMid) = a[market:et] + w[tier]·log(comps/estMid).
 *  w per tier on a 0.05 grid (the cell intercepts re-fit for each candidate w, so
 *  single-point and band estimates never share an intercept), then each cell's
 *  intercept is the weighted median residual shrunk toward its global:et
 *  intercept. Null under 300 usable rows (the engine's uncalibrated
 *  house × premium × comps^w fallback applies). */
export function fitBlend(rows: CalObs[], ref: string): NonNullable<EngineCalibration['blend']> | null {
  const pts = blendPoints(rows, ref);
  if (pts.length < 300) return null;
  const DEF: Record<string, number> = { high: 0.4, medium: 0.25, low: 0.05 };
  const cellsOf = (ps: BlendPt[], wOf: (p: BlendPt) => number) => {
    const acc = new Map<string, [number, number][]>();
    for (const p of ps) (acc.get(p.cell) || acc.set(p.cell, []).get(p.cell)!).push([p.y - wOf(p) * p.x, p.wt]);
    const a = new Map<string, number>();
    acc.forEach((v, k) => a.set(k, wmedian(v)));
    return a;
  };
  const w: Record<string, number> = {};
  const anchored = getEngineFlags().houseAnchor;
  for (const c of CONFS) {
    const cp = pts.filter(p => p.conf === c);
    // (Oct 3) under the HOUSE ANCHOR the weight is fit on the anchor model
    // itself — y = (1 − w)·hl + w·x — over the rows that carry the habit
    // they were scored against (hl); legacy rows fall back to the intercept fit
    const ap = anchored ? cp.filter(p => typeof p.hl === 'number') : [];
    if (ap.length >= 200) {
      let bestA = { w: DEF[c], e: Infinity };
      for (let k = 0; k <= 16; k++) {
        const ww = k * 0.05;
        const e = wmedian(ap.map(p => [Math.abs(p.y - (1 - ww) * p.hl! - ww * p.x), p.wt] as [number, number]));
        if (e < bestA.e - 1e-9) bestA = { w: ww, e };
      }
      w[c] = bestA.w;
      continue;
    }
    if (cp.length < 200) { w[c] = DEF[c]; continue; }
    let best = { w: DEF[c], e: Infinity };
    for (let k = 0; k <= 16; k++) {
      const ww = k * 0.05;
      const a = cellsOf(cp, () => ww);
      const e = wmedian(cp.map(p => [Math.abs(p.y - ww * p.x - a.get(p.cell)!), p.wt] as [number, number]));
      if (e < best.e - 1e-9) best = { w: ww, e };
    }
    w[c] = best.w;
  }
  const wOf = (p: BlendPt) => w[p.conf] ?? DEF[p.conf] ?? 0.1;
  const aOut: Record<string, number> = {};
  const glob: Record<string, number> = {};
  for (const et of ['b', 'p'] as const) {
    const ps = pts.filter(p => p.et === et);
    if (ps.length) glob[et] = wmedian(ps.map(p => [p.y - wOf(p) * p.x, p.wt] as [number, number]));
  }
  if (glob.b != null) aOut['global:b'] = r4(glob.b);
  if (glob.p != null) aOut['global:p'] = r4(glob.p);
  const byCell = new Map<string, BlendPt[]>();
  for (const p of pts) (byCell.get(p.cell) || byCell.set(p.cell, []).get(p.cell)!).push(p);
  byCell.forEach((ps, cell) => {
    const g = glob[ps[0].et];
    const raw = wmedian(ps.map(p => [p.y - wOf(p) * p.x, p.wt] as [number, number]));
    const W = ps.reduce((s, p) => s + p.wt, 0);
    aOut[cell] = r4(g == null ? raw : (W * raw + BLEND_K * g) / (W + BLEND_K));
  });
  // HOUSE × MARKET intercepts (rows carrying `h`, i.e. scored on/after the
  // Sep 27 engine): a house's own estimate conservativeness, shrunk toward its
  // market:et intercept. Measured on the record's test year (Oct 25 → Sep 26)
  // the market-level intercept left culture/science/sports band-estimate lots
  // at 1.4–1.7× realized/predicted — new houses entering those markets price
  // their estimates very differently from the archive the market cell learned.
  const byHouse = new Map<string, BlendPt[]>();
  for (const p of pts) if (p.h) { const k = houseCellKey(p.m, p.h, p.et); (byHouse.get(k) || byHouse.set(k, []).get(k)!).push(p); }
  byHouse.forEach((ps, k) => {
    if (ps.length < 30) return;
    const parent = aOut[`${ps[0].m}:${ps[0].et}`] ?? glob[ps[0].et];
    const raw = wmedian(ps.map(p => [p.y - wOf(p) * p.x, p.wt] as [number, number]));
    const W = ps.reduce((s, p) => s + p.wt, 0);
    aOut[k] = r4(parent == null ? raw : (W * raw + BLEND_K * parent) / (W + BLEND_K));
  });
  return { a: aOut, w, n: pts.length };
}
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** (Oct 3) THE NO-ESTIMATE PUBLISH GATE: per market × confidence, the
 *  trailing-year record of the PUBLISHED no-estimate value (rp — each row
 *  scored out of sample under the calibration of its own quarter) graded
 *  against the card bar (cards-gate.gateCell: n ≥ 50, ±30% ≥ 45%, |bias| ≤
 *  15%). Rows before the Sep 27 engine carry no rp and never count. */
export function fitNoEstGate(noEst: NoEstObs[], ref: string): Record<string, Record<string, CardGateCell>> {
  const acc = new Map<string, number[]>();
  for (const o of noEst) {
    if (!(typeof o.rp === 'number' && o.rp > 0)) continue;
    const age = yrsBetween(o.sd, ref);
    if (!(age >= 0) || age > NOEST_GATE_WINDOW_Y) continue;
    const k = `${o.m}|${o.conf}`;
    (acc.get(k) || acc.set(k, []).get(k)!).push(Math.log(o.rp));
  }
  const out: Record<string, Record<string, CardGateCell>> = {};
  acc.forEach((z, k) => { const [m, c] = k.split('|'); (out[m] ||= {})[c] = gateCell(z, 'noest'); });
  return out;
}
const NOEST_GATE_WINDOW_Y = 1;

/** Point-in-time no-estimate bias per market × tier: the recency-weighted
 *  median of log(realized / comp value), shrunk toward 0 (factor 1). */
export function fitNoEstBias(noEst: NoEstObs[], ref: string): Record<string, Record<string, number>> {
  const acc = new Map<string, [number, number][]>();
  for (const o of noEst) {
    if (!(o.rn > 0)) continue;
    const age = yrsBetween(o.sd, ref);
    if (!(age >= 0) || age > BIAS_WINDOW_Y) continue;
    const k = `${o.m}|${o.conf}`;
    (acc.get(k) || acc.set(k, []).get(k)!).push([Math.log(o.rn), Math.pow(0.5, age / PV_HL_Y)]);
  }
  const out: Record<string, Record<string, number>> = {};
  acc.forEach((pairs, k) => {
    if (pairs.length < 20) return;
    const [m, c] = k.split('|');
    const W = pairs.reduce((s, p) => s + p[1], 0);
    const f = Math.exp((W * wmedian(pairs)) / (W + BIAS_K));
    (out[m] ||= {})[c] = Math.round(Math.min(3, Math.max(1 / 3, f)) * 1000) / 1000;
  });
  return out;
}

/** realized / published-value residual for a calObs row under a fitted blend */
export function blendResidual(o: CalObs, blend: NonNullable<EngineCalibration['blend']>): number | null {
  const x0 = o.ca ?? o.cr;
  if (typeof o.pf !== 'number' || !(o.pf > -1) || !(x0 > 0)) return null;
  const et = o.et === 'p' ? 'p' : 'b';
  // the same intercept precedence value.blendPredict uses: house × market → market → global
  const a = (o.h ? blend.a[houseCellKey(o.m, o.h, et)] : undefined)
    ?? blend.a[`${o.m}:${et}`] ?? blend.a[`global:${et}`] ?? blend.a['global:b'];
  if (a == null) return null;
  const w = blend.w[o.conf] ?? 0.1;
  // (Oct 3) the HOUSE ANCHOR prediction where the row carries its habit
  if (getEngineFlags().houseAnchor && typeof o.hl === 'number') return Math.exp(Math.log(o.pf + 1) - (1 - w) * o.hl - w * Math.log(x0));
  return Math.exp(Math.log(o.pf + 1) - a - w * Math.log(x0));
}

type VB = { lo: number; hi: number; mb?: number };
/** Outcome bands of the PUBLISHED value: recency-weighted 15/85 quantiles of
 *  realized / prediction, per path ('e' blend, 'n' no-estimate) × tier, and
 *  per market where deep enough. */
export function fitValueBands(
  calObs: CalObs[], noEst: NoEstObs[], blend: NonNullable<EngineCalibration['blend']> | null,
  bias: Record<string, Record<string, number>>, ref: string,
): { valueBand: Record<string, Record<string, VB>>; valueBandByMarket: Record<string, Record<string, Record<string, VB>>> } {
  type P = { m: string; path: string; conf: string; z: number; wt: number };
  const pts: P[] = [];
  const VBW = VB_WINDOW_Y, VBHL = VB_HL_Y, VBQ = VB_Q;
  if (blend) {
    for (const o of calObs) {
      if (!o.sd) continue;
      const age = yrsBetween(o.sd, ref);
      if (!(age >= 0) || age > VBW) continue;
      const z = blendResidual(o, blend);
      if (z == null || !(z > 0)) continue;
      pts.push({ m: o.m, path: 'e', conf: o.conf, z, wt: Math.pow(0.5, age / VBHL) });
    }
  }
  for (const o of noEst) {
    const age = yrsBetween(o.sd, ref);
    if (!(age >= 0) || age > VBW || !(o.rn > 0)) continue;
    const b = APPLY_NOEST_BIAS ? (bias[o.m]?.[o.conf] ?? 1) : 1;
    pts.push({ m: o.m, path: 'n', conf: o.conf, z: o.rn / b, wt: Math.pow(0.5, age / VBHL) });
  }
  const bandOf = (ps: P[]): VB => {
    const pairs = ps.map(p => [p.z, p.wt] as [number, number]);
    const lo = Math.round(Math.min(1, Math.max(0.15, weightedQuantile(pairs, VBQ))) * 1000) / 1000;
    const hi = Math.round(Math.min(8, Math.max(1, weightedQuantile(pairs, 1 - VBQ))) * 1000) / 1000;
    // (Oct 3) the MAX-BID quantile of the same residuals (value.MAXBID_Q),
    // clamped into [lo, 1] — the buyer's walk-away point (value.buyerFields)
    const mb = Math.round(Math.min(1, Math.max(lo, weightedQuantile(pairs, MAXBID_Q))) * 1000) / 1000;
    return { lo, hi, mb };
  };
  const valueBand: Record<string, Record<string, VB>> = {};
  const valueBandByMarket: Record<string, Record<string, Record<string, VB>>> = {};
  for (const path of ['e', 'n']) {
    for (const c of CONFS) {
      const ps = pts.filter(p => p.path === path && p.conf === c);
      if (ps.length >= VB_MIN_N) (valueBand[path] ||= {})[c] = bandOf(ps);
    }
    // PER-MARKET value bands are deliberately NOT emitted: refit quarterly on
    // the record (valid Oct 24–Sep 25, test Oct 25–Sep 26), the global
    // path×tier band held 70–72% coverage on every tier while per-market
    // bands (≥150 rows) slipped 'high' to 66% out of sample — the market
    // cells are fit on too few recent rows to track their own drift.
    if (VB_PER_MARKET) {
      const markets = Array.from(new Set(pts.filter(p => p.path === path).map(p => p.m)));
      for (const m of markets) {
        for (const c of CONFS) {
          const ps = pts.filter(p => p.path === path && p.m === m && p.conf === c);
          if (ps.length >= VB_MARKET_MIN_N) ((valueBandByMarket[m] ||= {})[path] ||= {})[c] = bandOf(ps);
        }
      }
    }
  }
  return { valueBand, valueBandByMarket };
}

/** OUT-OF-SAMPLE band coverage — RECENT (Sep 27 2026; was P1-2's per-market
 *  median-day split, which tested 2006–2019 rows and certified bands the live
 *  book then missed: high 48% / medium 66% vs nominal 70%). Now ONE global
 *  split `OOS_TEST_DAYS` before the newest row: every band is fit ONLY on rows
 *  before the split (calibrationOf, recency-weighted, exactly as the replay
 *  would have loaded it) and scored on the most recent year — the published
 *  value's own band (the blend for estimate lots, the bias-corrected comp for
 *  no-estimate lots). `legacy` keeps the old comp-band read on the same split
 *  for continuity. Cells need ≥50 test rows. */
const OOS_TEST_DAYS = 365;
const OOS_MIN_TEST = 50;
export function bandCoverageOOS(calObs: CalObs[], nowMs: number, noEst: NoEstObs[] = []) {
  type Cell = { high: number | null; medium: number | null; low: number | null; nFit: number; nTest: number; split: string | null; legacy?: { high: number | null; medium: number | null; low: number | null } };
  const out: Record<string, Cell> = {};
  const dated = calObs.filter(o => o.r > 0).map(o => ({ o, d: obsDate(o, nowMs) }));
  if (!dated.length) return out;
  let latest = '';
  for (const x of dated) if (x.d > latest) latest = x.d;
  for (const o of noEst) if (o.sd > latest) latest = o.sd;
  const split = new Date(Date.parse(latest) - OOS_TEST_DAYS * 864e5).toISOString().slice(0, 10);
  const fitRows = dated.filter(x => x.d < split).map(x => x.o);
  const testRows = dated.filter(x => x.d >= split).map(x => x.o);
  const fitNe = noEst.filter(o => o.sd < split);
  const testNe = noEst.filter(o => o.sd >= split);
  if (!fitRows.length || !testRows.length) return out;
  const cal = calibrationOf(fitRows, fitNe, split);
  const pct = (hits: number, n: number) => (n >= OOS_MIN_TEST ? Math.round(100 * hits / n) : null);
  const vbFor = (m: string, path: string, c: string) => cal.valueBandByMarket?.[m]?.[path]?.[c] || cal.valueBand?.[path]?.[c] || null;
  for (const m of marketsOf(calObs).concat('all')) {
    const fit = m === 'all' ? fitRows : fitRows.filter(o => o.m === m);
    const test = m === 'all' ? testRows : testRows.filter(o => o.m === m);
    const cell: Cell = { high: null, medium: null, low: null, nFit: fit.length, nTest: test.length, split: fit.length && test.length ? split : null, legacy: { high: null, medium: null, low: null } };
    for (const c of CONFS) {
      const t = test.filter(o => o.conf === c);
      let hit = 0, n = 0;
      for (const o of t) {
        const z = cal.blend ? blendResidual(o, cal.blend) : o.rp ?? null;
        const b = vbFor(o.m, 'e', c) || (cal.bandByMarket[o.m]?.[c] ?? cal.band[c]);
        if (z == null || !b) continue;
        n++; if (z >= b.lo && z <= b.hi) hit++;
      }
      cell[c] = pct(hit, n);
      // legacy comp band on the same recent split (continuity read)
      const lb = (fit.filter(o => o.conf === c).length >= BAND_MIN_N ? cal.bandFor(c, fit) : cal.band[c]);
      cell.legacy![c] = pct(t.filter(o => o.r >= lb.lo && o.r <= lb.hi).length, t.length);
    }
    out[m] = cell;
  }
  if (testNe.length) {
    const cell: Cell = { high: null, medium: null, low: null, nFit: fitNe.length, nTest: testNe.length, split };
    for (const c of CONFS) {
      const t = testNe.filter(o => o.conf === c);
      let hit = 0, n = 0;
      for (const o of t) {
        const b = vbFor(o.m, 'n', c);
        if (!b) continue;
        const z = o.rn / (APPLY_NOEST_BIAS ? (cal.bias[o.m]?.[c] ?? 1) : 1);
        n++; if (z >= b.lo && z <= b.hi) hit++;
      }
      cell[c] = pct(hit, n);
    }
    out.noEstimate = cell;
  }
  // tier-keyed headline (the 'all' cell) — the shape the UI reads
  // (ComparableModal/LabFigures index bandCoverageOOS[confidence])
  const all = out.all;
  return Object.assign(out as Record<string, unknown>, {
    high: all?.high ?? null, medium: all?.medium ?? null, low: all?.low ?? null,
  }) as Record<string, Cell> & { high: number | null; medium: number | null; low: number | null };
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
  const cal = calibrationOf(calObs, st.noEst || []);
  // PER-MARKET RECORD (Aug 13 value audit): the +41/+16 receipt was global-
  // only — a watches user read an art/design-dominant number. Split it.
  const byMarket = recordByMarketOf(calObs);
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
  // THE PUBLISHED-VALUE RECORD (Sep 27): how the number a lot WOULD have been
  // served (compValueUsd, and the band it would have worn) landed — replayed
  // point-in-time, so every row is out-of-sample for the calibration it ran
  // under. Rows scored before this engine version carry no rp and are absent.
  const valueRecord = valueRecordOf(calObs, st.noEst || []);
  // (Oct 3) MAX-BID CALIBRATION: per market, where actual hammers landed
  // against the buyer's fields the lot would have worn — inside the band,
  // at/below the max bid (nominal MAXBID_Q = 30%), above it
  const maxBidCalibration = maxBidCalibrationOf(calObs, st.noEst || []);
  const onVersion = calObs.filter(o => o.ev === ENGINE_VERSION).length;
  const calibration = {
    edges: cal.edges,
    watchKt,
    bandCoverage,
    bandCoverageOOS: bandCoverageOOS(calObs, st.nowMs, st.noEst || []),
    beatRate: cal.beatRate,
    band: cal.band,
    bandByMarket: cal.bandByMarket,
    mdape: cal.mdape,
    // (Sep 27) the published-value layer build-market loads into the engine
    blend: cal.blend,
    bias: cal.bias,
    valueBand: cal.valueBand,
    valueBandByMarket: cal.valueBandByMarket,
    maxBidCalibration,
    noEstGate: cal.noEstGate,
    n: calObs.length,
    nNoEst: (st.noEst || []).length,
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
    valueRecord,
    calibration,
    series,
    distribution: distributionOf(st.flagged, st.unflagged),
  };
}

export type MaxBidCell = { n: number; inBandPct: number | null; belowMaxBidPct: number | null; aboveMaxBidPct: number | null; nominalBelowPct: number };
/** (Oct 3) Where actual hammers landed vs the buyer's fields (value.buyerFields)
 *  per market (+ 'all', + 'noEstimate'): share inside [bandLow, bandHigh],
 *  share at/below the max bid (nominal MAXBID_Q), share above it. Rows scored
 *  before the Oct 3 engine carry no xh/bm and are absent. Cells need ≥20 rows. */
export function maxBidCalibrationOf(calObs: CalObs[], noEst: NoEstObs[]): Record<string, MaxBidCell> {
  const cell = (rows: { xh?: number; bm?: number; bl?: number; bh?: number }[]): MaxBidCell => {
    const rs = rows.filter(o => typeof o.xh === 'number' && o.xh > 0 && typeof o.bm === 'number');
    const n = rs.length;
    const pct = (k: number) => (n >= 20 ? Math.round(1000 * k / n) / 10 : null);
    const banded = rs.filter(o => typeof o.bl === 'number' && typeof o.bh === 'number');
    return {
      n,
      inBandPct: banded.length >= 20 ? Math.round(1000 * banded.filter(o => o.xh! >= o.bl! && o.xh! <= o.bh!).length / banded.length) / 10 : null,
      belowMaxBidPct: pct(rs.filter(o => o.xh! <= o.bm!).length),
      aboveMaxBidPct: pct(rs.filter(o => o.xh! > o.bm!).length),
      nominalBelowPct: MAXBID_Q * 100,
    };
  };
  const out: Record<string, MaxBidCell> = {};
  for (const m of marketsOf(calObs).concat('all')) out[m] = cell(m === 'all' ? calObs : calObs.filter(o => o.m === m));
  if (noEst.length) {
    out.noEstimate = cell(noEst);
    for (const m of Array.from(new Set(noEst.map(o => o.m)))) out[`noEstimate:${m}`] = cell(noEst.filter(o => o.m === m));
  }
  return out;
}

export type ValueCell = { n: number; medAbsErrPct: number | null; within30Pct: number | null; bias: number | null; bandCoveragePct: number | null };
/** Accuracy of the PUBLISHED value by market × tier (+ 'all', + 'noEstimate'):
 *  median |realized/value − 1| in log space, share within ±30%, median
 *  realized/value (bias), and the share inside the band the lot wore. */
export function valueRecordOf(calObs: CalObs[], noEst: NoEstObs[]): Record<string, Record<string, ValueCell>> {
  const cell = (rows: { rp?: number; bl?: number; bh?: number }[]): ValueCell => {
    const rs = rows.filter(o => typeof o.rp === 'number' && o.rp > 0);
    if (rs.length < 20) return { n: rs.length, medAbsErrPct: null, within30Pct: null, bias: null, bandCoveragePct: null };
    const la = rs.map(o => Math.abs(Math.log(o.rp!))).sort((a, b) => a - b);
    const lr = rs.map(o => Math.log(o.rp!)).sort((a, b) => a - b);
    const banded = rs.filter(o => typeof o.bl === 'number' && typeof o.bh === 'number');
    return {
      n: rs.length,
      medAbsErrPct: Math.round((Math.exp(median(la)) - 1) * 1000) / 10,
      within30Pct: Math.round(1000 * rs.filter(o => o.rp! >= 1 / 1.3 && o.rp! <= 1.3).length / rs.length) / 10,
      bias: Math.round(Math.exp(median(lr)) * 1000) / 1000,
      bandCoveragePct: banded.length >= 20 ? Math.round(1000 * banded.filter(o => o.rp! >= o.bl! && o.rp! <= o.bh!).length / banded.length) / 10 : null,
    };
  };
  const out: Record<string, Record<string, ValueCell>> = {};
  for (const m of marketsOf(calObs).concat('all')) {
    const rows = m === 'all' ? calObs : calObs.filter(o => o.m === m);
    if (!rows.some(o => typeof o.rp === 'number')) continue;
    out[m] = { all: cell(rows) };
    for (const c of CONFS) out[m][c] = cell(rows.filter(o => o.conf === c));
  }
  if (noEst.length) {
    out.noEstimate = { all: cell(noEst) };
    for (const c of CONFS) out.noEstimate[c] = cell(noEst.filter(o => o.conf === c));
  }
  return out;
}

/** An observation's "above comparable market" call. Rows scored since Oct 6
 *  carry it (ab); older rows recover it from the label rule itself
 *  (value.ts: 'above' ⇔ not 'below' and flag ratio ≤ 0.75, the flag ratio
 *  being fr, or cr on rows from before the house-normalized flag). */
export const isAboveObs = (o: CalObs): boolean => (typeof o.ab === 'boolean' ? o.ab : !o.fl && (o.fr ?? o.cr) <= 0.75);

export type RecordCell = { n: number; medPct: number | null };
export type MarketRecord = {
  flagged: RecordCell; unflagged: RecordCell; above: RecordCell;
  /** single-figure estimates ("$500+", RR) — scored, but a different yardstick
   *  (no range, the figure is a floor), so never pooled into the cells above */
  singleFigure: { flagged: RecordCell; unflagged: RecordCell; above: RecordCell };
};
/** PER-MARKET RECORD CELLS (/value "The record" when a market is selected).
 *  Same population as the global headline buckets: RANGE-estimate lots only
 *  (et 'b'); 'unflagged' = the at-market calls, never the above-market ones
 *  (the headline keeps those in their own 'above' arm). Single-figure lots are
 *  reported separately. medPct needs n >= 50. */
export function recordByMarketOf(calObs: CalObs[]): Record<string, MarketRecord> {
  const medOf = (a: number[]) => { if (a.length < 50) return null; const x = [...a].sort((p, q) => p - q); return Math.round(x[Math.floor(x.length / 2)] * 1000) / 10; };
  const cell = (rows: CalObs[]): RecordCell => ({ n: rows.length, medPct: medOf(rows.map(o => o.pf!)) });
  const arms = (rows: CalObs[]) => ({
    flagged: cell(rows.filter(o => o.fl)),
    unflagged: cell(rows.filter(o => !o.fl && !isAboveObs(o))),
    above: cell(rows.filter(o => !o.fl && isAboveObs(o))),
  });
  const out: Record<string, MarketRecord> = {};
  for (const m of marketsOf(calObs)) {
    const rows = calObs.filter(o => o.m === m && typeof o.pf === 'number');
    out[m] = { ...arms(rows.filter(o => o.et !== 'p')), singleFigure: arms(rows.filter(o => o.et === 'p')) };
  }
  return out;
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
export function targetsOf(prep: Prepared, market?: string | null): { soldTargets: L[]; biTargets: L[]; noEstTargets: L[] } {
  const inMarket = (l: L) => !market || (prep.marketBySlug[l.artist] || 'other') === market;
  const soldTargets = prep.sold.filter(l => hasAnyEst(l) && inMarket(l));   // band + single-point (RR)
  const biTargets = prep.lots.filter(l => l.status === 'bought_in' && l.saleDate && l.titleTokens && l.titleTokens.length && hasEst(l) && inMarket(l));
  // (Sep 27) NO-ESTIMATE hedonic targets — the pure comp path's own record
  // (bias + 'n' band). Bounded to the trailing NOEST_WINDOW_DAYS (the bias
  // fit only reads 4 years and the replay budget is finite); the engine-
  // excluded mass-produced slugs are valued by the card tiers, not here.
  let latest = '';
  for (const l of prep.sold) if (l.saleDate > latest) latest = l.saleDate;
  const cut = latest ? new Date(Date.parse(latest.slice(0, 10)) - NOEST_WINDOW_DAYS * 864e5).toISOString().slice(0, 10) : '9999';
  const noEstTargets = prep.sold.filter(l => !hasAnyEst(l) && l.saleDate >= cut && !NOEST_EXCLUDED.has(l.artist)
    && (l as L & { source?: string }).source !== 'sothebys-algolia' && inMarket(l));
  return { soldTargets, biTargets, noEstTargets };
}
/** trailing window for no-estimate targets (days) */
export const NOEST_WINDOW_DAYS = 730;
/** mass-produced slugs the hedonic engine never values (build-market) */
const NOEST_EXCLUDED = new Set(['sports-cards', 'graded-cards', 'pokemon']);

/* ── SHADOW / PROMOTE: THE ENGINE COMPARISON (Oct 3 2026) ─────────────────
   One holdout, two engines, the same comp pools: validate-engine (with
   RAY_ENGINE_CANDIDATE=1) and the oneoff harnesses price every holdout lot
   under ENGINE_FLAGS_CURRENT and ENGINE_FLAGS_CANDIDATE and hand the rows
   here. VALUE error is scored on the lots BOTH engines valued (so a coverage
   move can't flatter either side; coverage is reported beside it). The
   DIRECTIONAL edge is scored on one yardstick for both: realized vs the
   HOUSE-ADJUSTED estimate (estimate mid × the house-bias index factor at the
   lot's quarter) — an edge that only re-reads a house's estimating policy is
   not an edge. Promotion: candidate median abs error ≤ current's, candidate
   ±30% hit ≥ current's − 0.5pt, and candidate adjusted edge ≥ current's −
   EDGE_TOL_PT (no loss of directional edge beyond noise). */
export type EngineRow = {
  id: string; m: string; conf: string;
  /** realized all-in, the published value + band (all-in) */
  r: number; p: number; lo: number; hi: number;
  /** actual hammer, max bid (hammer basis) */
  hm?: number; mb?: number;
  /** estimate lots: mid, raw top (high, or the single point), the
   *  HOUSE-ADJUSTED top (value.adjustedTop), the house factor, signal */
  mid?: number; top?: number; atop?: number; hf?: number;
  sig?: 'b' | 'a' | 't' | null;
};
export type EngineSummary = {
  valued: number; n: number; medAbsErrPct: number | null; within30Pct: number | null; bias: number | null; bandCoveragePct: number | null;
  belowMaxBidPct: number | null;
  flags: {
    nFlagged: number; nUnflagged: number; precisionAdjPct: number | null; precisionRawPct: number | null;
    flaggedAdj: number | null; unflaggedAdj: number | null; edgeAdjPt: number | null; edgeRawPt: number | null;
  };
};
export const EDGE_TOL_PT = 2;
export function summarizeEngineRows(rows: EngineRow[], both: Set<string>): EngineSummary {
  const med = (a: number[]) => median(a.slice().sort((x, y) => x - y));
  const scored = rows.filter(r => both.has(r.id) && r.p > 0 && r.r > 0);
  const lr = scored.map(r => Math.log(r.r / r.p));
  const n = scored.length;
  const pct = (k: number, d: number) => (d >= 20 ? Math.round(1000 * k / d) / 10 : null);
  const mbRows = scored.filter(r => (r.mb || 0) > 0 && (r.hm || 0) > 0);
  const est = rows.filter(r => (r.mid || 0) > 0 && r.sig != null);
  const fl = est.filter(r => r.sig === 'b'), un = est.filter(r => r.sig !== 'b');
  const adj = (r: EngineRow) => r.r / (r.mid! * (r.hf || 1));
  const fAdj = fl.length >= 20 ? med(fl.map(adj)) : null, uAdj = un.length >= 20 ? med(un.map(adj)) : null;
  const fRaw = fl.length >= 20 ? med(fl.map(r => r.r / r.mid!)) : null, uRaw = un.length >= 20 ? med(un.map(r => r.r / r.mid!)) : null;
  return {
    valued: rows.filter(r => r.p > 0).length,
    n,
    medAbsErrPct: n >= 20 ? Math.round((Math.exp(med(lr.map(Math.abs))) - 1) * 1000) / 10 : null,
    within30Pct: pct(lr.filter(x => Math.abs(x) <= Math.log(1.3)).length, n),
    bias: n >= 20 ? Math.round(Math.exp(med(lr)) * 1000) / 1000 : null,
    bandCoveragePct: pct(scored.filter(r => r.lo > 0 && r.hi > 0 && r.r >= r.lo && r.r <= r.hi).length, n),
    belowMaxBidPct: pct(mbRows.filter(r => r.hm! <= r.mb!).length, mbRows.length),
    flags: {
      nFlagged: fl.length, nUnflagged: un.length,
      precisionAdjPct: pct(fl.filter(r => r.r > (r.atop || (r.top || r.mid!) * (r.hf || 1))).length, fl.length),
      precisionRawPct: pct(fl.filter(r => r.r > (r.top || r.mid!)).length, fl.length),
      flaggedAdj: fAdj != null ? Math.round(fAdj * 1000) / 1000 : null,
      unflaggedAdj: uAdj != null ? Math.round(uAdj * 1000) / 1000 : null,
      edgeAdjPt: fAdj != null && uAdj != null ? Math.round((fAdj - uAdj) * 1000) / 10 : null,
      edgeRawPt: fRaw != null && uRaw != null ? Math.round((fRaw - uRaw) * 1000) / 10 : null,
    },
  };
}
/** Compare two engines' holdout rows (see the block comment above). */
export function compareEngines(current: EngineRow[], candidate: EngineRow[], versions: { current: string; candidate: string }) {
  const valuedIds = (rs: EngineRow[]) => new Set(rs.filter(r => r.p > 0).map(r => r.id));
  const a = valuedIds(current), b = valuedIds(candidate);
  const both = new Set(Array.from(a).filter(id => b.has(id)));
  const markets = Array.from(new Set(current.concat(candidate).map(r => r.m))).sort();
  const side = (rs: EngineRow[]) => ({
    all: summarizeEngineRows(rs, both),
    byMarket: Object.fromEntries(markets.map(m => [m, summarizeEngineRows(rs.filter(r => r.m === m), both)])),
  });
  const cur = side(current), cand = side(candidate);
  const reasons: string[] = [];
  const ce = cur.all, ne = cand.all;
  if (ce.medAbsErrPct != null && ne.medAbsErrPct != null && ne.medAbsErrPct > ce.medAbsErrPct) reasons.push(`value error ${ne.medAbsErrPct}% > current ${ce.medAbsErrPct}%`);
  if (ce.within30Pct != null && ne.within30Pct != null && ne.within30Pct < ce.within30Pct - 0.5) reasons.push(`±30% hit ${ne.within30Pct}% < current ${ce.within30Pct}% − 0.5`);
  if (ce.flags.edgeAdjPt != null && (ne.flags.edgeAdjPt == null || ne.flags.edgeAdjPt < ce.flags.edgeAdjPt - EDGE_TOL_PT)) reasons.push(`directional edge ${ne.flags.edgeAdjPt}pt < current ${ce.flags.edgeAdjPt}pt − ${EDGE_TOL_PT}`);
  return { versions, both: both.size, current: cur, candidate: cand, promote: reasons.length === 0, reasons };
}

/** One holdout lot's EngineRow from the value it would have been served. */
export function engineRowOf(lot: L, m: string, v: { compValueUsd: number; low: number; high: number; confidence: string; maxBidUsd?: number; signal?: { label: string } | null } | null, hf: number | undefined): EngineRow {
  const mid = estMidOf(lot);
  const lab = v?.signal?.label || '';
  return {
    id: String(lot.id), m, conf: v?.confidence || 'none', r: lot.realizedUsd || 0,
    p: v?.compValueUsd || 0, lo: v?.low || 0, hi: v?.high || 0,
    hm: inferHammerUsd(lot), ...(v?.maxBidUsd ? { mb: v.maxBidUsd } : {}),
    ...(mid > 0 ? { mid, top: estTopOf(lot), atop: adjustedTop(lot.estLowUsd, lot.estHighUsd, hf ?? 1), hf } : {}),
    sig: v?.signal ? (lab.startsWith('below') ? 'b' : lab.startsWith('above') ? 'a' : 't') : null,
  };
}
