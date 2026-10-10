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
import { MIN_MED_N, dayMinus, isSaleDay, type SoldPoint } from './stats';
import { medianSorted } from '../stats';

export interface FacetRow { key: string; label: string; n: number; n12: number; med12m: number | null }
export interface FacetGroup {
  key: 'grade' | 'lang' | 'object'; label: string; rows: FacetRow[];
  /** the clean `cat:sub` lens the split reads (an entity with several: the one
   *  that sold most in the trailing year — a vintage PSA 9 and a modern PSA 10
   *  never share a ladder) */
  scope?: string;
}

/** which facet groups an entity carries, by id (null = none). (r7) an
 *  athlete reads the grade ladder over their graded / raw cards. */
export function facetGroupsOf(id: string): FacetGroup['key'][] | null {
  if (id.startsWith('sj:tcg|') || id.startsWith('st:tcg|')) return ['grade', 'lang'];
  if (id.startsWith('sj:science|')) return ['object'];
  if (id.startsWith('pl:')) return ['grade'];
  return null;
}

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
const GROUP_DEF: Record<FacetGroup['key'], { label: string; rows: RowDef[] }> = {
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

/** every facet group of one entity from its stamped sold points. A group is
 *  dropped when fewer than two of its rows hold a sale (one row is no split). */
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
  const multi = new Set(all.map(r => r.lens)).size > 1;
  const pts = multi && scope ? all.filter(r => r.lens === scope) : all;
  const out: FacetGroup[] = [];
  for (const g of groups) {
    const def = GROUP_DEF[g];
    const acc = def.rows.map(() => ({ n: 0, p12: [] as number[] }));
    for (const r of pts) {
      const s = new Set(r.fx);
      const i = def.rows.findIndex(d => d.test(s));
      if (i < 0) continue;
      acc[i].n++;
      if (r.d > from12) acc[i].p12.push(r.p);
    }
    // a rung the build cannot split (optional, under the median gate) folds
    // back into "Other graded" so the ladder still sums to its lens
    const fr: FacetRow[] = [];
    let foldN = 0;
    const foldP: number[] = [];
    def.rows.forEach((d, i) => {
      const row = { key: d.key, label: d.label, n: acc[i].n, n12: acc[i].p12.length, med12m: acc[i].p12.length >= MIN_MED_N ? med(acc[i].p12) : null };
      if (d.optional && row.med12m == null) { foldN += row.n; foldP.push(...acc[i].p12); return; }
      if (d.key === 'graded-other' && (foldN || foldP.length)) {
        row.n += foldN;
        const ps = acc[i].p12.concat(foldP);
        row.n12 = ps.length;
        row.med12m = ps.length >= MIN_MED_N ? med(ps) : null;
      }
      fr.push(row);
    });
    if (fr.filter(r => r.n > 0).length >= 2) out.push({ key: g, label: def.label, rows: fr, ...(multi && scope ? { scope } : {}) });
  }
  return out.length ? out : null;
}
