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
 *  (F6): `value.low` only at non-low confidence; else 0.85 × the exact-card
 *  median only at cardComps.n ≥ 3; else none. gapRead, build-upcoming's
 *  bidProj stamp and close-board's overlay ALL call this — there used to be
 *  three copies and build-upcoming's was ungated (any value.low, any card
 *  median), so the served floor disagreed with the lane it fed. */
export function valueFloor(lot: {
  value?: { low?: number; confidence?: string } | null;
  cardComps?: { med?: number | null; n?: number } | null;
}): ValueFloor | null {
  const v = lot.value;
  if (v && typeof v.low === 'number' && v.low > 0 && v.confidence !== 'low') return { floor: v.low, src: 'value.low' };
  const cc = lot.cardComps;
  if (cc && typeof cc.med === 'number' && cc.med > 0 && (cc.n || 0) >= 3) return { floor: Math.round(cc.med * 0.85), src: 'cardComps' };
  return null;
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
  if (depth >= 0.40) return { shelf: 'forming', depth, allIn: proj.allIn, floor, floorSrc, daysOut };
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
    // BASIS-CONSISTENT (P2): cvu is all-in (median of premium-inclusive
    // realized), estMid is hammer-basis — gross the estimate to all-in
    // through the lot's premium before applying the engine's at-market band
    // (the raw ratio silently carried ~20 points of premium).
    const ratio = cvu / (estMid * lotAllInFactor(lot, estMid));
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
