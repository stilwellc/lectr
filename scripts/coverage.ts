/**
 * coverage.ts — what the archive actually covers, per house, for meta.json.
 *
 * /about §01 is headlined "Depth is the moat. It took three decades to build."
 * and charted lots-by-market underneath it: a claim about TIME evidenced with a
 * chart about CATEGORY. These are the series that let the section prove its own
 * headline instead of asserting it.
 *
 * Two deliberate choices, both about not overstating:
 *
 * 1. `first` and `dense` are reported separately. Christie's has exactly ONE lot
 *    dated 1989 and 1,331 dated 1991; RR Auction has seven years under 25 lots
 *    before 2003. Drawing a solid bar from the first stray record would let one
 *    lot claim a decade. The chart renders first→dense faint and dense→last
 *    solid, so thin early coverage is visible as thin rather than hidden.
 *
 * 2. Volume is NOT the time story. Goldin alone is 320,745 lots across 2022-2026
 *    (143,142 in 2023), so a lots-per-year chart is a picture of one house's card
 *    business, not of three decades. Depth-of-coverage is charted instead, with
 *    per-house totals shown as a number rather than a bar length.
 */
import type { AuctionLot } from '../app/types';

/** A year needs this many settled lots to count as materially covered. */
const DENSE_MIN = 25;

export interface HouseCoverage {
  house: string;
  /** first year with any settled record */
  first: number;
  /** first year with >= DENSE_MIN settled records; === first when coverage starts dense */
  dense: number;
  last: number;
  n: number;
}

export function soldByYear(lots: AuctionLot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lots) {
    if (l.status !== 'sold') continue;
    // Read the year off the string: saleDate has day granularity and
    // new Date('2026-01-01') is UTC midnight, which reads as the previous year
    // in a US-local timezone.
    const y = (l.saleDate || '').slice(0, 4);
    if (!/^\d{4}$/.test(y)) continue;
    out[y] = (out[y] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function houseCoverage(lots: AuctionLot[]): HouseCoverage[] {
  const byHouse: Record<string, Record<string, number>> = {};
  for (const l of lots) {
    if (l.status !== 'sold') continue;
    const y = (l.saleDate || '').slice(0, 4);
    if (!/^\d{4}$/.test(y)) continue;
    (byHouse[l.auctionHouse] ||= {})[y] = ((byHouse[l.auctionHouse] ||= {})[y] || 0) + 1;
  }
  return Object.entries(byHouse)
    .map(([house, years]): HouseCoverage => {
      const ks = Object.keys(years).sort();
      const dense = ks.find((y) => years[y] >= DENSE_MIN) ?? ks[0];
      return {
        house,
        first: Number(ks[0]),
        dense: Number(dense),
        last: Number(ks[ks.length - 1]),
        n: Object.values(years).reduce((a, b) => a + b, 0),
      };
    })
    // oldest coverage first — the chart reads as a descent through time
    .sort((a, b) => a.dense - b.dense || a.first - b.first);
}
