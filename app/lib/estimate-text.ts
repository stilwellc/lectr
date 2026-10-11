/**
 * estimate-text.ts — the estimate / live-bid words every lot surface prints
 * (moved out of LotCard.tsx in r9 so pure modules and tests can read them).
 */
import type { AuctionLot } from '../types';

/** The house ESTIMATE alone — for a column headed "Estimate". formatEstimate
 *  leads with the live bid when the estimate is one-sided or absent (right for
 *  an "ask" cell), which printed "$200 bid" under an Estimate header on /value.
 *  Here a one-sided bound prints as that bound, and no estimate prints "—". */
export function estimateOnly(lot: AuctionLot): string {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };
  if (lot.estimateLow && lot.estimateHigh) {
    const lo = fmt(lot.estimateLow), hi = fmt(lot.estimateHigh);
    return lo === hi ? lo : `${lo}–${hi}`;
  }
  if (lot.estimateLow) return `from ${fmt(lot.estimateLow)}`;
  if (lot.estimateHigh) return `to ${fmt(lot.estimateHigh)}`;
  return '—';
}

export function formatEstimate(lot: AuctionLot): string {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };
  if (lot.estimateLow && lot.estimateHigh) {
    const lo = fmt(lot.estimateLow);
    const hi = fmt(lot.estimateHigh);
    // K-rounding often collapses low and high into the same string — a
    // "$49K–$49K" range reads as a bug on the most repeated line in the
    // product. One value, and the app is USD-denominated: no suffix noise.
    return lo === hi ? `${lo} est.` : `${lo}–${hi} est.`;
  }
  // Goldin runs bid auctions with no estimates — the live bid is the honest
  // number, and it's real money on the lot right now.
  if (lot.currentBid && lot.currentBid > 0) {
    return `${fmt(lot.currentBid)} bid${lot.bidCount ? ` · ${lot.bidCount} ${lot.bidCount === 1 ? 'bid' : 'bids'}` : ''}`;
  }
  // ONE-SIDED estimate (D2 P2): a published bound must never vanish into
  // "Estimate on request" — say which side the house put on paper. Live-bid
  // lots never reach here (the bid stays the honest lead above).
  if (lot.estimateLow) return `from ${fmt(lot.estimateLow)} est.`;
  if (lot.estimateHigh) return `to ${fmt(lot.estimateHigh)} est.`;
  // "No reserve" is a Goldin fact, not a fallback — traditional houses run
  // reserves and merely keep some estimates private. Don't assert an auction
  // condition we can't stand behind on anyone else's lot.
  if (lot.auctionHouse === 'Goldin') return 'No reserve · opening bid';
  return 'Estimate on request';
}

/** THE FEED ROW'S PRICE (r9, QA4 C4) — the card's own words (formatEstimate),
 *  under the PRINTED-BID GATE: a lot without a two-sided estimate prints its
 *  live bid ("$8K bid"), never an unlabelled one-sided low estimate (the
 *  phone row printed RR's Einstein letter at "$20K" over an $8K bid). The
 *  gate reads what formatEstimate PRINTED; the row keeps only its lead
 *  ("$8K bid" — the count is the bid cell's) so the right column fits. */
export function feedRowPrice(lot: AuctionLot): string {
  const t = formatEstimate(lot);
  if (t === 'Estimate on request' || t.startsWith('No reserve')) return '—';
  if (t.includes(' bid')) return t.split(' · ')[0];
  return t;
}
