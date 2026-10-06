/**
 * stats.ts — THE order statistics (Sep 27 2026 engine pass). One definition of
 * median / weighted median / quantile for the whole engine, with the empty and
 * sort semantics written down once instead of re-derived in 17 local copies.
 *
 * Semantics (all functions are pure; none mutate their input):
 *  · Inputs are UNSORTED unless the name says `Sorted` — the function sorts a
 *    copy. Non-finite values (NaN/±Infinity) are dropped before anything else.
 *  · EMPTY input returns `NaN` from `median`/`quantile`/`weightedMedian`, so a
 *    missing statistic can never masquerade as a real $0. Callers that want a
 *    0 fallback say so at the call site (`|| 0`, `?? 0`).
 *  · Even-n median is the MEAN of the two middle values (the textbook
 *    definition every engine copy already used).
 *  · `quantile` is the linear-interpolation (type-7) estimator on the sorted
 *    values, q clamped to [0,1] — the ONE convention the engine band, the
 *    comps dispersion guards, the backtest conformal bands and the value book
 *    share (formerly value.quantile, which now re-exports this).
 *  · `weightedMedian` returns the smallest value whose cumulative weight
 *    reaches half the total weight (lower weighted median). Pairs with a
 *    non-positive or non-finite weight are ignored; if no weight remains the
 *    plain median of the values is returned.
 */

const finite = (x: number) => typeof x === 'number' && Number.isFinite(x);

/** Sorted ascending copy with non-finite values dropped. */
export function sortedFinite(vals: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of vals) if (finite(v)) out.push(v);
  return out.sort((a, b) => a - b);
}

/** Median of an ASCENDING-sorted array (no copy, no filtering). NaN if empty. */
export function medianSorted(sorted: readonly number[]): number {
  const n = sorted.length;
  if (!n) return NaN;
  const m = n >> 1;
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** Median of an unsorted array. NaN if empty. */
export function median(vals: readonly number[]): number {
  return medianSorted(sortedFinite(vals));
}

/** Median of an unsorted array, `empty` when there is no finite value. The
 *  call-site fallback in one place: `medianOr(xs, 0)` for the legacy
 *  0-on-empty readers, `medianOr(xs, null)` for "no median" UIs. */
export function medianOr<T>(vals: readonly number[], empty: T): number | T {
  const m = median(vals);
  return Number.isNaN(m) ? empty : m;
}

/** The UPPER-middle order statistic of an ASCENDING-sorted array — for even n
 *  this is sorted[n/2], not the mean of the two middles. Use ONLY where the
 *  figure must be an observed value (e.g. "the median lot holds 3 bids" over
 *  integer counts). `empty` when the array is empty. */
export function medianUpperSorted<T>(sorted: readonly number[], empty: T): number | T {
  return sorted.length ? sorted[sorted.length >> 1] : empty;
}

/** Linear-interpolation quantile on an ASCENDING-sorted array. NaN if empty. */
export function quantileSorted(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = Math.min(1, Math.max(0, q)) * (n - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Linear-interpolation quantile of an unsorted array. NaN if empty. */
export function quantile(vals: readonly number[], q: number): number {
  return quantileSorted(sortedFinite(vals), q);
}

/** Lower weighted median of [value, weight] pairs. NaN if empty. */
export function weightedMedian(pairs: readonly (readonly [number, number])[]): number {
  const s = pairs.filter(p => finite(p[0]) && finite(p[1]) && p[1] > 0).slice().sort((a, b) => a[0] - b[0]);
  if (!s.length) return median(pairs.map(p => p[0]));
  let total = 0;
  for (const p of s) total += p[1];
  let c = 0;
  for (const [v, w] of s) { c += w; if (c >= total / 2) return v; }
  return s[s.length - 1][0];
}

/** Weighted linear quantile of [value, weight] pairs (cumulative-weight
 *  interpolation, midpoint convention). Used for recency-weighted bands.
 *  NaN if empty; unweighted when every weight is equal it matches
 *  `quantile` at q = 0.5 only approximately — use `quantile` for plain data. */
export function weightedQuantile(pairs: readonly (readonly [number, number])[], q: number): number {
  const s = pairs.filter(p => finite(p[0]) && finite(p[1]) && p[1] > 0).slice().sort((a, b) => a[0] - b[0]);
  if (!s.length) return NaN;
  if (s.length === 1) return s[0][0];
  let total = 0;
  for (const p of s) total += p[1];
  const target = Math.min(1, Math.max(0, q)) * total;
  let c = 0;
  let prevMid = -Infinity, prevV = s[0][0];
  for (const [v, w] of s) {
    const mid = c + w / 2;
    if (target <= mid) {
      if (prevMid === -Infinity) return v;
      return prevV + (v - prevV) * ((target - prevMid) / (mid - prevMid));
    }
    prevMid = mid; prevV = v; c += w;
  }
  return s[s.length - 1][0];
}

/** Math.max over an array WITHOUT spreading it into call arguments — a spread
 *  of more than ~120k values overflows the call stack. Same semantics as
 *  `Math.max(...vals)`: empty → -Infinity, any NaN → NaN, +0 beats −0. */
export function maxOf(vals: readonly number[]): number {
  let m = -Infinity;
  for (const v of vals) {
    if (v !== v) return NaN;
    if (v > m || (v === 0 && m === 0 && Object.is(m, -0))) m = v;
  }
  return m;
}

/** Math.min counterpart of maxOf (empty → +Infinity, any NaN → NaN, −0 beats +0). */
export function minOf(vals: readonly number[]): number {
  let m = Infinity;
  for (const v of vals) {
    if (v !== v) return NaN;
    if (v < m || (v === 0 && m === 0 && Object.is(v, -0))) m = v;
  }
  return m;
}
