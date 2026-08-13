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

export interface Comp { id: string; match: Match; realizedUsd: number; saleDate: string; }

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
  signal: { label: 'below comparable market' | 'above comparable market' | 'at comparable market'; strength: 'strong' | 'moderate' | 'slight'; beatRatePct: number } | null;
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
}

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
function passesGateWith(g: { cosFloor: number; minScore: number }, m: { cls: string; cosine: number; score: number }): boolean {
  return m.cls !== 'none'
    && m.cosine >= g.cosFloor
    && (g.minScore === 0 || m.score >= g.minScore);
}
function passesGate(m: { cls: string; cosine: number; score: number }): boolean {
  return passesGateWith(COMP_GATE, m);
}

function weightedMedian(pairs: [number, number][]): number {
  const s = [...pairs].sort((a, b) => a[0] - b[0]);
  const total = s.reduce((t, p) => t + p[1], 0);
  let c = 0;
  for (const [v, w] of s) { c += w; if (c >= total / 2) return v; }
  return s.length ? s[s.length - 1][0] : 0;
}
function quantile(sortedVals: number[], q: number): number {
  if (!sortedVals.length) return 0;
  const i = Math.min(sortedVals.length - 1, Math.max(0, Math.round(q * (sortedVals.length - 1))));
  return sortedVals[i];
}
/** Linear-interpolation quantile for the DISPLAYED band — the round-index one
 *  makes an n=3 band [median, max] (shows the median as "low"). */
function lerpQuantile(sortedVals: number[], q: number): number {
  if (!sortedVals.length) return 0;
  const pos = q * (sortedVals.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedVals[lo];
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (pos - lo);
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
  marketBySlug?: Record<string, string>;
}
let CAL: EngineCalibration | null = null;
export function setCalibration(cal: EngineCalibration | null) { CAL = cal; }

/** Calibrated beat-high rate as a function of compRatio (comps / estimate-mid).
 *  Falls back to the original holdout fit (n=5,215, monotonic 42% → 69%). */
function beatRate(compRatio: number, market?: string): number {
  if (CAL) {
    const row = (market && CAL.beatRate[market]) || CAL.beatRate.global;
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
  // rank by match score; keep the comp-worthy pool. If the strict gate can't
  // seat 3 comps, retry once at the relaxed tier-b gate (validated: marginal
  // quality indistinguishable from the main engine) — never mix the two.
  let tier: 'main' | 'fallback' = 'main';
  let pool = comps
    .filter(c => passesGate(c.match) && c.realizedUsd > 0)
    .sort((a, b) => b.match.score - a.match.score);
  if (pool.length < 3) {
    const relaxed = comps
      .filter(c => passesGateWith(FALLBACK_GATE, c.match) && c.realizedUsd > 0)
      .sort((a, b) => b.match.score - a.match.score);
    if (relaxed.length < 3) return null;
    pool = relaxed;
    tier = 'fallback';
  }

  const top = pool.slice(0, TOP_K);
  // Recency decay (validated ADOPT, halflife 2y): a comp's weight halves every
  // 2 years of age relative to the lot's own sale (or now for a live lot).
  // Measured on temporal holdout: identical coverage, edge 23.9→25.0pt, +199
  // flags with clean churn (removed flags realize like unflagged).
  const refMs = (() => { const t = new Date(lot.saleDate || '').getTime(); return isNaN(t) ? Date.now() : t; })();
  // hl=2y for estimate lots (directional signal); hl=1y on the no-estimate
  // (Goldin absolute) path — memorabilia cycles faster, and the uncapped
  // holdout measured MdAPE 41.2%→38.8% at hl≈1y there.
  const halflife = (lot.estLowUsd && lot.estHighUsd) ? 2 : 1;
  const decay = (c: Comp) => {
    const t = new Date(c.saleDate || '').getTime();
    if (isNaN(t)) return 1;
    const ageYears = Math.max(0, (refMs - t) / 31_557_600_000);
    return Math.pow(0.5, ageYears / halflife);
  };
  let compValueUsd = weightedMedian(top.map(c => [c.realizedUsd, (c.match.cosine ** 2) * decay(c)]));
  const vals = top.map(c => c.realizedUsd).sort((a, b) => a - b);
  // Displayed band widened to q0.15..q0.85 (lerp) so it honestly covers ~50% of
  // realized outcomes; the round q1..q3 only covered ~37% and mislabeled the
  // median as "low" on tiny pools. (Measured: scripts/gate-ab band experiment.)
  const low = lerpQuantile(vals, 0.15);
  const high = lerpQuantile(vals, 0.85);

  // confidence from pool size, best-match strength, and dispersion. disp stays
  // on the tight q1..q3 (unchanged from the tier experiment); thresholds
  // tightened (2.2→1.5, 4→2.5) so the tiers order strictly by accuracy —
  // "high" now earns its label (medAbsErr 31%→27%, holds in split-half).
  const bestCos = top[0].match.cosine;
  const dLow = quantile(vals, 0.25);
  const dHigh = quantile(vals, 0.75);
  const disp = dHigh > 0 ? dHigh / Math.max(dLow, 1) : 99;
  let confidence: ValueResult['confidence'] = 'low';
  if (pool.length >= 6 && bestCos >= 0.85 && disp <= 1.5) confidence = 'high';
  else if (pool.length >= 4 && bestCos >= 0.72 && disp <= 2.5) confidence = 'medium';
  // a relaxed-gate pool never claims the top tier
  if (tier === 'fallback' && confidence === 'high') confidence = 'medium';


  // strongest identity match → "this exact item sold for $Z"
  const exactC = top.find(c => c.match.cls === 'physicalMatch') || top.find(c => c.match.cls === 'modelMatch' && c.match.cosine >= 0.92);
  const exact = exactC ? { id: exactC.id, realizedUsd: exactC.realizedUsd, saleDate: exactC.saleDate, cls: exactC.match.cls as 'physicalMatch' | 'modelMatch' } : null;

  // single-point fallback (RR posts low only) — mirror estUsdBand/demand.ts
  const eLo = lot.estLowUsd ?? lot.estHighUsd;
  const eHi = lot.estHighUsd ?? lot.estLowUsd;
  const estMid = eLo && eHi ? (eLo + eHi) / 2 : null;

  // DIRECTIONAL signal (estimate lots)
  let signal: ValueResult['signal'] = null;
  let compRatio: number | null = null;
  if (estMid && estMid > 0) {
    compRatio = compValueUsd / estMid;
    // EXACT-MATCH CONSISTENCY GUARD (holdout-validated ADOPT): an extreme
    // ratio that contradicts the lot's own strongest evidence — an exact comp
    // realized inside the estimate band — is comp-pool pollution, not alpha.
    // Recompute from the exact-class comps only; cap confidence at medium.
    // Fired cohort measured unflagged-like (+16%/−7% hammer, 52% beat); the
    // base compValue was 7.3× high vs 0.87 after. Edge 20.4→20.6pt, art +0.8.
    if (compRatio > 5 && exactC
        && exactC.realizedUsd >= 0.5 * lot.estLowUsd! && exactC.realizedUsd <= 2 * lot.estHighUsd!) {
      const exactPool = top.filter(c => c.match.cls === 'physicalMatch'
        || (c.match.cls === 'modelMatch' && c.match.cosine >= 0.92));
      if (exactPool.length) {
        compValueUsd = weightedMedian(exactPool.map(c => [c.realizedUsd, (c.match.cosine ** 2) * decay(c)]));
        compRatio = compValueUsd / estMid;
        if (confidence === 'high') confidence = 'medium';
      }
    }
    const br = beatRate(compRatio, CAL?.marketBySlug?.[lot.artist]);
    // ODDS GATE (Aug 13 value audit): admission by the market's CALIBRATED
    // beat rate, not the raw ratio alone. The 1.3 threshold was near a coin
    // flip in watches' low buckets (35-36%) while cr>2.0 runs 69-72% in every
    // market — a 'below' flag must carry ≥50% calibrated odds, 'strong' ≥60%.
    // This deletes the weak tail per-vertical automatically as calibration
    // refits, and keeps every strong flag.
    const label = compRatio >= 1.3 && br >= 50 ? 'below comparable market'
      : compRatio <= 0.75 ? 'above comparable market'
        : 'at comparable market';
    const strength = (compRatio >= 2 && br >= 60) || compRatio <= 0.55 ? 'strong'
      : compRatio >= 1.3 || compRatio <= 0.75 ? 'moderate' : 'slight';
    signal = { label, strength, beatRatePct: br };
  }

  // SPLIT-CONFORMAL band (when calibration is loaded): compValue × the
  // per-tier 15/85 quantiles of realized/compValue from the holdout — an
  // honest ~70% outcome band (the comp-price quantile band only covered
  // ~42-51%, and "high" confidence was the LEAST honest at 41.8%).
  let bandLow = low, bandHigh = high;
  const bandCal = CAL?.band?.[confidence];
  if (bandCal && compValueUsd > 0) {
    bandLow = compValueUsd * bandCal.lo;
    bandHigh = compValueUsd * bandCal.hi;
  }

  // ABSOLUTE value (Goldin / no estimate) + under/over vs live bid
  let estimateUsd: number | null = null;
  let vsBid: ValueResult['vsBid'] = null;
  if (!estMid) {
    estimateUsd = compValueUsd;
    const bid = lot.currentBid || 0;
    if (bid > 0) {
      const pct = Math.round((bid / compValueUsd - 1) * 100);
      vsBid = { label: pct <= -12 ? 'below recent comps' : pct >= 12 ? 'above recent comps' : 'in line', pct };
    }
  }

  return {
    poolIds: top.map(c => c.id),
    n: pool.length,
    compValueUsd: Math.round(compValueUsd),
    low: Math.round(bandLow),
    high: Math.round(bandHigh),
    compRatio,
    signal,
    estimateUsd: estimateUsd != null ? Math.round(estimateUsd) : null,
    vsBid,
    confidence,
    tier,
    exact,
  };
}

/**
 * Score `lot` against candidate comps and return the in-pool Comp list. Used
 * by build-market.ts (and validate-engine.ts with a prior-only filter).
 */
export function resolveComps(
  lot: AuctionLot & { _v?: Record<string, number> },
  candidates: (AuctionLot & { _v?: Record<string, number> })[],
  tbl: IdfTable,
  priorTo?: string,
): Comp[] {
  const out: Comp[] = [];
  for (const c of candidates) {
    if (c.id === lot.id) continue;
    if (priorTo && !(c.saleDate < priorTo)) continue;
    if (c.status !== 'sold' || !(c.realizedUsd! > 0)) continue;
    const m = similarity(lot, c, tbl);
    // admit down to the RELAXED tier-b gate — estimateValue applies the strict
    // gate first and only reaches for these when the strict pool is thin
    if (!passesGateWith(FALLBACK_GATE, m)) continue;
    out.push({ id: c.id, match: m, realizedUsd: c.realizedUsd!, saleDate: c.saleDate });
  }
  return out;
}
