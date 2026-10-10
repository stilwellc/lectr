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
import { parseCard, cardLadderKey } from './cards';
import { prioStatic, priorityOf, closeMsOf, saleKeyOf } from './priority';
import { matchesSavedQuery, unmatchableReason } from './saved-query';
import { makerLineOf } from './lot-labels';
import { craftTitle } from '../utils';
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

export type SeedKind = 'owned' | 'saved' | 'follow' | 'search';
export const SEED_WEIGHT: Record<SeedKind, number> = { owned: 1, saved: 0.75, follow: 0.55, search: 0.35 };
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

export interface TasteInput {
  saved: SavedInput[];
  follows: Follow[];
  searches?: SearchInput[];
  nowMs?: number;
}

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
}

export interface Taste {
  seeds: Seed[];
  /** ids (with aliases) of everything on the desk — never recommended back */
  exclude: Set<string>;
  /** card identities / titles on the desk (relists and twins never come back) */
  excludeKeys: Set<string>;
  counts: { owned: number; saved: number; follows: number; searches: number };
}

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

export function featOf(l: RecLot, nowMs: number, estFallback?: number | null): Feat {
  const hit = featMemo.get(l as object);
  if (hit) return hit;
  const t = taxonOf(l);
  const ek = ekOf(l);
  let card: string | null = null;
  if (CARD_CATS.has(t.cat) && l.title) card = cardLadderKey(parseCard(l.title));
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
  return { seeds, exclude, excludeKeys, counts: { owned, saved, follows: input.follows.length, searches } };
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
  return makerLineOf(l as Parameters<typeof makerLineOf>[0]).name;
}

const FX_WORD: Record<string, string> = {
  psa: 'PSA', sgc: 'SGC', bgs: 'BGS', cgc: 'CGC', g10: 'gem 10', rookie: 'rookie', auto: 'signed',
  'era-prewar': 'pre-war', 'era-vintage': 'vintage', 'era-80s90s': "'80s–'90s", 'era-modern': 'modern',
  'lang-ja': 'Japanese', 'lang-zh': 'Chinese', flown: 'flown', relic: 'relic', numbered: 'numbered',
  'film-tv': 'film & TV', music: 'music', 'cx-moon': 'moon phase', 'cx-gmt': 'GMT', 'cx-diver': 'diver', 'cx-tourbillon': 'tourbillon', 'cx-repeater': 'repeater',
  'cx-chrono': 'chronograph', 'cx-perpetual': 'perpetual', painting: 'painting', 'on-paper': 'on paper',
};

/** one scored lot before the diversity pass (the eval reads the full ranking) */
export interface ScoredRow<L extends RecLot = RecLot> { l: L; score: number; taste: number; best: { seed: Seed; c: number; parts?: SimParts }; f: Feat }

/**
 * Every lot on the block one seed truly reaches, scored and sorted best
 * first — no caps (recommend() deals the diversity).
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
  for (const l of pool) {
    if (l.status && l.status !== 'upcoming') continue;
    if (opts.onBlock && !opts.onBlock(l)) continue;
    if (taste.exclude.has(l.id)) continue;
    const close = closeMsOf(l);
    if (close != null && close <= nowMs) continue;
    if (opts.maxDays != null && (close == null || close - nowMs > opts.maxDays * 864e5)) continue;
    // cheap pre-gate: a lot no seed can reach skips the feature pass
    const t = taxonOf(l);
    let reach = seedCats.has(t.cat) || searchSeeds.length > 0;
    if (!reach) for (const s of followSeeds) {
      const fo = s.follow!;
      if (fo.kind === 'house' ? l.auctionHouse === fo.key : fo.kind === 'cat' ? fo.key.split(':')[0] === t.cat : true) { reach = true; break; }
    }
    if (!reach) continue;
    const f = featOf(l, nowMs);
    if (f.card && taste.excludeKeys.has(`card:${f.card}|${normTitle(l.title)}`)) continue;
    if (taste.excludeKeys.has(`t:${l.auctionHouse ?? ''}|${normTitle(l.title)}`)) continue;

    const contribs: { seed: Seed; c: number; parts?: SimParts }[] = [];
    for (const s of lotSeeds) {
      const p = lotSim(f, s.f!);
      if (p.sim < LOT_SIM_MIN) continue;
      contribs.push({ seed: s, c: s.w * p.sim, parts: p });
    }
    for (const s of followSeeds) {
      const v = followSim(l, f, s.follow!);
      if (v > 0) contribs.push({ seed: s, c: s.w * v });
    }
    for (const s of searchSeeds) {
      if (matchesSavedQuery(s.query!, l, today)) contribs.push({ seed: s, c: s.w * 0.6 });
    }
    if (!contribs.length) continue;
    contribs.sort((a, b) => b.c - a.c);
    const tasteV = contribs[0].c + 0.35 * (contribs[1]?.c ?? 0) + 0.15 * (contribs[2]?.c ?? 0);
    const pr = priorityOf(l, nowMs);
    const q = pr ? pr.score / 100 : 0.1;
    const score = tasteV * (0.45 + 0.55 * q) * windowFactor(close, nowMs);
    if (score <= 0) continue;
    rows.push({ l, score, taste: tasteV, best: contribs[0], f });
  }
  rows.sort((a, b) => (b.score - a.score) || (a.l.id < b.l.id ? -1 : 1));
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
  for (const s of taste.seeds) if (s.follow && (s.follow.kind === 'entity' || s.follow.kind === 'maker')) seedTot += s.w;
  const shareOf = (ek: string | null) => (ek && seedTot > 0 ? (seedW.get(ek) ?? 0) / seedTot : 0);
  const cand = rows.slice(0, Math.max(400, n * 20));
  const perEnt = new Map<string, number>(), perSale = new Map<string, number>(), perHouse = new Map<string, number>(), perSeed = new Map<Seed, number>();
  const seen = new Set<string>();
  const keysOf = (r: Row) => ({
    ent: r.f.ek ?? `id:${r.l.id}`, sale: saleKeyOf(r.l), house: r.l.auctionHouse ?? '',
    thing: r.f.card ? `card:${r.f.card}` : `t:${r.l.auctionHouse}|${normTitle(r.l.title)}`,
  });
  const keys = new Map(cand.map(r => [r, keysOf(r)]));
  const used = new Set<Row>();
  const bump = <K,>(m: Map<K, number>, key: K) => m.set(key, (m.get(key) ?? 0) + 1);
  while (out.length < n) {
    let best: Row | null = null, bestV = 0;
    for (const r of cand) {
      if (used.has(r)) continue;
      const k = keys.get(r)!;
      if (seen.has(k.thing) || seen.has(`id:${r.l.id}`)) { used.add(r); continue; }
      const e = perEnt.get(k.ent) ?? 0;
      const share = r.f.named ? shareOf(r.f.ek) : 0;
      if (r.f.named && e >= Math.max(4, Math.ceil(n * (0.4 + 0.5 * share)))) continue;
      const v = r.score
        * Math.pow(r.f.named ? 0.8 + 0.15 * share : 0.7, e)
        * Math.pow(0.85, perSale.get(k.sale) ?? 0)
        * Math.pow(0.8, perSeed.get(r.best.seed) ?? 0)
        * Math.pow(0.94, perHouse.get(k.house) ?? 0);
      if (v > bestV) { bestV = v; best = r; }
    }
    if (!best) break;
    const k = keys.get(best)!;
    used.add(best);
    out.push(best);
    bump(perEnt, k.ent); bump(perSale, k.sale); bump(perHouse, k.house); bump(perSeed, best.best.seed);
    seen.add(k.thing); seen.add(`id:${best.l.id}`);
    for (const x of best.l.crossLive || []) if (x?.id) seen.add(`id:${x.id}`);
  }

  return out.map(r => {
    const { reason, why, short } = explain(r.l, r.f, r.best, lotSeeds);
    return { lot: r.l, score: Math.round(r.score * 1000) / 1000, taste: Math.round(r.taste * 1000) / 1000, reason, short: short ?? reason, why, seed: r.best.seed };
  });
}

/* ── reasons ────────────────────────────────────────────────────────────── */

function explain(l: RecLot, f: Feat, best: { seed: Seed; parts?: SimParts }, lotSeeds: Seed[]): { reason: string; why: string[]; short?: string } {
  const s = best.seed;
  const why: string[] = [];
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
  if (p.price != null && p.price >= 0.6) why.push('in your price range');
  if (!why.length && p.sub) why.push(`also ${subLabel(f.cat, f.sub)}`);

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
