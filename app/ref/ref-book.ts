/**
 * ref-book.ts — the reference book as a reader sees it: one row per DISPLAY
 * label. refs.json can carry two keys that print the same name — 'panthère'
 * and 'panthere' are distinct catalogue spellings of one Cartier line — and a
 * list that prints "Panthère" twice reads as a bug. The deeper key keeps the
 * row (its dossier is the canonical one); the shallower one rides along as
 * `variants` so the row can say so and the dossier can link across.
 */
import { refLabel } from '../utils';
import { foldText } from '../lib/search-tokens';

export interface RefBookInput { key?: string; maker: string; ref: string; n: number }
export type RefBookRow<T extends RefBookInput> = T & { label: string; variants: T[] };

export function dedupeRefs<T extends RefBookInput>(rows: T[]): RefBookRow<T>[] {
  const by = new Map<string, RefBookRow<T>>();
  const sorted = rows.slice().sort((a, b) => b.n - a.n);
  for (const r of sorted) {
    const label = refLabel(r.ref);
    const k = `${r.maker}|${foldText(label)}`;
    const cur = by.get(k);
    if (cur) cur.variants.push(r);
    else by.set(k, { ...r, label, variants: [] });
  }
  return Array.from(by.values());
}

/** the other catalogue spellings of a reference's display label */
export function variantsOf<T extends RefBookInput>(rows: T[], maker: string, ref: string): T[] {
  const label = foldText(refLabel(ref));
  return rows.filter(r => r.maker === maker && r.ref !== ref && foldText(refLabel(r.ref)) === label);
}
