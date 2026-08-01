/**
 * grade-ladder.ts — the EMPIRICAL card-grade multiplier ladder, fitted from
 * graded Goldin card sales by WITHIN-CARD paired log-ratios (mix-immune, the
 * repeat-sales trick applied to grade instead of time).
 *
 * The old ladder was a hardcoded guess (raw 1 / 9 → 1.6 / 9.5 → 3 / 10 → 7).
 * Measured on ~193K graded sold cards it systematically UNDER-priced high
 * grades — a PSA-10 of a card trades at ~10× its PSA-8, not 7×. This module
 * fits the ladder from the data instead.
 *
 * METHOD (mix-immune, so a pool of expensive rookies never inflates a rung):
 *   1. group sold cards by ladder key (player|year|set|cardNo) — the SAME card
 *   2. within a group, take the MEDIAN price per grade rung (≥2 sales/cell)
 *   3. for every cross-grade pair in a group, observe log(medHi/medLo) as a
 *      reading of logMult[hi] − logMult[lo]
 *   4. least-squares solve the per-rung log-multiplier against a fixed base rung
 * Every observation is two grades of the ONE card, so card-value mix cancels.
 *
 * A rung publishes ONLY with sufficient paired support; a thin rung KEEPS the
 * old constant (honesty doctrine — a conservative known beats a noisy fit).
 */
import type { AuctionLot } from '../../app/types';

/** the rungs we fit — the dense numeric grades. Half-grades (8.5/9.5) are
 *  thinner but still clear the support floor on this corpus. */
const RUNGS = [7, 8, 8.5, 9, 9.5, 10] as const;
const BASE_RUNG = 8; // multiplier 1.00 — the ladder is anchored here
const MIN_CELL = 2; // sales per (card, grade) cell before its median is trusted
const MIN_RUNG_PAIRS = 30; // paired observations touching a rung to publish it

/** the OLD hardcoded ladder — the conservative fallback for any rung the fit
 *  can't support, and the read for grades outside the fitted rung set. */
export function oldGradeMult(n: number | null | undefined): number {
  if (n == null) return 1;
  if (n >= 10) return 7;
  if (n >= 9.5) return 3;
  if (n >= 9) return 1.6;
  if (n >= 8.5) return 1.15;
  if (n >= 8) return 1;
  return 0.8;
}

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export interface GradeLadder {
  /** the multiplier for a grade number (fitted where supported, old constant
   *  where thin / off-ladder). Only RATIOS between rungs are ever used. */
  mult: (n: number | null | undefined) => number;
  /** the published per-rung table for the market.json artifact + the report */
  rungs: { grade: number; mult: number; fitted: boolean; pairs: number; old: number }[];
  /** total cross-grade paired observations the fit was built on */
  pairs: number;
  /** ladder groups that contributed ≥1 pair */
  groups: number;
}

/**
 * Fit the ladder from a pool of sold card lots (each carrying _card with
 * gradeNum + the identity fields). Lots without a numeric grade / full identity
 * are ignored. `keyOf` extracts the ladder key (default: the standard
 * player|year|set|cardNo). `priceOf` reads the realized price.
 */
export function fitGradeLadder(
  soldCards: AuctionLot[],
  opts: {
    priceOf?: (l: AuctionLot) => number;
    gradeOf?: (l: AuctionLot) => number | null;
    keyOf?: (l: AuctionLot) => string | null;
  } = {},
): GradeLadder {
  const priceOf = opts.priceOf ?? ((l) => (l.realizedUsd && l.realizedUsd > 0 ? l.realizedUsd : l.priceUsd) || 0);
  const gradeOf = opts.gradeOf ?? ((l) => (l as { _card?: { gradeNum?: number | null } })._card?.gradeNum ?? null);
  const keyOf = opts.keyOf ?? ((l) => {
    const c = (l as { _card?: { playerSlug?: string; year?: string; setName?: string | null; cardNo?: string } })._card;
    if (!c || !c.playerSlug || !c.year || !c.cardNo) return null;
    const set = (c.setName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return `${c.playerSlug}|${c.year}|${set}|${c.cardNo.toLowerCase()}`;
  });
  const rungSet = new Set<number>(RUNGS as unknown as number[]);

  // group by ladder key → grade → prices
  const groups = new Map<string, Map<number, number[]>>();
  for (const l of soldCards) {
    const g = gradeOf(l);
    if (g == null || !rungSet.has(g)) continue;
    const price = priceOf(l);
    if (!(price > 0)) continue;
    const key = keyOf(l);
    if (!key) continue;
    let grp = groups.get(key);
    if (!grp) { grp = new Map(); groups.set(key, grp); }
    (grp.get(g) || grp.set(g, []).get(g)!).push(price);
  }

  // paired observations: within each group, cross-grade log-ratios of per-cell
  // medians. rungPairs counts observations touching each rung (its support).
  const obs: { hi: number; lo: number; y: number }[] = [];
  const rungPairs = new Map<number, number>();
  let groupsUsed = 0;
  for (const grp of Array.from(groups.values())) {
    const cells = Array.from(grp.entries()).filter(([, v]) => (v as number[]).length >= MIN_CELL) as [number, number[]][];
    if (cells.length < 2) continue;
    groupsUsed++;
    const meds = new Map<number, number>();
    for (const [grade, v] of cells) meds.set(grade, median(v));
    const gs = Array.from(meds.keys()).sort((a, b) => a - b);
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
      const lo = gs[i], hi = gs[j];
      obs.push({ hi, lo, y: Math.log(meds.get(hi)! / meds.get(lo)!) });
      rungPairs.set(hi, (rungPairs.get(hi) || 0) + 1);
      rungPairs.set(lo, (rungPairs.get(lo) || 0) + 1);
    }
  }

  // least-squares: unknown = logMult per rung, base fixed at 0. Each obs row has
  // +1 at hi, −1 at lo. Solve the normal equations by Gaussian elimination.
  const free = RUNGS.filter(r => r !== BASE_RUNG);
  const idx = new Map<number, number>();
  free.forEach((r, i) => idx.set(r, i));
  const P = free.length;
  const logMult = new Map<number, number>([[BASE_RUNG, 0]]);
  if (obs.length >= P) {
    const ATA = Array.from({ length: P }, () => new Array(P).fill(0));
    const ATb = new Array(P).fill(0);
    for (const o of obs) {
      const terms: [number, number][] = [];
      if (o.hi !== BASE_RUNG) terms.push([idx.get(o.hi)!, 1]);
      if (o.lo !== BASE_RUNG) terms.push([idx.get(o.lo)!, -1]);
      for (const [a, ca] of terms) {
        ATb[a] += ca * o.y;
        for (const [b, cb] of terms) ATA[a][b] += ca * cb;
      }
    }
    const M = ATA.map((r, i) => [...r, ATb[i]]);
    let ok = true;
    for (let c = 0; c < P; c++) {
      let piv = c;
      for (let r = c + 1; r < P; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-9) { ok = false; break; }
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < P; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= P; k++) M[r][k] -= f * M[c][k]; }
    }
    if (ok) free.forEach((r, i) => logMult.set(r, M[i][P] / M[i][i]));
  }

  // build the published rung table — a rung PUBLISHES only with enough paired
  // support AND a finite fit; otherwise it keeps the old constant.
  const fitted = new Map<number, number>();
  const rungsOut: GradeLadder['rungs'] = [];
  for (const r of RUNGS) {
    const lm = logMult.get(r);
    const pairs = rungPairs.get(r) || 0;
    const old = oldGradeMult(r);
    const publishable = r === BASE_RUNG || (lm != null && Number.isFinite(lm) && pairs >= MIN_RUNG_PAIRS);
    // monotonicity guard: a fitted rung that inverts the grade order (higher
    // grade cheaper than a lower one already accepted) is a data fault — keep
    // the old constant there instead of publishing a non-monotone ladder.
    let m = publishable ? Math.exp(lm ?? 0) : old;
    const priorAccepted = rungsOut.filter(x => x.grade < r).sort((a, b) => b.grade - a.grade)[0];
    const monotoneOk = !priorAccepted || m >= priorAccepted.mult;
    const use = publishable && monotoneOk;
    m = use ? m : old;
    fitted.set(r, m);
    rungsOut.push({ grade: r, mult: +m.toFixed(4), fitted: use, pairs, old });
  }

  const mult = (n: number | null | undefined): number => {
    if (n == null) return 1; // raw / ungradeable → base
    if (fitted.has(n)) return fitted.get(n)!;
    // off-ladder grade (e.g. 6, 5): fall to the old constant (rare in the pool)
    return oldGradeMult(n);
  };

  return { mult, rungs: rungsOut, pairs: obs.length, groups: groupsUsed };
}
