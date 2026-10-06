/**
 * lanes.ts — THE GAP and THE SLEEPERS: the two uncertified value lanes
 * (multi-lane engine, Aug 25 2026). One module, imported by BOTH the /value
 * page and scripts/build-upcoming (the calls ledger) so a lot can never show
 * one number and log another — one lot, one statistic, by construction.
 *
 * Lane law (the spec, F1–F18):
 *  · THE FLAGS (comps vs estimate) are untouched and remain the ONLY lane
 *    admitted to dealScore, the CallPlate, and certified vocabulary.
 *  · THE GAP answers "the bidding is behind the value" on NO-ESTIMATE lots
 *    only — the close-day growth curve is fitted exclusively from Goldin
 *    bid histories, so estimate-house books are out of distribution and
 *    abstain by population law, not preference.
 *  · THE SLEEPERS answer "the price is right and nobody's looking" — and
 *    fairness must be VERIFIED from the engine's own appraisal, never
 *    inferred from a null signal (null also covers abstentions and
 *    ×5-sanity kills, which must not read as "verified fair").
 *  · Both lanes are PROJECTION/READ products: neutral ink, no mint/coral,
 *    no certified language, receipts accruing on the forward tape ('gap'
 *    and 'quiet' call kinds) until their 20-graded publish gates.
 */
import type { AuctionLot } from '../types';
import { estUsdBand } from './comps';
import { hasConditionFlag } from './condition';
import { lotAllInFactor } from './premiums';
export { SIGNAL_LABEL, type SignalLabel, basisNote } from './value';

/* ── THE FLOOR (one-source law, P1-4, Sep 2 2026) ───────────────────────── */

export interface ValueFloor { floor: number; src: 'value.low' | 'cardComps' }

/** THE value floor a projected close is measured against — the strict rule
 *  (F6): `value.low` only at non-low confidence; else none. gapRead,
 *  build-upcoming's bidProj stamp and close-board's overlay ALL call this —
 *  there used to be three copies and build-upcoming's was ungated (any
 *  value.low, any card median), so the served floor disagreed with the lane
 *  it fed. (Oct 6 2026, wave 4) The 0.85 × exact-card-median branch is gone:
 *  it resurrected a floor on cards the engine declined to value (publish
 *  gate, stale pool) — 175 live lots, 84 of them under the bid already on
 *  the lot. `cardComps` stays in the signature for the callers' types. */
export function valueFloor(lot: {
  value?: { low?: number; confidence?: string } | null;
  cardComps?: { med?: number | null; n?: number } | null;
}): ValueFloor | null {
  const v = lot.value;
  if (v && typeof v.low === 'number' && v.low > 0 && v.confidence !== 'low') return { floor: v.low, src: 'value.low' };
  return null;
}

/* ── THE CLOSE-DAY GROWTH CURVE (one reader, Sep 27 2026) ──────────────── */

/** market.json analytics.closeCurve. `buckets`/`edges`/`n` = the days-out
 *  medians (unchanged meaning); `grid[bidBand][dayBucket]` = the same median
 *  within a hammer-USD bid band (`bidEdges`), null where thin. */
export interface CloseCurve {
  buckets: (number | null)[];
  edges: number[];
  n?: number[];
  bidEdges?: number[];
  grid?: (number | null)[][];
  gridN?: number[][];
}

/** THE projection factor for a live bid `daysOut` from close: the bid-band ×
 *  days-out cell when fitted, else the days-out bucket (the pre-Sep 27 curve).
 *  build-upcoming's bidProj stamp and close-board's overlay BOTH call this so
 *  a lot never wears two projections. Null when no factor ≥ 1 exists. */
export function closeGrowth(curve: CloseCurve | null | undefined, bid: number, daysOut: number): number | null {
  if (!curve?.buckets?.length || !(bid > 0) || !(daysOut >= 0)) return null;
  let d = 0; for (const e of curve.edges) { if (daysOut < e) break; d++; }
  let g: number | null | undefined = null;
  if (curve.grid && curve.bidEdges) {
    let b = 0; for (const e of curve.bidEdges) { if (bid < e) break; b++; }
    g = curve.grid[b]?.[d];
  }
  if (!(typeof g === 'number' && g >= 1)) g = curve.buckets[d];
  return typeof g === 'number' && g >= 1 ? g : null;
}

/* ── THE GAP'S PUBLISH GATE (Oct 6 2026) ────────────────────────────────
   The graded tape (calls ledger, 'vsbid' rows: every floored projection,
   graded on the realized price) showed the projection is right only where
   the Gap never looks: lots projecting AT or over their floor realize 0.88–
   0.91× the projection, but the Gap SELECTS lots projecting far under it, and
   those realize 2–10× (Goldin 4–8 days out, projection < ½ floor: 4.5×,
   n 385; the 'forming' shelf graded 4.68×, n 176; the wire 1.55×, n 121;
   Memory Lane 0 of 18 reached the floor). A per-cell correction fit on the
   calls before Sep 12 did not hold after it (4.2× fitted → 1.27–2.88× left).
   So a projection SEATS a Gap row only when its cell — house (lot id
   prefix) × days out × projection/floor band — has ≥ GAP_CELL_GATE.minN
   graded calls whose median realized/projected sits in [lo, hi]. The cells
   are re-validated every night from the ledger (build-upcoming stamps
   bidProj.ok); a cell that drifts out stops seating rows. The forming shelf
   is frozen outright. */
export const GAP_CELL_GATE = { minN: 50, lo: 0.8, hi: 1.25 };
/** the Gap shelf the lane may seat (forming frozen, Oct 6 2026) */
export const GAP_FORMING_FROZEN = true;
export type GapCell = { n: number; ratio: number; pass: boolean };
const houseKeyOf = (id: string) => String(id).split('-')[0].toLowerCase();
const daysBand = (d: number) => (d <= 1 ? '0-1' : d <= 3.5 ? '2-3' : d <= 8 ? '4-8' : '9+');
const pfBand = (x: number) => (x < 0.5 ? '<0.5' : x < 0.75 ? '0.5-0.75' : x < 1 ? '0.75-1' : '>=1');
/** the cell a projection is validated in: house × days-out band × projection/floor band */
export function gapCellKey(id: string, daysOut: number, projAllIn: number, floor: number): string {
  return `${houseKeyOf(id)}|${daysBand(daysOut)}|${pfBand(projAllIn / floor)}`;
}
/** Validate every cell from graded 'vsbid' calls (call day → sale day is the
 *  days out; p = projected close, f = the floor, r = realized). */
export function validateGapCells(calls: { id: string; d: string; k: string; p: number; f?: number; r?: number; sd?: string }[]): Record<string, GapCell> {
  const acc = new Map<string, number[]>();
  for (const c of calls) {
    if (c.k !== 'vsbid' || !(c.r! > 0) || !(c.p > 0) || !(c.f! > 0) || !c.sd) continue;
    const d = (Date.parse(c.sd.slice(0, 10)) - Date.parse(c.d)) / 86400000;
    if (!Number.isFinite(d) || d < 0) continue;
    const k = gapCellKey(c.id, d, c.p, c.f!);
    const a = acc.get(k); if (a) a.push(c.r! / c.p); else acc.set(k, [c.r! / c.p]);
  }
  const out: Record<string, GapCell> = {};
  acc.forEach((v, k) => {
    v.sort((x, y) => x - y);
    const ratio = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    out[k] = { n: v.length, ratio: Math.round(ratio * 1000) / 1000, pass: v.length >= GAP_CELL_GATE.minN && ratio >= GAP_CELL_GATE.lo && ratio <= GAP_CELL_GATE.hi };
  });
  return out;
}

/* ── THE GAP ────────────────────────────────────────────────────────────── */

export interface GapRead {
  shelf: 'wire' | 'forming';
  /** 1 − projected close / floor — the lane's one statistic */
  depth: number;
  allIn: number;
  floor: number;
  floorSrc: 'value.low' | 'cardComps';
  daysOut: number;
}

/** Wire shelf = today's deep-value gates verbatim (each documented against a
 *  real failure). Forming shelf = 3.5–8 days out at a 15pt-harder bar — 8d is
 *  the closeCurve's LAST FITTED EDGE; past it the lane abstains out loud. */
export function gapRead(lot: AuctionLot, now: number): GapRead | null {
  // population law: no-estimate lots only (the curve's fitted population)
  const est = estUsdBand(lot);
  if (est.low != null || est.high != null) return null;
  const proj = lot.bidProj;
  if (!proj || !(proj.allIn > 0)) return null;
  // (Oct 6) only a projection whose cell is validated on the graded tape
  if (proj.ok !== true) return null;
  if (hasConditionFlag(lot.title)) return null;
  // the floor is derived HERE through the ONE floor rule (valueFloor above)
  const vf = valueFloor(lot);
  if (!vf) return null;
  const floor = vf.floor;
  const floorSrc: GapRead['floorSrc'] = vf.src;
  const iso = lot.saleDateTime || lot.saleDate;
  if (!iso) return null;
  const closeMs = Date.parse(lot.saleDateTime || `${lot.saleDate}T23:59:59Z`);
  if (isNaN(closeMs) || closeMs <= now) return null;
  const daysOut = (closeMs - now) / 86400000;
  if (daysOut > 8) return null; // beyond the curve's last fitted edge
  const depth = 1 - proj.allIn / floor;
  if (depth < 0.25 || depth > 0.90) return null; // 0.90 = the floor-error gate
  if (daysOut <= 3.5) return { shelf: 'wire', depth, allIn: proj.allIn, floor, floorSrc, daysOut };
  if (!GAP_FORMING_FROZEN && depth >= 0.40) return { shelf: 'forming', depth, allIn: proj.allIn, floor, floorSrc, daysOut };
  return null;
}

/* ── THE SLEEPERS ───────────────────────────────────────────────────────── */

export interface SleeperRead {
  anchor: 'fair-est' | 'appraised';
  /** the engine's appraisal (all-in) — the fairness anchor and the graded p */
  cvu: number;
  /** estimate midpoint (hammer-basis) when the anchor is fair-est */
  estMid: number | null;
  /** the opening ask when a min-bid book posts one */
  entry: number | null;
  closes: string;
}

/** Verified-fair lots with a DEAD room (bidCount === 0 — median on bid-
 *  carrying estimate lots is 4, so zero is unambiguous), closing ≤7 days.
 *  Measurable only where a live book is exposed (bidCount is a number). */
export function sleeperRead(lot: AuctionLot, now: number): SleeperRead | null {
  if (typeof lot.bidCount !== 'number') return null; // no live book → unmeasurable
  if (lot.bidCount !== 0) return null;
  const cvu = lot.value?.compValueUsd;
  if (!cvu || cvu <= 0) return null; // fairness must be verified, never inferred
  if (hasConditionFlag(lot.title)) return null;
  const est = estUsdBand(lot);
  const estMid = est.low && est.high ? (est.low + est.high) / 2 : (est.low ?? est.high);
  let anchor: SleeperRead['anchor'];
  if (estMid) {
    // BASIS-CONSISTENT (P2): the comps are all-in (median of premium-inclusive
    // realized), estMid is hammer-basis — gross the estimate to all-in
    // through the lot's premium before applying the engine's at-market band
    // (the raw ratio silently carried ~20 points of premium). Sep 27: the
    // fairness test reads the POOL's own median (value.compMedianUsd) — on
    // estimate lots compValueUsd is now the house-anchored prediction, and a
    // number built from the estimate cannot verify the estimate.
    const poolMed = (lot.value as { compMedianUsd?: number } | null | undefined)?.compMedianUsd;
    const ratio = (poolMed && poolMed > 0 ? poolMed : cvu) / (estMid * lotAllInFactor(lot, estMid));
    if (ratio < 0.75 || ratio > 1.3) return null; // the engine's own at-market band
    anchor = 'fair-est';
  } else {
    const conf = lot.value?.confidence;
    if (conf !== 'high' && conf !== 'medium') return null;
    anchor = 'appraised';
  }
  const entry = (lot.currentBid || 0) > 0 ? lot.currentBid! : null;
  if (entry != null && entry > cvu) return null; // opening ask already exceeds the appraisal
  const iso = lot.saleDateTime || (lot.saleDate ? `${lot.saleDate}T23:59:59Z` : null);
  if (!iso) return null;
  const closeMs = Date.parse(iso);
  if (isNaN(closeMs) || closeMs <= now) return null;
  if ((closeMs - now) / 86400000 > 7) return null; // attention only means something near hammer
  return { anchor, cvu, estMid: estMid ?? null, entry, closes: lot.saleDate || iso.slice(0, 10) };
}

/* ── the cockpit's lane counters ────────────────────────────────────────── */

export function laneCounts(lots: AuctionLot[], now: number): { gapWire: number; gapForming: number; sleepers: number } {
  let gapWire = 0, gapForming = 0, sleepers = 0;
  for (const l of lots) {
    if (l.status !== 'upcoming') continue;
    const g = gapRead(l, now);
    if (g) { if (g.shelf === 'wire') gapWire++; else gapForming++; }
    if (sleeperRead(l, now)) sleepers++;
  }
  return { gapWire, gapForming, sleepers };
}
