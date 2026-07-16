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
 * Calibrated beat-high rate as a function of compRatio (comps / estimate-mid).
 * From the corpus holdout (n=5,215): monotonic 42% → 69%.
 */
function beatRate(compRatio: number): number {
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
  const decay = (c: Comp) => {
    const t = new Date(c.saleDate || '').getTime();
    if (isNaN(t)) return 1;
    const ageYears = Math.max(0, (refMs - t) / 31_557_600_000);
    return Math.pow(0.5, ageYears / 2);
  };
  const compValueUsd = weightedMedian(top.map(c => [c.realizedUsd, (c.match.cosine ** 2) * decay(c)]));
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

  const estMid = lot.estLowUsd && lot.estHighUsd ? (lot.estLowUsd + lot.estHighUsd) / 2 : null;

  // DIRECTIONAL signal (estimate lots)
  let signal: ValueResult['signal'] = null;
  let compRatio: number | null = null;
  if (estMid && estMid > 0) {
    compRatio = compValueUsd / estMid;
    const br = beatRate(compRatio);
    const label = compRatio >= 1.3 ? 'below comparable market'      // lot priced under where comps trade → likely undervalued
      : compRatio <= 0.75 ? 'above comparable market'
        : 'at comparable market';
    const strength = compRatio >= 2 || compRatio <= 0.55 ? 'strong'
      : compRatio >= 1.3 || compRatio <= 0.75 ? 'moderate' : 'slight';
    signal = { label, strength, beatRatePct: br };
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
    low: Math.round(low),
    high: Math.round(high),
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
