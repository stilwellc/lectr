/**
 * facets.ts — the cuts collectors shop by INSIDE one category (Oct 9): a card
 * buyer narrows by Graded / Raw / Rookie / Autographed / Relic / Numbered and
 * by era; an entertainment buyer by Film & TV vs Music. Read from the title at
 * view time with the one card parser (app/lib/cards.parseCard — ~13µs a lot),
 * memoized per lot object; nothing is stamped on the served payload.
 *
 * Keys are flat strings so the filter is one URL list (`fx=graded,rookie`).
 * Era keys are mutually exclusive (one era at a time); the rest AND together.
 */
import { parseCard } from './cards';
import { taxonOf, type CatKey } from './taxonomy';

export interface FacetDef { key: string; label: string; group: 'kind' | 'era' | 'domain' }

const CARD_KIND: FacetDef[] = [
  { key: 'graded', label: 'Graded', group: 'kind' },
  { key: 'raw', label: 'Raw', group: 'kind' },
  { key: 'rookie', label: 'Rookie', group: 'kind' },
  { key: 'auto', label: 'Autographed', group: 'kind' },
  { key: 'relic', label: 'Relic', group: 'kind' },
  { key: 'numbered', label: 'Numbered', group: 'kind' },
];
const CARD_ERA: FacetDef[] = [
  { key: 'era-prewar', label: 'Pre-war', group: 'era' },
  { key: 'era-vintage', label: '1946–79', group: 'era' },
  { key: 'era-80s90s', label: '1980–99', group: 'era' },
  { key: 'era-modern', label: '2000+', group: 'era' },
];
const ENT_DOMAIN: FacetDef[] = [
  { key: 'film-tv', label: 'Film & TV', group: 'domain' },
  { key: 'music', label: 'Music', group: 'domain' },
];

/** the facets a category offers (empty = none) */
export function facetsFor(cat: CatKey | null): FacetDef[] {
  if (cat === 'sports-cards') return [...CARD_KIND, ...CARD_ERA];
  if (cat === 'tcg') return CARD_KIND.filter(f => f.key === 'graded' || f.key === 'raw');
  if (cat === 'entertainment') return ENT_DOMAIN;
  return [];
}

export const FACET_LABEL: Record<string, string> = Object.fromEntries(
  [...CARD_KIND, ...CARD_ERA, ...ENT_DOMAIN].map(f => [f.key, f.label])
);
const ERA_KEYS = new Set(CARD_ERA.map(f => f.key));
export const isEraFacet = (k: string) => ERA_KEYS.has(k);
const GROUP: Record<string, string> = Object.fromEntries([
  ...CARD_ERA.map(f => [f.key, 'era']), ...ENT_DOMAIN.map(f => [f.key, 'domain']),
  ['graded', 'slab'], ['raw', 'slab'],
]);
/** one era, one domain, graded-or-raw: picking one replaces its sibling */
const rivals = (a: string, b: string) => a !== b && GROUP[a] != null && GROUP[a] === GROUP[b];

const RELIC_RE = /\b(relic|patch|swatch|jersey (?:card|relic)|game[- ](?:used|worn) (?:card|relic|patch)|memorabilia card|bat (?:card|relic)|logoman)\b/i;
/** a sealed box's "Possible … Rookie Cards" is the box's pitch, not the lot */
const SEALED_SUBS = new Set(['sealed-wax', 'sealed']);

type FacetLot = { title?: string | null; artist?: string | null; subCat?: string | null; drill?: string | null };
const memo = new WeakMap<object, ReadonlySet<string>>();

function eraOf(year: string | null | undefined): string | null {
  const y = parseInt(String(year || ''), 10);
  if (!Number.isFinite(y) || y < 1850 || y > 2100) return null;
  return y < 1946 ? 'era-prewar' : y < 1980 ? 'era-vintage' : y < 2000 ? 'era-80s90s' : 'era-modern';
}

/** every facet key one lot carries */
export function lotFacets(l: FacetLot): ReadonlySet<string> {
  const hit = memo.get(l as object);
  if (hit) return hit;
  const out = new Set<string>();
  const t = taxonOf(l);
  if (t.cat === 'sports-cards' || t.cat === 'tcg') {
    const title = String(l.title || '');
    const id = parseCard(title);
    const sealed = SEALED_SUBS.has(t.sub);
    if (!sealed && !id.notCard) {
      if (id.gradeCo || id.gradeTag) out.add('graded');
      else if (!id.multi && t.sub !== 'lots') out.add('raw');
      if (t.cat === 'sports-cards') {
        if (id.rookie) out.add('rookie');
        if (id.auto) out.add('auto');
        if (id.serialOf) out.add('numbered');
        if (RELIC_RE.test(title)) out.add('relic');
      }
    }
    if (t.cat === 'sports-cards') { const e = eraOf(id.year); if (e) out.add(e); }
  } else if (t.domain) {
    out.add(t.domain);
  }
  memo.set(l as object, out);
  return out;
}

/** AND across the selected facets */
export function passesFacets(l: FacetLot, fx: readonly string[]): boolean {
  if (!fx.length) return true;
  const s = lotFacets(l);
  return fx.every(k => s.has(k));
}

/** toggle one facet; picking an era replaces any other era */
export function toggleFacet(fx: readonly string[], key: string): string[] {
  if (fx.includes(key)) return fx.filter(k => k !== key);
  return [...fx.filter(k => !rivals(k, key)), key];
}

/** the category a facet row belongs to: the picked one, else the pool's only one */
export function facetCatOf(cat: CatKey | null, lots: FacetLot[]): CatKey | null {
  if (cat) return facetsFor(cat).length ? cat : null;
  let only: CatKey | null = null;
  for (const l of lots) {
    const c = taxonOf(l).cat;
    if (only && c !== only) return null;
    only = c;
  }
  return only && facetsFor(only).length ? only : null;
}

/** chip counts over `pool` with the OTHER selected facets applied; a chip that
 *  would match nothing or everything is dropped (it cuts nothing) */
export function facetChips(cat: CatKey, pool: FacetLot[], fx: readonly string[]): (FacetDef & { n: number })[] {
  const defs = facetsFor(cat);
  return defs.map(d => {
    const others = fx.filter(k => k !== d.key && !rivals(k, d.key));
    let n = 0, base = 0;
    for (const l of pool) {
      if (!passesFacets(l, others)) continue;
      base++;
      if (lotFacets(l).has(d.key)) n++;
    }
    return { ...d, n, base };
  }).filter(c => fx.includes(c.key) || (c.n > 0 && c.n < c.base)).map(({ base: _b, ...c }) => c);
}
