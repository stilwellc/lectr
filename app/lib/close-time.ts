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
