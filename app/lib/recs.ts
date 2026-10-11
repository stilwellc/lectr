/**
 * recs.ts — "Lots you may like" (Oct 10 2026). ONE recommender for the
 * profile's For-you room and the home feed's For-you tab, so the two agree.
 *
 * THE TASTE PROFILE is a list of SEEDS — the things the reader told us,
 * each with a weight by how strongly it speaks:
 *
 *   owned   a lot they marked "I won it"                     1.00
 *   saved   a lot on their desk (live, or settled = watched)  0.75
 *   follow  a maker / player / subject / category / house    0.55
 *   search  a saved search (its own matcher decides a hit)    0.35
 *
 * × recency (a save or search halves every 120 days, floored at 0.4; a
 * follow is a standing statement and does not decay).
 *
 * SCORING every lot on the block is item-to-item: a candidate's similarity
 * to each seed lot reads only facts already on the served lot —
 *
 *   same category (gate) · same clean sub · same named entity (maker,
 *   player, Pokémon, film, mission… app/lib/entity/key) · same card in any
 *   grade (cards.cardLadderKey) · same drill (a watch model line, an art
 *   sub-market) · shared facets (grader, grade band, era, language,
 *   franchise, complication, signed… app/lib/facets) · price on a log
 *   kernel (priority.prioStatic's anchor, ±0.35 decade) · same house
 *
 * — and a follow or search seed matches by its own rule (the follows
 * affinity ladder; saved-query's matcher). Contributions W·sim are
 * combined with diminishing returns (best + .35·second + .15·third), so a
 * lot like several things you saved outranks a lot like one, without one
 * seed's twin crowding the rest. Then
 *
 *   score = taste × (0.45 + 0.55 · priority/100) × closing window
 *
 * where priority is THE "matters most" score (app/lib/priority) and the
 * window keeps a lot closing this week ahead of one a month out. A lot
 * enters only when one seed truly reaches it (a lot seed needs sim ≥ 0.3 —
 * same category AND same sub or entity — never a category-only nudge).
 *
 * (Oct 11) × the reader's PRICE BAND per category (learnBands: median ±
 * robust spread of what they own and save, n ≥ 3; soft — never a filter)
 * × ENGINE_LIFT when the engine flags the lot below market (flags.isFlagged;
 * the reason says so). Closed and closed-pending lots never enter. When the
 * real ties run short, the FALLBACK LADDER (scoreLots) opens below them:
 * same identity family → same sub + cut → same category at the anchor's
 * prices, each rung dealt after every real tie and saying which rung it is.
 * The return loop (pickStrips) cuts "new since your last visit" and
 * "closing tonight" from the picks.
 *
 * DIVERSITY: ≤3 per named entity, ≤3 per sale (house + close day), ≤6 per
 * house, ≤4 explained by the same seed, one per object / card identity;
 * the caps loosen once only if seats stay empty — never filler below the
 * entry bar. Lots already on the desk (any id alias, or the same card live
 * at another house) never come back as a recommendation.
 *
 * Every pick carries its REASON — the seed that put it there, in words
 * ("Because you saved 1952 Topps Mantle PSA 3", "You follow Charizard",
 * "Like your Andy Warhol prints · $20K–40K") — and `why`, the matched
 * facts. A reader with no seeds gets NO picks (cold start is said, not
 * faked). Pure: no React, no storage — the eval script and the tests run
 * it over the real book.
 */
import { taxonOf, subMatches, subLabel, SPORTS, type CatKey } from './taxonomy';
import { lotFacets, FACET_LABEL } from './facets';
import { entityKeyOf } from './entity/key';
import { parseCard, cardLadderKey, cardSetKey, cardYearKey, type CardId } from './cards';
import { prioStatic, priorityOf, closeMsOf, saleKeyOf } from './priority';
import { matchesSavedQuery, unmatchableReason } from './saved-query';
import { makerLineOf } from './lot-labels';
import { craftTitle, isClosedPending } from '../utils';
import { ARTIST_LABEL } from '../constants';
import { isFlagged } from './flags';
import type { Follow } from './follows';
import type { SavedQuery } from './alerts';

/* ── inputs ─────────────────────────────────────────────────────────────── */

/** the slice of a lot the recommender reads (an AuctionLot fits) */
export type RecLot = {
  id: string;
  artist: string;
  title: string;
  status?: string | null;
  subCat?: string | null;
  drill?: string | null;
  auctionHouse?: string | null;
  saleName?: string | null;
  saleDate?: string | null;
  saleDateTime?: string | null;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  currentBid?: number | null;
  bidCount?: number | null;
  currency?: string | null;
  priceUsd?: number | null;
  playerSlug?: string | null;
  playerName?: string | null;
  formKey?: string | null;
  flown?: boolean | null;
  ek?: string | null;
  crossLive?: { id: string; house: string; bid: number }[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any; signal?: any; bidProj?: any;
};

export type SeedKind = 'owned' | 'saved' | 'follow' | 'search' | 'signal';
/** 'signal' = an on-device implicit signal (app/lib/recs-signals): its
 *  weight arrives with it (a lot view .25, an entity page .2, "More like
 *  this" .7 — already decayed), so the kind weight is 1 */
export const SEED_WEIGHT: Record<SeedKind, number> = { owned: 1, saved: 0.75, follow: 0.55, search: 0.35, signal: 1 };
const HALF_LIFE_DAYS = 120;
const RECENCY_FLOOR = 0.4;

/** one saved (or owned) lot as the desk knows it: the resolved row when the
 *  book still carries it, else the snapshot the save took (title, maker,
 *  estimate) — a settled watch still says what it was */
export interface SavedInput {
  id: string;
  lot?: RecLot | null;
  savedAt?: string | null;
  owned?: boolean;
  title?: string | null;
  artist?: string | null;
  estMid?: number | null;
}
export interface SearchInput { id?: string; name: string; query: SavedQuery; createdAt?: string | null }

/** (Oct 11) ONE on-device signal (app/lib/recs-signals → use-recs): a lot
 *  the reader looked at or asked "more like", an entity page they visited
 *  (as a follow-shaped seed), or a term they searched. `weight` is final
 *  (kind × decay); `reason` is the verb the pick's line speaks ("looked
 *  at", "asked for more like", "searched"). Never stored server-side. */
export interface ExtraInput {
  lot?: RecLot | null;
  follow?: Follow;
  text?: string;
  weight: number;
  reason: string;
}
/** "Not for me": these lot ids never come back; their entity / card
 *  identity (`keys`: an entity id, or `card:<identity>`; repeated once per
 *  mark) is down-weighted — the card hard (×0.3), the entity softly (×0.6
 *  per mark: one print you pass on does not erase its maker) */
export interface NegativeInput { ids?: Iterable<string>; keys?: Iterable<string> }

export interface TasteInput {
  saved: SavedInput[];
  follows: Follow[];
  searches?: SearchInput[];
  /** on-device implicit signals (optional; weigh below a save) */
  extra?: ExtraInput[];
  /** on-device "Not for me" marks */
  negative?: NegativeInput;
  /** the price range the reader STATED in the quick start (app/lib/interests,
   *  hammer-basis USD) — read as a strong band across every category, never a
   *  hard filter: a lot outside it sinks, it does not vanish */
  price?: StatedPriceInput | null;
  nowMs?: number;
}

export interface StatedPriceInput { minUsd: number | null; maxUsd: number | null }
/** a stated range in log10 dollars (null = open on that side) */
export interface StatedBand { lo: number | null; hi: number | null; text: string; /** the suffix a pick inside it carries */ say: string }

export interface Feat {
  cat: CatKey;
  sub: string;
  /** the entity id (mk:/pl:/sj:/st:/cs:) */
  ek: string | null;
  /** a NAMED entity (not a cs: collection bucket) */
  named: boolean;
  card: string | null;
  /** a watch model line / art sub-market (watches, fine art, design only) */
  drill: string | null;
  /** a card / memorabilia lot's sport */
  sport: string | null;
  fx: ReadonlySet<string>;
  /** log10 of the hammer-basis price anchor */
  logA: number | null;
  house: string | null;
}

export interface Seed {
  kind: SeedKind;
  /** kind weight × recency */
  w: number;
  /** the human handle: a lot's short title, a follow's label, a search's name */
  label: string;
  /** a lot seed's features */
  f?: Feat;
  /** the seed lot's id (and every id alias it covers) */
  lotId?: string;
  /** the lot seed is live (saved) or settled (watched) */
  live?: boolean;
  /** the lot seed's maker line name ("Andy Warhol", "Mickey Mantle", "Charizard") */
  who?: string;
  follow?: Follow;
  query?: SavedQuery;
  /** a 'signal' seed's verb ("looked at", "asked for more like", "searched") */
  verb?: string;
}

export interface Taste {
  seeds: Seed[];
  /** ids (with aliases) of everything on the desk — never recommended back */
  exclude: Set<string>;
  /** card identities / titles on the desk (relists and twins never come back) */
  excludeKeys: Set<string>;
  /** "Not for me" entity ids / card identities → marks — down-weighted, not banned */
  down?: Map<string, number>;
  counts: { owned: number; saved: number; follows: number; searches: number; signals?: number };
  /** the reader's comfortable price band per category, learned from what
   *  they own and save (learnBands) — a category with < BAND_MIN priced
   *  lots on the desk has none */
  bands: Map<CatKey, PriceBand>;
  /** the range the reader stated (quick start), if any */
  stated?: StatedBand | null;
}

/** a learned price band, in log10 dollars */
export interface PriceBand { med: number; lo: number; hi: number; n: number }

/* ── features ───────────────────────────────────────────────────────────── */

/** facets that describe TASTE (the shape of what you collect) — quantity
 *  and the default English language say nothing */
const TASTE_FX = /^(?:graded|raw|psa|sgc|bgs|cgc|tag|g10|g95|g9|g7|g6|gauth|rookie|auto|relic|numbered|era-.+|lang-(?:ja|zh|other)|film-tv|music|fr-.+|flown|cx-.+|painting|on-paper)$/;
const CARD_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['sports-cards', 'tcg']);
/** categories whose `drill` names a model line / sub-market (elsewhere it is a sport or an era) */
const DRILL_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['watches', 'fine-art', 'design']);
/** facets specific enough to tie two lots of one sub together (an era, a
 *  grader, a language, a complication, a domain…) — 'graded' alone is not */
const DISTINCT_FX = /^(?:psa|sgc|bgs|cgc|tag|g10|rookie|auto|relic|numbered|era-.+|lang-(?:ja|zh)|film-tv|music|flown|cx-.+|painting|on-paper)$/;
/** where a same-sub lot at your price is a fair suggestion on its own (another artist's print, another maker's watch) */
const PRICE_LINK_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['fine-art', 'design', 'watches']);
/** where a shared facet can tie two lots of one sub (an era, a grader, a
 *  language, a complication, flown). Memorabilia / entertainment /
 *  historical lots are about WHO or WHAT — only the entity or the franchise
 *  ties them ("signed" + "film & TV" made Houdini a Star Wars pick). */
const FACET_TIE_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['sports-cards', 'tcg', 'space-science', 'watches']);
const eraOf = (fx: ReadonlySet<string>): string | null => { for (const k of Array.from(fx)) if (k.startsWith('era-')) return k; return null; };
const featMemo = new WeakMap<object, Feat>();

const normTitle = (t: string | null | undefined) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function ekOf(l: RecLot): string | null {
  return l.ek !== undefined ? l.ek ?? null : entityKeyOf(l);
}

function anchorOf(l: RecLot, nowMs: number, fallback?: number | null): number | null {
  // a settled lot's realized price is the truest anchor it has
  if (l.status === 'sold' && (l.priceUsd || 0) > 0) return l.priceUsd as number;
  const p = prioStatic(l, nowMs);
  if (p && p.a > 0) return p.a;
  return fallback && fallback > 0 ? fallback : null;
}

/** ONE CARD, ANY GRADE (r9, QA4 C2): the ladder key (player · year · set ·
 *  number · variant), else — a Pokémon / TCG card, which carries no player
 *  slug, so cardLadderKey is null for ~80% of them — year · set · number ·
 *  variant. The grade is never part of it: the raw card and its PSA 10 are
 *  one seat ("2002 Legendary Collection Reverse Holo #3 Charizard" was dealt
 *  twice). */
export function cardIdentityKey(id: CardId, cat: CatKey): string | null {
  const k = cardLadderKey(id);
  if (k) return k;
  if (cat !== 'tcg' || id.multi || id.notCard || !id.cardNo || !id.setName) return null;
  const y = cardYearKey(id.year);
  if (!y) return null;
  return `tcg|${y}|${cardSetKey(id.setName)}|${id.cardNo.toLowerCase()}${id.variant ? `|v:${id.variant}` : ''}${id.serialOf ? `|/${id.serialOf}` : ''}`;
}

/** the grade a card lot is offered in ("PSA 10", "raw") — the twin note */
export function cardGradeOf(title: string): string {
  const id = parseCard(title);
  return id.gradeCo && id.gradeNum != null ? `${id.gradeCo} ${id.gradeNum}` : id.gradeCo ? id.gradeCo : 'raw';
}

export function featOf(l: RecLot, nowMs: number, estFallback?: number | null): Feat {
  const hit = featMemo.get(l as object);
  if (hit) return hit;
  const t = taxonOf(l);
  const ek = ekOf(l);
  let card: string | null = null;
  if (CARD_CATS.has(t.cat) && l.title) card = cardIdentityKey(parseCard(l.title), t.cat);
  const fx = new Set<string>();
  for (const k of Array.from(lotFacets(l))) if (TASTE_FX.test(k)) fx.add(k);
  const a = anchorOf(l, nowMs, estFallback);
  const f: Feat = {
    cat: t.cat, sub: t.sub, ek, named: !!ek && !ek.startsWith('cs:'),
    card, drill: DRILL_CATS.has(t.cat) && l.drill ? l.drill : null, sport: t.sport ?? null, fx,
    logA: a ? Math.log10(a) : null, house: l.auctionHouse || null,
  };
  featMemo.set(l as object, f);
  return f;
}

/** every id one save could be keyed under (the profile's idAliases) */
export function idAliases(id: string): string[] {
  const out = [id, id.endsWith('~') ? id.slice(0, -1) : `${id}~`];
  const fam = id.match(/^(wright|rago|lama)-(\d+)~?$/);
  if (fam) {
    for (const h of ['wright', 'rago', 'lama']) {
      if (h !== fam[1]) out.push(`${h}-${fam[2]}`, `${h}-${fam[2]}~`);
    }
  }
  return out;
}

/** a title cut for a reason line — whole words, ≤ 46 characters */
export function shortTitle(title: string | null | undefined, house?: string | null): string {
  const t = craftTitle(String(title || ''), house).replace(/\s+/g, ' ').trim();
  if (t.length <= 46) return t;
  const cut = t.slice(0, 46);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 24 ? cut.slice(0, sp) : cut).replace(/[\s,;:·–-]+$/, '')}…`;
}

const recency = (at: string | null | undefined, nowMs: number): number => {
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return 1;
  const days = Math.max(0, (nowMs - t) / 864e5);
  return Math.max(RECENCY_FLOOR, Math.pow(0.5, days / HALF_LIFE_DAYS));
};

/* ── the taste profile ──────────────────────────────────────────────────── */

export function buildTaste(input: TasteInput): Taste {
  const nowMs = input.nowMs ?? Date.now();
  const seeds: Seed[] = [];
  const exclude = new Set<string>();
  const excludeKeys = new Set<string>();
  let owned = 0, saved = 0;
  for (const s of input.saved) {
    for (const a of idAliases(s.id)) exclude.add(a);
    // the resolved row, else the save's own snapshot (a settled watch the
    // live book no longer carries still says what it was)
    const lot: RecLot | null = s.lot
      ?? (s.title && s.artist ? { id: s.id, artist: s.artist, title: s.title, status: 'sold' } : null);
    if (!lot) continue;
    if (s.lot) {
      exclude.add(s.lot.id);
      for (const x of s.lot.crossLive || []) if (x?.id) exclude.add(x.id);
    }
    const f = featOf(lot, nowMs, s.estMid);
    if (f.card) excludeKeys.add(`card:${f.card}|${normTitle(lot.title)}`);
    excludeKeys.add(`t:${lot.auctionHouse ?? ''}|${normTitle(lot.title)}`);
    const kind: SeedKind = s.owned ? 'owned' : 'saved';
    if (s.owned) owned++; else saved++;
    seeds.push({
      kind, w: SEED_WEIGHT[kind] * recency(s.savedAt, nowMs),
      label: shortTitle(lot.title, lot.auctionHouse), f, lotId: s.id,
      live: lot.status === 'upcoming', who: makerLineOf(lot).name,
    });
  }
  for (const fo of input.follows) {
    seeds.push({ kind: 'follow', w: SEED_WEIGHT.follow, label: fo.label, follow: fo });
  }
  let searches = 0;
  for (const q of input.searches || []) {
    if (!q.query || unmatchableReason(q.query as Record<string, unknown>)) continue;
    searches++;
    seeds.push({ kind: 'search', w: SEED_WEIGHT.search * recency(q.createdAt, nowMs), label: q.name, query: q.query });
  }
  // (Oct 11) on-device signals + "Not for me" — app/lib/recs-signals
  const neg = input.negative;
  const down = new Map<string, number>();
  for (const k of Array.from(neg?.keys ?? [])) down.set(k, (down.get(k) ?? 0) + 1);
  for (const id of Array.from(neg?.ids ?? [])) for (const a of idAliases(id)) exclude.add(a);
  let signals = 0;
  const followed = new Set(input.follows.map(fo => `${fo.kind}:${fo.key}`));
  for (const x of input.extra || []) {
    if (!(x.weight > 0)) continue;
    if (x.lot) {
      // a save already speaks louder; a lot marked "not for me" says nothing good
      if (exclude.has(x.lot.id)) continue;
      const f = featOf(x.lot, nowMs);
      signals++;
      seeds.push({
        kind: 'signal', w: x.weight, verb: x.reason, label: shortTitle(x.lot.title, x.lot.auctionHouse), f, lotId: x.lot.id,
        live: x.lot.status === 'upcoming', who: makerLineOf(x.lot).name,
      });
    } else if (x.follow) {
      if (followed.has(`${x.follow.kind}:${x.follow.key}`)) continue;
      signals++;
      seeds.push({ kind: 'signal', w: x.weight, verb: x.reason, label: x.follow.label, follow: x.follow });
    } else if (x.text && x.text.trim()) {
      const query: SavedQuery = { text: x.text.trim() };
      if (unmatchableReason(query as Record<string, unknown>)) continue;
      signals++;
      seeds.push({ kind: 'signal', w: x.weight, verb: x.reason, label: x.text.trim(), query });
    }
  }
  return { seeds, exclude, excludeKeys, down, counts: { owned, saved, follows: input.follows.length, searches, signals }, bands: learnBands(seeds), stated: statedBandOf(input.price) };
}

/* ── price-band learning ────────────────────────────────────────────────── */

/** priced lots a category needs on the desk before it has a band */
export const BAND_MIN = 3;
const BAND_K = 1.5;          // the band is median ± 1.5 robust spreads
const BAND_S_MIN = 0.2;      // decades — no band narrower than ×1.6 each way
const BAND_S_MAX = 0.8;
const BAND_SIGMA = 0.35;     // decades past the band edge → fit falls off on this kernel
const BAND_FLOOR = 0.45;     // a lot far outside the band keeps this much (soft, not a filter)

const medianOf = (xs: number[]) => { const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/**
 * THE READER'S PRICE BAND per category (Oct 11): what they own and save,
 * read robustly in log space — the median, ± 1.5 × the scaled median
 * absolute deviation (one $90K outlier on a $300 desk moves nothing),
 * floored at ±0.3 decade. An owned lot counts twice: what a reader paid
 * says more than what they watched. Gated: < BAND_MIN priced lots in a
 * category → no band there (one save is not a budget).
 */
export function learnBands(seeds: readonly Seed[]): Map<CatKey, PriceBand> {
  const by = new Map<CatKey, number[]>();
  for (const s of seeds) {
    if (!s.f || s.f.logA == null || (s.kind !== 'owned' && s.kind !== 'saved')) continue;
    let xs = by.get(s.f.cat);
    if (!xs) by.set(s.f.cat, (xs = []));
    xs.push(s.f.logA);
    if (s.kind === 'owned') xs.push(s.f.logA);
  }
  const out = new Map<CatKey, PriceBand>();
  by.forEach((xs, cat) => {
    const n = xs.length;
    if (n < BAND_MIN) return;
    const med = medianOf(xs);
    const mad = medianOf(xs.map(x => Math.abs(x - med)));
    const sd = Math.min(BAND_S_MAX, Math.max(BAND_S_MIN, 1.4826 * mad));
    out.set(cat, { med, lo: med - BAND_K * sd, hi: med + BAND_K * sd, n });
  });
  return out;
}

/* ── the stated range (quick start) ───────────────────────────────────── */

const STATED_SIGMA = 0.2;    // decades past the edge → falls off faster than a learned band
const STATED_FLOOR = 0.2;    // far outside still keeps a fifth: strong, not a filter
const STATED_NOPRICE = 0.85; // no price yet: cannot be placed, kept close to the in-range lots

const usdWord = (n: number) => `$${fmtK(n)}`;
/** the stated range as a band in log space, with its words ("$5K–50K",
 *  "under $1K", "$25K and up") — null when nothing is stated */
export function statedBandOf(p: StatedPriceInput | null | undefined): StatedBand | null {
  if (!p) return null;
  const lo = p.minUsd != null && p.minUsd > 0 ? p.minUsd : null;
  let hi = p.maxUsd != null && p.maxUsd > 0 ? p.maxUsd : null;
  if (lo != null && hi != null && lo >= hi) hi = null;
  if (lo == null && hi == null) return null;
  const text = lo != null && hi != null ? `${usdWord(lo)}–${fmtK(hi)}` : lo != null ? `${usdWord(lo)} and up` : `under ${usdWord(hi!)}`;
  const say = lo != null && hi != null ? `in your ${text} range` : lo != null ? `in your ${usdWord(lo)}-and-up range` : `under your ${usdWord(hi!)} cap`;
  return { lo: lo != null ? Math.log10(lo) : null, hi: hi != null ? Math.log10(hi) : null, text, say };
}

/** how a lot sits against the stated range: 1 inside, a steep Gaussian
 *  fall-off past either edge down to STATED_FLOOR — a reader who said
 *  "under $1K" sees $1K lots first and a $40K grail only when nothing
 *  under $1K ties (it sinks; it never disappears) */
export function statedFit(logA: number | null, b: StatedBand | null | undefined): { fit: number; inside: boolean } {
  if (!b) return { fit: 1, inside: false };
  if (logA == null) return { fit: STATED_NOPRICE, inside: false };
  const d = b.lo != null && logA < b.lo ? b.lo - logA : b.hi != null && logA >= b.hi ? logA - b.hi + 0.02 : 0;
  if (d === 0) return { fit: 1, inside: true };
  return { fit: Math.max(STATED_FLOOR, Math.exp(-(d * d) / (2 * STATED_SIGMA * STATED_SIGMA))), inside: false };
}

/** how a lot sits against the reader's band in its category: `fit` is the
 *  soft score factor (1 inside, falling off outside, never below the floor;
 *  1 when there is no band or no price), `inside` says it truly sits in it */
export function bandFit(f: Pick<Feat, 'cat' | 'logA'>, bands: ReadonlyMap<CatKey, PriceBand> | undefined): { fit: number; inside: boolean; band: PriceBand | null } {
  const b = bands?.get(f.cat) ?? null;
  if (!b) return { fit: 1, inside: false, band: null };
  // no price on the lot yet (a Goldin card at $0 bid): it may land anywhere
  // — a reader with a budget hears about it, below the lots that fit
  if (f.logA == null) return { fit: 0.75, inside: false, band: b };
  const d = f.logA < b.lo ? b.lo - f.logA : f.logA > b.hi ? f.logA - b.hi : 0;
  if (d === 0) return { fit: 1, inside: true, band: b };
  return { fit: Math.max(BAND_FLOOR, Math.exp(-(d * d) / (2 * BAND_SIGMA * BAND_SIGMA))), inside: false, band: b };
}

/* ── similarity ─────────────────────────────────────────────────────────── */

const PRICE_SIGMA = 0.35; // decades
export const LOT_SIM_MIN = 0.3;

export interface SimParts {
  sim: number; sub: boolean; entity: boolean; card: boolean; franchise: boolean; drill: boolean;
  /** tied only by sub + price (no entity, card, franchise, line or facet) */
  weak: boolean;
  /** shared distinctive facets */
  shared: string[]; fx: number; price: number | null; house: boolean;
}

/**
 * How alike two lots are, 0–1. 0 across categories or sports, and 0 unless
 * something REAL ties them: the same named entity, the same card, the same
 * franchise, the same model line — or, inside one sub, a shared distinctive
 * facet (era, grader, language, complication…) at a comparable price; in
 * art, design and watches the same sub at your price is a tie of its own.
 */
export function lotSim(c: Feat, s: Feat): SimParts {
  const out: SimParts = { sim: 0, sub: false, entity: false, card: false, franchise: false, drill: false, weak: false, shared: [], fx: 0, price: null, house: false };
  if (c.cat !== s.cat) return out;
  if (c.sport && s.sport && c.sport !== s.sport) return out;
  let v = 0.1;
  if (c.sub === s.sub) { v += 0.12; out.sub = true; }
  if (c.named && c.ek === s.ek) { v += 0.34; out.entity = true; }
  if (c.card && c.card === s.card) { v += 0.12; out.card = true; }
  let inter = 0;
  for (const k of Array.from(c.fx)) {
    if (!s.fx.has(k)) continue;
    inter++;
    if (k.startsWith('fr-')) out.franchise = true;
    else if (DISTINCT_FX.test(k)) out.shared.push(k);
  }
  if (out.franchise && !out.entity) v += 0.22;
  if (c.drill && c.drill === s.drill) { v += 0.1; out.drill = true; }
  if (c.fx.size || s.fx.size) { out.fx = inter / (c.fx.size + s.fx.size - inter); v += 0.16 * out.fx; } else v += 0.08;
  if (c.logA != null && s.logA != null) {
    const d = c.logA - s.logA;
    out.price = Math.exp(-(d * d) / (2 * PRICE_SIGMA * PRICE_SIGMA));
    v += 0.14 * out.price;
  } else v += 0.05;
  if (c.house && c.house === s.house) { v += 0.03; out.house = true; }
  const priceOk = (min: number) => out.price == null || out.price >= min;
  // two cards of different eras are different hobbies — a shared grader or
  // "rookie" does not tie a 1962 Fleer to a 2026 SuperFractor
  const eraA = eraOf(c.fx), eraB = eraOf(s.fx);
  const eraClash = !!eraA && !!eraB && eraA !== eraB;
  if (eraClash) v *= 0.75;
  // a facet tie needs the same sport when either side names one (an
  // unlabeled 1973 Panini sticker pack is no answer to a Topps baseball save)
  const sameSport = c.sport === s.sport;
  const facetTie = out.sub && FACET_TIE_CATS.has(c.cat) && !eraClash && sameSport && priceOk(0.3)
    && (out.shared.length > 0 || (CARD_CATS.has(c.cat) && c.fx.has('graded') && s.fx.has('graded') && out.price != null && out.price >= 0.5));
  const strong = out.entity || out.card || out.franchise || (out.drill && out.sub) || facetTie;
  out.weak = !strong && out.sub && PRICE_LINK_CATS.has(c.cat) && out.price != null && out.price >= 0.6;
  out.sim = strong ? Math.min(1, v) : out.weak ? Math.min(1, v) * 0.75 : 0;
  return out;
}

/** a follow's reach on one lot (the follows.affinityOf ladder, × 0.8) */
function followSim(l: RecLot, f: Feat, fo: Follow): number {
  if (fo.kind === 'maker') {
    return l.artist === fo.key || l.playerSlug === fo.key || f.ek === `pl:${fo.key}` || f.ek === `mk:${fo.key}` ? 0.8 : 0;
  }
  if (fo.kind === 'entity') return f.ek === fo.key ? 0.8 : 0;
  if (fo.kind === 'house') return l.auctionHouse === fo.key ? 0.32 : 0;
  const [cat, sub] = fo.key.split(':');
  if (f.cat !== cat) return 0;
  if (!sub) return 0.48;
  return subMatches(cat, sub, f.sub) ? 0.64 : 0;
}

/* ── recommend ──────────────────────────────────────────────────────────── */

export interface Rec<L extends RecLot = RecLot> {
  lot: L;
  score: number;
  /** the taste half alone (before quality and window) */
  taste: number;
  /** the one line under the lot: why it is here */
  reason: string;
  /** the same reason with its matched fact FIRST, for a one-line row that
   *  ellipsizes ("Same player · you saved 1952 Topps #88 Bob…") */
  short: string;
  /** the matched facts, in words ("same player", "PSA", "in your price range") */
  why: string[];
  /** the seed that explains it */
  seed: Seed;
  /** the engine flags it below market (the reason says so) */
  flagged?: boolean;
  /** it sits in the reader's learned price band for its category */
  inBand?: boolean;
  /** 1 = a real tie; 2–4 = a fallback rung (scoreLots' ladder) */
  tier?: 1 | LadderTier;
}

/** the suffix a below-market pick carries — the engine's read, said as one */
export const ENGINE_NOTE = 'engine reads below market';
/** a category's learned band in the house's money voice ("$200–900") */
export function bandOfCat(bands: ReadonlyMap<CatKey, PriceBand> | undefined, cat: CatKey): string | null {
  const b = bands?.get(cat);
  return b ? bandText(Math.pow(10, b.lo), Math.pow(10, b.hi)) : null;
}

/** the most of the deal's seats one seed may fill while others have lots */
export const SEED_SHARE = 0.4;

/** the deal size the per-entity cap reads (the profile's list) */
export const REC_DEAL = 24;

/** How deep the profile's list runs (r9, QA4 C1). A NARROW taste — at most
 *  two things followed or saved (one maker; a Pokémon and its category) —
 *  asks for a followed name's book, not a sampler: it deals twice the seats,
 *  and Show more walks them. A broad taste keeps the standard deal. */
export function recDepth(taste: Taste): number {
  const targets = new Set<string>();
  for (const s of taste.seeds) {
    targets.add(s.follow ? `${s.follow.kind}:${s.follow.key}` : s.f?.named && s.f.ek ? s.f.ek : s.query ? `q:${s.label}` : `lot:${s.lotId}`);
  }
  return targets.size > 0 && targets.size <= 2 ? REC_DEAL * 2 : REC_DEAL;
}

export interface RecOpts {
  nowMs?: number;
  n?: number;
  /** only lots closing within this many days (home's week-long For you) */
  maxDays?: number;
  /** a pool already narrowed to the block (skip the on-block gate) */
  onBlock?: (l: RecLot) => boolean;
}

function windowFactor(closeMs: number | null, nowMs: number): number {
  if (closeMs == null) return 0.6;
  const h = (closeMs - nowMs) / 3_600_000;
  if (h <= 0) return 0;
  return h <= 168 ? 1 : h <= 336 ? 0.85 : h <= 720 ? 0.7 : 0.55;
}

const fmtK = (n: number) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${Math.round(n)}`;
};
/** "$20K–40K", "$800–1.2K" → a band in the house's money voice */
export function bandText(lo: number, hi: number): string {
  const r = (x: number) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))) - 1); return Math.round(x / p) * p; };
  const a = r(lo), b = r(hi);
  if (a === b) return `$${fmtK(a)}`;
  return `$${fmtK(a)}–${fmtK(b)}`;
}

const NOUN: Partial<Record<CatKey, string>> = {
  'sports-cards': 'cards', tcg: 'cards', watches: 'watches', design: 'pieces',
  'sports-memorabilia': 'pieces', entertainment: 'pieces', historical: 'pieces', 'space-science': 'pieces',
};
function nounOf(cat: CatKey, sub: string): string {
  if (cat === 'fine-art') return sub === 'prints' ? 'prints' : sub === 'unique' ? 'works' : sub === 'ceramics' ? 'ceramics' : sub === 'sculpture' ? 'sculpture' : 'works';
  return NOUN[cat] || 'pieces';
}

/** what kind of thing an entity id names, for "same …" */
function entityWord(ek: string | null): string {
  if (!ek) return 'subject';
  if (ek.startsWith('pl:')) return 'player';
  if (ek.startsWith('mk:')) return 'maker';
  if (ek.startsWith('st:')) return 'set';
  const k = ek.slice(ek.indexOf('|') + 1);
  const pre = k.slice(0, k.indexOf(':'));
  return ({ k: 'Pokémon', p: 'person', f: 'film', fr: 'franchise', m: 'mission', t: 'team', b: 'brand', s: 'set' } as Record<string, string>)[pre] ?? 'subject';
}
function franchiseName(f: Feat): string | null {
  for (const k of Array.from(f.fx)) if (k.startsWith('fr-')) return FACET_LABEL[k] ?? null;
  return null;
}
/** the entity's own name — a franchise by its facet label ("Star Wars"),
 *  never one film's title; else the lot's maker line */
function entityName(f: Feat, l: RecLot): string {
  const fr = f.ek?.match(/\|fr:(fr-[a-z0-9-]+)$/);
  if (fr && FACET_LABEL[fr[1]]) return FACET_LABEL[fr[1]];
  const name = makerLineOf(l as Parameters<typeof makerLineOf>[0]).name;
  // a player card whose title the card parser could not name prints the
  // desk's pseudo-maker ("Like your Sports Cards cards") — the player's
  // own key names them
  if (f.ek?.startsWith('pl:') && name === (ARTIST_LABEL[l.artist] || l.artist)) {
    return f.ek.slice(3).split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  }
  return name;
}

const FX_WORD: Record<string, string> = {
  psa: 'PSA', sgc: 'SGC', bgs: 'BGS', cgc: 'CGC', g10: 'gem 10', rookie: 'rookie', auto: 'signed',
  'era-prewar': 'pre-war', 'era-vintage': 'vintage', 'era-80s90s': "'80s–'90s", 'era-modern': 'modern',
  'lang-ja': 'Japanese', 'lang-zh': 'Chinese', flown: 'flown', relic: 'relic', numbered: 'numbered',
  'film-tv': 'film & TV', music: 'music', 'cx-moon': 'moon phase', 'cx-gmt': 'GMT', 'cx-diver': 'diver', 'cx-tourbillon': 'tourbillon', 'cx-repeater': 'repeater',
  'cx-chrono': 'chronograph', 'cx-perpetual': 'perpetual', painting: 'painting', 'on-paper': 'on paper',
};

/** a fallback rung (the ladder): 2 = same identity family, 3 = same sub +
 *  a shared cut, 4 = same category at the anchor's prices */
export type LadderTier = 2 | 3 | 4;
export interface LadderHit { tier: LadderTier; /** the anchor's facts the rung reads */ anchor: LadderAnchor }

/** one scored lot before the diversity pass (the eval reads the full ranking) */
export interface ScoredRow<L extends RecLot = RecLot> {
  l: L; score: number; taste: number;
  best: { seed: Seed; c: number; parts?: SimParts; ladder?: LadderHit };
  f: Feat;
  /** the engine prices it below its comparables (flags.isFlagged) */
  flagged?: boolean;
  /** it sits inside the reader's learned price band for its category */
  inBand?: boolean;
  /** it sits inside the range the reader stated (quick start) */
  inStated?: boolean;
}

/** the engine's below-market flag lifts a qualifying pick this much — a
 *  tiebreak among real ties, never a way in */
export const ENGINE_LIFT = 1.15;

/* ── the fallback ladder ────────────────────────────────────────────────── */

/** what a narrow seed (a followed name, one save) stands for, read from its
 *  own live lots — the rungs below the name itself */
export interface LadderAnchor {
  seed: Seed;
  cat: CatKey;
  sub: string | null;
  sport: string | null;
  /** the identity family (familyOf) */
  fam: string | null;
  /** distinctive facets most of its lots share (era, grader, language…) */
  cut: string[];
  /** log10 median price of its lots */
  logA: number | null;
  /** the franchise most of its lots carry (fr-…) */
  fr: string | null;
}

/** THE IDENTITY FAMILY of a named entity: another Pokémon / film / mission
 *  / person (sj: by its subject kind), another set in the market (st:),
 *  another player of the same sport and era (pl:), another maker of the
 *  same category · sub (mk:) — null for a collection bucket */
export function familyOf(f: Pick<Feat, 'ek' | 'named' | 'cat' | 'sub' | 'sport' | 'fx'>): string | null {
  const ek = f.ek;
  if (!ek || !f.named) return null;
  if (ek.startsWith('sj:')) { const bar = ek.indexOf('|'); const k = ek.slice(bar + 1); const c = k.indexOf(':'); return c > 0 ? `${ek.slice(0, bar)}|${k.slice(0, c)}` : null; }
  if (ek.startsWith('st:')) return ek.slice(0, ek.indexOf('|'));
  if (ek.startsWith('pl:')) return f.sport ? `pl|${f.cat}|${f.sport}|${eraOf(f.fx) ?? ''}` : null;
  if (ek.startsWith('mk:')) return `mk|${f.cat}|${f.sub}`;
  return null;
}

const LADDER_SIM: Record<LadderTier, number> = { 2: 0.42, 3: 0.32, 4: 0.22 };
const modeOf = <T,>(xs: readonly T[]): T | null => {
  const m = new Map<T, number>(); let best: T | null = null, bn = 0;
  for (const x of xs) { const n = (m.get(x) ?? 0) + 1; m.set(x, n); if (n > bn) { bn = n; best = x; } }
  return best;
};

/** the anchors a taste's narrow seeds lend the ladder: every followed maker /
 *  player / subject (read from its live lots in the pool) and every named
 *  lot seed (read from itself) */
function ladderAnchors(taste: Taste, members: Map<Seed, Feat[]>): LadderAnchor[] {
  const out: LadderAnchor[] = [];
  for (const s of taste.seeds) {
    let fs: Feat[];
    if (s.f) fs = [s.f];
    else if (s.follow && (s.follow.kind === 'maker' || s.follow.kind === 'entity')) fs = members.get(s) ?? [];
    else continue;
    if (!fs.length) continue;
    const cat = modeOf(fs.map(f => f.cat))!;
    const inCat = fs.filter(f => f.cat === cat);
    const sub = modeOf(inCat.map(f => f.sub));
    const sport = modeOf(inCat.map(f => f.sport));
    const fam = modeOf(inCat.map(f => familyOf(f)).filter((x): x is string => !!x));
    const cnt = new Map<string, number>();
    for (const f of inCat) for (const k of Array.from(f.fx)) if (DISTINCT_FX.test(k)) cnt.set(k, (cnt.get(k) ?? 0) + 1);
    const cut: string[] = [];
    cnt.forEach((n, k) => { if (n * 2 >= inCat.length) cut.push(k); });
    const fr = modeOf(inCat.flatMap(f => Array.from(f.fx).filter(k => k.startsWith('fr-'))));
    const ps = inCat.map(f => f.logA).filter((x): x is number => x != null);
    out.push({ seed: s, cat, sub, sport, fam, cut, logA: ps.length ? medianOf(ps) : null, fr });
  }
  return out;
}

/** the best rung one candidate reaches on one anchor (0 = none) */
function ladderTier(c: Feat, a: LadderAnchor): LadderTier | 0 {
  if (c.cat !== a.cat) return 0;
  if (c.sport && a.sport && c.sport !== a.sport) return 0;
  const price = c.logA != null && a.logA != null ? Math.exp(-((c.logA - a.logA) ** 2) / (2 * PRICE_SIGMA * PRICE_SIGMA)) : null;
  if (a.fam && familyOf(c) === a.fam) {
    // another PERSON is a family only inside the same sub and outside a
    // franchise (a Star Wars signer's next pick is Star Wars — lotSim's
    // tie — never Houdini because both are people who signed photos)
    if (!a.fam.endsWith('|p') || (c.sub === a.sub && !a.fr)) return 2;
  }
  // memorabilia, entertainment and historical lots are about WHO or WHAT:
  // only the family rung reaches them (a shared "signed" or the same price
  // is no tie between Houdini and Star Wars — lotSim's FACET_TIE_CATS rule)
  if (!FACET_TIE_CATS.has(c.cat) && !PRICE_LINK_CATS.has(c.cat)) return 0;
  const eraA = a.cut.find(k => k.startsWith('era-')), eraC = eraOf(c.fx);
  if (a.sub && c.sub === a.sub && !(eraA && eraC && eraA !== eraC) && a.cut.some(k => c.fx.has(k)) && (price == null || price >= 0.3)) return 3;
  if ((a.sub == null || c.sub === a.sub) && price != null && price >= 0.6) return 4;
  return 0;
}

/** how many strong rows a taste needs before the ladder stays shut */
const LADDER_NEED = REC_DEAL * 2;

/**
 * Every lot on the block one seed truly reaches, scored and sorted best
 * first — no caps (recommend() deals the diversity). When the real ties
 * run short (a follow of a player with two live lots, one save), the
 * FALLBACK LADDER opens below them, rung by rung — same identity family →
 * same sub + a shared cut → same category at the anchor's prices — each
 * rung's rows strictly after the rung above, each saying which rung it is.
 */
export function scoreLots<L extends RecLot>(pool: readonly L[], taste: Taste, opts: RecOpts = {}): ScoredRow<L>[] {
  const nowMs = opts.nowMs ?? Date.now();
  if (!taste.seeds.length) return [];
  const lotSeeds = taste.seeds.filter(s => s.f);
  const followSeeds = taste.seeds.filter(s => s.follow);
  const searchSeeds = taste.seeds.filter(s => s.query);
  const seedCats = new Set(lotSeeds.map(s => s.f!.cat));
  const today = new Date(nowMs).toISOString().slice(0, 10);

  type Row = ScoredRow<L>;
  const rows: Row[] = [];
  // the gated pool the ladder may reach into, and each follow's live lots
  const open: { l: L; f: Feat | null; cat: CatKey; close: number | null }[] = [];
  /** a relist / twin of something on the desk */
  const deskTwin = (l: L, f: Feat) => (!!f.card && taste.excludeKeys.has(`card:${f.card}|${normTitle(l.title)}`)) || taste.excludeKeys.has(`t:${l.auctionHouse ?? ''}|${normTitle(l.title)}`);
  const members = new Map<Seed, Feat[]>();
  /** quality × window × the reader's band × the engine's flag */
  const finish = (l: L, f: Feat, tasteV: number, close: number | null) => {
    const pr = priorityOf(l, nowMs);
    const q = pr ? pr.score / 100 : 0.1;
    const band = bandFit(f, taste.bands);
    const flagged = isFlagged(l as Parameters<typeof isFlagged>[0]);
    // "Not for me" on a lot quiets its entity and its card in any grade
    const quiet = !taste.down?.size ? 1
      : (f.card && taste.down.has(`card:${f.card}`) ? 0.3 : 1) * Math.pow(0.6, (f.ek && taste.down.get(f.ek)) || 0);
    const said = statedFit(f.logA, taste.stated);
    const score = tasteV * (0.45 + 0.55 * q) * windowFactor(close, nowMs) * band.fit * said.fit * (flagged ? ENGINE_LIFT : 1) * quiet;
    return { score, flagged, inBand: band.inside, inStated: said.inside };
  };
  for (const l of pool) {
    if (l.status && l.status !== 'upcoming') continue;
    if (opts.onBlock ? !opts.onBlock(l) : isClosedPending(l as Parameters<typeof isClosedPending>[0], nowMs)) continue;
    if (taste.exclude.has(l.id)) continue;
    const close = closeMsOf(l);
    if (close != null && close <= nowMs) continue;
    if (opts.maxDays != null && (close == null || close - nowMs > opts.maxDays * 864e5)) continue;
    // cheap pre-gate: a lot no seed can reach skips the feature pass (the
    // ladder may still read it, lazily)
    const cat = taxonOf(l).cat;
    let reach = seedCats.has(cat) || searchSeeds.length > 0;
    if (!reach) for (const s of followSeeds) {
      const fo = s.follow!;
      if (fo.kind === 'house' ? l.auctionHouse === fo.key : fo.kind === 'cat' ? fo.key.split(':')[0] === cat : true) { reach = true; break; }
    }
    if (!reach) { open.push({ l, f: null, cat, close }); continue; }
    const f = featOf(l, nowMs);
    if (deskTwin(l, f)) continue;
    open.push({ l, f, cat, close });

    const contribs: { seed: Seed; c: number; parts?: SimParts }[] = [];
    for (const s of lotSeeds) {
      // a lot you only looked at never explains itself
      if (s.kind === 'signal' && s.lotId === l.id) continue;
      const p = lotSim(f, s.f!);
      if (p.sim < LOT_SIM_MIN) continue;
      contribs.push({ seed: s, c: s.w * p.sim, parts: p });
    }
    for (const s of followSeeds) {
      const v = followSim(l, f, s.follow!);
      if (v > 0) {
        contribs.push({ seed: s, c: s.w * v });
        if (s.follow!.kind === 'maker' || s.follow!.kind === 'entity') { let m = members.get(s); if (!m) members.set(s, (m = [])); m.push(f); }
      }
    }
    for (const s of searchSeeds) {
      if (matchesSavedQuery(s.query!, l, today)) contribs.push({ seed: s, c: s.w * 0.6 });
    }
    if (!contribs.length) continue;
    contribs.sort((a, b) => b.c - a.c);
    const tasteV = contribs[0].c + 0.35 * (contribs[1]?.c ?? 0) + 0.15 * (contribs[2]?.c ?? 0);
    const fin = finish(l, f, tasteV, close);
    if (fin.score <= 0) continue;
    rows.push({ l, score: fin.score, taste: tasteV, best: contribs[0], f, flagged: fin.flagged, inBand: fin.inBand, inStated: fin.inStated });
  }
  const order = (a: Row, b: Row) => (b.score - a.score) || (a.l.id < b.l.id ? -1 : 1);
  rows.sort(order);
  if (rows.length >= Math.max(LADDER_NEED, (opts.n ?? 0) * 2)) return rows;

  // THE LADDER — only when the real ties run short; rung by rung, each
  // rung's rows after every row above it (a family stranger never outranks
  // the name you follow)
  const anchors = ladderAnchors(taste, members);
  if (!anchors.length) return rows;
  const have = new Set(rows.map(r => r.l));
  const rungs: Record<LadderTier, Row[]> = { 2: [], 3: [], 4: [] };
  const anchorCats = new Set(anchors.map(a => a.cat));
  for (const o of open) {
    const { l, close } = o;
    if (have.has(l) || !anchorCats.has(o.cat)) continue;
    const f = o.f ?? featOf(l, nowMs);
    if (!o.f && deskTwin(l, f)) continue;
    let bestTier: LadderTier | 0 = 0, bestC = 0, bestA: LadderAnchor | null = null;
    for (const a of anchors) {
      // a looked-at lot never stands in as its own kin
      if (a.seed.kind === 'signal' && a.seed.lotId === l.id) continue;
      const t = ladderTier(f, a);
      if (!t) continue;
      // inside a rung, the anchor's price level leads (a $420K Kobe is a
      // stranger to a $96 Ewing rookie, however alike the family)
      const near = f.logA != null && a.logA != null ? Math.exp(-((f.logA - a.logA) ** 2) / (2 * 0.5 * 0.5)) : 0.5;
      const c = a.seed.w * LADDER_SIM[t] * (0.6 + 0.4 * near);
      if (!bestTier || t < bestTier || (t === bestTier && c > bestC)) { bestTier = t; bestC = c; bestA = a; }
    }
    if (!bestTier || !bestA) continue;
    const fin = finish(l, f, bestC, close);
    if (fin.score <= 0) continue;
    rungs[bestTier].push({ l, score: fin.score, taste: bestC, best: { seed: bestA.seed, c: bestC, ladder: { tier: bestTier, anchor: bestA } }, f, flagged: fin.flagged, inBand: fin.inBand, inStated: fin.inStated });
  }
  // each rung sits strictly below the one above: rescale into the gap
  let ceil = rows.length ? rows[rows.length - 1].score : Infinity;
  for (const t of [2, 3, 4] as LadderTier[]) {
    const r = rungs[t].sort(order);
    if (!r.length) continue;
    const top = r[0].score;
    const k = Number.isFinite(ceil) && top >= ceil ? (ceil * 0.98) / top : 1;
    for (const x of r) x.score *= k;
    ceil = r[r.length - 1].score;
    rows.push(...r);
  }
  return rows;
}

/**
 * Rank the live pool for one taste. Returns ≤ n picks, best first — fewer
 * when fewer lots truly match (never filler).
 */
export function recommend<L extends RecLot>(pool: readonly L[], taste: Taste, opts: RecOpts = {}): Rec<L>[] {
  const n = opts.n ?? 12;
  const rows = scoreLots(pool, taste, opts);
  if (!rows.length) return [];
  const lotSeeds = taste.seeds.filter(s => s.f);
  type Row = ScoredRow<L>;

  // DIVERSITY — a greedy deal with soft penalties: every pick already
  // dealt from the same entity / sale / seed / house discounts the next
  // (a strong same-maker lot still beats a weak stranger; a run of one
  // sale or one seed's twins does not wall the list). Hard: one seat per
  // object or card identity (any grade), a same card live at another
  // house is the same seat, and ≤ ~40% of the seats to one entity.
  const out: Row[] = [];
  // a taste that IS one entity (a Star Wars desk, a Patek desk) is not
  // diversified away from it: the entity's share of the lot seeds' weight
  // softens its penalty and lifts its cap
  const seedW = new Map<string, number>();
  let seedTot = 0;
  for (const s of lotSeeds) { seedTot += s.w; if (s.f!.named && s.f!.ek) seedW.set(s.f!.ek, (seedW.get(s.f!.ek) ?? 0) + s.w); }
  // (r9, QA4 C1) a followed maker / player / subject IS a named entity of the
  // taste: it carries its weight to its entity key(s), so a reader who follows
  // only Warhol is a Warhol taste (share 1) — the follow used to add to the
  // total and never to the entity, so every follow-only taste read share 0
  // and capped at ~40% of the seats (10 of 101 live Warhol lots)
  for (const s of taste.seeds) {
    const fo = s.follow;
    if (!fo || (fo.kind !== 'entity' && fo.kind !== 'maker')) continue;
    seedTot += s.w;
    const eks = fo.kind === 'entity' ? [fo.key] : [`mk:${fo.key}`, `pl:${fo.key}`];
    for (const ek of eks) seedW.set(ek, (seedW.get(ek) ?? 0) + s.w);
  }
  const shareOf = (ek: string | null) => (ek && seedTot > 0 ? Math.min(1, (seedW.get(ek) ?? 0) / seedTot) : 0);
  // the per-entity cap reads a fixed deal size, not n: home (20) and the
  // profile (24) deal the same list, so home is the profile's prefix (C7)
  const capN = Math.max(n, REC_DEAL);
  const cand = rows.slice(0, Math.max(400, capN * 20));
  const perEnt = new Map<string, number>(), perSale = new Map<string, number>(), perHouse = new Map<string, number>(), perSeed = new Map<Seed, number>();
  const seen = new Set<string>();
  const keysOf = (r: Row) => ({
    ent: r.f.ek ?? `id:${r.l.id}`, sale: saleKeyOf(r.l), house: r.l.auctionHouse ?? '',
    thing: r.f.card ? `card:${r.f.card}` : `t:${r.l.auctionHouse}|${normTitle(r.l.title)}`,
  });
  const keys = new Map(cand.map(r => [r, keysOf(r)]));
  const used = new Set<Row>();
  const bump = <K,>(m: Map<K, number>, key: K) => m.set(key, (m.get(key) ?? 0) + 1);
  // two phases: every real tie is dealt before any fallback rung opens (a
  // diversity penalty never lets a ladder row jump a real one)
  let ladderOpen = !cand.some(r => !r.best.ladder);
  // ONE SEED'S SHARE (Oct 11): no single seed — one "More like this" at .7,
  // one save — takes more than ~40% of the seats while another seed still
  // has something to deal, so a mixed taste stays mixed. A one-seed taste
  // (or one whose other seeds run dry) fills past the cap rather than
  // printing a short list.
  const seedCapOn = new Set(cand.map(r => r.best.seed)).size > 1;
  let seedCap = Math.ceil(capN * SEED_SHARE);
  while (out.length < n) {
    let best: Row | null = null, bestV = 0;
    for (const r of cand) {
      if (used.has(r)) continue;
      if (r.best.ladder && !ladderOpen) continue;
      const k = keys.get(r)!;
      if (seen.has(k.thing) || seen.has(`id:${r.l.id}`)) { used.add(r); continue; }
      const e = perEnt.get(k.ent) ?? 0;
      const share = r.f.named ? shareOf(r.f.ek) : 0;
      if (r.f.named && e >= Math.max(4, Math.ceil(capN * (0.4 + 0.5 * share)))) continue;
      if (seedCapOn && (perSeed.get(r.best.seed) ?? 0) >= seedCap) continue;
      const v = r.score
        * Math.pow(r.f.named ? 0.8 + 0.15 * share : 0.7, e)
        * Math.pow(0.85, perSale.get(k.sale) ?? 0)
        * Math.pow(0.8, perSeed.get(r.best.seed) ?? 0)
        * Math.pow(0.94, perHouse.get(k.house) ?? 0);
      if (v > bestV) { bestV = v; best = r; }
    }
    if (!best) {
      if (!ladderOpen) { ladderOpen = true; continue; }
      // every seed with lots left sits at the cap: lift it one seat (the
      // strongest seed takes the next, the others keep pace) — a one-seed
      // taste walks it up to the full deal
      if (seedCapOn && seedCap < n) { seedCap++; continue; }
      break;
    }
    const k = keys.get(best)!;
    used.add(best);
    out.push(best);
    bump(perEnt, k.ent); bump(perSale, k.sale); bump(perHouse, k.house); bump(perSeed, best.best.seed);
    seen.add(k.thing); seen.add(`id:${best.l.id}`);
    for (const x of best.l.crossLive || []) if (x?.id) seen.add(`id:${x.id}`);
  }

  // (r9, QA4 C2) the same card in another grade lost its seat to the better
  // fit — the kept pick says the other is live too ("also live as PSA 10")
  const twinOf = new Map<string, Row>();
  const picked = new Set(out);
  for (const r of rows) {
    if (picked.has(r) || !r.f.card) continue;
    const t = `card:${r.f.card}`;
    if (!twinOf.has(t)) twinOf.set(t, r);
  }

  return out.map(r => {
    const { reason: base, why, short: baseShort } = explain(r.l, r.f, r.best, lotSeeds, taste.bands, !!r.inBand);
    const tw = r.f.card ? twinOf.get(`card:${r.f.card}`) : undefined;
    const twinNote = tw ? twinNoteOf(r.l, tw.l) : null;
    // the suffixes, each only when TRUE: the engine's below-market flag
    // (isFlagged — a published read, never a number made up here), else the
    // reader's learned band when the lot sits in it and the reason does not
    // already print a band; then the card's other grade live
    // the learned band speaks first; else the range the reader stated
    const band = r.inBand ? bandOfCat(taste.bands, r.f.cat) : null;
    const said = !band && r.inStated && taste.stated ? taste.stated.say : null;
    const extra = [
      r.flagged ? ENGINE_NOTE : !/\$/.test(base) && band ? `in your ${band} range` : !/\$/.test(base) && said ? said : null,
      twinNote,
    ].filter(Boolean).join(' · ');
    const reason = extra ? `${base} · ${extra}` : base;
    const short = baseShort ? (extra ? `${baseShort} · ${extra}` : baseShort) : reason;
    return {
      lot: r.l, score: Math.round(r.score * 1000) / 1000, taste: Math.round(r.taste * 1000) / 1000, reason, short, why, seed: r.best.seed,
      flagged: !!r.flagged, inBand: !!r.inBand, tier: r.best.ladder?.tier ?? 1,
    };
  });
}

/* ── reasons ────────────────────────────────────────────────────────────── */

/** "also live as PSA 10" / "also live raw" (the house when only it differs) */
function twinNoteOf(kept: RecLot, twin: RecLot): string | null {
  const g = cardGradeOf(twin.title);
  if (g === cardGradeOf(kept.title)) return twin.auctionHouse && twin.auctionHouse !== kept.auctionHouse ? `also live at ${twin.auctionHouse}` : null;
  return `also live ${g === 'raw' ? 'raw' : `as ${g}`}`;
}

function explain(l: RecLot, f: Feat, best: { seed: Seed; parts?: SimParts; ladder?: LadderHit }, lotSeeds: Seed[], bands?: ReadonlyMap<CatKey, PriceBand>, inBand = false): { reason: string; why: string[]; short?: string } {
  const s = best.seed;
  const why: string[] = [];
  // an on-device signal speaks as what the reader did ("Because you looked
  // at Andy Warhol", "Because you searched “kaws”") — never as "your" desk
  if (s.kind === 'signal' && !s.f) return { reason: `Because you ${s.verb} ${s.query ? `“${s.label}”` : s.label}`, why: [] };
  lotSeeds = lotSeeds.filter(x => x.kind !== 'signal');
  if (best.ladder) return ladderReason(l, f, best.ladder, s);
  if (s.follow) {
    const word = s.follow.kind === 'house' ? 'house' : s.follow.kind === 'cat' ? 'category' : s.follow.kind === 'entity' ? 'subject' : 'name';
    return { reason: `You follow ${s.follow.label}`, why: [`followed ${word}`] };
  }
  if (s.query) return { reason: `Matches your search “${s.label}”`, why: ['saved search'] };
  const p = best.parts!;
  if (p.card) why.push('same card');
  else if (p.entity) why.push(`same ${entityWord(f.ek)}`);
  else if (p.franchise) why.push(`also ${franchiseName(f) ?? 'the same franchise'}`);
  else if (p.drill) why.push('same model line');
  const shared = p.shared.filter(k => FX_WORD[k]).map(k => FX_WORD[k]);
  if (shared.length) why.push(shared.slice(0, 2).join(', '));
  // the learned band speaks when the lot sits in it (the seed's own price
  // kernel otherwise — one save's neighborhood)
  const bandWords = inBand ? bandOfCat(bands, f.cat) : null;
  if (bandWords) why.push(`in your ${bandWords} range`);
  else if (p.price != null && p.price >= 0.6) why.push('in your price range');
  if (!why.length && p.sub) why.push(`also ${subLabel(f.cat, f.sub)}`);
  if (s.kind === 'signal') {
    const lead = why[0] ? why[0].charAt(0).toUpperCase() + why[0].slice(1) : null;
    return { reason: `Because you ${s.verb} ${s.label}`, why, short: lead ? `${lead} · you ${s.verb} ${s.label}` : undefined };
  }

  // several things on the desk share this lot's named entity and kind →
  // speak about the group ("Like your Andy Warhol prints · $20K–40K")
  if (f.named) {
    const group = lotSeeds.filter(x => x.f!.ek === f.ek && x.f!.cat === f.cat && (x.f!.sub === f.sub || f.cat === 'sports-cards'));
    if (group.length >= 2) {
      const name = entityName(f, l);
      const prices = group.map(x => x.f!.logA).filter((x): x is number => x != null).map(x => Math.pow(10, x));
      let band = '';
      if (prices.length >= 2 && f.logA != null) {
        const lo = Math.min(...prices), hi = Math.max(...prices);
        const a = Math.pow(10, f.logA);
        if (a >= lo / 1.6 && a <= hi * 1.6 && hi / lo <= 20) band = ` · ${bandText(lo, hi)}`;
      }
      return { reason: `Like your ${name} ${nounOf(f.cat, f.sub)}${band}`, why };
    }
  }
  // a franchise the desk keeps returning to speaks as the group, whoever
  // the lot's own subject is ("Like your Star Wars pieces")
  if (p.franchise && !p.entity) {
    const fr = Array.from(f.fx).find(k => k.startsWith('fr-'));
    if (fr && FACET_LABEL[fr] && lotSeeds.filter(x => x.f!.fx.has(fr)).length >= 2) {
      return { reason: `Like your ${FACET_LABEL[fr]} ${nounOf(f.cat, f.sub)}`, why };
    }
  }
  // a tie by CUT, not by name (a vintage PSA card for a vintage PSA desk,
  // another maker's print at your price): naming one save ("Because you
  // saved Phil Haugstad…" over a Jackie Robinson) reads as a non sequitur —
  // speak about the cut the desk shares instead
  if (!p.entity && !p.card && !p.franchise && !p.drill) {
    const cut = cutReason(f, p, lotSeeds);
    if (cut) return { reason: cut, why };
  }
  const verb = s.kind === 'owned' ? 'own' : s.live ? 'saved' : 'watched';
  // an art / design / watch title rarely names its maker ("Untitled (L. p.
  // 112)", "A fine and attractive stainless steel…") — say whose it was
  const named = s.f?.ek?.startsWith('mk:') && s.who && !s.label.toLowerCase().includes(s.who.toLowerCase());
  const what = `${named ? `${s.who} · ` : ''}${s.label}`;
  const lead = why[0] ? why[0].charAt(0).toUpperCase() + why[0].slice(1) : null;
  return { reason: `Because you ${verb} ${what}`, why, short: lead ? `${lead} · you ${verb} ${what}` : undefined };
}

/** what a family is called, for "Another …" */
function familyWord(a: LadderAnchor): string {
  const fam = a.fam ?? '';
  if (fam.startsWith('pl|')) {
    const era = fam.split('|')[3];
    const sport = a.sport ? SPORT_WORD[a.sport] : null;
    const eraW = era ? FX_WORD[era] : null;
    return `${eraW ? `${eraW} ` : ''}${sport && sport !== 'other sports' ? `${sport} ` : ''}player`;
  }
  if (fam.startsWith('mk|')) return `maker's ${nounOf(a.cat, a.sub ?? '')}`;
  if (fam.startsWith('st:')) return 'set';
  const pre = fam.slice(fam.indexOf('|') + 1);
  return ({ k: 'Pokémon', p: 'figure', f: 'film', fr: 'franchise', m: 'mission', t: 'team', b: 'brand', s: 'set' } as Record<string, string>)[pre] ?? 'subject';
}
/** a fallback rung's reason: which rung, and whose it is
 *  ("Another Pokémon · you follow Charizard",
 *   "More vintage PSA basketball cards · you follow Patrick Ewing",
 *   "More basketball cards at Patrick Ewing's prices · $200–900") */
function ladderReason(l: RecLot, f: Feat, hit: LadderHit, s: Seed): { reason: string; why: string[]; short: string } {
  const a = hit.anchor;
  // an on-device signal anchors as what the reader did, never as a follow or a save
  const src = s.kind === 'signal' ? `you ${s.verb} ${s.label}` : s.follow ? `you follow ${s.label}` : `you ${s.kind === 'owned' ? 'own' : s.live ? 'saved' : 'watched'} ${s.label}`;
  const whose = s.follow || s.kind === 'signal' ? s.label : 'your save';
  const sport = f.sport ? SPORT_WORD[f.sport] : null;
  const noun = f.cat === 'sports-cards' ? `${sport && sport !== 'other sports' ? `${sport} ` : ''}cards`
    : f.cat === 'tcg' ? 'Pokémon cards'
    : nounOf(f.cat, f.sub);
  let lead: string;
  if (hit.tier === 2) lead = `Another ${familyWord(a)}`;
  else if (hit.tier === 3) {
    const words = a.cut.filter(k => f.fx.has(k) && FX_WORD[k]).sort((x, y) => rankCut(x) - rankCut(y)).slice(0, 2).map(k => FX_WORD[k]);
    lead = `More ${words.length ? `${words.join(' ')} ` : ''}${noun}`;
  } else {
    const p = a.logA != null ? Math.pow(10, a.logA) : null;
    lead = `More ${noun} at ${whose === 'your save' ? 'your save’s' : `${whose}’s`} prices${p ? ` · ~${bandText(p, p)}` : ''}`;
  }
  const why = [hit.tier === 2 ? `another ${familyWord(a)}` : hit.tier === 3 ? 'same cut' : 'same price level'];
  void l;
  return { reason: `${lead} · ${src}`, why, short: `${lead} · ${src}` };
}

const SPORT_WORD: Record<string, string> = Object.fromEntries(SPORTS.map(x => [x.key, x.label.toLowerCase()]));
const CUT_ORDER = /^(?:era-|lang-|psa|sgc|bgs|cgc|tag|g10|cx-|flown|rookie|auto|relic|numbered|painting|on-paper)/;
/** "More vintage PSA baseball cards like yours · $100–800",
 *  "More prints in your range · $5K–70K" */
function cutReason(f: Feat, p: SimParts, lotSeeds: Seed[]): string | null {
  const words = p.shared.filter(k => CUT_ORDER.test(k) && FX_WORD[k]).sort((a, b) => rankCut(a) - rankCut(b)).slice(0, 2).map(k => FX_WORD[k]);
  const sport = f.sport ? SPORT_WORD[f.sport] : null;
  const noun = f.cat === 'sports-cards' ? `${sport && sport !== 'other sports' ? `${sport} ` : ''}cards`
    : f.cat === 'tcg' ? 'Pokémon cards'
    : f.cat === 'space-science' ? `${subLabel(f.cat, f.sub)} pieces`
    : nounOf(f.cat, f.sub);
  // the band of the saves that share this cut (same sub and sport)
  const group = lotSeeds.filter(x => x.f!.cat === f.cat && x.f!.sub === f.sub && (x.f!.sport ?? null) === (f.sport ?? null));
  const prices = group.map(x => x.f!.logA).filter((x): x is number => x != null).map(x => Math.pow(10, x));
  let band = '';
  if (prices.length >= 2 && f.logA != null) {
    const lo = Math.min(...prices), hi = Math.max(...prices), a = Math.pow(10, f.logA);
    if (a >= lo / 1.6 && a <= hi * 1.6 && hi / lo <= 40) band = ` · ${bandText(lo, hi)}`;
  }
  if (p.weak) return `More ${noun} in your range${band}`;
  if (!words.length) return null;
  return `More ${words.join(' ')} ${noun} like yours${band}`;
}
const rankCut = (k: string) => (k.startsWith('era-') ? 0 : k.startsWith('lang-') ? 1 : /^(?:psa|sgc|bgs|cgc|tag)$/.test(k) ? 2 : 3);

/** the note a row prints: the reason, then the first matched fact the
 *  reason does not already say */
export function recNote(r: Pick<Rec, 'reason' | 'why'> & { short?: string }, opts: { short?: boolean } = {}): string {
  if (opts.short && r.short) return r.short;
  const extra = r.why.find(w => !/^(?:followed|saved search)/.test(w) && !r.reason.toLowerCase().includes(w.toLowerCase()));
  return extra && !/^(?:Like your|More )/.test(r.reason) ? `${r.reason} · ${extra}` : r.reason;
}

/* ── the return loop ────────────────────────────────────────────────────── */

/** "tonight" ends at 4am local after `nowMs` (an evening close at a West
 *  Coast or Asian house still lands before the reader's morning) */
export function tonightEndMs(nowMs: number): number {
  const d = new Date(nowMs);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 4, 0, 0, 0);
  if (end.getTime() <= nowMs) end.setDate(end.getDate() + 1);
  return end.getTime();
}

export interface PickStrips<L extends RecLot = RecLot> {
  /** picks the reader has not been shown before: first seen after their
   *  previous visit (the caller's isNew — feed-filters.isNewLot, onboarding
   *  floods excluded) */
  fresh: Rec<L>[];
  /** picks closing before tonight ends, soonest first */
  closing: Rec<L>[];
}

/**
 * THE RETURN LOOP (Oct 11) — two compact strips above the picks, cut from
 * the reader's own picks (never from the whole block: "new" here means new
 * AND yours). A pick closing tonight shows there and not again under new.
 * Either strip may be empty; the caller says so.
 */
export function pickStrips<L extends RecLot>(recs: readonly Rec<L>[], opts: { isNew: (l: L) => boolean; nowMs?: number; closesBy?: number; max?: number }): PickStrips<L> {
  const nowMs = opts.nowMs ?? Date.now();
  const by = opts.closesBy ?? tonightEndMs(nowMs);
  const max = opts.max ?? 3;
  const closing = recs
    .map(r => ({ r, c: closeMsOf(r.lot) }))
    .filter(x => x.c != null && x.c > nowMs && x.c <= by)
    .sort((a, b) => (a.c! - b.c!) || (b.r.score - a.r.score))
    .slice(0, max)
    .map(x => x.r);
  const inClosing = new Set(closing.map(r => r.lot.id));
  const fresh = recs.filter(r => !inClosing.has(r.lot.id) && opts.isNew(r.lot)).slice(0, max);
  return { fresh, closing };
}
