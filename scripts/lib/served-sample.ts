/**
 * served-sample.ts — WHICH sold cards / Pokémon reach the wire (r7, Oct 10).
 *
 * Sold sports cards + graded cards and sold Pokémon stay corpus-only except a
 * SAMPLE: the newest 1,500 + the top 500 by price per group (build-market's
 * isCorpusOnly). The entity pages read the FULL corpus, so their result rows
 * can name a lot no served file holds — a /lot link that opens "This lot isn't
 * on the book" (QA2 Q2: 19 of 203). One function picks the sample for both
 * the served write and the entity emitter, so a result row links only where
 * the lot page can open it. Deterministic (ties broken by id): the corpus
 * order the two callers see differs.
 */
type Row = { id?: unknown; artist?: unknown; status?: unknown; realizedUsd?: unknown; saleDate?: unknown };

export const SAMPLE_NEWEST = 1500;
export const SAMPLE_TOP = 500;
/** the sampled groups: one sample per group */
export const SAMPLED_GROUPS: Readonly<Record<string, 'cards' | 'pokemon'>> = {
  'sports-cards': 'cards', 'graded-cards': 'cards', pokemon: 'pokemon',
};

/** a SOLD card / Pokémon row: served only when the sample holds it (an
 *  unpriced one never is — build-market's isCorpusOnly) */
export function inSampledGroup(l: Row): boolean {
  return l.status === 'sold' && typeof l.artist === 'string' && Object.prototype.hasOwnProperty.call(SAMPLED_GROUPS, l.artist);
}

/** the ids of the served sample over every sold card / Pokémon row */
export function servedSoldSample(rows: readonly Row[]): Set<string> {
  const groups = new Map<string, { id: string; d: string; p: number }[]>();
  const seen = new Set<string>();
  for (const l of rows) {
    if (!inSampledGroup(l) || !(Number(l.realizedUsd) > 0)) continue;
    const id = String(l.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const g = SAMPLED_GROUPS[l.artist as string];
    let a = groups.get(g);
    if (!a) groups.set(g, a = []);
    a.push({ id, d: String(l.saleDate || ''), p: Number(l.realizedUsd) });
  }
  const out = new Set<string>();
  const byId = (x: { id: string }, y: { id: string }) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  groups.forEach(a => {
    a.slice().sort((x, y) => (x.d < y.d ? 1 : x.d > y.d ? -1 : byId(x, y))).slice(0, SAMPLE_NEWEST).forEach(r => out.add(r.id));
    a.slice().sort((x, y) => y.p - x.p || byId(x, y)).slice(0, SAMPLE_TOP).forEach(r => out.add(r.id));
  });
  return out;
}
