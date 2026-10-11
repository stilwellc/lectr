/**
 * stats.ts — THE one function behind every entity figure (makers overhaul,
 * Oct 10 2026). The /makers row, the dossier hero and the entity page read
 * the same numbers because they are all computed here, once, by the build
 * (scripts/emit-entities.ts) — and by the client's fail-soft adapter over the
 * same rows when an older payload has no entities file.
 *
 * The rules, written down once:
 *   population   sold lots with a price, already attributed (entityKeyOf —
 *                the misattribution guard has run)
 *   scope        sold, sold12m and the record count EVERY lot of the entity.
 *                The median, the spark and yoy read ONE lens — the entity's
 *                dominant clean sub-category over the trailing year (app/lib/
 *                taxonomy `cat:sub`), named in `medScope` — so a maker's
 *                editions and unique works, or a player's cards and game-worn
 *                pieces, never share a median
 *   12 months    a true calendar window: saleDate in (now − 365d, now]
 *   medians      printed only at n ≥ MIN_MED_N; the n always travels with it
 *   quarters     calendar quarters by the saleDate STRING (no local-time
 *                drift), COMPLETE quarters only — never the quarter in
 *                progress; a quarter under MIN_Q_N sales is null (a gap)
 *   yoy          the last 4 complete quarters vs the 4 before, LIKE FOR LIKE
 *                (yoyOf): the median per-identity price ratio over the
 *                identities sold in both years (basis 'matched', n = pairs);
 *                else pooled medians only when both sides hold ≥ MIN_YOY_N
 *                sales on a stable intake (basis 'median'); else none. Every
 *                read carries its 90% interval [lo, hi] and prints only when
 *                that interval excludes 0 or is at most ±YOY_CI_HALF wide
 */
import { medianSorted } from '../stats';

export const MIN_MED_N = 5;
export const MIN_Q_N = 3;
export const MIN_YOY_N = 10;
export const SPARK_QUARTERS = 12;
/** a spark needs this many non-null quarters to draw at all */
export const MIN_SPARK_POINTS = 4;
/** detail history: the newest N complete quarters (yearly covers the full span) */
export const DETAIL_QUARTERS = 48;
export const RESULT_ROWS = 8;
/** per coarse lens: its own top results (a player's best memorabilia even when cards hold the overall top 8) */
export const LENS_TOP = 4;
/** sorts below well-supported rows */
export const THIN_SOLD12M = 5;

/** one sold lot, as the stats read it */
export interface SoldPoint {
  /** price, USD (the served priceUsd) */
  p: number;
  /** sale day, YYYY-MM-DD */
  d: string;
  h: string;
  /** the fine lens: clean `cat:sub` */
  lens: string;
  /** the coarse lens (art/design/watches: the sub; collections: the category) */
  coarse: string;
  id: string;
  t: string;
  img: string | null;
  /** (facet-bearing entities only) the lot's live-chip facet keys — app/lib/entity/facets */
  fx?: readonly string[];
  /** the lot's like-for-like identity (scripts/emit-entities identityOf: a
   *  card + grade, a Pokémon card + grade, a watch reference + material, a
   *  print edition) — the unit the matched yoy pairs on; absent = none */
  k?: string | null;
  /** (r8, grade-ladder entities only) the same card WITHOUT its grade — the
   *  unit the matched grade ladder prices across grades (facets gradeLadder) */
  kg?: string | null;
}

export interface Labels { lens: (k: string) => string; coarse: (k: string) => string }

export interface EntityFigures {
  sold: number;
  sold12m: number;
  med12m: number | null;
  med12mN: number;
  medScope: string | null;
  medLens: string | null;
  record: { p: number; d: string; t: string; h: string; id: string; img: string | null } | null;
  spark: (number | null)[] | null;
  sparkN: number[] | null;
  /** (r7) what the spark reads: 'median' = the lens's trailing-year median sale at each quarter (r8);
   *  'matched' = an identity-keyed lens (cards, Pokémon, references,
   *  editions) — the same items' trailing-year price level, chained (sameItemSpark) */
  sparkBasis: 'median' | 'matched' | null;
  /** (r8) the line's own change over its last four quarters (percent), set
   *  ONLY when it falls outside the YoY's 90% interval — the two then read
   *  the year differently (sparkYoyOff), and the row says so. null = agrees,
   *  or nothing to compare */
  sparkYoyOff: number | null;
  sparkQ: string[];
  yoy: Yoy | null;
  quarters: { q: string; med: number | null; n: number; high: number }[];
  yearly: { y: number; med: number | null; n: number; partial?: true }[];
  houses: { h: string; n: number }[];
  cats: { key: string; label: string; n: number; med12m: number | null; med12mN: number }[];
  top: { id: string; img: string | null; p: number; d: string; t: string; h: string; cat: string }[];
  recent: { id: string; img: string | null; p: number; d: string; t: string; h: string; cat: string }[];
  lensSplit: { key: string; label: string; n: number; n12: number; med: number | null; yearly: { y: number; med: number | null; n: number; partial?: true }[]; top: EntityFigures['top'] }[] | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isSaleDay = (d: string) => DAY.test(d);

/** 'YYYY-Qn' of a YYYY-MM-DD string */
export function quarterOf(d: string): string {
  return `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;
}

/** the `count` most recent COMPLETE calendar quarters before `today`, oldest first */
export function completeQuarters(today: string, count: number): string[] {
  let y = Number(today.slice(0, 4));
  let q = Math.ceil(Number(today.slice(5, 7)) / 3) - 1; // the quarter before the one in progress
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (q < 1) { q = 4; y--; }
    out.push(`${y}-Q${q}`);
    q--;
  }
  return out.reverse();
}

/** the day 365 days before `today` (YYYY-MM-DD, UTC arithmetic) */
export function dayMinus(today: string, days: number): string {
  const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return new Date(t - days * 86400000).toISOString().slice(0, 10);
}

const med = (ps: number[]): number => Math.round(medianSorted(ps.slice().sort((a, b) => a - b)));
const gated = (ps: number[], min: number): number | null => (ps.length >= min ? med(ps) : null);

function yearlyOf(rows: readonly SoldPoint[], thisYear: number): { y: number; med: number | null; n: number; partial?: true }[] {
  const by = new Map<number, number[]>();
  for (const r of rows) { const y = Number(r.d.slice(0, 4)); (by.get(y) || by.set(y, []).get(y)!).push(r.p); }
  return Array.from(by.entries()).sort((a, b) => a[0] - b[0])
    .map(([y, ps]) => (y === thisYear ? { y, med: gated(ps, MIN_MED_N), n: ps.length, partial: true as const } : { y, med: gated(ps, MIN_MED_N), n: ps.length }));
}

/** a matched yoy needs at least this many identities sold in BOTH years —
 *  the fewest a distribution-free 90% interval on their median exists for
 *  (R7: the read is gated on its precision, not on a fixed count) */
export const MIN_YOY_PAIRS = 5;
/** a plain-median yoy only when the two years' sale counts sit within this
 *  ratio of each other — past it the median reads what the crawl added (a
 *  4× card / Pokémon intake in 2026), not what prices did */
export const YOY_COVERAGE_MAX = 1.5;
/** a lens where at least this share of the two years' sales carry an
 *  identity reads matched or not at all (never the pooled median) */
export const YOY_KEYED_SHARE = 0.5;
/** the yoy interval's confidence (two-sided) — the one every read prints */
export const YOY_CI_LEVEL = 0.9;
/** (R7) a read prints when its 90% interval is at most this wide either side
 *  of the read, in log points (≈ −26% … +35% around flat): a flat or modest
 *  move, bounded. A wider interval prints only when it EXCLUDES no change —
 *  a move whose size is uncertain but whose direction is not: at 90% for a
 *  matched read, at YOY_MEDIAN_MOVE_LEVEL for a pooled median (its interval
 *  sees sampling noise only, never a shift in what sold, so a wide median
 *  move needs the stronger evidence). Anything else is noise — none. */
export const YOY_CI_HALF = 0.3;
export const YOY_MEDIAN_MOVE_LEVEL = 0.98;

/** the 1-indexed rank l such that [x(l), x(n−l+1)] of n sorted draws is a
 *  distribution-free `level` interval for their median: the largest l with
 *  P(Binomial(n, ½) ≤ l−1) ≤ (1 − level)/2 (exact to n = 60, normal beyond).
 *  0 = n too small for any such interval (n < 5 at 90%). */
export function medianRankLo(n: number, level = YOY_CI_LEVEL): number {
  const half = (1 - level) / 2;
  if (n > 60) return Math.max(0, Math.floor(n / 2 - (zOf(half) * Math.sqrt(n)) / 2));
  let pmf = Math.pow(0.5, n), cdf = 0, l = 0;
  for (let j = 0; j <= n; j++) {
    cdf += pmf;
    if (cdf > half) break;
    l = j + 1;
    pmf = (pmf * (n - j)) / (j + 1);
  }
  return l;
}
/** the upper-tail normal quantile for the two levels yoy uses */
const zOf = (tail: number) => (tail >= 0.05 - 1e-9 ? 1.6448536269514722 : 2.3263478740408408);

/** a sorted sample's median with its distribution-free interval (null when n is too small) */
function medianCi(sorted: readonly number[], level = YOY_CI_LEVEL): { m: number; lo: number; hi: number } | null {
  const l = medianRankLo(sorted.length, level);
  if (l < 1) return null;
  return { m: medianSorted(sorted), lo: sorted[l - 1], hi: sorted[sorted.length - l] };
}

/**
 * yoy — the lens's last 4 complete quarters against the 4 before, like with
 * like (P3, Oct 10), each read with its 90% interval (R7). Two honest bases,
 * in order:
 *   matched  every identity (SoldPoint.k) that sold in BOTH years gives one
 *            log ratio, its this-year median over its last-year median; the
 *            read is the median of those ratios, n = the identities paired,
 *            the interval the distribution-free one on that median (order
 *            statistics — no shape assumed, exact at small n). Same card at
 *            the same grade, same reference, same edition — the crawl adding
 *            more cheap (or dear) things cannot move it.
 *   median   the pooled median against the pooled median — only for a lens
 *            whose sales mostly carry NO identity (unique works, most
 *            memorabilia), when both years clear MIN_YOY_N AND their counts
 *            are within YOY_COVERAGE_MAX of each other (a stable intake). Its
 *            interval combines each year's median interval (root sum of
 *            squares in log space — conservative against a bootstrap).
 * Either prints only when it means something (YOY_CI_HALF): bounded, or a
 * clear move. The interval travels with the read ([lo, hi], in percent).
 * Measured Oct 10 2026 on the full sold corpus (scratchpad r7yoy): placebo
 * reads (each identity's sales shuffled between the years, true change 0)
 * print a move — an interval excluding 0 — under 10% of the time; coarser
 * identity tiers (same card any grade, grade-adjusted on the market's ladder)
 * and a mix-reweighted median disagreed with precise matched reads by 18–26
 * log points (sign right ~70% of the time) and are not used.
 */
export type Yoy = { pct: number; n: number; basis: 'matched' | 'median'; lo: number; hi: number };
export function yoyOf(scoped: readonly SoldPoint[], today: string): Yoy | null {
  const q8 = completeQuarters(today, 8);
  const prevQ = new Set(q8.slice(0, 4)), curQ = new Set(q8.slice(4));
  const prev: number[] = [], cur: number[] = [];
  const pk = new Map<string, number[]>(), ck = new Map<string, number[]>();
  for (const r of scoped) {
    if (!(r.p > 0)) continue;
    const q = quarterOf(r.d);
    const side = prevQ.has(q) ? 0 : curQ.has(q) ? 1 : -1;
    if (side < 0) continue;
    (side ? cur : prev).push(r.p);
    if (r.k) { const m = side ? ck : pk; (m.get(r.k) || m.set(r.k, []).get(r.k)!).push(r.p); }
  }
  const sorted = (ps: number[]) => ps.slice().sort((a, b) => a - b);
  const pct = (logR: number) => Math.round((Math.exp(logR) - 1) * 1000) / 10;
  const tight = (lo: number, hi: number) => (hi - lo) / 2 <= YOY_CI_HALF;
  const move = (lo: number, hi: number) => lo > 0 || hi < 0;
  const yoy = (m: number, lo: number, hi: number, n: number, basis: Yoy['basis']): Yoy => ({ pct: pct(m), n, basis, lo: pct(lo), hi: pct(hi) });
  const logs: number[] = [];
  pk.forEach((ps, k) => {
    const cs = ck.get(k);
    if (!cs) return;
    logs.push(Math.log(medianSorted(sorted(cs)) / medianSorted(sorted(ps))));
  });
  if (logs.length >= MIN_YOY_PAIRS) {
    const ci = medianCi(logs.sort((a, b) => a - b))!;
    return tight(ci.lo, ci.hi) || move(ci.lo, ci.hi) ? yoy(ci.m, ci.lo, ci.hi, logs.length, 'matched') : null;
  }
  // an identity-keyed lens (cards, Pokémon, references, editions) that cannot
  // pair: its pooled median is a different basket each year (a rookie's
  // prospect cards then, his flagship cards now) — no read
  let keyed = 0;
  pk.forEach(ps => { keyed += ps.length; });
  ck.forEach(ps => { keyed += ps.length; });
  if (keyed >= YOY_KEYED_SHARE * (prev.length + cur.length)) return null;
  if (prev.length < MIN_YOY_N || cur.length < MIN_YOY_N) return null;
  const hi = Math.max(prev.length, cur.length), lo = Math.min(prev.length, cur.length);
  if (hi / lo > YOY_COVERAGE_MAX) return null;
  const lp = sorted(prev).map(Math.log), lc = sorted(cur).map(Math.log);
  // the difference of the two medians: each year's interval, combined
  const diff = (level: number) => {
    const a = medianCi(lp, level)!, c = medianCi(lc, level)!;
    const d = c.m - a.m;
    return { d, lo: d - Math.hypot(c.m - c.lo, a.hi - a.m), hi: d + Math.hypot(c.hi - c.m, a.m - a.lo) };
  };
  const r = diff(YOY_CI_LEVEL);
  if (tight(r.lo, r.hi)) return yoy(r.d, r.lo, r.hi, lo, 'median');
  const strong = diff(YOY_MEDIAN_MOVE_LEVEL);
  return move(strong.lo, strong.hi) ? yoy(r.d, r.lo, r.hi, lo, 'median') : null;
}

/**
 * (r7 data fix) THE SAME-ITEMS SPARK. A lens whose sales mostly carry an
 * identity (a card at a grade, a Pokémon card, a watch reference, a print
 * edition — YOY_KEYED_SHARE) drew its trend as the pooled quarterly median,
 * which swings with what sold: Jordan's last quarter read $7,375 against
 * $1,098 the quarter before at n≈500 — a Goldin Elite sale vs a Weekly one,
 * not a price move, beside an honest matched YoY. This reads the same items
 * instead: a repeat-sales index (Bailey–Muth–Nourse) — every identity's
 * median price per quarter, consecutive sold quarters paired into log
 * ratios, least squares for one level per quarter (the first anchored at 0).
 * A quarter prints only when at least MIN_Q_N repeat-sold identities price it
 * (the pooled spark's own gate);
 * (r8) Each printed point is the TRAILING YEAR's level — the mean log level
 * of the quarter and the three before it (at least three of the four priced)
 * — so the line's change over four quarters is the same comparison the YoY
 * makes (the last four complete quarters against the four before, the same
 * items): Jordan's quarter-to-quarter endpoints read +145% against a +105%
 * YoY whose 90% interval stopped at +119%; the trailing-year line reads
 * the year blocks the YoY reads.
 * The levels are then scaled so the newest four printed points average the
 * lens's typical sale — the line's SHAPE is the same items, its height the
 * dollars a reader already sees beside it. null = too few repeat sales.
 */
export function sameItemSpark(scoped: readonly SoldPoint[], printedQ: readonly string[], anchor: number | null): { v: (number | null)[]; n: number[] } | null {
  // the index runs over the printed quarters and the SPARK_ROLL − 1 before them
  const lead = SPARK_ROLL - 1;
  const quarters = withLeadQuarters(printedQ, lead);
  const qi = new Map(quarters.map((q, i) => [q, i] as const));
  const byK = new Map<string, Map<number, number[]>>();
  for (const r of scoped) {
    if (!r.k || !(r.p > 0)) continue;
    const i = qi.get(quarterOf(r.d));
    if (i === undefined) continue;
    let m = byK.get(r.k);
    if (!m) byK.set(r.k, m = new Map());
    (m.get(i) || m.set(i, []).get(i)!).push(r.p);
  }
  const Q = quarters.length;
  const pairs: { a: number; b: number; y: number }[] = [];
  const touch = new Array<number>(Q).fill(0);
  byK.forEach(m => {
    if (m.size < 2) return;
    const qs = Array.from(m.keys()).sort((x, y) => x - y);
    const lv = qs.map(i => Math.log(medianSorted(m.get(i)!.slice().sort((x, y) => x - y))));
    for (const i of qs) touch[i]++;
    for (let j = 1; j < qs.length; j++) pairs.push({ a: qs[j - 1], b: qs[j], y: lv[j] - lv[j - 1] });
  });
  if (pairs.length < MIN_YOY_PAIRS) return null;
  // normal equations for β_1..β_{Q-1} (β_0 = 0); a whisper of ridge keeps an
  // uncovered quarter solvable — it never prints (touch < MIN_YOY_PAIRS)
  const P = Q - 1;
  const A = Array.from({ length: P }, () => new Array<number>(P).fill(0));
  const B = new Array<number>(P).fill(0);
  for (const { a, b, y } of pairs) {
    const ia = a - 1, ib = b - 1;
    if (ib >= 0) { A[ib][ib] += 1; B[ib] += y; }
    if (ia >= 0) { A[ia][ia] += 1; B[ia] -= y; }
    if (ia >= 0 && ib >= 0) { A[ia][ib] -= 1; A[ib][ia] -= 1; }
  }
  for (let i = 0; i < P; i++) A[i][i] += 1e-6;
  // Gaussian elimination (P ≤ 11)
  for (let c = 0; c < P; c++) {
    let piv = c;
    for (let r = c + 1; r < P; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = c + 1; r < P; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < P; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  const beta = new Array<number>(P).fill(0);
  for (let r = P - 1; r >= 0; r--) {
    let acc = B[r];
    for (let k = r + 1; k < P; k++) acc -= A[r][k] * beta[k];
    beta[r] = acc / A[r][r];
  }
  const lvl = [0, ...beta];
  const ok = lvl.map((_, i) => touch[i] >= MIN_Q_N);
  // the trailing year at each printed quarter: its own level priced, and at least
  // three of the window's four — the mean of the priced levels
  const roll = printedQ.map((_, j) => {
    const i = j + lead;
    if (!ok[i]) return null;
    let s = 0, c = 0;
    for (let w = i - lead; w <= i; w++) if (ok[w]) { s += lvl[w]; c++; }
    return c >= SPARK_ROLL - 1 ? s / c : null;
  });
  const printed = roll.filter((b): b is number => b != null);
  if (printed.length < MIN_SPARK_POINTS) return null;
  // the newest four printed points average the typical sale
  const recent = printed.slice(-4);
  const base = recent.reduce((x, y) => x + y, 0) / recent.length;
  const scale = anchor && anchor > 0 ? anchor : Math.exp(medianSorted(scoped.map(r => Math.log(r.p)).sort((x, y) => x - y)));
  return { v: roll.map(b => (b != null ? Math.round(scale * Math.exp(b - base)) : null)), n: touch.slice(lead) };
}

/** (r8) a spark point reads the trailing year: its quarter and the three before */
export const SPARK_ROLL = 4;
/** the quarter before 'YYYY-Qn' */
function prevQuarter(q: string): string {
  const y = Number(q.slice(0, 4)), n = Number(q.slice(6));
  return n > 1 ? `${y}-Q${n - 1}` : `${y - 1}-Q4`;
}
/** `quarters` with the `lead` quarters before its first prepended (oldest first) */
export function withLeadQuarters(quarters: readonly string[], lead: number): string[] {
  const out = quarters.slice();
  for (let i = 0; i < lead && out.length; i++) out.unshift(prevQuarter(out[0]));
  return out;
}

/**
 * (r8) Where the trend line and the YoY disagree. Both read the trailing year
 * on one lens, so the line's change over its last four points (the last four
 * complete quarters against the four before) is the YoY's comparison — exact
 * on a median basis. On a same-items basis the line is a repeat-sales index
 * (every repeat sale, quarter to quarter) and the YoY the median item's
 * year-on-year ratio: the two agree within the YoY's 90% interval on ~85% of
 * entities (measured Oct 10 2026 on the full corpus), and where they do not,
 * the build says so rather than let a +145% line sit silent beside a +105% cell.
 */
export function sparkYoyOff(spark: readonly (number | null)[], yoy: Yoy | null): number | null {
  if (!yoy || spark.length < 5) return null;
  const a = spark[spark.length - 5], b = spark[spark.length - 1];
  if (a == null || b == null || !(a > 0)) return null;
  const ch = Math.round(((b / a) - 1) * 1000) / 10;
  return ch < yoy.lo - 0.5 || ch > yoy.hi + 0.5 ? ch : null;
}

export const TITLE_MAX = 120;
const resultRow = (r: SoldPoint, labels: Labels) => ({ id: r.id, img: r.img, p: Math.round(r.p), d: r.d, t: r.t.slice(0, TITLE_MAX), h: r.h, cat: labels.lens(r.lens) });

/**
 * Every figure for one entity from its sold points. `today` is the build's
 * calendar day (YYYY-MM-DD) — pass it explicitly so the build and a test
 * agree on the window.
 */
export interface FigureOpts {
  /** (r7) the lens the entity's LIVE book is mostly in (≥ half its live lots) —
   *  the median reads it when it has a 12-month median of its own, so the
   *  typical sale names what is on the block (Star Wars: 59 of 76 live lots
   *  are props; the median read 11 "other memorabilia" sales) */
  liveLens?: string | null;
}
export function entityFigures(rows: readonly SoldPoint[], today: string, labels: Labels, opts: FigureOpts = {}): EntityFigures {
  const pts = rows.filter(r => r.p > 0 && isSaleDay(r.d) && r.d <= today);
  const from12 = dayMinus(today, 365);
  const in12 = (r: SoldPoint) => r.d > from12 && r.d <= today;
  const last12 = pts.filter(in12);

  // the lens: dominant over the trailing year, else all-time (ties: the key)
  const count = (xs: readonly SoldPoint[], key: (r: SoldPoint) => string) => {
    const m = new Map<string, number>();
    for (const r of xs) m.set(key(r), (m.get(key(r)) || 0) + 1);
    return m;
  };
  const pick = (m: Map<string, number>) => {
    let best: string | null = null, n = -1;
    m.forEach((c, k) => { if (c > n || (c === n && best !== null && k < best)) { n = c; best = k; } });
    return best;
  };
  let lens: string | null = pick(count(last12.length ? last12 : pts, r => r.lens));
  if (opts.liveLens && opts.liveLens !== lens && last12.filter(r => r.lens === opts.liveLens).length >= MIN_MED_N) lens = opts.liveLens;
  const scoped = lens ? pts.filter(r => r.lens === lens) : [];
  const scoped12 = scoped.filter(in12).map(r => r.p);

  // complete quarters of the scoped lens
  const spQ = completeQuarters(today, SPARK_QUARTERS);
  const byQ = new Map<string, number[]>();
  for (const r of scoped) { const q = quarterOf(r.d); (byQ.get(q) || byQ.set(q, []).get(q)!).push(r.p); }
  // (r7) an identity-keyed lens draws the same items, chained (sameItemSpark) —
  // never the pooled median that swings with the mix when the items can chain
  const spSet = new Set(spQ);
  const inWin = scoped.filter(r => spSet.has(quarterOf(r.d)));
  const keyedLens = inWin.length > 0 && inWin.filter(r => r.k).length >= YOY_KEYED_SHARE * inWin.length;
  // (r8) …and so does a lens whose YoY pairs the same items (yoyOf 'matched'),
  // keyed majority or not: the line then reads the basis the YoY beside it reads
  const yoy = yoyOf(scoped, today);
  const same = keyedLens || yoy?.basis === 'matched' ? sameItemSpark(scoped, spQ, gated(scoped12, MIN_MED_N)) : null;
  let sparkN = spQ.map(q => byQ.get(q)?.length || 0);
  // (r8) each point the TRAILING YEAR's median sale (the quarter and the three
  // before it), drawn where the quarter itself holds MIN_Q_N sales and the
  // year MIN_MED_N — so the line's change over four quarters is exactly the
  // median YoY's comparison (the last four complete quarters against the four
  // before), and one quarter's mix cannot spike it
  const extQ = withLeadQuarters(spQ, SPARK_ROLL - 1);
  let sparkV: (number | null)[] = spQ.map((q, j) => {
    if ((byQ.get(q)?.length || 0) < MIN_Q_N) return null;
    const win: number[] = [];
    for (let w = j; w < j + SPARK_ROLL; w++) win.push(...(byQ.get(extQ[w]) || []));
    return gated(win, MIN_MED_N);
  });
  // …and where too few items repeat to chain, the quarterly median stands — said as such
  // (sparkBasis 'median'; the row and the compare tray name the basis)
  if (same) { sparkV = same.v; sparkN = same.n; }
  const sparkOk = sparkV.filter(v => v != null).length >= MIN_SPARK_POINTS;


  // the record: every lot, every lens
  let rec: SoldPoint | null = null;
  for (const r of pts) if (!rec || r.p > rec.p) rec = r;

  // full history (all lenses), complete quarters only, newest DETAIL_QUARTERS
  const allQ = new Map<string, number[]>();
  for (const r of pts) { const q = quarterOf(r.d); (allQ.get(q) || allQ.set(q, []).get(q)!).push(r.p); }
  const keepQ = new Set(completeQuarters(today, DETAIL_QUARTERS));
  const quarters = Array.from(allQ.entries()).filter(([q]) => keepQ.has(q)).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([q, ps]) => ({ q, med: gated(ps, MIN_Q_N), n: ps.length, high: Math.round(ps.reduce((m, x) => Math.max(m, x), 0)) }));
  const thisYear = Number(today.slice(0, 4));

  const houses = Array.from(count(pts, r => r.h || '').entries()).filter(([h]) => h)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([h, n]) => ({ h, n }));

  const byLens = new Map<string, SoldPoint[]>();
  for (const r of pts) (byLens.get(r.lens) || byLens.set(r.lens, []).get(r.lens)!).push(r);
  const cats = Array.from(byLens.entries()).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(([key, rs]) => {
    const p12 = rs.filter(in12).map(r => r.p);
    return { key, label: labels.lens(key), n: rs.length, med12m: gated(p12, MIN_MED_N), med12mN: p12.length };
  });

  const byCoarse = new Map<string, SoldPoint[]>();
  for (const r of pts) (byCoarse.get(r.coarse) || byCoarse.set(r.coarse, []).get(r.coarse)!).push(r);
  const lensSplit = byCoarse.size > 1
    ? Array.from(byCoarse.entries()).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(([key, rs]) => {
      const p12 = rs.filter(in12).map(r => r.p);
      const tops = rs.slice().sort((a, b) => b.p - a.p || (a.d < b.d ? 1 : -1)).slice(0, LENS_TOP).map(r => resultRow(r, labels));
      return { key, label: labels.coarse(key), n: rs.length, n12: p12.length, med: gated(p12, MIN_MED_N), yearly: yearlyOf(rs, thisYear), top: tops };
    })
    : null;

  const top = pts.slice().sort((a, b) => b.p - a.p || (a.d < b.d ? 1 : -1)).slice(0, RESULT_ROWS).map(r => resultRow(r, labels));
  const recent = pts.slice().sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.p - a.p)).slice(0, RESULT_ROWS).map(r => resultRow(r, labels));

  return {
    sold: pts.length,
    sold12m: last12.length,
    med12m: gated(scoped12, MIN_MED_N),
    med12mN: scoped12.length,
    medScope: lens ? labels.lens(lens) : null,
    medLens: lens,
    record: rec ? { p: Math.round(rec.p), d: rec.d, t: rec.t.slice(0, TITLE_MAX), h: rec.h, id: rec.id, img: rec.img } : null,
    spark: sparkOk ? sparkV : null,
    sparkN: sparkOk ? sparkN : null,
    sparkBasis: sparkOk ? (same ? 'matched' : 'median') : null,
    sparkYoyOff: sparkOk ? sparkYoyOff(sparkV, yoy) : null,
    sparkQ: spQ,
    yoy,
    quarters,
    yearly: yearlyOf(pts, thisYear),
    houses,
    cats,
    top,
    recent,
    lensSplit,
  };
}
