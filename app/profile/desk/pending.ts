/**
 * pending.ts — the one rule for "this upcoming lot has left the block" (moved
 * out of derive.ts on Oct 20 2026 so pure modules — the share card, its tests —
 * can use the masthead's exact rule without importing UI components).
 */
import type { AuctionLot } from '../../types';
import { localToday } from '../../utils';

/** past-pending = concluded but unresolved. The resultsPending flag alone
    is NOT enough: a sale that closes between nightlies can carry rows frozen
    as bare status 'upcoming' with a past saleDate and NO flag (RR sale 748's
    Apple lots sat in "Watching" for six days this way). The DATE is the
    truth — anything upcoming whose sale day is behind us has left the block,
    flag or no flag. One-day grace mirrors isLiveUpcoming. A lot with NO
    saleDate can't be date-judged and stays visible in Watching as
    "scheduled" — an honest unknown, not a claim it is live.
    UTC-parsed on both sides (the daysUntil convention) so the two clocks
    can never disagree about whether a day is behind us. */
export function isPastPending(l: AuctionLot): boolean {
  if (l.status !== 'upcoming' || !l.saleDate) return false;
  const day = l.saleDate.slice(0, 10);
  if (l.resultsPending) return day < localToday();
  const graceMs = Date.parse(`${day}T00:00:00Z`) + 2 * 86_400_000; // sale day + 1 grace day
  return !isNaN(graceMs) && graceMs < Date.parse(`${localToday()}T00:00:00Z`) + 1;
}
