/**
 * search-tokens.ts — the ONE tokenizer the sold-title index is built with
 * (scripts/emit-search-index.ts) and queried with (app/lib/search-index.ts).
 * Both sides must cut a title into the same tokens or a typed word never
 * meets its posting list, so this module is pure (no fs, no DOM) and shared.
 *
 *   'CARTIER: "PANTHÈRE" Brooch'  →  ['cartier', 'panthere', 'brooch']
 *   'Ref. 5711/1A-010'            →  ['ref', '5711', '1a', '010']
 *
 * Diacritics fold (è → e) so a collector typing 'panthere' finds 'Panthère'.
 * Single characters and a short stop-list never index — they would land in
 * every shard and narrow nothing.
 */

const STOP = new Set([
  'the', 'of', 'and', 'an', 'in', 'with', 'for', 'by', 'on', 'to', 'at', 'from', 'or', 'as', 'its', 'his', 'her',
  'de', 'la', 'le', 'les', 'des', 'du', 'et', 'di', 'da', 'del', 'el', 'lo', 'un', 'une',
]);

/** lower-case, diacritics folded — the comparison form for labels and keys */
export function foldText(s: string): string {
  return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** every indexable token in a string, in order, duplicates kept */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const t of foldText(s).split(/[^a-z0-9]+/)) {
    if (t.length < 2 || STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** the shard a token lives in: its first two characters ('5711' → '57'), or
    its first three when that two-char shard was too heavy and got split
    (`split` = the two-char prefixes that were; tokens of exactly two chars
    stay in the two-char file either way) */
export function shardOf(token: string, split?: ReadonlySet<string>): string {
  const p2 = token.slice(0, 2);
  return split && split.has(p2) && token.length >= 3 ? token.slice(0, 3) : p2;
}

/** a reference key reduced to its alphanumerics — '5711/1a' → '57111a' —
    so '5711-1A', '5711/1A' and '57111a' all compare equal */
export function refCompact(s: string): string {
  return foldText(s).replace(/[^a-z0-9]/g, '');
}

/** the sold-doc row the emitter writes and the palette reads:
    [id, title, maker slug, price USD (all-in, rounded), sale date, house] */
export type SoldDoc = [string, string, string, number, string, string];

/** one sale on a reference's ledger: [date, price USD, lot id, house, title, image|null] */
export type RefSale = [string, number, string, string, string, string | null];

/** the search-meta.json shape */
export interface SearchMeta {
  v: string;
  /** docs per d-<n>.json block */
  block: number;
  docs: number;
  /** token shard keys that exist (t-<key>.json) */
  shards: string[];
  /** two-char prefixes whose tokens of 3+ chars live in three-char shards */
  split: string[];
  /** tokens too common to carry postings (they match via the doc's own text) */
  common: string[];
  /** [maker, ref, n, median USD, model line?] — every reference with a
   *  dossier; the 5th slot (Oct 10) is its line when its titles name one */
  refs: ([string, string, number, number] | [string, string, number, number, string])[];
  generatedAt: string;
}
