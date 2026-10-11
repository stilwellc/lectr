/**
 * search-query.ts — how a typed query is read, shared by the ⌘K palette
 * (palette-search.ts) and the feed search box (lot-browser feedPass):
 * folded words, nicknames + card-year shorthand, typo repair against a
 * vocabulary. A leaf module (lot-labels only), so the feed path does not pull
 * the palette's entity / reference code.
 */
import { searchTextOf } from './lot-labels';
import { editDistance } from './search-tokens';

export { editDistance };

/** case- and accent-blind text ("Prouve" finds Prouvé) */
export function fold(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* ── nicknames + shorthand ─────────────────────────────────────────────── */

/** whole-word (or phrase) shorthand → what the book calls it. Folded. */
export const ALIASES: [string, string][] = [
  ['the mick', 'mickey mantle'], ['the commerce comet', 'mickey mantle'],
  ['mj', 'michael jordan'], ['air jordan', 'michael jordan'],
  ['the babe', 'babe ruth'], ['bambino', 'babe ruth'], ['the bambino', 'babe ruth'],
  ['the great one', 'wayne gretzky'], ['great one', 'wayne gretzky'],
  ['wemby', 'victor wembanyama'], ['king james', 'lebron james'], ['lbj', 'lebron james'],
  ['black mamba', 'kobe bryant'], ['tb12', 'tom brady'], ['say hey kid', 'willie mays'],
  ['the kid', 'ken griffey'], ['shotime', 'shohei ohtani'], ['the greatest', 'muhammad ali'],
  ['zard', 'charizard'], ['pkmn', 'pokemon'], ['poke', 'pokemon'], ['pkm', 'pokemon'],
  ['jmb', 'jean michel basquiat'], ['samo', 'jean michel basquiat'],
  ['ap', 'audemars piguet'], ['pp', 'patek philippe'], ['rlx', 'rolex'],
  ['speedy', 'speedmaster'], ['rc', 'rookie'], ['1st ed', '1st edition'],
  ['star war', 'star wars'], ['the king', 'elvis presley'], ['fab four', 'the beatles'],
];

export const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'with', 'for', 'by', 'on', 'to', 'at', 'from', 'or', 'de', 'la', 'le']);
/** card brands: a two-digit year beside one is a year ("52 topps" = 1952) */
export const CARD_BRANDS = new Set(['topps', 'bowman', 'fleer', 'donruss', 'score', 'goudey', 'leaf', 'upper', 'prizm', 'panini', 'skybox', 'hoops', 'o-pee-chee', 'opc', 'base', 'jungle', 'fossil']);

/** how many edits a typed word may carry and still be the word it meant */
export const typoBudget = (w: string) => (/\d/.test(w) || w.length < 4 ? 0 : w.length < 6 ? 1 : 2);

/** nicknames + card-year shorthand applied, folded, split into words */
export function rewriteQuery(q: string): { words: string[]; typing: boolean } {
  // a dot stays inside a number ('145.022', '9.5'), nowhere else
  let s = ` ${fold(q).replace(/'/g, '').replace(/[^a-z0-9.]+/g, ' ').replace(/(^|\s)\.+|\.+(?=\s|$)/g, ' ').replace(/([a-z])\.+([a-z])/g, '$1 $2').replace(/\s+/g, ' ').trim()} `;
  for (const [from, to] of ALIASES) {
    if (s.includes(` ${from} `)) s = s.replace(` ${from} `, ` ${to} `);
  }
  const raw = s.trim().split(/\s+/).filter(Boolean);
  // "52 topps" / "topps 52" / "'86 fleer" → the four-digit year the titles print
  const words = raw.map((w, i) => {
    if (/^\d{2}$/.test(w) && (CARD_BRANDS.has(raw[i + 1]) || CARD_BRANDS.has(raw[i - 1]))) {
      return `${Number(w) >= 30 ? 19 : 20}${w}`;
    }
    return w;
  });
  return { words, typing: !/\s$/.test(q) && words.length > 0 };
}

/** a word's spellings in `vocab` within its typo budget — [] when the word is
 *  in the vocabulary, starts one of its words (still being typed), or is too
 *  short / numeric to guess at. Heaviest spellings first. */
export function spellFixes(w: string, vocab: ReadonlyMap<string, number>, byFirst: ReadonlyMap<string, string[]>): string[] {
  const budget = typoBudget(w);
  if (!budget || vocab.has(w)) return [];
  const bucket = byFirst.get(w[0]) || [];
  if (bucket.some(t => t.startsWith(w))) return [];
  // a plural of a book word is the word
  if (w.endsWith('s') && vocab.has(w.slice(0, -1))) return [w.slice(0, -1)];
  let best = budget + 1;
  let out: string[] = [];
  for (const t of bucket) {
    if (Math.abs(t.length - w.length) > budget) continue;
    const d = editDistance(w, t, budget);
    if (d < best) { best = d; out = [t]; } else if (d === best && d <= budget) out.push(t);
  }
  if (best > budget) return [];
  return out.sort((a, b) => (vocab.get(b) ?? 0) - (vocab.get(a) ?? 0)).slice(0, 3);
}

/* ── the live feed's text search (home + market landers, LotBrowser) ──── */

type FeedLot = Parameters<typeof searchTextOf>[0];
const feedHay = new WeakMap<object, string>();
const hayOf = (l: FeedLot) => {
  let h = feedHay.get(l as object);
  if (h == null) { h = fold(searchTextOf(l)); feedHay.set(l as object, h); }
  return h;
};
interface BookVocab { vocab: Map<string, number>; byFirst: Map<string, string[]> }
const bookVocab = new WeakMap<readonly object[], BookVocab>();
function vocabOfBook(lots: readonly FeedLot[]): BookVocab {
  let v = bookVocab.get(lots as readonly object[]);
  if (!v) {
    const vocab = new Map<string, number>();
    for (const l of lots) for (const t of hayOf(l).split(/[^a-z0-9]+/)) if (t.length >= 3 && !/\d/.test(t)) vocab.set(t, (vocab.get(t) ?? 0) + 1);
    const byFirst = new Map<string, string[]>();
    vocab.forEach((_, t) => { const a = byFirst.get(t[0]); if (a) a.push(t); else byFirst.set(t[0], [t]); });
    v = { vocab, byFirst };
    bookVocab.set(lots as readonly object[], v);
  }
  return v;
}

/**
 * The feed search box's matcher over a live book (W3, Oct 11). It was one
 * lowercase substring — "jordan rookie", "rolex daytona", "prouve standard
 * chair" (é) and every misspelling found nothing. Now: accent-folded words,
 * each anywhere in the lot's label vocabulary + title (searchTextOf), with
 * the palette's nicknames and card-year shorthand; a short grade number
 * stays glued to the word before it ("psa 10" is the PSA 10 slab, not a PSA
 * lot that is 8 x 10); a word NO lot in the book carries is read as the
 * book's nearest spelling ("warhole" → warhol).
 */
export function feedQueryMatcher(q: string, book: readonly FeedLot[]): (l: FeedLot) => boolean {
  const { words } = rewriteQuery(q);
  if (!words.length) return () => true;
  const terms: string[][] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (STOP.has(w) && words.length > 1) continue;
    if (/^\d{1,2}(\.\d)?$/.test(w) && terms.length && i > 0 && !/^\d/.test(words[i - 1])) {
      const prev = terms[terms.length - 1];
      terms[terms.length - 1] = prev.map(p => `${p} ${w}`);
      continue;
    }
    terms.push([w]);
  }
  let v: BookVocab | null = null;
  for (const t of terms) {
    const w = t[0];
    if (w.includes(' ') || book.some(l => hayOf(l).includes(w))) continue;
    v = v || vocabOfBook(book);
    t.push(...spellFixes(w, v.vocab, v.byFirst));
  }
  return l => { const h = hayOf(l); return terms.every(t => t.some(w => h.includes(w))); };
}
