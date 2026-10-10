/**
 * closing.ts — ONE clock for "is this lot still open, and when does it close".
 *
 * The served data is built once a night; any "today" / "in 3d" baked at build
 * time (or computed against the crawl stamp) goes stale the moment the reader
 * opens the page later — the Oct 3 audit found hammered Christie's lots still
 * counted live and labelled "today". Every label here is computed in the
 * BROWSER, against the reader's clock, at render time:
 *
 *   closeMs(lot)        the close instant: the stamped saleDateTime when the
 *                       house publishes one, else the END of the sale's
 *                       calendar day in the HOUSE's zone (a day-only lot is
 *                       open until its day is over where it is sold)
 *   isOpen(lot, now)    upcoming AND not past its close. A results-pending
 *                       lot past its close is CLOSED (it hammered; the house
 *                       just hasn't posted) — it never counts as live.
 *   closeWord / closeShort   'closed' · 'closes in 40m' · 'in 5h' · 'today' ·
 *                       'tomorrow' · 'in 4d'
 *   useNow()            null on the server / first paint (SSG-safe — a build
 *                       on another day must never hydrate a different
 *                       string), then the reader's clock, re-read every minute.
 */
import { useEffect, useState } from 'react';
import { closeMs, closeIsTimed } from './house-tz';
import { trueSaleDay } from '../utils';

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const CLOSING_SOON_MS = 48 * HOUR;

type Closable = { status?: string; saleDate?: string | null; saleDateTime?: string | null; resultsPending?: boolean; auctionHouse?: string | null; saleName?: string | null; currency?: string | null; id?: string | null };

// ONE close clock, shared with the build (app/lib/house-tz): a real close
// time when the house publishes one; a date-only lot (or a Christie's
// local-midnight DAY stamp) closes when its sale day ends in the HOUSE's zone
// — never at a reader-calendar midnight, never at an invented hour.
export { closeMs, closeIsTimed };

/** Open = still upcoming and its close hasn't passed on the reader's clock. */
export function isOpen(l: Closable, now: number): boolean {
  if (l.status !== 'upcoming') return false;
  const c = closeMs(l);
  return c != null && c > now;
}

/** Open and closing within `windowMs` (default 48h). */
export function closesWithin(l: Closable, now: number, windowMs = CLOSING_SOON_MS): boolean {
  if (!isOpen(l, now)) return false;
  return (closeMs(l) as number) - now <= windowMs;
}

function localDayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Whole calendar days from the reader's today to the close day (negative = past). */
export function daysToClose(l: Closable, now: number): number | null {
  const c = closeMs(l);
  if (c == null) return null;
  // a date-only sale is ON its day — count to that day, not to the instant
  // it ends in the house zone (which can fall on the reader's next day)
  if (!closeIsTimed(l)) {
    const day = trueSaleDay(l);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY) - localDayIndex(now);
  }
  return localDayIndex(c) - localDayIndex(now);
}

/** The sentence-case close label: 'closed' · 'closes in 40m' · 'closes in 5h'
    · 'today' · 'tomorrow' · 'in 4d'. Timed lots under 24h read in hours. */
export function closeWord(l: Closable, now: number): string {
  const c = closeMs(l);
  if (c == null) return 'scheduled';
  if (l.status !== 'upcoming' || c <= now) return 'closed';
  const left = c - now;
  if (closeIsTimed(l) && left < DAY) {
    if (left < HOUR) return `closes in ${Math.max(1, Math.round(left / 60_000))}m`;
    return `closes in ${Math.round(left / HOUR)}h`;
  }
  const d = daysToClose(l, now) ?? 0;
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d}d`;
}

/** The table-cell form: 'closed' · '40m' · '5h' · 'today' · '1d' · '4d'. */
export function closeShort(l: Closable, now: number): string {
  const c = closeMs(l);
  if (c == null) return '—';
  if (l.status !== 'upcoming' || c <= now) return 'closed';
  const left = c - now;
  if (closeIsTimed(l) && left < DAY) {
    if (left < HOUR) return `${Math.max(1, Math.round(left / 60_000))}m`;
    return `${Math.round(left / HOUR)}h`;
  }
  const d = daysToClose(l, now) ?? 0;
  return d <= 0 ? 'today' : `${d}d`;
}

/** The reader's clock: null until mounted (SSG/hydration-safe), then
    Date.now(), refreshed every `everyMs` (default one minute). */
export function useNow(everyMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}
