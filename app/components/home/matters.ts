/**
 * matters.ts — the home feed's surfacing rules that live with the feed
 * (components/LotBrowser, preview/terminal/TerminalHome), pure for tests.
 *
 *  · mattersList — "What matters" READS in score order. The shortlist
 *    (lib/priority) seats lots in passes under its caps (≤3 per sale, ≤5 per
 *    category, then looser) and returned them in SEAT order: on Sports the
 *    $2.8K Broncos jerseys sat at #9 and #11 while the $488K Ohtani Gold
 *    Refractor — seated on the last, looser pass — printed at #16 (W20,
 *    Oct 11). Which lots get a seat is the shortlist's; the order they print
 *    in is the score's (score, then sooner close, then bigger anchor).
 *  · staleHouse — a house lens the market's live book has no lot from. The
 *    house filter travels across markets (URL + feed memory), so NFL Auction
 *    picked on Sports opened Art and TCG on "0 of 875 · Nothing on the block
 *    matches that" with the dropdown reading "All houses". Once the whole
 *    book is in, a house with no live lot here is dropped.
 */
import { shortlist, byPriority } from '../../lib/priority';

type Lot = Parameters<typeof shortlist>[0][number];

export function mattersList<T extends Lot>(lots: T[], nowMs: number, n = 20, opts: { who?: number } = {}): T[] {
  return shortlist(lots, nowMs, n, opts).slice().sort(byPriority(nowMs));
}

/** true when `house` is set and the live book has no lot from it */
export function staleHouse(house: string | null | undefined, live: readonly { auctionHouse?: string | null }[]): boolean {
  if (!house || !live.length) return false;
  for (const l of live) if (l.auctionHouse === house) return false;
  return true;
}
