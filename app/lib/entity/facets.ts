/**
 * entity/facets.ts — the kind modules' splits that the taxonomy lens can't
 * make (makers overhaul P2, Oct 10 2026).
 *
 * A Pokémon is read by GRADE (raw · PSA 9 · PSA 10 · other slabs) and by
 * LANGUAGE; a mission by what the object IS (flown · signed · the rest). Both
 * cuts speak the live chips' vocabulary — app/lib/facets lotFacets, the very
 * reader the lot browser's facet chips filter with — so "PSA 10" on the
 * entity page and "PSA 10" in its live book are the same lots.
 *
 * The build (scripts/emit-entities) stamps each sold point of a facet-bearing
 * entity with its facet keys (`fx`) and writes `facets` into the entity's
 * detail. Medians follow app/lib/entity/stats: the trailing 365 days, printed
 * only at n ≥ MIN_MED_N, the n always beside it.
 */
import { lotFacets, lotGradeNum, type FacetLot } from '../facets';
import { teamSeasonOf } from '../subject-groups';
import { MIN_MED_N, dayMinus, isSaleDay, type SoldPoint } from './stats';
import { medianSorted } from '../stats';

export interface FacetRow { key: string; label: string; n: number; n12: number; med12m: number | null }
export interface FacetGroup {
  key: 'grade' | 'lang' | 'object' | 'season'; label: string; rows: FacetRow[];
  /** the clean `cat:sub` lens the split reads (an entity with several: the one
   *  that sold most in the trailing year — a vintage PSA 9 and a modern PSA 10
   *  never share a ladder) */
  scope?: string;
  /** (r8) the grade ladder's basis: 'matched' — each rung's level is the SAME
   *  cards' price at that grade (gradeLadder), so `n12` counts the cards that
   *  sold at that grade AND at another one in the window, and `med12m` is the
   *  chained level (base rung = the base cards' median price). Absent: a plain
   *  12-month median per row, `n12` its sales. */
  basis?: 'matched';
  /** (r8, matched) the rung the levels chain to, the cards matched, the window in days */
  base?: string;
  cards?: number;
  days?: number;
}

/** which facet groups an entity carries, by id (null = none). (r7) an
 *  athlete reads the grade ladder over their graded / raw cards. */
export function facetGroupsOf(id: string): FacetGroup['key'][] | null {
  if (id.startsWith('sj:tcg|') || id.startsWith('st:tcg|')) return ['grade', 'lang'];
  if (id.startsWith('sj:science|')) return ['object'];
  if (id.startsWith('pl:')) return ['grade'];
  // (r8) one team entity, every season — the season is its cut
  if (id.startsWith('sj:sports|t:')) return ['season'];
  return null;
}
/** (r8) a team lot's season facet key */
export const seasonKey = (season: string) => `season:${season}`;

/** the keys the grade ladder reads (an athlete's points carry only these —
 *  the nightly holds every player's sold cards in memory) */
const GRADE_FX = new Set(['raw', 'graded', 'psa', 'bgs', 'cgc', 'sgc', 'tag', 'g10', 'g95', 'g9', 'g7', 'g6', 'gauth']);
/** a graded point's exact grade key ('gn:8', 'gn:9.5') — the chips bucket 7–8.5 as one */
const gradeKey = (n: number) => `gn:${n}`;

/** the facet keys one sold lot carries, for an entity that reads facets
 *  (undefined: the entity reads none — the point carries nothing) */
export function facetKeysFor(id: string, l: FacetLot): string[] | undefined {
  const groups = facetGroupsOf(id);
  if (!groups) return undefined;
  if (groups.includes('season')) {
    const s = teamSeasonOf(l.title);
    return s ? [seasonKey(s)] : [];
  }
  const keys = Array.from(lotFacets(l));
  if (!groups.includes('grade')) return keys;
  const g = lotGradeNum(l);
  const out = id.startsWith('pl:') ? keys.filter(k => GRADE_FX.has(k)) : keys;
  if (g != null) out.push(gradeKey(g));
  return out;
}
/** a point carries a grade read (raw or a slab) */
const hasGradeFx = (fx: readonly string[] | undefined) => !!fx && (fx.includes('raw') || fx.includes('graded'));

interface RowDef {
  key: string; label: string; test: (fx: ReadonlySet<string>) => boolean;
  /** (r7) printed only where its n allows a median — a BGS / CGC rung that
   *  sold under MIN_MED_N times in the trailing year is left off, not shown thin */
  optional?: true;
}
/** one grader at one exact grade ('gn:' keys: facetKeysFor) */
const at = (co: string, n: number) => (s: ReadonlySet<string>) => s.has(co) && s.has(gradeKey(n));
/** the ladder's named rungs — "Other graded" is every slab none of them takes */
const GRADE_RUNGS: RowDef[] = [
  { key: 'raw', label: 'Raw', test: s => s.has('raw') },
  { key: 'psa-8', label: 'PSA 8', test: at('psa', 8) },
  // a point stamped before the exact-grade key (no 'gn:') still reads PSA 9 / 10 off the chip buckets
  { key: 'psa-9', label: 'PSA 9', test: s => s.has('psa') && s.has('g9') },
  { key: 'psa-10', label: 'PSA 10', test: s => s.has('psa') && s.has('g10') },
  { key: 'bgs-9.5', label: 'BGS 9.5', test: at('bgs', 9.5), optional: true },
  { key: 'bgs-10', label: 'BGS 10', test: at('bgs', 10), optional: true },
  { key: 'cgc-9.5', label: 'CGC 9.5', test: at('cgc', 9.5), optional: true },
  { key: 'cgc-10', label: 'CGC 10', test: at('cgc', 10), optional: true },
  { key: 'sgc-10', label: 'SGC 10', test: at('sgc', 10), optional: true },
];
const GROUP_DEF: Record<Exclude<FacetGroup['key'], 'season'>, { label: string; rows: RowDef[] }> = {
  grade: {
    label: 'By grade',
    rows: [
      ...GRADE_RUNGS,
      { key: 'graded-other', label: 'Other graded', test: s => s.has('graded') && !GRADE_RUNGS.some(d => d.key !== 'raw' && d.test(s)) },
    ],
  },
  lang: {
    label: 'By language',
    rows: [
      { key: 'lang-en', label: 'English', test: s => s.has('lang-en') },
      { key: 'lang-ja', label: 'Japanese', test: s => s.has('lang-ja') },
      { key: 'lang-zh', label: 'Chinese', test: s => s.has('lang-zh') },
    ],
  },
  object: {
    label: 'By object',
    rows: [
      { key: 'flown', label: 'Flown', test: s => s.has('flown') },
      { key: 'auto', label: 'Signed', test: s => s.has('auto') && !s.has('flown') },
      { key: 'other', label: 'Everything else', test: s => !s.has('flown') && !s.has('auto') },
    ],
  },
};

const med = (ps: number[]) => Math.round(medianSorted(ps.slice().sort((a, b) => a - b)));

/** (r8) the grade ladder's window: grade premiums move slowly, and a card that
 *  sold at two grades inside one year is rare — the same cards over three years */
export const LADDER_DAYS = 3 * 365;
/** the core rungs a matched ladder must climb in order (a level that falls as
 *  the grade rises is noise the ladder never prints) */
const CORE_ORDER = ['raw', 'psa-8', 'psa-9', 'psa-10'];
/** the rung a matched ladder chains to, in preference order (the first that enough cards price) */
const BASE_ORDER = ['psa-9', 'psa-10', 'psa-8', 'raw'];

export interface GradeLadder {
  /** per rung (the keys' order): the chained level in dollars, null = not printed */
  levels: (number | null)[];
  /** per rung: the matched cards that price it */
  cards: number[];
  /** the base rung's key */
  base: string;
  /** cards that sold at two or more rungs in the window */
  matched: number;
}

/**
 * (r8) THE MATCHED GRADE LADDER. A rung's plain median is a different basket
 * of cards at each grade — Mantle's PSA 10s are 1990s inserts, his PSA 9s
 * 1950s Topps — so the ladder read upside down ($215 PSA 10 under an $8,224
 * PSA 9). This prices the SAME cards: every card identity (SoldPoint.kg, the
 * card without its grade) that sold at two or more rungs in the window gives
 * its median log price per rung; a two-way fit (log p = card + rung, least
 * squares by alternating means) reads each rung's premium over the same cards,
 * chained to the base rung through every card that links them. A rung prints
 * when MIN_MED_N cards price it and it connects to the base; the base prints
 * the median price those base cards sold at, every other rung that times its
 * premium. A core ladder that still falls as the grade rises prints no level.
 * `rungOf` < 0 (or a key 'graded-other': many grades in one row) never enters.
 */
export function gradeLadder(pts: readonly SoldPoint[], rungOf: (r: SoldPoint) => number, keys: readonly string[], today: string): GradeLadder | null {
  const from = dayMinus(today, LADDER_DAYS);
  const cell = new Map<string, Map<number, number[]>>();
  for (const r of pts) {
    if (!r.kg || r.d <= from || r.d > today) continue;
    const i = rungOf(r);
    if (i < 0 || keys[i] === 'graded-other') continue;
    let m = cell.get(r.kg);
    if (!m) cell.set(r.kg, m = new Map());
    (m.get(i) || m.set(i, []).get(i)!).push(r.p);
  }
  // per card: its median price per rung — cards seen at two rungs or more only
  const ids: { y: Map<number, number>; raw: Map<number, number> }[] = [];
  cell.forEach(m => {
    if (m.size < 2) return;
    const y = new Map<number, number>(), raw = new Map<number, number>();
    m.forEach((ps, i) => { const v = medianSorted(ps.slice().sort((a, b) => a - b)); raw.set(i, v); y.set(i, Math.log(v)); });
    ids.push({ y, raw });
  });
  const R = keys.length;
  if (!ids.length) return { levels: keys.map(() => null), cards: new Array<number>(R).fill(0), base: BASE_ORDER[0], matched: 0 };
  const cards = new Array<number>(R).fill(0);
  for (const c of ids) c.y.forEach((_, i) => { cards[i]++; });
  const bk = BASE_ORDER.find(k => { const i = keys.indexOf(k); return i >= 0 && cards[i] >= MIN_MED_N; });
  if (!bk) return { levels: keys.map(() => null), cards, base: BASE_ORDER[0], matched: ids.length };
  const base = keys.indexOf(bk);
  // the rungs linked to the base through shared cards (union-find)
  const par = keys.map((_, i) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  for (const c of ids) { const rs = Array.from(c.y.keys()); for (let j = 1; j < rs.length; j++) par[find(rs[j])] = find(rs[0]); }
  // alternating means: a_card = mean(y − b), b_rung = mean(y − a), b_base = 0
  const a = ids.map(c => { let s = 0; c.y.forEach(v => { s += v; }); return s / c.y.size; });
  const b = new Array<number>(R).fill(0);
  for (let it = 0; it < 500; it++) {
    const sum = new Array<number>(R).fill(0), cnt = new Array<number>(R).fill(0);
    ids.forEach((c, k) => c.y.forEach((v, i) => { sum[i] += v - a[k]; cnt[i]++; }));
    for (let i = 0; i < R; i++) b[i] = cnt[i] ? sum[i] / cnt[i] : 0;
    let delta = 0;
    ids.forEach((c, k) => {
      let s = 0;
      c.y.forEach((v, i) => { s += v - b[i]; });
      const na = s / c.y.size;
      delta = Math.max(delta, Math.abs(na - a[k]));
      a[k] = na;
    });
    if (delta < 1e-9) break;
  }
  // the base rung's dollars: the median price the base cards sold at there
  const basePs = ids.filter(c => c.raw.has(base)).map(c => c.raw.get(base)!).sort((x, y) => x - y);
  const anchor = medianSorted(basePs);
  const levels = keys.map((_, i) => (cards[i] >= MIN_MED_N && find(i) === find(base) ? Math.round(anchor * Math.exp(b[i] - b[base])) : null));
  // a raw level at or above a slab's is a raw read that is no raw card (a lot,
  // a slab the title names oddly) — the raw rung alone leaves the ladder
  const ri = keys.indexOf('raw');
  const slabs = CORE_ORDER.slice(1).map(k => levels[keys.indexOf(k)]).filter((v): v is number => v != null);
  if (ri >= 0 && levels[ri] != null && slabs.length && levels[ri]! >= Math.min(...slabs)) levels[ri] = null;
  // a core ladder that still falls as the grade rises prints nothing
  let prev = -Infinity;
  for (const k of CORE_ORDER) {
    const i = keys.indexOf(k);
    const v = i >= 0 ? levels[i] : null;
    if (v == null) continue;
    if (v < prev) return { levels: keys.map(() => null), cards, base: bk, matched: ids.length };
    prev = v;
  }
  return { levels, cards, base: bk, matched: ids.length };
}

/** every facet group of one entity from its stamped sold points. A group is
 *  dropped when fewer than two of its rows hold a sale (one row is no split);
 *  a row that never sold is left off. */
export function facetSplits(id: string, rows: readonly SoldPoint[], today: string): FacetGroup[] | null {
  const groups = facetGroupsOf(id);
  if (!groups) return null;
  // (r7) an athlete's ladder reads only the points that carry a grade (cards,
  // raw or slabbed) — their memorabilia never picks the ladder's lens
  const all = rows.filter(r => r.p > 0 && isSaleDay(r.d) && r.d <= today && r.fx && (!id.startsWith('pl:') || hasGradeFx(r.fx)));
  const from12 = dayMinus(today, 365);
  // one lens: the dominant one over the trailing year, else all-time (ties: the key)
  const lensN = new Map<string, number>();
  const recent = all.filter(r => r.d > from12);
  for (const r of recent.length ? recent : all) lensN.set(r.lens, (lensN.get(r.lens) || 0) + 1);
  let scope: string | null = null, best = -1;
  lensN.forEach((n, k) => { if (n > best || (n === best && scope !== null && k < scope)) { best = n; scope = k; } });
  // (r8) a team's seasons span every lens (a signed ball, a team card) — no lens cut
  const multi = !groups.includes('season') && new Set(all.map(r => r.lens)).size > 1;
  const pts = multi && scope ? all.filter(r => r.lens === scope) : all;
  const out: FacetGroup[] = [];
  for (const g of groups) {
    const def = g === 'season' ? seasonDef(pts) : GROUP_DEF[g];
    const acc = def.rows.map(() => ({ n: 0, p12: [] as number[] }));
    const rungOf = (r: SoldPoint) => { const s = new Set(r.fx); return def.rows.findIndex(d => d.test(s)); };
    for (const r of pts) {
      const i = rungOf(r);
      if (i < 0) continue;
      acc[i].n++;
      if (r.d > from12) acc[i].p12.push(r.p);
    }
    // (r8) the grade ladder prices the same cards at each grade (gradeLadder)
    const lad = g === 'grade' ? gradeLadder(pts, rungOf, def.rows.map(d => d.key), today) : null;
    // a rung the build cannot split (optional, under its gate) folds back into
    // "Other graded" so the ladder still sums to its lens
    const fr: FacetRow[] = [];
    let foldN = 0;
    const foldP: number[] = [];
    def.rows.forEach((d, i) => {
      const row = lad
        ? { key: d.key, label: d.label, n: acc[i].n, n12: lad.cards[i], med12m: lad.levels[i] }
        : { key: d.key, label: d.label, n: acc[i].n, n12: acc[i].p12.length, med12m: acc[i].p12.length >= MIN_MED_N ? med(acc[i].p12) : null };
      if (d.optional && row.med12m == null) { foldN += row.n; foldP.push(...acc[i].p12); return; }
      if (d.key === 'graded-other') {
        row.n += foldN;
        if (lad) { row.n12 = 0; row.med12m = null; }
        else if (foldP.length) {
          const ps = acc[i].p12.concat(foldP);
          row.n12 = ps.length;
          row.med12m = ps.length >= MIN_MED_N ? med(ps) : null;
        }
      }
      if (row.n > 0) fr.push(row);
    });
    if (fr.length < 2) continue;
    const grp: FacetGroup = { key: g, label: def.label, rows: fr, ...(multi && scope ? { scope } : {}) };
    if (lad) Object.assign(grp, { basis: 'matched' as const, base: lad.base, cards: lad.matched, days: LADDER_DAYS });
    out.push(grp);
  }
  return out.length ? out : null;
}

/** (r8) a team's seasons as rows: the seasons sold at least MIN_MED_N times,
 *  most sold first (at most SEASON_ROWS), then every other season, then the
 *  lots that name none */
export const SEASON_ROWS = 8;
function seasonDef(pts: readonly SoldPoint[]): { label: string; rows: RowDef[] } {
  const n = new Map<string, number>();
  for (const r of pts) for (const k of r.fx || []) if (k.startsWith('season:')) n.set(k, (n.get(k) || 0) + 1);
  const top = Array.from(n.entries()).filter(([, c]) => c >= MIN_MED_N)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, SEASON_ROWS).map(([k]) => k);
  const named = new Set(top);
  const anySeason = (s: ReadonlySet<string>) => Array.from(s).some(k => k.startsWith('season:'));
  return {
    label: 'By season',
    rows: [
      ...top.map(k => ({ key: k, label: k.slice(7), test: (s: ReadonlySet<string>) => s.has(k) })),
      { key: 'season-other', label: 'Other seasons', test: (s: ReadonlySet<string>) => anySeason(s) && !Array.from(s).some(k => named.has(k)) },
      { key: 'season-none', label: 'No season named', test: (s: ReadonlySet<string>) => !anySeason(s) },
    ],
  };
}

/** (r8) the matched grade ladder's basis, in words (the panel and the page say it alike) */
export function ladderNote(g: { rows: readonly { key: string; label: string }[]; base?: string; cards?: number; days?: number }): string {
  const base = g.rows.find(r => r.key === g.base)?.label ?? 'the base grade';
  const yrs = g.days ? Math.round(g.days / 365) : 3;
  return `Each grade priced on the same cards: the ${(g.cards ?? 0).toLocaleString()} ${g.cards === 1 ? 'card' : 'cards'} that sold at two grades or more in the past ${yrs} years, each grade's premium over ${base} on those cards, chained to what they sold for at ${base}. A ladder that still falls as the grade rises prints no prices`;
}

