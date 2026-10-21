/**
 * THE DESK v3 — the pure reads the desk's rooms share (Oct 11 2026).
 *
 * Lifted verbatim out of app/profile/page.tsx so the provider, the cockpit
 * and every room read ONE copy of each rule: the day-to-hammer convention
 * (NaN-safe), the past-pending judgment, the one why-now classifier and the
 * live-signal ink. No React in here — every function is unit-testable on a
 * fixture.
 */
import type { AuctionLot } from '../../types';
import type { SavedMeta } from '../../lib/account';
import { daysUntil as daysUntilOrNull } from '../../components/Terminal';
import { lotSignal } from '../../components/LotCard';
import { signalMagnitude } from '../../lib/comps';
import { sleeperRead } from '../../lib/lanes';
import { closeDayOf } from '../../utils';

/** Terminal's shared daysUntil, kept on the desk's NaN convention (every
    comparison here is NaN-safe; a null would need `?? NaN` at 14 call sites) */
export const daysUntil = (dateStr: string): number => daysUntilOrNull(dateStr) ?? NaN;
/** days to a lot's PRINTED close day (closeDayOf — the reader's true day,
    never the crawl day a late-night close was stamped with) */
export const closeDays = (l: AuctionLot): number => daysUntil(closeDayOf(l));

export function hammerWord(days: number): string {
  if (isNaN(days)) return 'scheduled';
  if (days < 0) return `hammered ${-days} ${days === -1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** sort key for saleDate — a missing/garbled date must sort DETERMINISTICALLY
    (to the end of any ordering), never feed NaN into a comparator. `missing`
    is the sentinel: MAX for ascending lists, 0 for descending ones, so the
    dateless rows land LAST either way. */
export const saleTime = (l: AuctionLot, missing = Number.MAX_SAFE_INTEGER): number => {
  const t = Date.parse(`${(l.saleDate || '').slice(0, 10)}T00:00:00Z`);
  return isNaN(t) ? missing : t;
};

export { isPastPending } from './pending';

/* ── THE ONE CLASSIFIER — why a live watch needs you now. Both surfaces
   that tag rows (Today's reads and the Watching ledger) read THESE
   thresholds; a tuning change lands in both or in neither. ── */
export const TAG_SOON_DAYS = 2;      // "Lands soon": hammers within 2 days
// "Quiet" IS the engine's sleeper read (app/lib/lanes.ts sleeperRead: a dead
// room — zero bids — on a lot whose fairness the engine VERIFIED from its own
// appraisal, closing within the week). The old local rule (≤3 bids, no
// fairness check) was a second sleeper classifier; one-source law.
export type WatchTag = { tag: 'Lands soon' | 'Below market' | 'Most bids' | 'Quiet'; rank: number };
export function watchTagOf(l: AuctionLot, sig: { label: string } | null | undefined, now = Date.now()): WatchTag | null {
  const d = closeDays(l);
  // the read outranks the clock: a lot closing today that reads below market
  // says so (its row already prints when it hammers)
  if (sig?.label === 'Below Market') return { tag: 'Below market', rank: 1 };
  if (d >= 0 && d <= TAG_SOON_DAYS) return { tag: 'Lands soon', rank: 0 };
  if (l.bidVelocity && l.bidVelocity.delta > 0) return { tag: 'Most bids', rank: 2 };
  if (sleeperRead(l, now)) return { tag: 'Quiet', rank: 3 };
  return null;
}

export type LiveSignal = NonNullable<ReturnType<typeof lotSignal>>;
/** live-signal ink + text — THE app-wide formatter, comps.signalMagnitude
 *  ("+38%", "3.2×" past 2×, "5×+", "−50%"): the same string lot-face
 *  call.text prints on the lot page, the cards and /value (X5: the desk
 *  printed "+224%" where the lot page printed "3.2×") */
export const sigInk = (label: LiveSignal['label']) =>
  label === 'Below Market' ? 'var(--color-up)' : 'var(--color-down-text)';
export const sigText = (sig: LiveSignal) => signalMagnitude(sig.label, sig.pct);

/** a save's meta (keyed by the id at save time) — the raw shape rooms read */
export type MetaOf = (rowId: string) => SavedMeta | undefined;
