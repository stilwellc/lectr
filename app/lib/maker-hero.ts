/**
 * maker-hero.ts — the rules behind the maker hero's headline read (Oct 10).
 *
 * The hero printed the quarter IN PROGRESS as the headline ("$397 heating" on
 * Sports Cards was 2026-Q4 to date, 629 sales, against a complete Q3 of
 * $750), counted "a year ago" as five NON-EMPTY quarters back (Fossils' "year
 * ago" was 7 quarters back, n=3), and said heating/cooling for a one-point
 * move on two sales. The rules, in one place:
 *
 *   · only COMPLETE calendar quarters are read or drawn;
 *   · the headline needs HEAD_MIN_N sales behind its quarter;
 *   · "a year ago" is the same quarter one calendar year back, never an
 *     array offset — absent → no comparison;
 *   · a direction word needs DELTA_MIN_N sales on BOTH sides and a move big
 *     enough to be more than noise (MOVE_MIN_PTS points on a vs-estimate
 *     read, MOVE_MIN_PCT % on a price level).
 */

export interface QuarterPoint { date: string; value: number; n: number }

export const HEAD_MIN_N = 10;
export const DELTA_MIN_N = 30;
/** vs-estimate reads are already in %: a move under this many points is noise */
export const MOVE_MIN_PTS = 5;
/** price levels (median $): a move under this relative % is noise */
export const MOVE_MIN_PCT = 10;

/** "YYYY Qn" (also accepts "YYYY-Qn") → a sortable quarter ordinal */
export function quarterOrdinal(date: string): number | null {
  const m = /^(\d{4})[\s-]?Q([1-4])$/.exec(String(date).trim());
  return m ? +m[1] * 4 + (+m[2] - 1) : null;
}

export function quarterLabel(ord: number): string {
  return `${Math.floor(ord / 4)} Q${(ord % 4) + 1}`;
}

/** the quarter in progress at `now` (UTC) */
export function currentQuarterOrdinal(now: number = Date.now()): number {
  const d = new Date(now);
  return d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3);
}

/** drop the quarter in progress (and anything dated after it) */
export function completeQuarters<T extends { date: string }>(series: T[], now: number = Date.now()): T[] {
  const cur = currentQuarterOrdinal(now);
  return series.filter(p => {
    const o = quarterOrdinal(p.date);
    return o !== null && o < cur;
  });
}

export interface HeadlineRead {
  head: QuarterPoint;
  /** the same quarter one calendar year earlier, when it exists */
  yearAgo: QuarterPoint | null;
  /** 'up' | 'down' only when both sides clear DELTA_MIN_N and the move clears the noise floor */
  dir: 'up' | 'down' | null;
}

/**
 * The headline over a COMPLETE-quarter series (call completeQuarters first).
 * Null when the latest complete quarter is too thin to headline.
 * `kind`: 'demand' = a vs-estimate % (points), 'price' = a $ level.
 */
export function headlineRead(series: QuarterPoint[], kind: 'demand' | 'price'): HeadlineRead | null {
  if (!series.length) return null;
  const head = series[series.length - 1];
  if (!(head.n >= HEAD_MIN_N)) return null;
  const ho = quarterOrdinal(head.date);
  const yearAgo = ho === null ? null : series.find(p => quarterOrdinal(p.date) === ho - 4) || null;
  let dir: HeadlineRead['dir'] = null;
  if (yearAgo && head.n >= DELTA_MIN_N && yearAgo.n >= DELTA_MIN_N) {
    const move = kind === 'demand'
      ? Math.round(head.value) - Math.round(yearAgo.value)
      : yearAgo.value > 0 ? ((head.value - yearAgo.value) / yearAgo.value) * 100 : 0;
    const floor = kind === 'demand' ? MOVE_MIN_PTS : MOVE_MIN_PCT;
    if (Math.abs(move) >= floor) dir = move > 0 ? 'up' : 'down';
  }
  return { head, yearAgo, dir };
}
