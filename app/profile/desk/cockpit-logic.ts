/**
 * THE COCKPIT's reads (THE DESK v3, Oct 11 2026) — pure, fixture-tested.
 *
 *   hammerStrip   the next N days, each with the count and estimate midpoint
 *                 total of the reader's lots closing that day (closeDayOf's
 *                 reader-day, never the crawl day)
 *   streakOf      the trailing run of judged calls on one side of the
 *                 estimate — "3 beat in a row" (a flat call ends the run)
 *   estMidOf      the one estimate midpoint rule (./priced: BOTH bounds =
 *                 priced; a one-sided estimate is "from $X" and adds 0)
 */
import { estMidOf as pricedMid, type EstBounds } from './priced';

/** whose lot a strip row is: a watch (yours, bold), a pick or a sale of one
 *  of your names (light) — the same three kinds Your week prints */
export type StripKind = 'watch' | 'pick' | 'name';
export interface StripInput { day: string; est: number; kind?: StripKind }
export interface StripDay {
  /** YYYY-MM-DD, the reader's day */
  day: string;
  /** every row on the day (watches + picks + names) */
  n: number;
  /** your watches on the day (the bold part of the bar) */
  watches: number;
  picks: number;
  names: number;
  /** estimate midpoints summed over the day's lots that carry one */
  est: number;
  today: boolean;
  /** the weekday's one letter (M T W T F S S) */
  dow: string;
}

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** YYYY-MM-DD + n days, in local calendar arithmetic (DST-safe) */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n, 12);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export function dowLetter(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return DOW[new Date(y, (m || 1) - 1, d || 1, 12).getDay()] ?? '';
}

/** `Tue, Oct 13` for a YYYY-MM-DD day */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function estMidOf(l: EstBounds): number {
  return pricedMid(l) ?? 0;
}

/** the strip: `days` days from `todayKey` inclusive; a lot closing before
 *  today or past the window is not counted (the Watching room still has it) */
export function hammerStrip(lots: readonly StripInput[], todayKey: string, days = 14): StripDay[] {
  const by = new Map<string, { n: number; watches: number; picks: number; names: number; est: number }>();
  for (const l of lots) {
    const d = (l.day || '').slice(0, 10);
    if (!d) continue;
    const cur = by.get(d) ?? { n: 0, watches: 0, picks: 0, names: 0, est: 0 };
    cur.n += 1;
    const kind = l.kind ?? 'watch';
    if (kind === 'watch') cur.watches += 1; else if (kind === 'pick') cur.picks += 1; else cur.names += 1;
    // a name's sale is never your money: only watches and picks add to the day's total
    cur.est += l.est > 0 && kind !== 'name' ? l.est : 0;
    by.set(d, cur);
  }
  const out: StripDay[] = [];
  for (let k = 0; k < days; k++) {
    const day = addDays(todayKey, k);
    const hit = by.get(day);
    out.push({ day, n: hit?.n ?? 0, watches: hit?.watches ?? 0, picks: hit?.picks ?? 0, names: hit?.names ?? 0, est: hit?.est ?? 0, today: k === 0, dow: dowLetter(day) });
  }
  return out;
}

export interface Streak { n: number; dir: 'beat' | 'missed' }
/** the trailing run of same-sign calls (series in hammer order, oldest
 *  first); a flat call (rounds to 0) ends it; a run under 2 is no streak */
export function streakOf(series: readonly { pct: number }[]): Streak | null {
  let n = 0;
  let dir: Streak['dir'] | null = null;
  for (let k = series.length - 1; k >= 0; k--) {
    const r = Math.round(series[k].pct);
    if (r === 0) break;
    const d: Streak['dir'] = r > 0 ? 'beat' : 'missed';
    if (dir == null) dir = d;
    if (d !== dir) break;
    n++;
  }
  return dir && n >= 2 ? { n, dir } : null;
}

/** the strip's caption: what the 14 days hold, in one line. A strip of
 *  watches only reads as before ("3 lots close in 14 days · next today");
 *  a mixed strip names its kinds, so the count never passes picks or your
 *  names' sales off as your watches ("2 watches · 24 picks · 3 of your
 *  names close in 14 days · next today") */
export function stripCaption(days: readonly StripDay[]): string {
  const total = days.reduce((s, d) => s + d.n, 0);
  if (!total) return 'nothing of yours closes in the next 14 days';
  const watches = days.reduce((s, d) => s + d.watches, 0);
  const picks = days.reduce((s, d) => s + d.picks, 0);
  const names = days.reduce((s, d) => s + d.names, 0);
  const next = days.find(d => d.n > 0)!;
  const when = next.today ? 'today' : days.indexOf(next) === 1 ? 'tomorrow' : dayLabel(next.day);
  const busiest = days.reduce((a, b) => (b.n > a.n ? b : a), days[0]);
  const busy = busiest.n >= 2 && busiest !== next ? ` · busiest ${busiest.today ? 'today' : dayLabel(busiest.day)} (${busiest.n})` : '';
  const what = watches === total
    ? `${total} ${total === 1 ? 'lot closes' : 'lots close'}`
    : [watches ? `${watches} ${watches === 1 ? 'watch' : 'watches'}` : null, picks ? `${picks} ${picks === 1 ? 'pick' : 'picks'}` : null, names ? `${names} ${names === 1 ? 'sale' : 'sales'} of your names` : null]
        .filter(Boolean).join(' · ') + (total === 1 ? ' closes' : ' close');
  return `${what} in 14 days · next ${when}${busy}`;
}
