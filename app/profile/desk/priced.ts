/**
 * ONE "PRICED" RULE for the desk (Oct 11 2026 review, R4#3) — every surface
 * that sums estimates or counts "N of M priced" reads this file: the cockpit
 * and the Watching summary (provider), Your week, the Budget desk, Names.
 *
 *   priced     BOTH bounds published (USD) → the estimate midpoint counts
 *   one-sided  one bound only (RR's "from $2,000") → "from $X" on the row,
 *              counted as UNPRICED, never summed into a total
 *   none       no estimate — unpriced
 *
 * USD first: a lot carries estLowUsd/estHighUsd when the build converted a
 * foreign estimate; the raw estimateLow/High are already USD elsewhere (the
 * names.ts double-FX bug read them as native and converted again — never
 * convert here). No React, no clock.
 */
import { fmtFace } from '../../lib/lot-face';

export interface EstBounds { estLowUsd?: number | null; estHighUsd?: number | null; estimateLow?: number | null; estimateHigh?: number | null }

export interface PricedRead {
  /** both bounds published: the midpoint is a number a total may carry */
  priced: boolean;
  /** (low + high) / 2 when priced, else null */
  mid: number | null;
  /** exactly one bound published */
  oneSided: boolean;
  /** the one published bound of a one-sided estimate ("from $X") */
  from: number | null;
  lo: number | null;
  hi: number | null;
}

const pos = (n: number | null | undefined): number | null => (typeof n === 'number' && n > 0 ? n : null);

/** the one read: both bounds = priced; one bound = "from"; none = nothing */
export function pricedOf(l: EstBounds): PricedRead {
  const lo = pos(l.estLowUsd) ?? pos(l.estimateLow);
  const hi = pos(l.estHighUsd) ?? pos(l.estimateHigh);
  if (lo != null && hi != null) return { priced: true, mid: (lo + hi) / 2, oneSided: false, from: null, lo, hi };
  const one = lo ?? hi;
  if (one != null) return { priced: false, mid: null, oneSided: true, from: one, lo, hi };
  return { priced: false, mid: null, oneSided: false, from: null, lo: null, hi: null };
}

export const isPriced = (l: EstBounds): boolean => pricedOf(l).priced;

/** the estimate midpoint a total may carry — null for one-sided / none */
export function estMidOf(l: EstBounds): number | null {
  return pricedOf(l).mid;
}

/** the row's words for a one-sided estimate ("from $700"); null otherwise */
export function fromText(l: EstBounds): string | null {
  const p = pricedOf(l);
  return p.oneSided && p.from != null ? `from ${fmtFace(p.from)}` : null;
}

export interface PricedTotal { total: number; priced: number; oneSided: number; n: number }

/** the basis every head prints beside a summed total — "3 of 4 priced · 1
 *  from one bound, not summed"; null when every row is priced (nothing to
 *  qualify) */
export function pricedBasisText(t: Pick<PricedTotal, 'priced' | 'oneSided' | 'n'>): string | null {
  if (t.priced >= t.n) return null;
  return [`${t.priced} of ${t.n} priced`, t.oneSided > 0 ? `${t.oneSided} from one bound, not summed` : null].filter(Boolean).join(' · ');
}

/** a live bid in USD — the row's currency through its dated rate; a non-USD
 *  bid with no rate cannot be read against a USD max and returns null (never
 *  a native figure read as dollars, never a false alarm). The cockpit's
 *  over-max count and the Daily Desk's read the same rule. */
export function liveBidUsd(l: { currentBid?: number | null; currency?: string | null; fxRate?: number | null }): number | null {
  const bid = l.currentBid || 0;
  if (!(bid > 0)) return null;
  if (!l.currency || l.currency === 'USD') return bid;
  return l.fxRate && l.fxRate > 0 ? bid * l.fxRate : null;
}

/** Σ midpoints over the priced rows + the counts every head prints
 *  ("$212K at estimate midpoint · 3 of 4 priced · 1 from $700") */
export function pricedTotal(lots: readonly EstBounds[]): PricedTotal {
  let total = 0, priced = 0, oneSided = 0;
  for (const l of lots) {
    const p = pricedOf(l);
    if (p.priced) { total += p.mid!; priced++; } else if (p.oneSided) oneSided++;
  }
  return { total, priced, oneSided, n: lots.length };
}
