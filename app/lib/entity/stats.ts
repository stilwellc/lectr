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
 *   yoy          the last 4 complete quarters vs the 4 before, pooled, only
 *                when BOTH sides hold ≥ MIN_YOY_N sales
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
  sparkQ: string[];
  yoy: { pct: number; n: number; basis: 'median' } | null;
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

export const TITLE_MAX = 120;
const resultRow = (r: SoldPoint, labels: Labels) => ({ id: r.id, img: r.img, p: Math.round(r.p), d: r.d, t: r.t.slice(0, TITLE_MAX), h: r.h, cat: labels.lens(r.lens) });

/**
 * Every figure for one entity from its sold points. `today` is the build's
 * calendar day (YYYY-MM-DD) — pass it explicitly so the build and a test
 * agree on the window.
 */
export function entityFigures(rows: readonly SoldPoint[], today: string, labels: Labels): EntityFigures {
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
  const lens = pick(count(last12.length ? last12 : pts, r => r.lens));
  const scoped = lens ? pts.filter(r => r.lens === lens) : [];
  const scoped12 = scoped.filter(in12).map(r => r.p);

  // complete quarters of the scoped lens
  const spQ = completeQuarters(today, SPARK_QUARTERS);
  const byQ = new Map<string, number[]>();
  for (const r of scoped) { const q = quarterOf(r.d); (byQ.get(q) || byQ.set(q, []).get(q)!).push(r.p); }
  const sparkN = spQ.map(q => byQ.get(q)?.length || 0);
  const sparkV = spQ.map(q => gated(byQ.get(q) || [], MIN_Q_N));
  const sparkOk = sparkV.filter(v => v != null).length >= MIN_SPARK_POINTS;

  // yoy: the last 4 complete quarters vs the 4 before, pooled
  let yoy: EntityFigures['yoy'] = null;
  {
    const q8 = completeQuarters(today, 8);
    const prev = q8.slice(0, 4).flatMap(q => byQ.get(q) || []);
    const cur = q8.slice(4).flatMap(q => byQ.get(q) || []);
    if (prev.length >= MIN_YOY_N && cur.length >= MIN_YOY_N) {
      const a = med(cur), b = med(prev);
      if (b > 0) yoy = { pct: Math.round((a / b - 1) * 1000) / 10, n: Math.min(prev.length, cur.length), basis: 'median' };
    }
  }

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
