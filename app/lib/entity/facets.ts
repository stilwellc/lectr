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
import { lotFacets, type FacetLot } from '../facets';
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

/** which facet groups an entity carries, by id (null = none) */
export function facetGroupsOf(id: string): FacetGroup['key'][] | null {
  if (id.startsWith('sj:tcg|') || id.startsWith('st:tcg|')) return ['grade', 'lang'];
  if (id.startsWith('sj:science|')) return ['object'];
  return null;
}

/** the facet keys one sold lot carries, for an entity that reads facets
 *  (undefined: the entity reads none — the point carries nothing) */
export function facetKeysFor(id: string, l: FacetLot): string[] | undefined {
  if (!facetGroupsOf(id)) return undefined;
  return Array.from(lotFacets(l));
}

interface RowDef { key: string; label: string; test: (fx: ReadonlySet<string>) => boolean }
const GROUP_DEF: Record<FacetGroup['key'], { label: string; rows: RowDef[] }> = {
  grade: {
    label: 'By grade',
    rows: [
      { key: 'raw', label: 'Raw', test: s => s.has('raw') },
      { key: 'psa-9', label: 'PSA 9', test: s => s.has('psa') && s.has('g9') },
      { key: 'psa-10', label: 'PSA 10', test: s => s.has('psa') && s.has('g10') },
      { key: 'graded-other', label: 'Other graded', test: s => s.has('graded') && !(s.has('psa') && (s.has('g9') || s.has('g10'))) },
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
  const all = rows.filter(r => r.p > 0 && isSaleDay(r.d) && r.d <= today && r.fx);
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
    const fr: FacetRow[] = def.rows.map((d, i) => ({
      key: d.key, label: d.label, n: acc[i].n, n12: acc[i].p12.length,
      med12m: acc[i].p12.length >= MIN_MED_N ? med(acc[i].p12) : null,
    }));
    if (fr.filter(r => r.n > 0).length >= 2) out.push({ key: g, label: def.label, rows: fr, ...(multi && scope ? { scope } : {}) });
  }
  return out.length ? out : null;
}
