/**
 * close-time.ts — the pure close-instant rule closing.ts publishes, split out
 * with no React import so server-reachable modules (utils.ts →
 * isLiveUpcoming) can read it. See closing.ts for the doctrine.
 */

export type Closable = { status?: string; saleDate?: string | null; saleDateTime?: string | null; resultsPending?: boolean };

/** a saleDateTime carries a real time only when it is not a bare midnight-UTC
    day stamp (several crawlers write `YYYY-MM-DDT00:00:00Z` for day-only) */
export function hasRealTime(s: string): boolean {
  return /T\d{2}:\d{2}/.test(s) && !/T00:00(:00(\.000)?)?Z$/.test(s);
}

/** The close instant in epoch ms, or null when the lot carries no usable date. */
export function closeMs(l: Closable): number | null {
  const dt = l.saleDateTime || '';
  if (dt && hasRealTime(dt)) {
    const t = Date.parse(dt);
    if (!isNaN(t)) return t;
  }
  const day = (dt || l.saleDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  // end of that calendar day in the READER's zone
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/* ── "tonight" / "today" / "tomorrow" on the READER's calendar ───────────
   (Oct 11 2026, the R1/R4/R5 "tonight" bug) A reader's evening runs past
   midnight: "tonight" ends at 4am. The date on the reader's clock decides
   which night: at 00:40 on Sunday, tonight is Sunday night (ending 4am
   Monday) — the old rule ended tonight at 4am Sunday and then said "the
   next closes Sun, Oct 11", i.e. today. Built on the local Date
   constructor, so a DST change night is still 4am wall time. */

/** the hour a reader's "tonight" ends (local wall clock) */
export const NIGHT_END_HOUR = 4;

/** the end of "tonight" (epoch ms): the 4am after today's evening */
export function tonightEndMs(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, NIGHT_END_HOUR, 0, 0, 0).getTime();
}

/** whole calendar days from `nowMs`'s local date to `ms`'s (0 today, 1 tomorrow) */
export function calendarDaysBetween(nowMs: number, ms: number): number {
  const a = new Date(nowMs), b = new Date(ms);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
}

/**
 * A close instant in the reader's words: "today at 2 PM", "tonight at
 * 10 PM", "tonight at 1:30 AM" (the small hours before tonight ends),
 * "tomorrow at 9 AM", "Tue, Oct 13". `timed` false (a date-only sale)
 * drops the clock time: "today", "tomorrow".
 */
export function closeWhenText(ms: number, nowMs: number, timed = true): string {
  const h = new Date(ms).getHours();
  const at = timed ? ` at ${new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
  const days = calendarDaysBetween(nowMs, ms);
  const night = h >= 18 || h < NIGHT_END_HOUR;
  if (days === 0) return timed && night ? `tonight${at}` : `today${at}`;
  if (days === 1 && timed && ms <= tonightEndMs(nowMs)) return `tonight${at}`;
  if (days === 1) return `tomorrow${at}`;
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
