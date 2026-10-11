/**
 * palette-search.ts — the ⌘K palette's ranker, pure (no React, no fetch), so
 * the palette and the query-set harness run the SAME code.
 *
 * W3 SEARCH (Oct 11 2026). Measured over an 80-query set (players, Pokémon,
 * watch references, art, design, space, pop, misspellings, nicknames,
 * half-typed words) the old palette landed 68% of queries on the right row
 * first and returned NOTHING for every misspelling. What this module adds:
 *
 *   1. NICKNAMES + SHORTHAND — "the mick", "MJ", "wemby", "zard", "pkmn",
 *      "jmb", "ap"/"pp"; card-year shorthand ("52 topps" → 1952 Topps);
 *      dial nicknames ride the reference rows (search-index.ts REF_NICKNAMES).
 *   2. TYPO TOLERANCE — a word no name in the book starts with is matched
 *      within 1–2 edits (Damerau, same first letter) of the names' own words:
 *      "warhole", "pokemon charzard", "mickie mantle", "lichtenstien".
 *      A correction is only used where the typed word finds nothing as typed,
 *      so a real word ("conoid") is never "corrected" into a name ("Condo").
 *   3. DESCRIPTOR-AWARE NAMES — "jordan rookie", "babe ruth signed baseball":
 *      the name still surfaces when the other words describe the object.
 *   4. SECTIONS — Go to · Names · On the block · References · Sold archive,
 *      each with its count; the section whose best row is most specific leads
 *      (a full name match, then live lots that carry every word, then the
 *      reference book; the sold archive always last). A typed reference
 *      number ("patek 5711") puts its dossier first.
 */
import type { AuctionLot } from '../types';
import { ARTISTS, ARTIST_LABEL, MARKETS } from '../constants';
import { craftTitle, formatPrice, formatDate } from '../utils';
import { makerLineOf, labelLineOf, labelTagOf, searchTextOf } from './lot-labels';
import { RETIRED_MAKERS } from './entity/retired';
import { entityIdOf } from './entity/live';
import { priorityOf } from './priority';
import { matchRefs, refHref, type RefRow, type SoldHit } from './search-index';
import { fold, STOP, editDistance, typoBudget, rewriteQuery, spellFixes } from './search-query';

export { fold, rewriteQuery, feedQueryMatcher } from './search-query';

export type PaletteKind = 'section' | 'market' | 'maker' | 'entity' | 'sub' | 'lot' | 'ref' | 'sold';
export interface PaletteItem {
  label: string;
  hint: string;
  path: string;
  kind: PaletteKind;
  /** name rank inside the merged names (sold all time + live) */
  weight?: number;
  /** extra words this row answers to beyond its label (a sub-market's slug,
   *  a category's market) — matched at the hint tier */
  also?: string;
}
export interface PaletteEntity { id: string; label: string; hint: string; path: string; sold: number }
export type SectionKey = 'goto' | 'names' | 'live' | 'refs' | 'sold';
export interface PaletteSection { key: SectionKey; title: string; count: number | null; rows: PaletteItem[] }
export interface PaletteResult { sections: PaletteSection[]; rows: PaletteItem[] }

const toks = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** a word that, typed, also answers to these name words (the word itself
 *  still searches the lots + archive as typed) */
const SYNONYMS: Record<string, string[]> = {
  moonwatch: ['speedmaster'], pokemon: ['tcg'], pokémon: ['tcg'], sub: ['submariner'],
};
/** the market words a name answers to at the hint tier */
const MARKET_WORDS: Record<string, string> = {
  tcg: 'tcg pokemon trading cards', sports: 'sports', science: 'science space',
  culture: 'pop culture', art: 'art', design: 'design', watches: 'watches watch',
};
/** words that describe the OBJECT, not who made it: a name matched only on
 *  these is noise ("signed" → the Autographs category for "beatles signed") */
const DESCRIPTORS = new Set(('rookie rc signed sign autograph autographed auto psa bgs sgc cgc beckett jsa dna topps fleer bowman ' +
  'panini upper deck donruss prizm chrome card cards 1st first edition holo shadowless unlimited sealed box pack wax ' +
  'flown prop props worn game used jersey ball baseball football basketball bat photo photograph letter ticket poster ' +
  'original chair table lamp desk print lithograph screenprint painting drawing ceramic ceramics vase sculpture watch ' +
  'gold steel dial gilt tropical vintage rare mint gem graded lot set')
  .split(' '));
/* ── the index (built once per palette open) ───────────────────────────── */

interface NameRec { it: PaletteItem; lt: string[]; ht: string[]; fl: string; id: string | null; room: boolean }
interface LotRec { l: AuctionLot; hay: string; row: string; phrase: string; ent: string | null; prio: number }
export interface PaletteIndex {
  names: NameRec[];
  rooms: NameRec[];
  /** the live book's search text — built on first use (lotsOf), or ahead of
   *  it in an idle slot (the palette calls warmPaletteLots after opening) */
  lots: LotRec[] | null;
  upcomingLots: AuctionLot[];
  refs: RefRow[];
  refLabel: (ref: string) => string;
  /** every word a name is spelled with → the heaviest name weight using it */
  vocab: Map<string, number>;
  /** vocab bucketed by first letter (the typo search space) */
  byFirst: Map<string, string[]>;
}

/**
 * The 22 retired category pages (Graded Cards, Meteorites, Film & TV …) as
 * searchable names pointing at their CURRENT home — the slug pages are gone
 * (entity/retired), but a collector still types "meteorite".
 */
export function categoryItems(upcomingCounts: Record<string, number>): PaletteItem[] {
  return ARTISTS.filter(a => RETIRED_MAKERS[a.slug]).map(a => {
    const live = upcomingCounts[a.slug] || 0;
    const mk = MARKETS.find(m => m.key === a.market);
    return {
      label: a.label,
      hint: [`${mk?.short ?? a.market} category`, live ? `${live.toLocaleString()} live` : null].filter(Boolean).join(' · '),
      path: RETIRED_MAKERS[a.slug],
      kind: 'sub' as const,
      weight: live,
      also: `${a.slug.replace(/-/g, ' ')} ${MARKET_WORDS[a.market] || ''}`,
    };
  });
}

export function buildPaletteIndex(inp: {
  items: PaletteItem[];
  ents: PaletteEntity[];
  entMarket?: (id: string) => string | undefined;
  liveByEntity: Map<string, number>;
  upcomingLots: AuctionLot[];
  refs: RefRow[];
  refLabel: (ref: string) => string;
}): PaletteIndex {
  const names: NameRec[] = [];
  const rooms: NameRec[] = [];
  for (const it of inp.items) {
    const rec: NameRec = {
      it: it.kind === 'maker' ? { ...it, weight: Infinity } : it,
      lt: toks(it.label),
      ht: toks(`${it.hint} ${it.also || ''}${it.kind === 'sub' ? ` ${it.path.replace(/[/?=&#]+/g, ' ')}` : ''}`),
      fl: fold(it.label), id: it.kind === 'maker' ? `mk:${it.path.replace(/^\/makers\//, '')}` : null,
      room: it.kind === 'section' || it.kind === 'market',
    };
    (rec.room ? rooms : names).push(rec);
  }
  for (const e of inp.ents) {
    const live = inp.liveByEntity.get(e.id) || 0;
    const mk = inp.entMarket?.(e.id);
    names.push({
      it: {
        label: e.label,
        hint: [e.hint, live ? `${live} live` : e.sold ? `${e.sold.toLocaleString()} sold` : null].filter(Boolean).join(' · '),
        path: e.path, kind: 'entity', weight: e.sold + live,
      },
      lt: toks(e.label),
      ht: toks(`${e.hint} ${mk ? MARKET_WORDS[mk] || '' : ''}`),
      fl: fold(e.label), id: e.id, room: false,
    });
  }
  const vocab = new Map<string, number>();
  const add = (t: string, w: number) => { if (t.length >= 3 && !/^\d+$/.test(t)) vocab.set(t, Math.max(vocab.get(t) ?? 0, w)); };
  for (const r of names) {
    const w = Number.isFinite(r.it.weight ?? 0) ? (r.it.weight ?? 0) : 1e9;
    for (const t of r.lt) add(t, w);
  }
  for (const r of inp.refs) if (r.line) for (const t of toks(inp.refLabel(r.line))) add(t, r.n);
  const byFirst = new Map<string, string[]>();
  for (const t of Array.from(vocab.keys())) {
    const k = t[0];
    const a = byFirst.get(k);
    if (a) a.push(t); else byFirst.set(k, [t]);
  }
  return { names, rooms, lots: null, upcomingLots: inp.upcomingLots, refs: inp.refs, refLabel: inp.refLabel, vocab, byFirst };
}

/** the live book's folded search text — built once per book (an index
 *  rebuilt when the entity names land reuses it) */
const lotsByBook = new WeakMap<AuctionLot[], LotRec[]>();
export function lotsOf(idx: PaletteIndex): LotRec[] {
  if (!idx.lots) idx.lots = lotsByBook.get(idx.upcomingLots) ?? null;
  if (!idx.lots) {
    idx.lots = idx.upcomingLots.map(l => {
      const title = craftTitle(l.title, l.auctionHouse);
      const phrase = fold(`${makerLineOf(l).name} ${labelLineOf(l)}`);
      return {
        l,
        // what the row prints: the maker line, the label, the title
        row: `${phrase} ${fold(title)}`,
        hay: fold(`${title} ${searchTextOf(l)}`),
        phrase,
        ent: entityIdOf(l),
        prio: priorityOf(l)?.score ?? 0,
      };
    });
    lotsByBook.set(idx.upcomingLots, idx.lots);
  }
  return idx.lots;
}
/** build the live book's search text ahead of the first keystroke */
export const warmPaletteLots = (idx: PaletteIndex) => { lotsOf(idx); };

/* ── the query, normalized ─────────────────────────────────────────────── */

export interface Normalized {
  /** the folded words after nicknames + card-year shorthand */
  words: string[];
  /** per word: the name-book spellings within its typo budget, when the word
   *  as typed starts no name word (empty = typed as meant, or no idea) */
  fixes: string[][];
  /** the last word is still being typed (no trailing space) */
  typing: boolean;
}

export function normalizeQuery(q: string, idx: Pick<PaletteIndex, 'vocab' | 'byFirst'>): Normalized {
  const { words, typing } = rewriteQuery(q);
  return { words, typing, fixes: words.map(w => spellFixes(w, idx.vocab, idx.byFirst)) };
}

/**
 * The query the sold-archive index sees: nicknames and card-year shorthand
 * applied, typos left alone (the archive's own shard fixes them against the
 * archive's words — search-index.ts). A rewritten last word is whole.
 */
export function soldQueryOf(q: string, idx: Pick<PaletteIndex, 'vocab' | 'byFirst'>): string {
  const n = normalizeQuery(q, idx);
  const lastTyped = fold(q).trim().split(/\s+/).pop() || '';
  const lastAsTyped = n.typing && n.words[n.words.length - 1] === lastTyped;
  // a half-typed last word under 3 letters narrows nothing yet ('nakashima
  // co' would look up the WORD 'co') — the rest searches, as whole words
  if (lastAsTyped && lastTyped.length < 3 && n.words.length > 1) return `${n.words.slice(0, -1).join(' ')} `;
  const out = n.words.join(' ');
  return lastAsTyped ? out : `${out} `;
}

/* ── ranking ───────────────────────────────────────────────────────────── */

/** how one typed word meets a name: 0 exact · 0.5 its plural · 1 prefix ·
 *  2 typo · 3 only the hint/market words · null no */
function wordHit(w: string, fixes: string[], r: NameRec, last: boolean): number | null {
  let best: number | null = null;
  const alts = [w, ...(SYNONYMS[w] || [])];
  for (const t of r.lt) {
    for (const a of alts) {
      if (t === a) return 0;
      if (a.length >= 4 && a.endsWith('s') && t === a.slice(0, -1)) best = Math.min(best ?? 1, 0.5);
      else if (t.startsWith(a) && (a.length >= 2 || last)) best = Math.min(best ?? 1, 1);
    }
    if (best == null && fixes.includes(t)) best = 2;
  }
  if (best != null) return best;
  for (const t of r.ht) for (const a of alts) if (t === a || (a.length >= 3 && t.startsWith(a))) return 3;
  return null;
}
/** the lenient pass for a name that already met another word: within the
 *  word's typo budget of one of the name's own words */
function looseHit(w: string, r: NameRec): boolean {
  const b = typoBudget(w);
  if (!b) return false;
  return r.lt.some(t => t[0] === w[0] && editDistance(w, t, b) <= b);
}

interface Scored { r: NameRec; full: boolean; cover: number; tier: number }
function scoreName(r: NameRec, n: Normalized, content: number[], needle: string): Scored | null {
  if (r.fl === needle) return { r, full: true, cover: 1, tier: -1 };
  let met = 0, tier = 0, strong = false;
  const miss: number[] = [];
  for (const i of content) {
    const h = wordHit(n.words[i], n.fixes[i], r, n.typing && i === n.words.length - 1);
    if (h == null) { miss.push(i); continue; }
    met++;
    tier = Math.max(tier, h);
    // what makes a name worth listing on PART of the query: a whole word of
    // it (or the word still being typed) that is not a number ('8', '1952'),
    // not two letters ('jr') and not a describing word ('signed')
    const w = n.words[i];
    const last = n.typing && i === n.words.length - 1;
    if ((h < 1 || (h === 1 && last)) && w.length >= 3 && !DESCRIPTORS.has(w) && !/^\d+$/.test(w)) strong = true;
    if (h === 2 && content.length === 1) strong = true;
  }
  if (!met) return null;
  // a name that met one word may still carry a misspelled other ("micheal")
  if (miss.length && strong) {
    const rest = miss.filter(i => !looseHit(n.words[i], r));
    if (rest.length < miss.length) { met += miss.length - rest.length; tier = Math.max(tier, 2); miss.length = 0; miss.push(...rest); }
  }
  const full = miss.length === 0;
  if (!full && !strong) return null;
  return { r, full, cover: met / content.length, tier };
}

const SECTION_TITLE: Record<SectionKey, string> = {
  goto: 'Go to', names: 'Names', live: 'On the block', refs: 'References', sold: 'Sold archive',
};
const LIMIT: Record<SectionKey, number> = { goto: 3, names: 5, live: 5, refs: 4, sold: 5 };

/**
 * Ranks every source for one query into sections. `sold` is the archive's
 * answer for soldQueryOf(q) (fetched by the caller), `soldTotal` its exact
 * count when the index knows it.
 */
export function rankPalette(q: string, idx: PaletteIndex, sold: SoldHit[] = [], soldTotal: number | null = null): PaletteResult {
  const n = normalizeQuery(q, idx);
  if (!n.words.length) return { sections: [], rows: [] };
  const needle = n.words.join(' ');
  const content = n.words.map((w, i) => i).filter(i => !STOP.has(n.words[i]) && (n.words[i].length > 1 || /\d/.test(n.words[i])));
  if (!content.length) content.push(...n.words.map((_, i) => i));

  // ── Go to: the rooms + market landers, by their own label only
  const goto = idx.rooms
    .map(r => ({ r, t: r.fl === needle ? 0 : content.every(i => r.lt.some(t => t.startsWith(n.words[i]))) ? 1 : -1 }))
    .filter(x => x.t >= 0 && (x.t === 0 || needle.length >= 3))
    .sort((a, b) => a.t - b.t)
    .map(x => x.r.it);

  // ── On the block: live lots carrying every word (a typo'd word that meets
  //    no lot as typed is read as its name-book spelling)
  const lots = lotsOf(idx);
  const alts = content.map(i => {
    const w = n.words[i];
    const a = [w];
    // a word the live book carries as typed is a word, not a typo ("conoid"
    // is never read as Condo)
    if (n.fixes[i].length && lots.some(x => x.hay.includes(w))) n.fixes[i] = [];
    a.push(...n.fixes[i]);
    return a;
  });

  // ── Names: makers, categories, sub-markets, players, Pokémon, sets …
  const scored: Scored[] = [];
  for (const r of idx.names) { const s = scoreName(r, n, content, needle); if (s) scored.push(s); }
  scored.sort((a, b) => Number(b.full) - Number(a.full) || b.cover - a.cover || a.tier - b.tier
    || ((b.r.it.weight ?? 0) - (a.r.it.weight ?? 0)));
  const anyFull = scored.some(s => s.full);
  // a name that carries every word makes the partial ones noise ("paul
  // newman" lists Paul Newman, not every Paul)
  if (anyFull) scored.splice(scored.findIndex(s => !s.full) >>> 0);
  // …and among partial names, the ones meeting fewer words than the best
  // (under half the query) are noise ("jumbo royal oak" ≠ Professor Oak)
  else if (scored.length) {
    const top = scored[0].cover;
    for (let z = scored.length - 1; z > 0; z--) if (scored[z].cover < top && scored[z].cover < 0.5) scored.splice(z, 1);
  }
  const names = scored.map(s => s.r.it);
  const nameIds = new Set(scored.slice(0, 3).map(s => s.r.id).filter(Boolean) as string[]);

  const liveAll = lots.filter(x => alts.every(a => a.some(w => x.hay.includes(w))));
  // the named one's own lots first, then lots whose printed row carries every
  // word (not just the category vocabulary), the whole phrase on the label;
  // ties in the feed's own Matters-most order
  const rankLot = (x: LotRec) =>
    ((x.ent && nameIds.has(x.ent)) || nameIds.has(`mk:${x.l.artist}`) ? 0 : 4)
    + (alts.every(a => a.some(w => x.row.includes(w))) ? 0 : 2)
    + (x.phrase.includes(needle) ? 0 : 1);
  const live = liveAll
    .map(x => ({ x, r: rankLot(x) }))
    .sort((a, b) => a.r - b.r || b.x.prio - a.x.prio)
    .slice(0, LIMIT.live)
    .map(({ x }) => ({
      label: craftTitle(x.l.title, x.l.auctionHouse),
      hint: [makerLineOf(x.l).name, labelTagOf(x.l), 'on the block'].filter(Boolean).join(' · '),
      path: `/lot?id=${encodeURIComponent(x.l.id)}`,
      kind: 'lot' as const,
    }));

  // ── References: the dossier book (a typed reference number leads)
  const refHits = idx.refs.length ? matchRefs(n.words.join(' '), idx.refs, idx.refLabel, 50) : [];
  const refs = refHits.map(h => ({
    label: `${ARTIST_LABEL[h.row.maker] || h.row.maker} ${idx.refLabel(h.row.ref)}`,
    hint: `${h.row.line ? `${idx.refLabel(h.row.line)} · ` : ''}reference · ${h.row.n.toLocaleString()} sold · median ${formatPrice(h.row.med)}`,
    path: refHref(h.row),
    kind: 'ref' as const,
  }));
  const refExact = refHits.some(h => h.how !== 'name');

  // ── Sold archive
  const soldRows: PaletteItem[] = sold.map(h => ({
    label: craftTitle(h.title),
    hint: `${ARTIST_LABEL[h.maker] || h.maker} · sold ${formatPrice(h.price)} · ${h.house} · ${formatDate(h.date)}`,
    path: `/lot?id=${encodeURIComponent(h.id)}`,
    kind: 'sold' as const,
  }));

  // the section whose best row is most specific leads
  const strength: Record<SectionKey, number> = {
    goto: goto.length ? 9 : 0,
    names: !names.length ? 0 : scored[0].tier === -1 ? 4 : anyFull ? 3 : 1,
    refs: !refs.length ? 0 : refExact ? 3.5 : 2,
    live: liveAll.length ? 2.5 : 0,
    sold: soldRows.length ? 0.5 : 0,
  };
  const ORDER: SectionKey[] = ['goto', 'names', 'live', 'refs', 'sold'];
  const all: Record<SectionKey, PaletteItem[]> = { goto, names, live, refs, sold: soldRows };
  const counts: Record<SectionKey, number | null> = {
    goto: goto.length, names: names.length, live: liveAll.length, refs: refs.length, sold: soldTotal,
  };
  const sections = ORDER
    .filter(k => all[k].length)
    .sort((a, b) => strength[b] - strength[a] || ORDER.indexOf(a) - ORDER.indexOf(b))
    .map(k => ({ key: k, title: SECTION_TITLE[k], count: counts[k], rows: all[k].slice(0, LIMIT[k]) }));
  return { sections, rows: sections.flatMap(s => s.rows) };
}
