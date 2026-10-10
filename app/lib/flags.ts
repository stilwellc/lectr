/**
 * flags.ts — THE ONE "flagged" predicate (Oct 10, makers overhaul P1).
 *
 * A live lot is FLAGGED when the engine prices it below its comparables.
 * Three surfaces used to ask three different questions:
 *
 *   /makers rows     l.signal.label === 'Below Market'          (crawl-time comp signal)
 *   maker page       l.value.signal.label === 'below comparable market'  (value engine)
 *   LotBrowser       lotSignal(l, comps) → may recompute from the client pool
 *
 * They agreed on the Oct 9 book (95 = 95 = 95) by coincidence, not by
 * construction. Now every surface calls isFlagged():
 *
 *   1. the crawl-time comp signal when the lot carries one (every served lot
 *      does: the pipeline stamps `signal`, null included, on the whole book);
 *   2. else the value engine's read on the lot (`value.signal`);
 *   3. never a client-side recompute — a flag is a published read, not a
 *      number the browser derives from whatever pool it happens to hold.
 */

export const FLAG_SIGNAL = 'Below Market';
export const FLAG_VALUE = 'below comparable market';

export interface FlaggableLot {
  signal?: { label?: string | null } | null;
  value?: { signal?: { label?: string | null } | null } | null;
}

/** the engine prices this lot below its comparables */
export function isFlagged(l: FlaggableLot): boolean {
  if (l.signal !== undefined) return !!l.signal && l.signal.label === FLAG_SIGNAL;
  return !!l.value?.signal && l.value.signal.label === FLAG_VALUE;
}

/** the value engine appraised this lot (the denominator the maker page's
 *  "N of M appraised live lots" divides by) */
export function isAppraised(l: FlaggableLot): boolean {
  return !!l.value && l.value.signal !== undefined;
}

/** flagged lots in a pool */
export function countFlagged(lots: readonly FlaggableLot[]): number {
  let n = 0;
  for (const l of lots) if (isFlagged(l)) n++;
  return n;
}
