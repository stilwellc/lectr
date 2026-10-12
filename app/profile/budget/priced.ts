/**
 * priced.ts — ONE "priced" rule for the Budget desk and the Names calendar
 * (/profile review fix wave, Oct 11 2026: R4#1, R4#3, R4#10).
 *
 * TODO(X1): X1 is exporting a shared "priced" helper from the desk
 * (provider.tsx / cockpit-logic.ts estMidOf) in this same wave. When it is
 * on main, import it here, make `estBandOf` read it, and delete the local
 * rule — the two sections must never disagree with the cockpit on what
 * "priced" means.
 *
 * THE RULE. A lot is PRICED when the house published BOTH bounds of its
 * estimate; a one-sided estimate (RR Auction publishes estimateLow only;
 * some houses a ceiling alone) is printed as "from $X" / "to $X" and is
 * NEVER summed into a band or a plan — it joins the unpriced count.
 *
 * THE READ. The estimate is read the way comps.estUsdBand and verdict.estUsd
 * read it: the canonical est*Usd fields first, the legacy estimateLow/High
 * aliases after — BOTH ARE USD. The live book (upcoming.json) carries
 * non-USD lots with estimateLow/High only (158 of 9,658 on Oct 11 2026),
 * and those figures are already dollars (the Bruun Rasmussen Calder reads
 * DKK 1,500–2,000 as estimateLow/High 233.1/310.8). Nothing here converts:
 * the Names calendar used to multiply them by fxRateFor again and printed
 * "$36–$48" for that Calder (R4#1).
 */
import type { AuctionLot } from '../../types';
import { estUsdBand } from '../../lib/comps';

export interface EstBand {
  /** the band in USD — lo === hi on a one-sided estimate (the published side) */
  lo: number;
  hi: number;
  /** both bounds published — the only estimate a sum may carry */
  priced: boolean;
  /** which side the house put on paper when only one was (null when both) */
  side: 'low' | 'high' | null;
}

/** the lot's estimate in USD, or null when the house published none */
export function estBandOf(lot: AuctionLot): EstBand | null {
  const b = estUsdBand(lot);
  const lo = b.low ?? 0, hi = b.high ?? 0;
  if (!(lo > 0) && !(hi > 0)) return null;
  const rawLo = (lot.estLowUsd ?? lot.estimateLow) || 0;
  const rawHi = (lot.estHighUsd ?? lot.estimateHigh) || 0;
  const priced = rawLo > 0 && rawHi > 0;
  return { lo, hi, priced, side: priced ? null : rawLo > 0 ? 'low' : 'high' };
}

/** a lot the sums may carry: both estimate bounds published */
export function isPriced(lot: AuctionLot): boolean {
  return estBandOf(lot)?.priced === true;
}

/** "from $700" / "to $700" — a one-sided estimate's own words (fmt = the surface's money formatter) */
export function oneSidedText(side: 'low' | 'high', usd: number, fmt: (n: number) => string): string {
  return `${side === 'low' ? 'from' : 'to'} ${fmt(usd)}`;
}
