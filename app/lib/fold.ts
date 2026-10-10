/**
 * fold.ts — fold near-duplicates in a lot list (Oct 9).
 *
 * The live book carries the same thing many times over at one house: one
 * Munson rookie in eleven grades at REA, seven Fleer Jordans, five identical
 * wax packs. In a browse list that is noise — the reader wants to meet the
 * card once and know the other grades are there.
 *
 *   - Cards (sports-cards, tcg): one group per HOUSE + card ladder key
 *     (player · year · set · # · variant · serial — grade aside), the same
 *     identity the shortlist seats on.
 *   - Everything else: one group per HOUSE + maker + normalized title, but
 *     never for unique works (fine art, design) — eleven "Untitled" Wools at
 *     one house are eleven paintings — nor for titles too short to identify
 *     anything ("Lot", "Pair of chairs").
 *
 * The group's representative is its highest-priority lot (app/lib/priority);
 * representatives keep their own place in the input order, so whatever sort
 * the reader chose still reads true.
 *
 * Cross-house (Oct 9 r3): a card the build matched LIVE at another house
 * (`crossLive` — the same card, same grade) is ONE thing on the board, not two:
 * the pair folds into one group (best-priority copy shows) and the reason line
 * names the other venue — "Also live at REA · $220 bid" (crossNote). A same-
 * title lot at another house WITHOUT that match still stands alone.
 *
 * Pure; memoize at the call site (parseCard ~13µs × 10K lots).
 */
import { parseCard, cardLadderKey, type CardId } from './cards';
import { taxonOf, type CatKey } from './taxonomy';
import { priorityOf } from './priority';

type FoldLot = {
  id: string;
  title?: string | null;
  artist?: string | null;
  subCat?: string | null;
  drill?: string | null;
  auctionHouse?: string | null;
  crossLive?: { id: string; house: string; bid: number }[] | null;
} & Parameters<typeof priorityOf>[0];

/** A lot's crossLive siblings at OTHER houses. The build's pre-Oct 9 stamp
 *  matched same-house copies too (182 of 202 entries were Goldin→Goldin or
 *  REA→REA) — those are grades/copies the fold already groups, never "also
 *  live at" another venue. */
export function crossSibs(l: { auctionHouse?: string | null; crossLive?: { id: string; house: string; bid: number }[] | null }): { id: string; house: string; bid: number }[] {
  return (l.crossLive || []).filter(x => x && x.id && x.house && x.house !== l.auctionHouse);
}

const fmtBid = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K` : `$${Math.round(n)}`);

/** The reason-line text for the same card live at another house:
 *  "Also live at REA · $220 bid" · "Also live at REA · no bids yet" ·
 *  two venues → "Also live at REA, Goldin". `others` are the live lots
 *  themselves when the caller has them (fresher bids than the build stamp). */
export function crossNote(l: FoldLot, others?: readonly { auctionHouse?: string | null; currentBid?: number | null }[]): string | null {
  const rows = others && others.length
    ? others.filter(o => o.auctionHouse && o.auctionHouse !== l.auctionHouse).map(o => ({ house: o.auctionHouse as string, bid: o.currentBid || 0 }))
    : crossSibs(l);
  if (!rows.length) return null;
  const houses = Array.from(new Set(rows.map(r => r.house)));
  if (houses.length > 1) return `Also live at ${houses.join(', ')}`;
  const best = rows.reduce((a, b) => (b.bid > a.bid ? b : a));
  return `Also live at ${houses[0]} · ${best.bid > 0 ? `${fmtBid(best.bid)} bid` : 'no bids yet'}`;
}

export interface Fold<T> {
  /** one lot per group, in input order */
  reps: T[];
  /** rep.id → the folded-away lots of its group (best first); only groups of 2+ */
  siblings: Map<string, T[]>;
  /** rep.id → 'card' | 'title' — how the group was keyed */
  kind: Map<string, 'card' | 'title'>;
  /** EVERY member's id (rep or sibling) → its whole group, best first — a
   *  list that seats a sibling (the shortlist) can still name the others */
  group: Map<string, { members: T[]; kind: 'card' | 'title' }>;
}

const CARD_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['sports-cards', 'tcg']);
/** unique works: a shared title is not a shared object */
const NO_TITLE_FOLD: ReadonlySet<CatKey> = new Set<CatKey>(['fine-art', 'design']);
/** " - PSA NM-MT 8 (OC)", " BGS 9.5", " - CGC PRISTINE 10" … to the end */
const GRADE_TAIL = /\s*[-–—]?\s*\b(?:PSA|BGS|SGC|CGC|BVG|HGA|TAG|ISA|GMA)\b.*$/i;
const normTitle =(t: string | null | undefined) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The fold key for one lot, or null when it stands alone. */
export function foldKeyOf(l: FoldLot): { key: string; kind: 'card' | 'title'; card?: CardId } | null {
  const house = l.auctionHouse || '';
  const cat = taxonOf(l).cat;
  if (CARD_CATS.has(cat) && l.title) {
    const id = parseCard(l.title);
    const k = cardLadderKey(id);
    if (k) return { key: `c|${house}|${k}`, kind: 'card', card: id };
    // no ladder key (most Pokémon titles name no "player"), but a slab grade
    // parsed: the title with its grade tail cut is the card
    if (id.gradeCo && !id.multi && !id.notCard) {
      const bare = normTitle(l.title.replace(GRADE_TAIL, ''));
      if (bare.length >= 16 && bare.split(' ').length >= 3) return { key: `g|${house}|${bare}`, kind: 'card', card: id };
    }
  }
  if (NO_TITLE_FOLD.has(cat)) return null;
  const t = normTitle(l.title);
  // a title must name something: ≥3 words and ≥16 characters
  if (t.length < 16 || t.split(' ').length < 3) return null;
  return { key: `t|${house}|${l.artist || ''}|${t}`, kind: 'title' };
}

// a lot's key never changes: parse each served lot once per session
const KEY_CACHE = new WeakMap<object, ReturnType<typeof foldKeyOf>>();
function cachedKey(l: FoldLot) {
  let k = KEY_CACHE.get(l);
  if (k === undefined) { k = foldKeyOf(l); KEY_CACHE.set(l, k); }
  return k;
}

export function foldVariants<T extends FoldLot>(lots: readonly T[], nowMs: number = Date.now()): Fold<T> {
  const groups = new Map<string, { kind: 'card' | 'title'; members: { l: T; i: number; s: number }[] }>();
  const keyAt: (string | null)[] = new Array(lots.length);
  lots.forEach((l, i) => {
    const fk = cachedKey(l);
    if (!fk) { keyAt[i] = null; return; }
    keyAt[i] = fk.key;
    let g = groups.get(fk.key);
    if (!g) groups.set(fk.key, (g = { kind: fk.kind, members: [] }));
    g.members.push({ l, i, s: 0 });
  });
  // cross-house pairs (crossSibs) join one group: union the two lots' groups
  // (a lot with no fold key of its own gets a singleton group to join)
  const idAt = new Map<string, number>();
  lots.forEach((l, i) => idAt.set(l.id, i));
  const parent = new Map<string, string>();
  const find = (k: string): string => { let r = k; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; parent.set(k, r); return r; };
  lots.forEach((l, i) => {
    for (const s of crossSibs(l)) {
      const j = idAt.get(s.id);
      if (j === undefined) continue;
      for (const x of [i, j]) {
        if (keyAt[x] !== null) continue;
        const k = `x|${lots[x].id}`;
        keyAt[x] = k;
        groups.set(k, { kind: 'card', members: [{ l: lots[x], i: x, s: 0 }] });
      }
      const a = find(keyAt[i]!), b = find(keyAt[j]!);
      if (a !== b) parent.set(b, a);
    }
  });
  if (parent.size) {
    for (const k of Array.from(groups.keys())) {
      const r = find(k);
      if (r === k) continue;
      const into = groups.get(r)!, from = groups.get(k)!;
      into.members.push(...from.members);
      if (from.kind === 'card') into.kind = 'card';
      groups.delete(k);
    }
    for (let i = 0; i < keyAt.length; i++) if (keyAt[i] !== null) keyAt[i] = find(keyAt[i]!);
  }
  const repIdx = new Set<number>();
  const siblings = new Map<string, T[]>();
  const kind = new Map<string, 'card' | 'title'>();
  const group: Fold<T>['group'] = new Map();
  groups.forEach(g => {
    // best score first; ties keep input order (scored only when it matters)
    if (g.members.length > 1) for (const x of g.members) x.s = priorityOf(x.l, nowMs)?.score ?? -1;
    const m = g.members.slice().sort((a, b) => (b.s - a.s) || (a.i - b.i));
    repIdx.add(m[0].i);
    if (m.length > 1) {
      siblings.set(m[0].l.id, m.slice(1).map(x => x.l));
      kind.set(m[0].l.id, g.kind);
      const entry = { members: m.map(x => x.l), kind: g.kind };
      for (const x of m) group.set(x.l.id, entry);
    }
  });
  const reps = lots.filter((_, i) => keyAt[i] === null || repIdx.has(i));
  return { reps, siblings, kind, group };
}

const TIER_LABEL: Record<string, string> = { bl: 'Black Label', pristine: 'Pristine', gold: 'Gold Label' };

/** "PSA 8", "BGS 9.5", "PSA A", "CGC 10 Pristine", "PSA 8 (OC)", "Raw" */
export function gradeLabel(id: CardId): string {
  if (!id.gradeCo) return 'Raw';
  const g = id.gradeNum ?? id.gradeTag ?? '';
  const tier = id.gradeTier ? ` ${TIER_LABEL[id.gradeTier] ?? id.gradeTier}` : '';
  return `${id.gradeCo}${g !== '' ? ` ${g}` : ''}${tier}${id.gradeQual ? ` (${id.gradeQual})` : ''}`;
}

/** The reason-line text for a folded group:
 *  cards  → "Also PSA 8, PSA 6 · 6 more grades"
 *  titles → "+4 more of this lot" */
export function foldNote(rep: FoldLot, sibs: readonly FoldLot[], kind: 'card' | 'title'): string | null {
  if (!sibs.length) return null;
  if (kind === 'title') return `+${sibs.length} more of this lot`;
  const ids = sibs.map(s => parseCard(s.title || ''));
  // best grade first; raw last
  const order = ids
    .map((id, i) => ({ label: gradeLabel(id), n: id.gradeNum ?? (id.gradeCo ? 0.5 : -1), i }))
    .sort((a, b) => (b.n - a.n) || (a.i - b.i));
  const labels: string[] = [];
  for (const o of order) if (!labels.includes(o.label)) labels.push(o.label);
  const shown = labels.slice(0, 2);
  const restLots = order.filter(o => !shown.includes(o.label)).length;
  const restGrades = labels.length - shown.length;
  const tail = restLots ? ` · ${restLots} more ${restGrades === restLots ? (restLots === 1 ? 'grade' : 'grades') : (restLots === 1 ? 'lot' : 'lots')}` : '';
  return `Also ${shown.join(', ')}${tail}`;
}

/** A search string every lot of the group contains (their titles' longest
 *  common prefix, cut back to a whole word) — so the feed's own text query
 *  lists the whole group. null when the titles share too little to search. */
export function foldQuery(lots: readonly FoldLot[]): string | null {
  const ts = lots.map(l => String(l.title || '').toLowerCase());
  if (!ts.length) return null;
  let p = ts[0];
  for (const t of ts.slice(1)) {
    let i = 0;
    while (i < p.length && i < t.length && p[i] === t[i]) i++;
    p = p.slice(0, i);
  }
  // a prefix that ends mid-word in any title is cut back to the last space
  if (ts.some(t => t.length > p.length && /[a-z0-9]/.test(t[p.length]) && /[a-z0-9]$/.test(p))) {
    p = p.slice(0, Math.max(0, p.lastIndexOf(' ')));
  }
  p = p.replace(/[\s\-–—,:;/(#]+$/, '').trim();
  return p.length >= 12 ? p : null;
}
