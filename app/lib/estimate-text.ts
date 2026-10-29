/**
 * estimate-text.ts — the estimate / live-bid words every lot surface prints
 * (moved out of LotCard.tsx in r9 so pure modules and tests can read them).
 */
import type { AuctionLot } from '../types';
import { fmtFace, liveBidUsd } from './lot-face';

/** (W24, Oct 11 2026) the card's money words are the lot page's: fmtFace
 *  ($6.9K, $18K, $2.39M, $850) — one decimal under $10K. The cards used to
 *  round to whole thousands, so a $6,900–$9,200 estimate read "$7K–$9K est."
 *  on the feed and "$6.9K–$9.2K" on the lot page it opens. */
const fmt = fmtFace;

/** The house ESTIMATE alone — for a column headed "Estimate". formatEstimate
 *  leads with the live bid when the estimate is one-sided or absent (right for
 *  an "ask" cell), which printed "$200 bid" under an Estimate header on /value.
 *  Here a one-sided bound prints as that bound, and no estimate prints "—". */
export function estimateOnly(lot: AuctionLot): string {
  if (lot.estimateLow && lot.estimateHigh) {
    const lo = fmt(lot.estimateLow), hi = fmt(lot.estimateHigh);
    return lo === hi ? lo : `${lo}–${hi}`;
  }
  if (lot.estimateLow) return `from ${fmt(lot.estimateLow)}`;
  if (lot.estimateHigh) return `to ${fmt(lot.estimateHigh)}`;
  return '—';
}

export function formatEstimate(lot: AuctionLot): string {
  if (lot.estimateLow && lot.estimateHigh) {
    const lo = fmt(lot.estimateLow);
    const hi = fmt(lot.estimateHigh);
    // rounding can collapse low and high into the same string — a
    // "$49K–$49K" range reads as a bug on the most repeated line in the
    // product. One value, and the app is USD-denominated: no suffix noise.
    return lo === hi ? `${lo} est.` : `${lo}–${hi} est.`;
  }
  // Goldin runs bid auctions with no estimates — the live bid is the honest
  // number, and it's real money on the lot right now. In USD (lot-face
  // liveBidUsd — the desk row, My max and the Daily Desk read the same);
  // a bid the money layer cannot convert keeps its own currency's code.
  if (lot.currentBid && lot.currentBid > 0) {
    const usd = liveBidUsd(lot);
    const bidText = usd != null ? fmt(usd) : `${lot.currentBid.toLocaleString('en-US')} ${lot.currency}`;
    return `${bidText} bid${lot.bidCount ? ` · ${lot.bidCount} ${lot.bidCount === 1 ? 'bid' : 'bids'}` : ''}`;
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
