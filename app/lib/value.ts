/**
 * value.ts — the lot value engine. Two honest products, both validated by
 * temporal holdout on the real corpus (see scripts/validate-engine.ts):
 *
 * 1. THE DIRECTIONAL SIGNAL (lots WITH a house estimate).
 *    Absolute comp valuation loses to expert house estimates on heterogeneous
 *    art (holdout: engine 1.6× vs house 1.3× median error — same title ≠ same
 *    value on fungibles). So we DON'T claim to out-price the house. Instead we
 *    measure where comparable sales trade relative to the lot's estimate — a
 *    signal that DOES predict beating estimate, monotonically, in every market
 *    (beat-high rate: art 43%→63%, design 53%→67%, watches 47%→82% as comps go
 *    from below-estimate to above). This is the "under/over comparable market"
 *    call — a lean against the house's own number, never a fabricated price.
 *
 * 2. GOLDIN VALUE (lots with NO house estimate — ~10k sports/science).
 *    Here there is no expert number to defer to, so the comp estimate IS the
 *    value (holdout ~1.4× median error, the only estimate that exists). Shown
 *    with a confidence tier from pool size + dispersion, and compared to the
 *    live bid for an under/over read.
 *
 * Every output is traceable to an inspectable pool of real sales (`poolIds`).
 */
import type { AuctionLot } from '../types';
import { similarity, sizeRatio, type IdfTable, type Match } from './similarity';
import { lotAllInFactor, lotHammerFromAllIn } from './premiums';
import { weightedMedian, quantileSorted } from './stats';
import { lotShapeOf, shapesCompatible, isCompExcluded } from './comps';
import type { CardGateCell } from './cards-gate';
import { numericWatchRef, editionIdentityKey, isEditionLot, WATCH_SLUGS } from './identity';
import { compBoundaryFault, compPurityFault, isIdentityLessTitle } from './comp-purity';

/** THE signal-label vocabulary — one source (P2, Sep 2 2026). Re-exported from
 *  lanes.ts; UI files that hardcode the strings should import from there
 *  (app/makers/[slug]/page.tsx, ComparableModal.tsx, LotCard.tsx,
 *  app/preview/terminal/TerminalHome.tsx — listed in docs/ENGINE_SPEC_V2.md). */
export const SIGNAL_LABEL = {
  below: 'below comparable market',
  above: 'above comparable market',
  at: 'at comparable market',
} as const;
export type SignalLabel = (typeof SIGNAL_LABEL)[keyof typeof SIGNAL_LABEL];

/** THE basis caption every UI surface that prints a realized-vs-estimate or
 *  bid-vs-value figure should use (P1-5). Realized prices are all-in
 *  (premium-inclusive); house estimates are hammer-basis; the engine's
 *  compValue is all-in (a median of realized prices); bid comparisons gross
 *  the bid to all-in through the house premium before comparing. */
export function basisNote(kind: 'estimate' | 'bid' | 'value' = 'estimate'): string {
  switch (kind) {
    case 'bid': return 'bid grossed to all-in (house premium) vs all-in comp value';
    case 'value': return 'comp value is all-in (median of premium-inclusive realized prices)';
    default: return 'all-in realized vs hammer-basis estimate — the gap carries the buyer\'s premium by design';
  }
}

export interface Comp {
  id: string; match: Match; realizedUsd: number; saleDate: string;
  /** (Oct 6 2026, pricing wave 2) the comp's own lot row — resolveComps
   *  attaches it so the comp-purity readers (title, medium, edition class,
   *  signedness, subject) can judge the comp against the target */
  lot?: AuctionLot;
}

/* ── ENGINE VERSION + THE SHADOW/PROMOTE SEAM (Oct 3 2026) ────────────────
   Every served value carries `engineVersion`; every backtest observation and
   value-tape row carries the version that produced it. The engine runs under
   one EngineFlags set at a time: ENGINE_FLAGS_CURRENT serves the book;
   ENGINE_FLAGS_CANDIDATE is the next engine, run ALONGSIDE it on the holdout
   (validate-engine, RAY_ENGINE_CANDIDATE=1) and on the live book as shadow
   value-tape rows (build-market, RAY_ENGINE_CANDIDATE=1) — never served.
   Promotion = copy the candidate's flags into CURRENT and bump its version,
   only when validate-engine's comparison reports `promote: true` (candidate
   ≥ current on holdout value error, no loss of directional edge). */
export interface EngineFlags {
  /** version string stamped on everything this flag set produces */
  version: string;
  /** THE FLAGS read comps against the HOUSE-ADJUSTED estimate (houseFactorOf):
   *  `flagRatio` = comp median / (estimate mid × the house's own habit) */
  houseNormFlags: boolean;
  /** the estimate-lot prediction anchors on the house's own estimate habit
   *  (house-bias index) — blendPredict */
  houseAnchor: boolean;
  /** card / TCG tiers publish a value only in tier × confidence × market
   *  cells that clear CARD_GATE on recent out-of-sample sales (build-market) */
  cardGate: boolean;
  /** the no-estimate (absolute) hedonic value publishes only in market ×
   *  confidence cells whose recent replayed record clears the SAME bar
   *  (calibration.noEstGate; build-market applies it at publish — the record
   *  keeps scoring every value, gated or not) */
  noEstGate: boolean;
  /** (Oct 6 2026) THE HAMMER BASIS: compRatio / flagRatio compare the comps'
   *  HAMMER (the all-in median through this lot's dated premium inverse) to
   *  the hammer-basis estimate, and the Flags' odds count a beat only when the
   *  HAMMER clears the (house-adjusted) top — so at-market reads 1 and the
   *  1.3 / 0.75 thresholds sit symmetric on one basis */
  hammerBasis?: boolean;
  /** (Oct 6) beat-rate calibration recency half-life of 1 year (was 3) */
  calHalfLife1y?: boolean;
  /** (Oct 6) a single printed figure (low == high) is its own estimate kind
   *  's' — never read as a range; flags only where its own odds row exists */
  singleFigure?: boolean;
  /** (Oct 6) confidence demotes at most ONE notch (else-if), on the record's
   *  error of the PUBLISHED value (rp), not the comp pool's (r) */
  confOnPublished?: boolean;
  /** (Oct 6, pricing wave 2) HARD comp boundaries (comp-purity.compBoundaryFault):
   *  signed vs unsigned, a different subject, a different designator
   *  ("Apollo 13" vs "Apollo 10"), a different object class — such a comp
   *  never enters the pool */
  compBoundary?: boolean;
  /** (Oct 6, pricing wave 2) THE PURITY GATE: a flag needs ≥ PURITY.minPure
   *  comps with an object-naming title, the target's medium family and
   *  edition class, ≤ PURITY.maxAgeY old and within PURITY.band× of the pool
   *  median; else signal = null. The signal is also stripped whenever the
   *  comp ratio sits outside the ×5 estimate-band sanity. */
  purityGate?: boolean;
  /** (Oct 6, pricing wave 2) the value pool itself keeps only pure comps when
   *  ≥ PURITY.minPure of them exist (else the pool stands, unflagged).
   *  Measured, NOT adopted: holdout medErr 28.4% → 29.0% (§13) */
  purityPool?: boolean;
}
/** The engine before the Oct 3 pass (raw-estimate Flags, premium-only
 *  anchor, ungated card tiers) — kept so the harnesses can replay it. */
export const ENGINE_FLAGS_LEGACY: EngineFlags = {
  version: '2026.09.27-blend-tadj', houseNormFlags: false, houseAnchor: false, cardGate: false, noEstGate: false,
};
/** The Oct 3 engine (house-normalized Flags on the all-in basis) — kept so
 *  the harnesses can replay it against CURRENT. */
export const ENGINE_FLAGS_HOUSE_GATE: EngineFlags = {
  version: '2026.10.03-house-gate',
  houseNormFlags: true, houseAnchor: true, cardGate: true, noEstGate: true,
};
/** (Oct 6 2026) THE HAMMER BASIS + one-notch confidence, promoted on the
 *  test-year holdout (oneoff/qa/engine-ab.ts, 4,917 estimate lots, one
 *  yardstick for both: the hammer over the house-adjusted top): flags 2,257 →
 *  1,148 at FLAG_GATE.minOddsHammer 45, precision 43.4% → 49.7%, edge 19.0 →
 *  21.2pt; flagged-odds calibration error per quarter 0.5–5.8pt (mean 3.0) →
 *  0.2–3.3pt (mean 1.4); value medErr 32.3% = 32.3%, ±30% 47.7% → 47.8%;
 *  band coverage 72.0% → 68.2%. Measured and NOT adopted: calHalfLife1y
 *  (fewer flags, odds calibration 1.4 → 3.1pt), singleFigure (flat: 1,152
 *  flags, same edge). docs/ENGINE_LANES.md §11. Kept so the harnesses can
 *  replay it against CURRENT. */
export const ENGINE_FLAGS_HAMMER_BASIS: EngineFlags = {
  ...ENGINE_FLAGS_HOUSE_GATE,
  version: '2026.10.06-hammer-basis',
  hammerBasis: true, confOnPublished: true,
};
/** (Oct 6 2026, pricing wave 2) COMP PURITY: the purity gate on every
 *  directional read + the ×5 strip, and the hard comp boundaries. Measured
 *  (docs/ENGINE_LANES.md §13): live (Sep 14 book graded to Oct 5) flag
 *  precision 47.5% → 56.0%, edge 24.7 → 38.7pt, estimate-lot medErr 26.5% →
 *  26.4%, band 70.7% → 71.8%; holdout precision 49.9% → 49.6%, edge 21.4 →
 *  20.1pt (within EDGE_TOL_PT), medErr 28.0% → 27.7% on the same lots; the
 *  hand-judged comp sample good 42.7% → 65.5%, wrong 18.0% → 11.0% among
 *  the comps that may carry a call. Measured and NOT adopted: purityPool (§13). */
export const ENGINE_FLAGS_CURRENT: EngineFlags = {
  ...ENGINE_FLAGS_HAMMER_BASIS,
  version: '2026.10.06-comp-purity',
  purityGate: true, compBoundary: true,
};
/** The candidate under evaluation. Equal to CURRENT's flags when nothing is
 *  pending — a candidate run then reports a no-op comparison. */
export const ENGINE_FLAGS_CANDIDATE: EngineFlags = { ...ENGINE_FLAGS_CURRENT, version: `${ENGINE_FLAGS_CURRENT.version}+cand` };
/** THE served engine version (= ENGINE_FLAGS_CURRENT.version) */
export const ENGINE_VERSION = ENGINE_FLAGS_CURRENT.version;
let FLAGS: EngineFlags = ENGINE_FLAGS_CURRENT;
export function setEngineFlags(f: EngineFlags | null) { FLAGS = f || ENGINE_FLAGS_CURRENT; }
export function getEngineFlags(): EngineFlags { return FLAGS; }

/* ── THE HOUSE-BIAS INDEX (Oct 3 2026; built by indices.makeHouseBiasIndexer) ──
   Point-in-time recency-weighted median of log(realized all-in / estimate
   mid) per house × market × estimate kind, shrunk up a ladder to the global.
   `ref` is the global BAND habit — houseFactorOf returns exp(cell − ref), the
   house's habit RELATIVE to a typical band estimate (≈1 for a typical band
   house; RR's single-point lows read ≈2–3). Set by the caller (build-market
   for today, the backtest replay and validate-engine per quarter). */
export interface HouseBias {
  asOf: string;
  ref: number;
  /** 'g:et' · 'm:<market>:et' · 'h:<house>:et' · 'mh:<market>|<house>:et' → shrunk log ratio */
  cells: Record<string, number>;
  n: Record<string, number>;
}
let HB: HouseBias | null = null;
export function setHouseBias(hb: HouseBias | null) { HB = hb; }
export function getHouseBias(): HouseBias | null { return HB; }
/** clamp on the house multiplier — past ×/÷4 the cell is a data fault */
const HOUSE_FACTOR_CLAMP = [0.25, 4] as const;
/** The house's estimate habit for this lot: the most specific cell present
 *  (market×house → house → market → global). `log` is the cell itself
 *  (log realized all-in / estimate mid); `f` = exp(log − ref), the habit
 *  relative to the global band habit. */
export function houseFactorOf(market: string | null | undefined, house: string | null | undefined, et: EstKind, hb: HouseBias | null = HB): { f: number; log: number; key: string } | null {
  if (!hb) return null;
  const m = market || 'other';
  // (Oct 6) under the single-figure split a band reads the TRUE-range cells
  // ('r': low < high) and a single figure its own ('s'); both relative to the
  // true-range global habit
  if (FLAGS.singleFigure && (et === 'b' || et === 's')) {
    const k2 = et === 'b' ? 'r' : 's';
    const ref = hb.cells['g:r'] ?? hb.ref;
    const keys2 = house ? [`mh:${m}|${house}:${k2}`, `h:${house}:${k2}`, `m:${m}:${k2}`, `g:${k2}`] : [`m:${m}:${k2}`, `g:${k2}`];
    for (const k of keys2) {
      const c = hb.cells[k];
      if (typeof c === 'number' && Number.isFinite(c)) {
        const f = Math.min(HOUSE_FACTOR_CLAMP[1], Math.max(HOUSE_FACTOR_CLAMP[0], Math.exp(c - ref)));
        return { f, log: Math.log(f) + ref, key: k };
      }
    }
    if (et === 's') return null;
  }
  const keys = house ? [`mh:${m}|${house}:${et}`, `h:${house}:${et}`, `m:${m}:${et}`, `g:${et}`] : [`m:${m}:${et}`, `g:${et}`];
  for (const k of keys) {
    const c = hb.cells[k];
    if (typeof c === 'number' && Number.isFinite(c)) {
      const f = Math.min(HOUSE_FACTOR_CLAMP[1], Math.max(HOUSE_FACTOR_CLAMP[0], Math.exp(c - hb.ref)));
      return { f, log: Math.log(f) + hb.ref, key: k };
    }
  }
  return null;
}
/** The estimate kind of a lot under the flags in force: 'b' a two-sided band,
 *  'p' a single bound (RR's "$500+"), and — with FLAGS.singleFigure — 's' a
 *  single printed figure (low == high; Wright/Rago "$5,000"), which clears its
 *  "high" 78–89% of the time against 45–68% for real ranges. */
export type EstKind = 'b' | 'p' | 's';
export function estKindOf(estLow: number | null | undefined, estHigh: number | null | undefined, flags: EngineFlags = FLAGS): EstKind {
  const lo = estLow || 0, hi = estHigh || 0;
  if (lo > 0 && hi > 0) return flags.singleFigure && lo === hi ? 's' : 'b';
  return 'p';
}

/** Median estimate high / estimate mid over band estimates (sold archive,
 *  n=4,496: 1.20, IQR 1.17–1.33) — the band-equivalent top of a single-point
 *  estimate. */
export const BAND_TOP_RATIO = 1.2;
/** THE HOUSE-ADJUSTED TOP (Oct 3 2026): the estimate's high as a typical
 *  band house would have written it — band estimates: high × the house
 *  factor; single-point ("$500+") estimates: the point × the house factor ×
 *  BAND_TOP_RATIO. "Beat" in the Flags' odds and precision means realized
 *  above THIS (a single-point low is beaten ~85% of the time by policy, which
 *  made every RR flag read 85% odds). f = 1 when no index is loaded. */
export function adjustedTop(estLow: number | null | undefined, estHigh: number | null | undefined, f = 1, kind?: EstKind): number {
  const lo = estLow || 0, hi = estHigh || 0;
  if (kind === 's') return lo * f * BAND_TOP_RATIO;
  if (lo > 0 && hi > 0) return hi * f;
  return (lo || hi) * f * BAND_TOP_RATIO;
}

/* ── THE BUYER'S FIELDS (Oct 3 2026): expected hammer + band + max bid ──
   The product leads with the HAMMER — what the gavel most likely falls at,
   on the SAME basis as the house estimate printed next to it (house
   estimates are hammer-basis; every engine price — compValueUsd, low, high —
   is all-in, premium-inclusive). One rule:
     expectedHammerUsd  = compValueUsd ÷ premiumFactor     (the median prediction)
     bandLowUsd/HighUsd = low/high ÷ premiumFactor         (the calibrated outcome band)
     maxBidUsd          = the MAXBID_Q (30%) quantile of the calibrated
                          outcome distribution ÷ premiumFactor — the hammer
                          only ~30% of comparable outcomes cleared at or
                          below: bid to here and you are buying in the cheap
                          third of where this lot is expected to land.
                          Clamped into [bandLowUsd, expectedHammerUsd].
   premiumFactor = the lot's stamped premium, else the house schedule
   (premiums.lotAllInFactor). backtest.json calibration.maxBidCalibration
   measures the realized share below max bid per market (nominal 30%). */
export const MAXBID_Q = 0.3;
/** uncalibrated max-bid position: the q=0.30 point between the median and a
 *  ~13% band low under a log-normal outcome (z0.30 / z0.13 = 0.524 / 1.126) */
const MAXBID_T = 0.465;
export interface BuyerFields {
  expectedHammerUsd: number;
  bandLowUsd: number;
  bandHighUsd: number;
  maxBidUsd: number;
  premiumFactor: number;
  engineVersion: string;
}
export function buyerFields(
  lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null; saleDate?: string | null },
  predAllIn: number, lowAllIn: number, highAllIn: number, mbAllIn?: number | null,
): BuyerFields {
  let mb = typeof mbAllIn === 'number' && mbAllIn > 0 ? mbAllIn
    : lowAllIn > 0 && lowAllIn < predAllIn ? predAllIn * Math.pow(lowAllIn / predAllIn, MAXBID_T) : predAllIn;
  if (mb > predAllIn) mb = predAllIn;
  if (lowAllIn > 0 && mb < lowAllIn) mb = lowAllIn;
  // every figure through the lot's own all-in → hammer inverse (the dated
  // schedule in force on its sale date where the house has one; else the
  // undated schedule read at the predicted hammer's band, as before)
  const hammerOf = (x: number) => lotHammerFromAllIn(lot, x, predAllIn / 1.25);
  const xh = hammerOf(predAllIn);
  const pf = xh > 0 ? predAllIn / xh : lotAllInFactor(lot, predAllIn / 1.25);
  const r = (x: number) => Math.round(hammerOf(x));
  return {
    expectedHammerUsd: Math.round(xh), bandLowUsd: r(lowAllIn), bandHighUsd: r(highAllIn), maxBidUsd: r(mb),
    premiumFactor: Math.round(pf * 1000) / 1000, engineVersion: FLAGS.version,
  };
}

/** (Oct 6 2026) THE LIVE-BID FLOOR. A live lot's hammer cannot land below the
 *  bid already on it (currentBid is a HAMMER bid), so every served value is
 *  floored there: expectedHammerUsd = max(xh, bid), and inside the last
 *  BID_FLOOR_LATE_DAYS of the sale max(xh, bid × BID_FLOOR_LATE_LIFT) — a lot
 *  that close still draws at least one more increment. The band low and max
 *  bid are floored at the bid itself; the all-in fields keep their meaning
 *  (compValueUsd / low / estimateUsd = hammer × the lot's premium at that
 *  hammer). vsBid stays the COMPS read (it is computed before the floor).
 *  Measured on the served tape (Sep 20 – Oct 5, 3,189 graded lots, first
 *  served value): median abs error 154% → 86.0% (floor alone 86.9%), ±30%
 *  17.8% → 25.0%, bias 1.61 → 1.29; last served value 154% → 60.2% (floor
 *  alone 66.5%); card exact tier 67% → 36%. Applied at publish (build-market),
 *  never inside the replay — a holdout lot has no bid at valuation time. */
export const BID_FLOOR_LATE_DAYS = 3;
export const BID_FLOOR_LATE_LIFT = 1.1;
export function floorAtBid<V extends Partial<ValueResult> & { compValueUsd: number }>(
  v: V, lot: { currentBid?: number | null; auctionHouse?: string | null; buyerPremiumPct?: number | null; saleDate?: string | null; saleDateTime?: string | null },
  nowMs: number,
): V {
  const bid = lot.currentBid || 0;
  if (!(bid > 0)) return v;
  const closeMs = Date.parse(String(lot.saleDateTime || lot.saleDate || ''));
  const late = Number.isFinite(closeMs) && (closeMs - nowMs) / 86_400_000 <= BID_FLOOR_LATE_DAYS;
  const floor = bid * (late ? BID_FLOOR_LATE_LIFT : 1);
  const xh = v.expectedHammerUsd ?? (v.premiumFactor ? v.compValueUsd / v.premiumFactor : lotHammerFromAllIn(lot, v.compValueUsd));
  if (xh >= floor && !((v.bandLowUsd ?? Infinity) < bid)) return v;
  const out = { ...v } as V;
  if (xh < floor) {
    const pf = lotAllInFactor(lot, floor);
    const allIn = Math.round(floor * pf);
    out.expectedHammerUsd = Math.round(floor);
    out.premiumFactor = Math.round(pf * 1000) / 1000;
    out.compValueUsd = allIn;
    if (out.estimateUsd != null) out.estimateUsd = allIn;
    if ((out.high ?? 0) < allIn) out.high = allIn;
    if ((out.bandHighUsd ?? 0) < out.expectedHammerUsd) out.bandHighUsd = out.expectedHammerUsd;
    out.bidFloor = Math.round(floor);
  }
  const bidAllIn = Math.round(bid * lotAllInFactor(lot, bid));
  if (out.bandLowUsd != null && out.bandLowUsd < bid) out.bandLowUsd = Math.round(bid);
  if (out.low != null && out.low < bidAllIn) out.low = bidAllIn;
  if (out.maxBidUsd != null) {
    const lo = out.bandLowUsd ?? 0, hi = out.expectedHammerUsd ?? Infinity;
    out.maxBidUsd = Math.min(hi, Math.max(lo, out.maxBidUsd));
  }
  return out;
}

export interface ValueResult {
  /** the pool this was computed from (real sales, inspectable) */
  poolIds: string[];
  n: number;
  /** weighted-median comp value in USD */
  compValueUsd: number;
  /** comp dispersion (q1..q3) for the band */
  low: number;
  high: number;
  /** DIRECTIONAL (estimate lots): comps vs the lot's estimate midpoint */
  compRatio: number | null;
  signal: { label: SignalLabel; strength: 'strong' | 'moderate' | 'slight'; beatRatePct: number } | null;
  /** ABSOLUTE (Goldin/no-estimate): the value estimate + under/over vs live bid */
  estimateUsd: number | null;
  vsBid: { label: 'below recent comps' | 'above recent comps' | 'in line'; pct: number } | null;
  confidence: 'high' | 'medium' | 'low';
  /** which gate built the pool: 'main' = strict 0.50/65; 'fallback' = the
   *  relaxed 0.45/55 tier used only when the strict pool is thin (validated:
   *  marginal cohort +38.9%/63.1% — indistinguishable from the main engine) */
  tier?: 'main' | 'fallback';
  /** the strongest identity match found, if any (drives "this exact item…") */
  exact: { id: string; realizedUsd: number; saleDate: string; cls: 'physicalMatch' | 'modelMatch' } | null;
  /** provenance of this value. Absent/'hedonic' = the estimateValue engine above.
   *  'card-comp' = the tiered SPORTS-CARD comp value (build-market.ts §3): a live
   *  bid-only Goldin card valued from past sales of that exact card / that player,
   *  NOT the hedonic engine — signal is always null on these. */
  basis?: 'hedonic' | 'card-comp';
  /** count of exact-identity comps (same watch reference / same art edition)
   *  in the top pool — the non-card analogue of a card tier-1 match */
  idn?: number;
  /** PARTIAL abstention (P1-6): a value exists but a product on top of it was
   *  withheld and why (e.g. a tier-3 card median that carries no vsBid call).
   *  Full abstentions come back as { value: null, abstain } from
   *  estimateValueEx and are stamped on the LOT as `abstain`. */
  abstain?: string;
  /** card-comp tier that produced this value (build-market §3e) */
  cardTier?: 'exact' | 'grade-adj' | 'player' | 'tcg-exact' | 'tcg-grade-adj';
  /** (Sep 27 2026) THE POOL'S OWN MEDIAN: the recency-weighted median of the
   *  comp prices exactly as listed (unadjusted) — the statistic compRatio and
   *  the Flags are computed on (= compRatio × estimate mid on estimate lots).
   *  compValueUsd is now the published PREDICTION (on estimate lots the house
   *  estimate × premium × a shrunk comp adjustment — see `blendW`; on
   *  no-estimate lots the time-adjusted comp value), so every surface that
   *  prints "the comps' median" next to the pool rows must read THIS field. */
  compMedianUsd?: number;
  /** (Sep 27 2026) the comp median with every comp carried to the valuation
   *  date by its market's point-in-time index — the prediction's comp input */
  compAdjUsd?: number;
  /** weight the prediction put on the comps vs the house estimate (0 = pure
   *  house × premium, 1 = pure comps); absent on no-estimate lots */
  blendW?: number;
  /** (Oct 3 2026) THE FLAG STATISTIC: comp median / (estimate mid × the
   *  house's own estimate habit, houseFactor). The signal (label, strength,
   *  beatRatePct) is called on THIS ratio; compRatio stays the raw
   *  comps-vs-estimate ratio (the ×5 data-fault sanity reads it). Equal to
   *  compRatio when no house-bias index is loaded or the flag is off. */
  flagRatio?: number | null;
  /** the house multiplier the flag ratio divided by (1 = typical band house) */
  houseFactor?: number;
  /** (Oct 3 2026) THE BUYER'S FIELDS — hammer basis (see buyerFields) */
  expectedHammerUsd?: number;
  bandLowUsd?: number;
  bandHighUsd?: number;
  maxBidUsd?: number;
  /** all-in = hammer × premiumFactor */
  premiumFactor?: number;
  /** the engine version that produced this value */
  engineVersion?: string;
  /** (Oct 6 2026) set when the live-bid floor lifted the expected hammer:
   *  the floor it was lifted to (hammer USD) — see floorAtBid */
  bidFloor?: number;
  /** (Oct 3 2026, card/TCG values) the publish-gate record of this value's
   *  market × tier × confidence cell over the trailing year, out of sample:
   *  graded n, share within ±30%, median realized / value */
  gate?: { n: number; within30Pct: number | null; bias: number | null };
}

/** Why the engine declined to value a lot (P1-6). Stable, greppable codes —
 *  served on the lot as `abstain` so a client can tell "abstained" from
 *  "never ran" (a lot with neither `value` nor `abstain` was never scored). */
export type AbstainReason =
  | 'pool<3'            // fewer than 3 comps cleared even the relaxed gate
  | 'no-candidates'     // nothing to compare against (empty prior roster)
  | 'no-identity'       // card/TCG tiers: the title yields no comp key
  | 'dispersion'        // pool disagrees with itself past the guard
  | 'no-value'          // weighted median collapsed to 0
  | 'card:pool<2'       // card tiers: exact/ladder pools too thin, no player pool
  | 'card:player<5'     // card tier 3: player pool under the floor (legacy)
  | 'card:player-tier'  // (Sep 27) only a PLAYER median exists — abstains (2.87× live)
  | 'card:stale'        // (Sep 27) the card's pools hold no sale in the last 3 years
  | 'tcg:pool<2'        // TCG tier: exact/ladder pools too thin
  // (Oct 3 2026) THE PUBLISH GATES — a value was computed but its cell's
  // trailing-year out-of-sample record misses the bar (cards-gate.CARD_GATE)
  | 'card:uncalibrated'   // card/TCG cell under 50 graded rows
  | 'card:gate-accuracy'  // card/TCG cell under 45% within ±30%
  | 'card:gate-bias'      // card/TCG cell biased past ×/÷1.15 after correction
  | 'noest:uncalibrated'  // no-estimate market × tier never measured
  | 'noest:gate-accuracy' // no-estimate cell under 45% within ±30%
  | 'noest:gate-bias';    // no-estimate cell biased past ×/÷1.15

const MIN_COS = 0.65;   // comp-pool inclusion (calibrated: below this is a different object)
const TOP_K = 10;

// Comp-pool inclusion gate. Admits a comp when its title cosine clears a floor
// AND cos+bonus (score) clears a bar — so comps whose wording dips just under the
// old 0.65 floor but whose STRUCTURED agreement (same reference/model/entity →
// bonus) lifts score to ≥65 are kept (the engine already calls them the same
// object). Validated via scripts/gate-ab.ts temporal-holdout A/B: vs the old raw
// 0.65 floor this values +5% more lots and +172 below-market calls with IDENTICAL
// predictive edge (+40% flagged median, 63% beatHigh, 24-pt edge — all unchanged).
// Mutable so the A/B harness can flip it. score = round((cosine+bonus)*100).
export const COMP_GATE = { cosFloor: 0.50, minScore: 65 };
// Tier-b fallback gate (validated ADOPT): used ONLY when the strict gate yields
// <3 comps — never replaces a strict pool. Holdout: +1,744 lots (30.6→37.5%
// coverage) whose flagged cohort measured +38.9%/63.1%, statistically
// indistinguishable from the main engine; confidence is capped at 'medium'.
export const FALLBACK_GATE = { cosFloor: 0.45, minScore: 55 };
function passesGateWith(g: { cosFloor: number; minScore: number }, m: { cls: string; cosine: number; score: number; idExact?: boolean }): boolean {
  if (m.cls === 'none') return false;
  // exact structured identity (same numeric watch reference / same art
  // edition) IS the object — admit past the wording gates. similarity already
  // floors these at cosine 0.2 so pure noise never carries the flag.
  if (m.idExact) return true;
  return m.cosine >= g.cosFloor
    && (g.minScore === 0 || m.score >= g.minScore);
}
function passesGate(m: { cls: string; cosine: number; score: number }): boolean {
  return passesGateWith(COMP_GATE, m);
}

/** THE quantile (P2, Sep 2 2026): linear interpolation on a SORTED array —
 *  the one convention shared by the engine band, the comps.ts dispersion
 *  guards, the backtest's conformal bands and the value book. Defined once in
 *  stats.ts (quantileSorted); this export keeps the legacy 0-on-empty
 *  contract its existing callers rely on (emit-value-book). */
export function quantile(sortedVals: number[], q: number): number {
  const v = quantileSorted(sortedVals, q);
  return Number.isNaN(v) ? 0 : v;
}
const lerpQuantile = quantile;

/* ── POINT-IN-TIME DATE SEMANTICS (data contract, Sep 27 2026) ───────────
   A lot may carry `datePrecision: 'month' | 'year'` (absent = 'day'). A sale
   dated only to its month is KNOWN only once that month has ended; one dated
   only to its year, once that year has ended. `knownKey` sorts after every
   day of the sale's period and before the next period, so every
   point-in-time cut in the engine is `knownKey(comp) < valuationDay`. */
export function knownKey(l: { saleDate?: string | null; datePrecision?: string | null }): string {
  const d = (l.saleDate || '').slice(0, 10);
  const p = l.datePrecision;
  // 'unknown' precision (undated Goldin lots, empty saleDate) or no parseable
  // day: NEVER known at any cut — sorts after every real date
  if (p === 'unknown' || !/^\d{4}/.test(d)) return UNKNOWN_KEY;
  if (p === 'month' && d.length >= 7) return `${d.slice(0, 7)}-32`;
  if (p === 'year' && d.length >= 4) return `${d.slice(0, 4)}-13`;
  return d;
}
/** knownKey of an undated sale — greater than every real date */
export const UNKNOWN_KEY = '9999-99-99';
/** The data contract's precision union (app/types.ts) — absent = 'day'. */
export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

/* ── TIME ADJUSTMENT (Sep 27 2026) ──────────────────────────────────────
   Each comp is carried to the valuation date by its MARKET's price index
   before the median: a 2019 sale in a market that has since risen 30% is
   evidence of a 30%-higher price today. The index is built point-in-time
   (indices.buildTimeIndex over sales known before `asOf` only) and set here
   by the caller — build-market for the live book, the backtest replay per
   quarter. No index loaded → factor 1 everywhere (the pre-change engine). */
export interface TimeIndex {
  /** the valuation cut the index was built for (exclusive) */
  asOf: string;
  marketBySlug: Record<string, string>;
  /** market → quarter ('2024Q3') → index level (any base) */
  levels: Record<string, Record<string, number>>;
  /** market → the last quarter with a level strictly before asOf's quarter */
  lastQ: Record<string, string>;
}
let TIDX: TimeIndex | null = null;
export function setTimeIndex(ti: TimeIndex | null) { TIDX = ti; }
export function getTimeIndex(): TimeIndex | null { return TIDX; }
export const quarterKey = (d: string | null | undefined): string =>
  (d && d.length >= 7 ? `${d.slice(0, 4)}Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}` : '');
/** clamp for one comp's time factor — past ±2× an index move is a data fault
 *  or a regime the index cannot carry, not a price adjustment */
const TIME_ADJ_CLAMP = [0.5, 2] as const;
/** Factor carrying a sale in `market` on `saleDate` to the index's asOf. */
export function timeFactor(market: string | null | undefined, saleDate: string, ti: TimeIndex | null = TIDX): number {
  if (!ti || !market) return 1;
  const lv = ti.levels[market];
  const last = ti.lastQ[market];
  if (!lv || !last || !(lv[last] > 0)) return 1;
  let q = quarterKey(saleDate);
  if (!q || q >= last) return 1;
  let l = lv[q];
  if (!(l > 0)) {
    // nearest earlier quarter with a level, else the index's first level
    const qs = Object.keys(lv).filter(k => lv[k] > 0).sort();
    let pick: string | null = null;
    for (const k of qs) { if (k <= q) pick = k; else break; }
    q = pick || qs[0];
    l = lv[q];
  }
  if (!(l > 0)) return 1;
  return Math.min(TIME_ADJ_CLAMP[1], Math.max(TIME_ADJ_CLAMP[0], lv[last] / l));
}

/**
 * AUTO-CALIBRATION (set at build time by build-market from the previous
 * backtest's emitted calibration block — per-market, recency-weighted,
 * shrunk, refit every corpus build so it can never go stale the way the
 * original hand-fit constants did). The hardcoded steps below are the
 * fallback when no calibration is loaded.
 */
export interface EngineCalibration {
  edges: number[];
  beatRate: Record<string, number[]>;
  band: Record<string, { lo: number; hi: number }>;
  /** per-market tier bands where the market had ≥150 rows for the tier (P1-2);
   *  a missing market/tier falls back to `band` */
  bandByMarket?: Record<string, Record<string, { lo: number; hi: number }>>;
  /** per-market MdAPE by tier from the record (P2): 'high' is demoted where
   *  the market's own high-tier error runs past 30% */
  mdape?: Record<string, Record<string, number | null>>;
  marketBySlug?: Record<string, string>;
  /** (Sep 27) THE ESTIMATE-LOT PREDICTOR, learned point-in-time from the
   *  record: log(realized / estMid) = a[market:et] + w[tier] · log(comps /
   *  estMid). `a` carries the house premium + the houses' own bias (per
   *  market, per estimate kind — a single-point RR "$500+" low reads very
   *  differently from a band mid), shrunk toward the global intercept; `w`
   *  is the shrunk weight on the comps' disagreement with the estimate. */
  blend?: { a: Record<string, number>; w: Record<string, number>; n?: number };
  /** (Sep 27) per market × tier multiplicative bias of the PURE comp value on
   *  NO-ESTIMATE lots (median realized / compMedian, recency-weighted, shrunk
   *  toward 1), learned point-in-time. Missing cell → 1. */
  bias?: Record<string, Record<string, number>>;
  /** (Sep 27) outcome bands for the PUBLISHED value (realized / compValueUsd
   *  15/85 quantiles, recency-weighted) by path ('e' estimate-blend, 'n'
   *  no-estimate) × tier, and per market where n allows. */
  valueBand?: Record<string, Record<string, { lo: number; hi: number; mb?: number }>>;
  valueBandByMarket?: Record<string, Record<string, Record<string, { lo: number; hi: number; mb?: number }>>>;
  /** (Oct 3) the no-estimate publish gate: market → confidence → the cell's
   *  record over the trailing year (cards-gate.gateCell on log realized /
   *  published value). A missing cell = uncalibrated (abstains). */
  noEstGate?: Record<string, Record<string, CardGateCell>>;
}
/** (Oct 3) The no-estimate publish gate verdict for a valued lot (its
 *  market × confidence cell in calibration.noEstGate). Never measured →
 *  'noest:uncalibrated'. Only meaningful when FLAGS.noEstGate is on. */
export function noEstGateOf(artist: string, confidence: string, cal: EngineCalibration | null = CAL): CardGateCell {
  const market = cal?.marketBySlug?.[artist] ?? TIDX?.marketBySlug?.[artist] ?? 'other';
  return cal?.noEstGate?.[market]?.[confidence]
    || { n: 0, within30Pct: null, bias: null, pass: false, reason: 'noest:uncalibrated' };
}

/** 'high' must mean ≤~30% MdAPE in the lot's own market; 'medium' ≤~50%. */
export const CONF_MDAPE_CEIL = { high: 0.30, medium: 0.50 } as const;
let CAL: EngineCalibration | null = null;
export function setCalibration(cal: EngineCalibration | null) { CAL = cal; }
export function getCalibration(): EngineCalibration | null { return CAL; }

/** Uncalibrated fallback comp weights for the estimate-lot predictor — the
 *  2019–2024 fit of the record (scratch blend study, Sep 27): the comps earn
 *  weight only where the pool is tight. */
export const BLEND_W_DEFAULT: Record<string, number> = { high: 0.4, medium: 0.25, low: 0.05 };
/** THE ESTIMATE-LOT PREDICTION: house estimate × the house's habit × a
 *  shrunk comp adjustment. `compMedian` is the time-adjusted comp value.
 *  Returns the all-in prediction and the comp weight used.
 *
 *  (Oct 3 2026) THE HOUSE ANCHOR (FLAGS.houseAnchor): the prediction anchors
 *  on the house-bias index cell for this house × market × estimate kind —
 *  h = log(realized all-in / estimate mid), the house's premium AND its
 *  estimating habit, learned point-in-time from every sold estimate lot —
 *  and moves toward the comps by the comp weight w:
 *      log(value / mid) = (1 − w)·h + w·log(comps / mid)
 *  w is the calibrated per-tier weight (blend.w) or BLEND_W_DEFAULT.
 *  Measured on the test-year holdout (docs/ENGINE_LANES.md §Oct 3). Without
 *  the anchor (legacy engine): the fitted market intercept a (+ house cell)
 *  when calibrated, else house mid × premium × (comps vs house all-in)^w. */
export function blendPredict(
  lot: { artist: string; auctionHouse?: string | null; buyerPremiumPct?: number | null },
  estMid: number, estKind: EstKind, compMedian: number, confidence: string,
  cal: EngineCalibration | null = CAL,
): { value: number; w: number } {
  const market = cal?.marketBySlug?.[lot.artist];
  const ratio = compMedian > 0 && estMid > 0 ? compMedian / estMid : 1;
  const b = cal?.blend;
  if (FLAGS.houseAnchor) {
    const hf = houseFactorOf(market ?? TIDX?.marketBySlug?.[lot.artist], lot.auctionHouse, estKind);
    const w = b?.w[confidence] ?? BLEND_W_DEFAULT[confidence] ?? 0.1;
    if (hf) return { value: estMid * Math.exp((1 - w) * hf.log + w * Math.log(ratio)), w };
  }
  if (b) {
    const w = b.w[confidence] ?? BLEND_W_DEFAULT[confidence] ?? 0.1;
    // house × market intercept (the house's own estimate habit) → market → global
    const ek = estKind === 's' ? 'b' : estKind;
    const a = (market != null && lot.auctionHouse ? b.a[`${market}|${lot.auctionHouse}:${ek}`] : undefined)
      ?? (market != null ? b.a[`${market}:${ek}`] : undefined) ?? b.a[`global:${ek}`] ?? b.a['global:b'];
    if (typeof a === 'number' && Number.isFinite(a)) {
      return { value: estMid * Math.exp(a + w * Math.log(ratio)), w };
    }
  }
  // uncalibrated: house mid × the lot's own premium × (comps vs house all-in)^w
  const pm = lotAllInFactor(lot, estMid);
  const w = BLEND_W_DEFAULT[confidence] ?? 0.1;
  return { value: estMid * pm * Math.pow(ratio / pm, w), w };
}

/* ── PRICING WAVE 2 (Oct 6 2026): comp purity, recency cap, exact blend ── */
/** The purity gate's bar (EngineFlags.purityGate / purityPool): a flag needs
 *  ≥ minPure comps that pass comp-purity.compPurityFault, sold ≤ maxAgeY
 *  before the valuation, and inside band× of the pure comps' median. */
export const PURITY = { minPure: 3, maxAgeY: 10, band: 5, ratioCap: 5 };

/** Whether the engine applies the no-estimate bias (measured: no — see
 *  estimateValueEx; re-measured Oct 5 2026, still no). The 'n' value band is
 *  fit on the SAME basis. */
export const APPLY_NOEST_BIAS = false;
/** The shrunk no-estimate bias multiplier for a market × tier (1 = none). */
export function noEstimateBias(artist: string, confidence: string, cal: EngineCalibration | null = CAL): number {
  const market = cal?.marketBySlug?.[artist];
  const f = market != null ? cal?.bias?.[market]?.[confidence] : undefined;
  return typeof f === 'number' && f > 0 && Number.isFinite(f) ? f : 1;
}

/** The Flags' admission bar under the house-normalized engine: calibrated
 *  odds of beating the HOUSE-ADJUSTED top ≥ minOdds, and ≥ minLiftPt over
 *  the market's own at-market bucket. 55, not the legacy 50: on the adjusted
 *  yardstick sports' 1.3–2× bucket calibrates at 51% and realized 49% out of
 *  sample with a 6.6pt edge (179 flags, test year) — a coin flip is not a
 *  flag; every other market's flag buckets calibrate at 57–75%. The legacy
 *  engine keeps its 50 (raw-high odds). Mutable for the harness sweep. */
export const FLAG_GATE = { minOdds: 55, minLiftPt: 10, minOddsHammer: 45 };

/** Calibrated beat-high rate as a function of compRatio (comps / estimate-mid).
 *  Falls back to the original holdout fit (n=5,215, monotonic 42% → 69%). */
function beatRate(compRatio: number, market?: string, estKind?: EstKind): number {
  if (CAL) {
    // single-point (RR "$500+") lots read the ':pt' row when calibrated —
    // there "beat" means beating the LOW estimate, a different base rate.
    // (Oct 6) a single printed figure reads ONLY its own ':sf' row (market,
    // then global); none calibrated → NaN (the caller never flags on it)
    if (estKind === 's') {
      const sf = (market && CAL.beatRate[`${market}:sf`]) || CAL.beatRate['global:sf'];
      if (!sf || sf.length !== CAL.edges.length + 1) return NaN;
      let b = 0;
      for (const e of CAL.edges) { if (compRatio < e) break; b++; }
      return sf[b];
    }
    const row = (market && estKind === 'p' && CAL.beatRate[`${market}:pt`])
      || (market && CAL.beatRate[market]) || CAL.beatRate.global;
    if (row && row.length === CAL.edges.length + 1) {
      let b = 0;
      for (const e of CAL.edges) { if (compRatio < e) break; b++; }
      return row[b];
    }
  }
  if (compRatio < 0.6) return 42;
  if (compRatio < 0.9) return 48;
  if (compRatio < 1.3) return 55;
  if (compRatio < 2.0) return 64;
  return 69;
}

/**
 * Estimate value for `lot` from its comparable prior sales in `pool`.
 * `pool` MUST be pre-filtered to sales strictly before lot.saleDate when used
 * for validation; for a live upcoming lot, pass all sold comps.
 *
 * `resolveComps` yields scored, in-pool comps (already candidate-blocked).
 */
export function estimateValue(
  lot: AuctionLot & { _v?: Record<string, number> },
  comps: Comp[],
  tbl: IdfTable,
): ValueResult | null {
  return estimateValueEx(lot, comps, tbl).value;
}

/** estimateValue with the abstention reason surfaced (P1-6). `value` is the
 *  exact object estimateValue returns (null on abstention); `abstain` names why. */
export function estimateValueEx(
  lot: AuctionLot & { _v?: Record<string, number> },
  comps: Comp[],
  tbl: IdfTable,
): { value: ValueResult | null; abstain: AbstainReason | null } {
  // rank by match score; keep the comp-worthy pool. If the strict gate can't
  // seat 3 comps, retry once at the relaxed tier-b gate (validated: marginal
  // quality indistinguishable from the main engine) — never mix the two.
  let tier: 'main' | 'fallback' = 'main';
  // (Oct 6, FLAGS.compBoundary) a comp across a HARD boundary — signed vs
  // unsigned, another subject, another designator, another object class —
  // never enters either gate's pool (comp-purity.compBoundaryFault)
  const src = FLAGS.compBoundary ? comps.filter(c => !c.lot || !compBoundaryFault(lot, c.lot)) : comps;
  let pool = src
    .filter(c => passesGate(c.match) && c.realizedUsd > 0)
    .sort((a, b) => b.match.score - a.match.score);
  if (pool.length < 3) {
    const relaxed = src
      .filter(c => passesGateWith(FALLBACK_GATE, c.match) && c.realizedUsd > 0)
      .sort((a, b) => b.match.score - a.match.score);
    if (relaxed.length < 3) return { value: null, abstain: comps.length ? 'pool<3' : 'no-candidates' };
    pool = relaxed;
    tier = 'fallback';
  }

  const refMs = (() => { const t = new Date(lot.saleDate || '').getTime(); return isNaN(t) ? Date.now() : t; })();
  const ageYOf = (c: Comp) => { const t = new Date(c.saleDate || '').getTime(); return isNaN(t) ? Infinity : (refMs - t) / 31_557_600_000; };
  // (Oct 6, FLAGS.purityGate / purityPool) THE PURE COMPS: an object-naming
  // title, the target's medium family + edition class (comp-purity), sold ≤
  // PURITY.maxAgeY before the valuation, inside PURITY.band× of their own
  // median. A target whose own title names no object has none.
  const targetIdLess = FLAGS.purityGate || FLAGS.purityPool ? isIdentityLessTitle(lot) : false;
  const pureOf = (cs: Comp[]): Comp[] => {
    if (targetIdLess) return [];
    const st = cs.filter(c => ageYOf(c) <= PURITY.maxAgeY && !(c.lot && compPurityFault(lot, c.lot)));
    if (!st.length) return st;
    const m = quantile(st.map(c => c.realizedUsd).sort((a, b) => a - b), 0.5);
    return st.filter(c => c.realizedUsd <= m * PURITY.band && c.realizedUsd >= m / PURITY.band);
  };
  if (FLAGS.purityPool) {
    const p = pureOf(pool);
    if (p.length >= PURITY.minPure) pool = p;
  }

  const top = pool.slice(0, TOP_K);
  // Recency decay (validated ADOPT, halflife 2y): a comp's weight halves every
  // 2 years of age relative to the lot's own sale (or now for a live lot).
  // Measured on temporal holdout: identical coverage, edge 23.9→25.0pt, +199
  // flags with clean churn (removed flags realize like unflagged).
  // hl=2y for estimate lots (directional signal); hl=1y on the no-estimate
  // (Goldin absolute) path — memorabilia cycles faster, and the uncapped
  // holdout measured MdAPE 41.2%→38.8% at hl≈1y there.
  // ANY estimate (incl. RR's single-point low) = the directional path → 2y;
  // only the true no-estimate (Goldin absolute) path takes the 1y halflife.
  const halflife = (lot.estLowUsd || lot.estHighUsd) ? 2 : 1;
  const decay = (c: Comp) => {
    const t = new Date(c.saleDate || '').getTime();
    if (isNaN(t)) return 0.25; // undated comp: penalty weight, never max recency
    const ageYears = Math.max(0, (refMs - t) / 31_557_600_000);
    return Math.pow(0.5, ageYears / halflife);
  };
  const market = CAL?.marketBySlug?.[lot.artist] ?? TIDX?.marketBySlug?.[lot.artist];
  // the comp's price carried to the valuation date by its market's index
  const adjOf = (c: Comp) => c.realizedUsd * timeFactor(TIDX?.marketBySlug?.[lot.artist] ?? market, c.saleDate);
  // the CERTIFIED statistic (compRatio → the Flags) stays on the unadjusted
  // pool; the time-adjusted median is the value's comp input
  let compRawUsd = weightedMedian(top.map(c => [c.realizedUsd, (c.match.cosine ** 2) * decay(c)] as [number, number]));
  let compAdjUsd = weightedMedian(top.map(c => [adjOf(c), (c.match.cosine ** 2) * decay(c)] as [number, number]));
  if (!(compRawUsd > 0) || !(compAdjUsd > 0)) return { value: null, abstain: 'no-value' };
  const vals = top.map(c => c.realizedUsd).sort((a, b) => a - b);
  const adjVals = top.map(adjOf).sort((a, b) => a - b);

  // confidence from pool size, best-match strength, and dispersion. disp stays
  // on the tight q1..q3 (unchanged from the tier experiment); thresholds
  // tightened (2.2→1.5, 4→2.5) so the tiers order strictly by accuracy —
  // "high" now earns its label (medAbsErr 31%→27%, holds in split-half).
  const bestCos = top.reduce((m, c) => Math.max(m, c.match.cosine), 0);
  const dLow = quantile(vals, 0.25);
  const dHigh = quantile(vals, 0.75);
  const disp = dHigh > 0 ? dHigh / Math.max(dLow, 1) : 99;
  // idExact comps (same watch reference / same art edition) carry identity the
  // title cosine can't see — a pool anchored on them earns tiers on pool size
  // + dispersion alone, bestCos waived.
  const idn = top.filter(c => c.match.idExact).length;
  let confidence: ValueResult['confidence'] = 'low';
  if (pool.length >= 6 && (bestCos >= 0.85 || idn >= 4) && disp <= 1.5) confidence = 'high';
  else if (pool.length >= 4 && (bestCos >= 0.72 || idn >= 3) && disp <= 2.5) confidence = 'medium';
  // a relaxed-gate pool never claims the top tier
  if (tier === 'fallback' && confidence === 'high') confidence = 'medium';
  // PER-MARKET HONESTY (P2): the record's own MdAPE for this market × tier
  // decides whether the tier label is earned — 'high' must run ≤30% MdAPE in
  // this market, 'medium' ≤50%; otherwise demote one notch. No calibration →
  // the structural ladder above stands alone.
  const md = market ? CAL?.mdape?.[market] : undefined;
  if (md) {
    if (confidence === 'high' && typeof md.high === 'number' && md.high > CONF_MDAPE_CEIL.high) confidence = 'medium';
    // (Oct 6, FLAGS.confOnPublished) at most ONE notch: a 'high' demoted for
    // its own tier's error is not demoted again for the 'medium' tier's
    else if (confidence === 'medium' && typeof md.medium === 'number' && md.medium > CONF_MDAPE_CEIL.medium) confidence = 'low';
    if (!FLAGS.confOnPublished && confidence === 'medium' && typeof md.medium === 'number' && md.medium > CONF_MDAPE_CEIL.medium) confidence = 'low';
  }


  // strongest identity match → "this exact item sold for $Z"
  const exactC = top.find(c => c.match.cls === 'physicalMatch') || top.find(c => c.match.cls === 'modelMatch' && c.match.cosine >= 0.92);
  const exact = exactC ? { id: exactC.id, realizedUsd: exactC.realizedUsd, saleDate: exactC.saleDate, cls: exactC.match.cls as 'physicalMatch' | 'modelMatch' } : null;

  // single-point fallback (RR posts low only) — mirror estUsdBand/demand.ts
  const eLo = lot.estLowUsd ?? lot.estHighUsd;
  const eHi = lot.estHighUsd ?? lot.estLowUsd;
  const estMid = eLo && eHi ? (eLo + eHi) / 2 : null;
  const estKind: EstKind = estKindOf(lot.estLowUsd, lot.estHighUsd);

  // DIRECTIONAL signal (estimate lots)
  let signal: ValueResult['signal'] = null;
  let partial: string | null = null;
  let compRatio: number | null = null;
  let flagRatio: number | null = null;
  let houseF: number | undefined;
  // (Oct 6, FLAGS.hammerBasis) the comps' median through THIS lot's dated
  // premium inverse — hammer vs the hammer-basis estimate
  const ratioOf = (allIn: number) => (FLAGS.hammerBasis ? lotHammerFromAllIn(lot, allIn) : allIn) / estMid!;
  if (estMid && estMid > 0) {
    compRatio = ratioOf(compRawUsd);
    // EXACT-MATCH CONSISTENCY GUARD (holdout-validated ADOPT): an extreme
    // ratio that contradicts the lot's own strongest evidence — an exact comp
    // realized inside the estimate band — is comp-pool pollution, not alpha.
    // Recompute from the exact-class comps only; cap confidence at medium.
    // Fired cohort measured unflagged-like (+16%/−7% hammer, 52% beat); the
    // base compValue was 7.3× high vs 0.87 after. Edge 20.4→20.6pt, art +0.8.
    // eLo/eHi (not the raw fields): RR posts estLow only, and 2*undefined=NaN
    // made this guard DEAD on every single-point lot — the exact cohort it
    // was validated to protect.
    if (compRatio > 5 && exactC
        && exactC.realizedUsd >= 0.5 * eLo! && exactC.realizedUsd <= 2 * eHi!) {
      const exactPool = top.filter(c => c.match.cls === 'physicalMatch'
        || (c.match.cls === 'modelMatch' && c.match.cosine >= 0.92));
      if (exactPool.length) {
        compRawUsd = weightedMedian(exactPool.map(c => [c.realizedUsd, (c.match.cosine ** 2) * decay(c)] as [number, number]));
        compAdjUsd = weightedMedian(exactPool.map(c => [adjOf(c), (c.match.cosine ** 2) * decay(c)] as [number, number]));
        compRatio = ratioOf(compRawUsd);
        if (confidence === 'high') confidence = 'medium';
      }
    }
    // (Oct 3 2026) THE HOUSE-NORMALIZED FLAG: the signal is called on comps vs
    // the estimate AS THIS HOUSE HABITUALLY CLEARS IT (house-bias index,
    // point-in-time) — a house that prints low estimates by policy no longer
    // reads as a flag on every lot. compRatio itself stays raw.
    flagRatio = compRatio;
    if (FLAGS.houseNormFlags) {
      const hf = houseFactorOf(market, lot.auctionHouse, estKind);
      if (hf) { houseF = hf.f; flagRatio = compRatio / hf.f; }
    }
    const br = beatRate(flagRatio, CAL?.marketBySlug?.[lot.artist], estKind);
    // ODDS GATE (Aug 13 value audit): admission by the market's CALIBRATED
    // beat rate, not the raw ratio alone. The 1.3 threshold was near a coin
    // flip in watches' low buckets (35-36%) while cr>2.0 runs 69-72% in every
    // market — a 'below' flag must carry ≥50% calibrated odds, 'strong' ≥60%.
    // This deletes the weak tail per-vertical automatically as calibration
    // refits, and keeps every strong flag.
    // (Oct 3) ODDS LIFT: under the house-adjusted yardstick a market's base
    // beat rate varies (a house that over-estimates its sports lots makes the
    // adjusted top easy to beat), so a flag must also LIFT the odds over the
    // market's own at-market bucket (flag ratio ≈ 1) by FLAG_GATE.minLiftPt —
    // a flag that only reads a soft yardstick is not a flag
    const lifted = !FLAGS.houseNormFlags || !CAL
      || br - beatRate(1, CAL?.marketBySlug?.[lot.artist], estKind) >= FLAG_GATE.minLiftPt;
    const minOdds = FLAGS.houseNormFlags && CAL ? (FLAGS.hammerBasis ? FLAG_GATE.minOddsHammer : FLAG_GATE.minOdds) : 50;
    // (Oct 6) a single printed figure with no odds row of its own carries no
    // directional call either way (br NaN)
    const uncal = Number.isNaN(br);
    const label: SignalLabel = uncal ? SIGNAL_LABEL.at
      : flagRatio >= 1.3 && br >= minOdds && lifted ? SIGNAL_LABEL.below
        : flagRatio <= 0.75 ? SIGNAL_LABEL.above
          : SIGNAL_LABEL.at;
    const strength = (flagRatio >= 2 && br >= 60) || flagRatio <= 0.55 ? 'strong'
      : flagRatio >= 1.3 || flagRatio <= 0.75 ? 'moderate' : 'slight';
    signal = { label, strength, beatRatePct: uncal ? 0 : br };
    // (Oct 6, FLAGS.purityGate) no directional read without the evidence for
    // one: a comp ratio outside the ×5 estimate-band sanity is a data fault
    // (engineFlagOf already hid it; the signal itself kept 'strong, 64%'),
    // and a read needs ≥ PURITY.minPure pure comps
    if (FLAGS.purityGate) {
      if (!(compRatio <= PURITY.ratioCap && compRatio >= 1 / PURITY.ratioCap)) { signal = null; partial = 'flag:ratio-x5'; }
      else if (pureOf(top).length < PURITY.minPure) { signal = null; partial = 'flag:purity'; }
    }
  }

  // THE PUBLISHED VALUE (Sep 27 2026 engine pass). Measured live (659 estimate
  // lots, Sep 14 → 27): the pure comp median ran 0.60 median abs error vs the
  // house midpoint × premium at 0.32 — comps lose to the specialist on
  // heterogeneous objects. So on estimate lots the prediction IS the house
  // estimate × premium, moved by a SHRUNK comp adjustment whose weight the
  // record learns point-in-time (tight pools earn weight, loose ones ~none).
  // No-estimate lots keep the pure comp value, bias-corrected per market ×
  // tier (learned point-in-time, shrunk to 1).
  let blendW: number | undefined;
  let predUsd: number;
  if (estMid && estMid > 0) {
    const bp = blendPredict(lot, estMid, estKind, compAdjUsd, confidence);
    predUsd = bp.value; blendW = bp.w;
  } else {
    // The no-estimate market×tier bias (calibration.bias) is FITTED and
    // published but NOT applied: re-scored live (Sep 14 → 27, the same 187
    // hedonic no-estimate lots) it moved median abs error 1.00 → 1.05 — the
    // replay's no-estimate pools don't yet mirror production's same-player /
    // roster-tier pools closely enough for its level to transfer. The time
    // adjustment alone carries this path (0.97 → 1.00 vs 1.05 before).
    // RE-MEASURED Oct 5 2026 with point-in-time fits by market × tier (and by
    // house × market, 4y/2y/1y windows) on the full-replay record, test year
    // Oct 25 → Oct 26 (7,936 no-estimate lots): bias 1.069 → 1.00–1.04 but
    // median abs error 67.1% → 67.1–67.9% and ±30% 29.2% → 28.7–29.0% — it
    // recentres the level without making a single value more accurate; live
    // (Sep 14 book, 197 lots) 99.5% → 101.0% error. Stays off.
    // docs/ENGINE_LANES.md §10.
    predUsd = compAdjUsd * (APPLY_NOEST_BIAS ? noEstimateBias(lot.artist, confidence) : 1);
  }
  if (!(predUsd > 0) || !Number.isFinite(predUsd)) return { value: null, abstain: 'no-value' };

  // OUTCOME BAND for the published value. Calibrated: the prediction × the
  // path×tier (per market where deep enough) 15/85 quantiles of realized /
  // prediction — recency-weighted so the width tracks the current market
  // (the uncalibrated comp-quantile band ran 48% coverage on 'high' live).
  // Legacy calibration (no valueBand yet) → the conformal comp band on the
  // pure comp value; nothing loaded → the pool's own 15/85 spread.
  const path = estMid ? 'e' : 'n';
  let bandLow: number, bandHigh: number;
  let mbAllIn: number | null = null;
  const vb = (market && CAL?.valueBandByMarket?.[market]?.[path]?.[confidence]) || CAL?.valueBand?.[path]?.[confidence];
  const bandCal = (market && CAL?.bandByMarket?.[market]?.[confidence]) || CAL?.band?.[confidence];
  if (vb) {
    bandLow = predUsd * vb.lo; bandHigh = predUsd * vb.hi;
    if (typeof vb.mb === 'number' && vb.mb > 0) mbAllIn = predUsd * vb.mb;
  } else if (bandCal) {
    bandLow = predUsd * bandCal.lo; bandHigh = predUsd * bandCal.hi;
  } else {
    // Displayed band widened to q0.15..q0.85 (lerp) so it honestly covers
    // ~50% of realized outcomes, re-centred on the prediction.
    const scale = predUsd / compAdjUsd;
    bandLow = lerpQuantile(adjVals, 0.15) * scale;
    bandHigh = lerpQuantile(adjVals, 0.85) * scale;
  }
  if (bandLow > predUsd) bandLow = predUsd;
  if (bandHigh < predUsd) bandHigh = predUsd;

  // ABSOLUTE value (Goldin / no estimate) + under/over vs live bid
  let estimateUsd: number | null = null;
  let vsBid: ValueResult['vsBid'] = null;
  if (!estMid) {
    estimateUsd = predUsd;
    const bid = lot.currentBid || 0;
    if (bid > 0) vsBid = vsBidRead(lot, bid, predUsd);
  }

  return { value: {
    poolIds: top.map(c => c.id),
    n: pool.length,
    compValueUsd: Math.round(predUsd),
    low: Math.round(bandLow),
    high: Math.round(bandHigh),
    compRatio,
    signal,
    estimateUsd: estimateUsd != null ? Math.round(estimateUsd) : null,
    vsBid,
    confidence,
    tier,
    exact,
    idn: idn || undefined,
    ...(partial ? { abstain: partial } : {}),
    compMedianUsd: Math.round(compRawUsd),
    compAdjUsd: Math.round(compAdjUsd),
    ...(blendW != null ? { blendW: Math.round(blendW * 100) / 100 } : {}),
    ...(flagRatio != null ? { flagRatio: Math.round(flagRatio * 1000) / 1000 } : {}),
    ...(houseF != null ? { houseFactor: Math.round(houseF * 1000) / 1000 } : {}),
    ...buyerFields(lot, predUsd, bandLow, bandHigh, mbAllIn),
  }, abstain: null };
}

/** BASIS-CONSISTENT bid read (P1-5): compValue is all-in (a median of
 *  premium-inclusive realized prices), so the live bid is grossed to all-in
 *  through the lot's house premium BEFORE the comparison — a raw hammer bid
 *  read ~20% "below comps" on every lot by construction. Shared by the
 *  hedonic path and the card tiers (build-market) so the ±12% band means one
 *  thing everywhere. */
export function vsBidRead(lot: { auctionHouse?: string | null; buyerPremiumPct?: number | null }, bid: number, compValueUsd: number): NonNullable<ValueResult['vsBid']> {
  const bidAllIn = bid * lotAllInFactor(lot, bid);
  const pct = Math.round((bidAllIn / compValueUsd - 1) * 100);
  return { label: pct <= -12 ? 'below recent comps' : pct >= 12 ? 'above recent comps' : 'in line', pct };
}

/* ── THE COMP CANDIDATE INDEX (Oct 5 2026 scale pass) ─────────────────────
   resolveComps scores every candidate it is handed; the live book handed it
   the lot's WHOLE maker roster, so valuing the upcoming book cost
   O(upcoming × maker book) cosines — superlinear in corpus size (161s at 1×,
   3,476s at a 3× synthetic corpus). The backtest replay has carried an EXACT
   pre-filter since Sep 2 (backtest-core.candidatePriors); this is the same
   necessary-condition filter as a shared, order-preserving index:
     a comp is admitted only with cosine ≥ FALLBACK_GATE.cosFloor (or an exact
     ref/edition identity), and cosine(a,b) ≤ ‖a restricted to the tokens b
     shares‖ / ‖a‖ — so a candidate sharing NO token from the lot's
     heaviest-IDF prefix (the prefix after which the remaining suffix norm
     fraction drops under the floor) can never be admitted. Exact-identity
     candidates come from their own posting list.
   compCandidates returns the surviving roster positions in ASCENDING order, so
   resolveComps sees the admissible candidates in the roster's own order and
   returns byte-identically the comps the full scan would (proved on the real
   corpus by scripts/ci/equivalence.ts; unit-tested in engine-core.test.ts).
   CONTRACT: the roster and the lot carry `_v`/`_vn` from ONE buildVectors
   pass (the norms cosine() trusts); the roster is not mutated after the index
   is built. A lot without a vector gets `null` (caller scans the roster). */
export interface CompCandidateIndex {
  roster: readonly AuctionLot[];
  posting: Map<string, number[]>;
  idPosting: Map<string, number[]>;
  mark: Int32Array;
  gen: number;
}
/** The exact-identity key similarity's exactIdentity compares (numeric watch
 *  reference / art edition) — a superset key: materials are checked later. */
export function compIdentityKey(l: Pick<AuctionLot, 'artist' | 'reference' | 'title' | 'formKey' | 'medium'>): string | null {
  if (WATCH_SLUGS.has(l.artist)) return numericWatchRef(l);
  return isEditionLot(l) ? editionIdentityKey(l) : null;
}
export function buildCompCandidateIndex(roster: readonly (AuctionLot & { _v?: Record<string, number> })[]): CompCandidateIndex {
  const posting = new Map<string, number[]>();
  const idPosting = new Map<string, number[]>();
  for (let i = 0; i < roster.length; i++) {
    const c = roster[i];
    const toks = c._v ? Object.keys(c._v) : Array.from(new Set(c.titleTokens || []));
    for (const t of toks) { const p = posting.get(t); if (p) p.push(i); else posting.set(t, [i]); }
    const k = compIdentityKey(c);
    if (k) { const p = idPosting.get(k); if (p) p.push(i); else idPosting.set(k, [i]); }
  }
  return { roster, posting, idPosting, mark: new Int32Array(roster.length), gen: 0 };
}
/** Roster positions (ascending) that can possibly pass resolveComps' admission
 *  gate for `lot`; null when the lot carries no precomputed vector. */
export function compCandidates(ix: CompCandidateIndex, lot: AuctionLot & { _v?: Record<string, number>; _vn?: number }): number[] | null {
  const v = lot._v;
  const vn = lot._vn;
  if (!v || typeof vn !== 'number') return null;
  ix.gen++;
  if (ix.gen === 0x7fffffff) { ix.mark.fill(0); ix.gen = 1; }
  const gen = ix.gen, mark = ix.mark;
  const hits: number[] = [];
  const visit = (list: number[] | undefined) => {
    if (!list) return;
    for (let k = 0; k < list.length; k++) { const i = list[k]; if (mark[i] !== gen) { mark[i] = gen; hits.push(i); } }
  };
  if (vn > 0) {
    // heaviest-IDF first; stop once the remaining suffix can no longer carry
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
  const idk = compIdentityKey(lot);
  if (idk) visit(ix.idPosting.get(idk));
  return hits.sort((a, b) => a - b);
}

/**
 * Score `lot` against candidate comps and return the in-pool Comp list. Used
 * by build-market.ts (and validate-engine.ts with a prior-only filter).
 *
 * Point-in-time: with `priorTo`, a comp is admitted only once its sale was
 * KNOWN before that day (knownKey — month/year-precision dates count from the
 * end of their period). Never admits a `compExclude`-stamped lot, and never a
 * comp of a different SHAPE (comps.lotShapeOf: a part never comps a whole, a
 * single never a set/lot, original art never a printed object).
 */
export function resolveComps(
  lot: AuctionLot & { _v?: Record<string, number> },
  candidates: (AuctionLot & { _v?: Record<string, number> })[],
  tbl: IdfTable,
  priorTo?: string,
): Comp[] {
  const out: Comp[] = [];
  const shapeA = lotShapeOf(lot.title);
  for (const c of candidates) {
    if (c.id === lot.id) continue;
    if (priorTo && !(knownKey(c as { saleDate?: string; datePrecision?: string | null }) < priorTo)) continue;
    if (c.status !== 'sold' || !(c.realizedUsd! > 0)) continue;
    if (isCompExcluded(c)) continue;
    if (!shapesCompatible(shapeA, lotShapeOf(c.title))) continue;
    const m = similarity(lot, c, tbl);
    // admit down to the RELAXED tier-b gate — estimateValue applies the strict
    // gate first and only reaches for these when the strict pool is thin
    if (!passesGateWith(FALLBACK_GATE, m)) continue;
    out.push({ id: c.id, match: m, realizedUsd: compAllInUsd(c), saleDate: c.saleDate, lot: c });
  }
  return out;
}

/** (Oct 6 2026) A comp's price ON THE POOL'S BASIS (all-in). Every pool
 *  statistic is a median of premium-inclusive realized prices, but a row whose
 *  priceBasis says the number is the HAMMER ('hammer-only' — Bonhams/Phillips
 *  lots published without a premium; 'hammer' — the struts houses' stamp)
 *  carries realizedUsd = hammer. Gross it with the house premium in force on
 *  ITS sale date (premiums.lotAllInFactor — the stamped premium, else the dated
 *  schedule; the exact inverse of lotHammerFromAllIn), so a hammer never sits
 *  ~20% low in an all-in pool. */
export function compAllInUsd(c: { realizedUsd?: number | null; hammerUsd?: number | null; priceBasis?: string | null; auctionHouse?: string | null; buyerPremiumPct?: number | null; saleDate?: string | null }): number {
  const r = c.realizedUsd || 0;
  if (c.priceBasis !== 'hammer-only' && c.priceBasis !== 'hammer') return r;
  const h = (c.hammerUsd || 0) > 0 ? c.hammerUsd! : r;
  return h > 0 ? Math.round(h * lotAllInFactor(c, h) * 100) / 100 : r;
}
