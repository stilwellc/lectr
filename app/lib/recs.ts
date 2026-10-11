/**
 * recs.ts — "Lots you may like" (Oct 10 2026; re-tuned Oct 11 against a
 * held-out eval, scripts/recs-eval.ts). ONE recommender for the profile's
 * For-you room and the home feed's For-you tab, so the two agree.
 *
 * THE TASTE PROFILE is a list of SEEDS — the things the reader told us,
 * each with a weight by how strongly it speaks:
 *
 *   owned   a lot they marked "I won it"                     1.00
 *   saved   a lot on their desk (live, or settled = watched)  0.75
 *   follow  a maker / player / subject / category / house    0.55
 *   search  a saved search (its own matcher decides a hit)    0.35
 *   signal  what this device learned (recs-signals): a lot view .25,
 *           an entity page .2, a searched term .15, "More like this" .7
 *   market  a quick-start market with no name in it            0.30
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
 * — and a follow or search seed matches by its own rule (a followed name by
 * its slug / entity id; a category, house or market by the lot's clean
 * category, only when the lot IS that kind of object — app/lib/object-kind;
 * a searched term by entity + facet, never by loose title words; a saved
 * search by saved-query's matcher). Contributions W·sim are combined with
 * diminishing returns (best + .35·second + .15·third). Then
 *
 *   score = taste × (0.8 + 0.2 · priority/100) × closing window
 *           × the reader's band (learned per category, or the stated range)
 *           × "Not for me" quieting
 *
 * where priority is THE "matters most" score (app/lib/priority — it already
 * carries the engine's below-market edge, so a flagged lot gets no second
 * lift; its reason still says so). A broad follow (a category, a house, a
 * market) is read through the names the reader keeps in that category (same
 * sport / era / cut lead; a Wembanyama reader's "Singles" follow is modern
 * basketball, not F1), and a followed name with no band to read leans to the
 * name's own price level (a Warhol follower is not handed only grails).
 *
 * THE DEAL (recommend) is greedy with soft repeat penalties: a NAMED tie
 * (the same maker / player / subject / card as a seed, or a followed name)
 * is barely discounted by its own repeats — the reader asked for that name —
 * while a GENERIC tie (a cut, a broad follow, a fallback rung) is spread
 * hard. Hard caps, lifted one seat at a time only when every seed with lots
 * left sits at them (never filler below the entry bar):
 *   one seed      ≤ 40% of the deal (a broad seed ≤ 20%; a followed name the
 *                 taste is mostly about up to 90% of its share; the device's
 *                 quiet signals count as one seed; a save's own ties are
 *                 bounded by the entity cap instead)
 *   one sale      ≤ 1/6 of the GENERIC seats (house + close day) — unless
 *                 nothing elsewhere comes within 70%; a named tie is never
 *                 capped by its sale
 *   one entity    ≤ 40–90% by its share of the taste
 *   one object    one seat per card identity in any grade / title per house
 * Phases: every real tie in range first, then the FALLBACK LADDER (same
 * identity family → same sub + cut → same category at the anchor's prices;
 * inside a stated range only), then real ties far outside a stated range
 * (each saying "below your $50K floor"). What the device learned keeps a
 * small guaranteed share (3 of every 24 seats) once the reader has said
 * anything out loud. Lots already on the desk never come back.
 *
 * Every pick carries its REASON — the seed that put it there, in words
 * ("Because you saved 1952 Topps Mantle PSA 3", "You follow Charizard",
 * "Like your Andy Warhol prints · $20K–40K") — and `why`, the matched
 * facts; a price band is printed only on a lot inside it. A reader with no
 * seeds gets NO picks (cold start is said, not faked). Pure: no React, no
 * storage — the eval script and the tests run it over the real book.
 */
import { taxonOf, subMatches, subLabel, SPORTS, MARKET_CATS, type CatKey } from './taxonomy';
import { lotFacets, FACET_LABEL } from './facets';
import { entityKeyOf } from './entity/key';
import { parseCard, cardLadderKey, cardSetKey, cardYearKey, type CardId } from './cards';
import { prioStatic, priorityOf, closeMsOf, saleKeyOf } from './priority';
import { tonightEndMs } from './close-time';
import { matchesSavedQuery, unmatchableReason } from './saved-query';
import { makerLineOf } from './lot-labels';
import { craftTitle, isClosedPending } from '../utils';
import { ARTIST_LABEL, MARKETS } from '../constants';
import { isFlagged } from './flags';
import { lotIdTwins } from './id-aliases';
import { kindFits } from './object-kind';
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
  /** the upstream object class / item class (object-kind reads them) */
  objectClass?: string | null;
  itemClass?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any; signal?: any;
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
export interface NegativeInput {
  ids?: Iterable<string>;
  keys?: Iterable<string>;
  /** (Oct 11) the passed lots themselves (resolved row or snapshot): the seed
   *  that explained each one is quieted (×0.75 per pass, floored), and a lot
   *  with no named entity quiets its cut (category · sub · sport · era) */
  lots?: Iterable<RecLot>;
}

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
  /** the markets the reader picked in the quick start (app/lib/interests):
   *  a market with no followed or saved name in it still deals its own
   *  picks — the weakest seed, read as its categories */
  markets?: readonly string[];
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
  /** a BROAD seed — a category / house follow, a quick-start market: it
   *  fills fewer seats than a name */
  broad?: boolean;
  /** a quick-start market seed: the market's words ("TCG") */
  market?: string;
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
  /** entity ids the reader follows (maker / player / subject) — "Not for me"
   *  quiets them only so far */
  followedEks?: Set<string>;
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
/** per lot object, per UTC day: the price anchor moves as bids arrive and
 *  closes near, so a tab left open for days never reads yesterday's features */
const featMemo = new WeakMap<object, { day: number; f: Feat }>();

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
  const day = Math.floor(nowMs / 864e5);
  const hit = featMemo.get(l as object);
  if (hit && hit.day === day) return hit.f;
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
  featMemo.set(l as object, { day, f });
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
  // (W16) the same Christie's object under the other crawler's id — the
  // build keeps ONE (christies-<n>), a save may be keyed under either
  out.push(...lotIdTwins(id));
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
  // (Oct 11) a quick-start market with no name in it still deals its own
  // picks: the weakest seed, one per category of the market (scoreLots opens
  // it only for a category no followed or saved name already covers)
  for (const m of Array.from(new Set(input.markets ?? []))) {
    const cats = MARKET_CATS[m];
    if (!cats) continue;
    const label = MARKETS.find(x => x.key === m)?.label ?? m;
    for (const cat of cats) seeds.push({ kind: 'follow', w: MARKET_WEIGHT, label, follow: { kind: 'cat', key: cat, label }, broad: true, market: label });
  }
  for (const s of seeds) if (s.follow && (s.follow.kind === 'cat' || s.follow.kind === 'house')) s.broad = true;
  const followedEks = new Set<string>();
  for (const fo of input.follows) {
    if (fo.kind === 'maker') followedEks.add(`mk:${fo.key}`).add(`pl:${fo.key}`);
    else if (fo.kind === 'entity') followedEks.add(fo.key);
  }
  // (Oct 11) "Not for me" reaches the SEED that explained the pick, not only
  // its entity: each pass quiets the strongest seed tying the passed lot
  // ×0.75 (a save floors at .3, a follow — a standing statement — at .5), and
  // a lot with no named entity (a collection bucket, 12% of the block) quiets
  // its cut — the category · sub · sport · era it stood for
  const passed = new Map<Seed, number>();
  const today = new Date(nowMs).toISOString().slice(0, 10);
  for (const nl of Array.from(neg?.lots ?? [])) {
    if (!nl || !nl.title) continue;
    const nf = featOf(nl, nowMs);
    if (!nf.named) { const k = cutKeyOf(nf); down.set(k, (down.get(k) ?? 0) + 1); }
    let best: Seed | null = null, bc = 0;
    for (const s of seeds) {
      let c = 0;
      if (s.f) { if (s.lotId === nl.id) continue; const p = lotSim(nf, s.f); c = p.sim >= LOT_SIM_MIN ? s.w * p.sim : 0; }
      else if (s.follow) c = s.w * followSim(nl, nf, s.follow);
      else if (s.query) c = (s.kind === 'signal' ? termMatcherOf(s.label)?.(nl, nf) : matchesSavedQuery(s.query, nl, today)) ? s.w * 0.6 : 0;
      if (c > bc) { bc = c; best = s; }
    }
    if (best) passed.set(best, (passed.get(best) ?? 0) + 1);
  }
  passed.forEach((k, s) => { s.w *= Math.max(s.f ? 0.3 : 0.5, Math.pow(0.75, k)); });
  return { seeds, exclude, excludeKeys, down, counts: { owned, saved, follows: input.follows.length, searches, signals }, bands: learnBands(seeds), stated: statedBandOf(input.price), followedEks };
}

/** a quick-start market's seed weight — below a follow, above a page view */
const MARKET_WEIGHT = 0.3;

/** the cut a lot with no named entity stands for ("Not for me" quiets it) */
function cutKeyOf(f: Pick<Feat, 'cat' | 'sub' | 'sport' | 'fx'>): string {
  return `cut:${f.cat}|${f.sub}|${f.sport ?? ''}|${eraOf(f.fx) ?? ''}`;
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
/** the same named entity in another category (a card desk's player on a signed ball) */
const CROSS_CAT_SIM = 0.42;

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
export function lotSim(c: Feat, s: Feat, entityTie = REC_TUNE.entityTie): SimParts {
  const out: SimParts = { sim: 0, sub: false, entity: false, card: false, franchise: false, drill: false, weak: false, shared: [], fx: 0, price: null, house: false };
  if (c.cat !== s.cat) {
    // (Oct 11) the same NAMED entity across categories — a Derek Jeter signed
    // ball for a desk of Jeter cards, a Sinatra letter for his photographs —
    // is a tie of its own (weaker than inside one category); nothing else crosses
    if (c.named && s.named && c.ek === s.ek) { out.entity = true; out.sim = CROSS_CAT_SIM; }
    return out;
  }
  if (c.sport && s.sport && c.sport !== s.sport) return out;
  let v = 0.1;
  if (c.sub === s.sub) { v += 0.12; out.sub = true; }
  if (c.named && c.ek === s.ek) { v += entityTie; out.entity = true; }
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

/* ── a searched term, read as an entity + facets ───────────────────────── */

/** words a search carries that say nothing on their own */
const TERM_DROP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'for', 'with', 'in', 'on', 'by', 'to', 'card', 'cards', 'lot', 'lots', 'item', 'items', 'screen', 'used', 'worn', 'game', 'original', 'rare', 'new', 'vintage', 'modern', 'graded']);
/** words that must match but never anchor a term (an object noun, a set word):
 *  "signed album" alone names nobody — it matched Walt Disney's Autograph Album */
const TERM_COMMON = new Set(['album', 'set', 'base', 'print', 'prints', 'screenprint', 'lithograph', 'poster', 'photo', 'photograph', 'helmet', 'jersey', 'ball', 'bat', 'letter', 'book', 'record', 'vinyl', 'chair', 'table', 'lamp', 'watch', 'painting', 'drawing', 'sculpture', 'prop', 'costume', 'edition', 'first', '1st', 'holo', 'promo', 'gold', 'silver', 'refractor', 'chrome', 'prizm', 'topps', 'panini', 'bowman', 'fleer', 'calendar', 'perpetual', 'surface', 'pop', 'shop', 'collection', 'complete', 'sealed', 'box', 'pack', 'trophy', 'award', 'shirt', 'ticket', 'program']);
const TERM_GRADERS: Record<string, string> = { psa: 'psa', sgc: 'sgc', bgs: 'bgs', beckett: 'bgs', cgc: 'cgc' };
const TERM_FACET: Record<string, { fx?: string; re?: RegExp }> = {
  japanese: { fx: 'lang-ja', re: /\b(?:japanese|japan|pocket monsters)\b/i }, japan: { fx: 'lang-ja', re: /\bjapan/i }, jp: { fx: 'lang-ja' },
  chinese: { fx: 'lang-zh', re: /\bchinese\b/i }, flown: { fx: 'flown', re: /\bflown\b/i },
  rookie: { fx: 'rookie', re: /\b(?:rookie|rc)\b/i }, rc: { fx: 'rookie', re: /\b(?:rookie|rc)\b/i },
  signed: { fx: 'auto', re: /\b(?:sign|autograph|auto\b)/i }, autograph: { fx: 'auto', re: /\b(?:sign|autograph|auto\b)/i }, autographed: { fx: 'auto', re: /\b(?:sign|autograph|auto\b)/i },
  auto: { fx: 'auto', re: /\b(?:sign|autograph|auto\b)/i }, signature: { fx: 'auto', re: /\b(?:sign|autograph|auto\b)/i },
};
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim().split(' ').filter(Boolean);
const termMemo = new Map<string, ((l: RecLot, f: Feat) => boolean) | null>();

/**
 * A searched term as a matcher (Oct 11, R1 #7): a term is read as an ENTITY
 * plus FACETS, never as loose title words. Grader / grade / language /
 * flown / rookie / signed words must hold as facts (the card's grade, its
 * language facet…), a year must be in the title, every other word must be
 * on the lot — and at least one word must ANCHOR it: a name on the lot's
 * maker / player / subject line, the term's words as a phrase in the title,
 * or one distinctive word (≥ 6 letters, not an object noun). A term that can
 * never anchor ("signed album") seeds nothing. null = no matcher.
 */
export function termMatcherOf(term: string): ((l: RecLot, f: Feat) => boolean) | null {
  const key = term.trim().toLowerCase();
  if (termMemo.has(key)) return termMemo.get(key)!;
  const ws = words(key).filter(w => !TERM_DROP.has(w));
  const graders: string[] = [], grades: number[] = [], years: string[] = [], facets: { fx?: string; re?: RegExp }[] = [], text: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (TERM_GRADERS[w]) { graders.push(TERM_GRADERS[w]); const g = ws[i + 1]; if (g && /^\d{1,2}(?:\.5)?$/.test(g)) { grades.push(parseFloat(g)); i++; } continue; }
    if (/^(?:18|19|20)\d{2}$/.test(w)) { years.push(w); continue; }
    if (TERM_FACET[w]) { facets.push(TERM_FACET[w]); continue; }
    if (/^\d+$/.test(w)) continue;
    text.push(w);
  }
  const anchorable = text.some(w => !TERM_COMMON.has(w)) || text.length >= 2 || graders.length + grades.length + years.length + facets.length >= 2;
  let fn: ((l: RecLot, f: Feat) => boolean) | null = null;
  if (anchorable && (text.length || graders.length + grades.length + years.length + facets.length >= 2)) {
    const phrase = text.length >= 2 ? ` ${text.join(' ')} ` : null;
    fn = (l, f) => {
      const title = ` ${words(String(l.title || '')).join(' ')} `;
      for (const y of years) if (!title.includes(` ${y} `)) return false;
      for (const fc of facets) if (!(fc.fx && f.fx.has(fc.fx)) && !(fc.re && fc.re.test(String(l.title || '')))) return false;
      if (graders.length || grades.length) {
        const id = parseCard(String(l.title || ''));
        for (const g of graders) if (!f.fx.has(g) && String(id.gradeCo || '').toLowerCase() !== g) return false;
        for (const g of grades) if (id.gradeNum !== g) return false;
      }
      // facets alone ("japanese psa") anchor only a term with no other words
      if (!text.length) return true;
      const name = ` ${words(`${makerLineOf(l as Parameters<typeof makerLineOf>[0]).name} ${l.playerName ?? ''} ${(l.playerSlug ?? '').replace(/-/g, ' ')} ${ARTIST_LABEL[l.artist] ?? l.artist.replace(/-/g, ' ')} ${(f.ek ?? '').replace(/[^a-z0-9]+/g, ' ')} ${(l.drill ?? '').replace(/-/g, ' ')}`).join(' ')} `;
      const on = (hay: string, w: string) => hay.includes(` ${w}`) && (w.length >= 3 || hay.includes(` ${w} `));
      let anchored = false;
      for (const w of text) {
        const inName = on(name, w);
        if (!inName && !on(title, w)) return false;
        if (inName && !TERM_COMMON.has(w)) anchored = true;
        else if (!TERM_COMMON.has(w) && w.length >= 6) anchored = true;
      }
      if (!anchored && phrase && (title.includes(phrase) || name.includes(phrase))) anchored = true;
      return anchored;
    };
  }
  termMemo.set(key, fn);
  return fn;
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
  /** a real tie far outside the range the reader stated (dealt after every
   *  lot inside it; the reason says "below your $50K floor") */
  outOfRange?: 'below' | 'above';
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

/**
 * The deal's tuning (Oct 11), chosen on scripts/recs-eval.ts's held-out
 * collectors (see the eval's header): every number here moved the held-out
 * hit rate, the baseline gap or a scenario, and the eval reports each.
 */
export interface RecTune {
  /** lotSim's same-entity weight (was .34: a name tie lost to a cut tie) */
  entityTie: number;
  /** the quality curve: qBase + (1 − qBase) · priority — priority is 40% price
   *  size, so a steep curve handed every follow its grails */
  qBase: number;
  /** per-repeat discounts on a NAMED tie (the same maker / player / subject /
   *  card as a seed, or a followed name): the reader asked for that name */
  namedEnt: number; namedSale: number; namedSeed: number;
  /** a named tie's lift in the deal over a generic one at the same score */
  namedLift: number;
  /** per-repeat discounts on a GENERIC tie (a cut, a broad follow, a rung) */
  genEnt: number; genSale: number; genSeed: number;
  house: number;
  /** hard caps, as shares of the deal: GENERIC seats from one sale (a named
   *  tie is never capped by its sale — the reader's names sell where they
   *  sell); one broad seed; one entity = entBase + entShare × its share */
  saleShare: number; broadShare: number; entBase: number; entShare: number;
  /** a sale past its cap still deals when the best lot elsewhere is worth
   *  less than this share of it (a vintage-baseball desk whose names all sell
   *  at one REA sale is not handed Pokémon to keep REA under a third) */
  saleYield: number;
  /** seats in every 24 kept for what the device learned, once the reader has
   *  said anything out loud (a deep desk otherwise never shows a view) */
  sigSeats: number;
}
export const REC_TUNE: Readonly<RecTune> = {
  entityTie: 0.5, qBase: 0.8,
  namedEnt: 0.98, namedSale: 0.98, namedSeed: 0.98, namedLift: 1,
  genEnt: 0.7, genSale: 0.93, genSeed: 0.95,
  house: 0.97,
  saleShare: 1 / 6, broadShare: 0.2, saleYield: 0.7, entBase: 0.4, entShare: 0.5,
  sigSeats: 3,
};

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
  /** the eval's knob (scripts/recs-eval.ts sweeps variants); the app never passes it */
  tune?: Partial<RecTune>;
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
  if (f.ek?.startsWith('pl:') && (!name || name === (ARTIST_LABEL[l.artist] || l.artist))) {
    return f.ek.slice(3).split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  }
  // (Oct 11) a pseudo-maker lot with no subject has no maker line - the desk label names the group
  return name || ARTIST_LABEL[l.artist] || l.artist;
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
  /** far outside the stated range (dealt last, said so) */
  out?: 'below' | 'above';
  /** the strongest tie an on-device signal lends it, when the best tie is
   *  something else (the signal quota deals it under that reason) */
  sig?: { seed: Seed; c: number; parts?: SimParts };
}

/* (Oct 11) the engine's below-market flag no longer multiplies the score: the
 * priority it is scored on already carries the engine's edge (+ up to 25),
 * and the second lift put flagged lots in 58% of an art desk's top 12 against
 * 16% of the lots that fit. The reason still says so (ENGINE_NOTE). */

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

/** how far past a stated edge a real tie is "far outside" it (×2) */
const STATED_FAR = 0.3;
/** which side of the stated range a priced lot sits FAR outside (null: inside or near) */
function statedSide(logA: number | null, b: StatedBand | null | undefined): 'below' | 'above' | null {
  if (!b || logA == null) return null;
  if (b.lo != null && logA < b.lo - STATED_FAR) return 'below';
  if (b.hi != null && logA > b.hi + STATED_FAR) return 'above';
  return null;
}

/** how well a candidate fits one anchor's cut, 0–1: the same sport, the
 *  same era, a shared distinctive facet (a broad follow reads through it) */
function anchorFit(c: Feat, a: LadderAnchor): number {
  if (c.sport && a.sport && c.sport !== a.sport) return 0;
  // a screen piece for a film reader, a stage piece for a music reader: an
  // Elvis ring is no answer to a Star Wars follow's "Props & Wardrobe"
  if ((a.cut.includes('film-tv') && c.fx.has('music') && !c.fx.has('film-tv')) || (a.cut.includes('music') && c.fx.has('film-tv') && !c.fx.has('music'))) return 0.05;
  if (a.fr && c.fx.has(a.fr)) return 1;
  let v = a.sport ? (c.sport === a.sport ? 0.4 : 0.15) : 0.4;
  const era = a.cut.find(k => k.startsWith('era-'));
  const ec = eraOf(c.fx);
  v += era ? (ec === era ? 0.35 : ec ? 0 : 0.15) : 0.2;
  if (a.cut.some(k => !k.startsWith('era-') && c.fx.has(k))) v += 0.25;
  if (a.sub && c.sub === a.sub) v += 0.1;
  return Math.min(1, v);
}

type Contrib = { seed: Seed; c: number; parts?: SimParts };
const tuneOf = (opts: RecOpts): RecTune => (opts.tune ? { ...REC_TUNE, ...opts.tune } : REC_TUNE);

/**
 * Every lot on the block one seed truly reaches, scored and sorted best
 * first — no caps (recommend() deals the diversity). When the real ties
 * run short (a follow of a player with two live lots, one save), the
 * FALLBACK LADDER opens below them, rung by rung — same identity family →
 * same sub + a shared cut → same category at the anchor's prices — each
 * rung's rows strictly after the rung above, each saying which rung it is.
 * Real ties far outside a stated range come last of all.
 */
export function scoreLots<L extends RecLot>(pool: readonly L[], taste: Taste, opts: RecOpts = {}): ScoredRow<L>[] {
  const nowMs = opts.nowMs ?? Date.now();
  if (!taste.seeds.length) return [];
  const T = tuneOf(opts);
  const lotSeeds = taste.seeds.filter(s => s.f);
  const followSeeds = taste.seeds.filter(s => s.follow);
  const nameSeeds = followSeeds.filter(s => s.follow!.kind === 'maker' || s.follow!.kind === 'entity');
  const searchSeeds = taste.seeds.filter(s => s.query);
  // a searched TERM (an on-device signal) is read as entity + facets; a saved
  // search keeps its own matcher
  const terms = new Map<Seed, ((l: RecLot, f: Feat) => boolean) | null>();
  for (const s of searchSeeds) if (s.kind === 'signal') terms.set(s, termMatcherOf(s.label));
  const looseSearch = searchSeeds.some(s => !terms.has(s));
  const termWords = Array.from(terms.entries()).filter(([, m]) => m).map(([s]) => words(s.label).filter(w => w.length >= 3 && !TERM_DROP.has(w) && !TERM_FACET[w] && !TERM_GRADERS[w] && !/^\d+$/.test(w)));
  const today = new Date(nowMs).toISOString().slice(0, 10);

  type Row = ScoredRow<L>;
  type Open = { l: L; f: Feat | null; cat: CatKey; close: number | null };
  /** a relist / twin of something on the desk */
  const deskTwin = (l: L, f: Feat) => (!!f.card && taste.excludeKeys.has(`card:${f.card}|${normTitle(l.title)}`)) || taste.excludeKeys.has(`t:${l.auctionHouse ?? ''}|${normTitle(l.title)}`);

  // PASS 0 — the gated pool, and each followed name's live lots (the anchors
  // the broad follows, the price prior and the ladder read)
  const open: Open[] = [];
  const members = new Map<Seed, Feat[]>();
  for (const l of pool) {
    if (l.status && l.status !== 'upcoming') continue;
    if (opts.onBlock ? !opts.onBlock(l) : isClosedPending(l as Parameters<typeof isClosedPending>[0], nowMs)) continue;
    if (taste.exclude.has(l.id)) continue;
    const close = closeMsOf(l);
    if (close != null && close <= nowMs) continue;
    if (opts.maxDays != null && (close == null || close - nowMs > opts.maxDays * 864e5)) continue;
    const o: Open = { l, f: null, cat: taxonOf(l).cat, close };
    for (const s of nameSeeds) {
      const fo = s.follow!;
      let hit = fo.kind === 'maker' && (l.artist === fo.key || l.playerSlug === fo.key);
      if (!hit) { const ek = ekOf(l); hit = fo.kind === 'maker' ? ek === `pl:${fo.key}` || ek === `mk:${fo.key}` : ek === fo.key; }
      if (!hit) continue;
      o.f ??= featOf(l, nowMs);
      if (deskTwin(l, o.f)) continue;
      let m = members.get(s); if (!m) members.set(s, (m = [])); m.push(o.f);
    }
    open.push(o);
  }
  const anchors = ladderAnchors(taste, members);
  const anchorsByCat = new Map<CatKey, LadderAnchor[]>();
  const anchorLogA = new Map<Seed, number | null>();
  for (const a of anchors) {
    // the device's own looks lend the ladder, never the broad follows' reading
    if (a.seed.kind !== 'signal') { let xs = anchorsByCat.get(a.cat); if (!xs) anchorsByCat.set(a.cat, (xs = [])); xs.push(a); }
    anchorLogA.set(a.seed, a.logA);
  }
  // a quick-start market opens only when nothing the reader named or saved
  // sits in that market (a Mantle follower who picked Sports is a Mantle
  // reader, not a game-used-jersey reader)
  const covered = new Set<string>(Array.from(anchorsByCat.keys()));
  for (const s of followSeeds) if (s.follow!.kind === 'cat' && !s.market) covered.add(s.follow!.key.split(':')[0]);
  const marketOpen = (s: Seed) => { const cats = MARKET_CATS[MARKETS.find(m => m.label === s.market)?.key ?? ''] ?? [s.follow!.key]; return !cats.some(c => covered.has(c)); };
  const followOn = followSeeds.filter(s => !s.market || marketOpen(s));
  const seedCats = new Set<string>(lotSeeds.map(s => s.f!.cat));
  for (const s of followOn) if (s.follow!.kind === 'cat') seedCats.add(s.follow!.key.split(':')[0]);
  const houses = new Set(followOn.filter(s => s.follow!.kind === 'house').map(s => s.follow!.key));

  /** quality × window × the reader's band (learned, else stated) × "Not for me" */
  const finish = (l: L, f: Feat, tasteV: number, close: number | null) => {
    const pr = priorityOf(l, nowMs);
    const q = pr ? pr.score / 100 : 0.1;
    const band = bandFit(f, taste.bands);
    const flagged = isFlagged(l as Parameters<typeof isFlagged>[0]);
    let quiet = 1;
    if (taste.down?.size) {
      // "Not for me" quiets the card in any grade hard, the entity by pass
      // (a followed name never below half), a nameless lot's cut softly
      if (f.card && taste.down.has(`card:${f.card}`)) quiet *= 0.3;
      const k = f.ek ? taste.down.get(f.ek) ?? 0 : 0;
      if (k) quiet *= Math.max(taste.followedEks?.has(f.ek!) ? 0.5 : 0.15, Math.pow(0.6, k));
      if (!f.named) { const c = taste.down.get(cutKeyOf(f)) ?? 0; if (c) quiet *= Math.max(0.4, Math.pow(0.75, c)); }
    }
    const said = statedFit(f.logA, taste.stated);
    const score = tasteV * (T.qBase + (1 - T.qBase) * q) * windowFactor(close, nowMs) * band.fit * said.fit * quiet;
    return { score, flagged, inBand: band.inside, inStated: said.inside, out: statedSide(f.logA, taste.stated) ?? undefined };
  };

  // PASS 1 — every lot a seed truly reaches
  const rows: Row[] = [];
  for (const o of open) {
    const { l, cat, close } = o;
    let reach = o.f != null || seedCats.has(cat) || houses.has(l.auctionHouse ?? '') || looseSearch;
    if (!reach && termWords.length) {
      const hay = `${String(l.title || '').toLowerCase()} ${l.playerSlug ?? ''} ${l.artist} ${l.ek ?? ''} ${l.drill ?? ''}`;
      reach = termWords.some(ws => !ws.length || ws.some(w => hay.includes(w)));
    }
    if (!reach) continue;
    const f = o.f ?? featOf(l, nowMs);
    o.f = f;
    if (deskTwin(l, f)) continue;
    // a category-level tie needs the lot to BE that kind of object
    const kind = kindFits({ ...l, ek: f.ek });
    const contribs: Contrib[] = [];
    for (const s of lotSeeds) {
      // a lot you only looked at never explains itself
      if (s.kind === 'signal' && s.lotId === l.id) continue;
      const p = lotSim(f, s.f!, T.entityTie);
      if (p.sim < LOT_SIM_MIN) continue;
      if (!kind && !p.entity && !p.card) continue;
      contribs.push({ seed: s, c: s.w * p.sim, parts: p });
    }
    for (const s of followOn) {
      const fo = s.follow!;
      let v = followSim(l, f, fo);
      if (!v) continue;
      if (fo.kind === 'cat' || fo.kind === 'house') {
        // a category follow (or a market) reaches only the kind of object it
        // names; a house follow reaches whatever the house sells
        if (fo.kind === 'cat' && !kind) continue;
        // a broad follow reads through the names the reader keeps there
        const as = anchorsByCat.get(f.cat);
        if (as?.length) { let b = 0; for (const a of as) b = Math.max(b, anchorFit(f, a)); v *= 0.45 + 0.55 * b; }
      } else if (!taste.stated && !taste.bands.has(f.cat)) {
        // a followed name with no band to read leans to its own price level
        const m = anchorLogA.get(s);
        if (m != null) v *= f.logA == null ? 0.85 : 0.6 + 0.4 * Math.exp(-((f.logA - m) ** 2) / (2 * 0.45 * 0.45));
      }
      contribs.push({ seed: s, c: s.w * v });
    }
    // a searched term SHARPENS what the reader already wants: a lot it
    // matches that another seed reaches is lifted (a "flown apollo" search
    // puts the flown pieces first among the Apollo picks)
    let sharpen = 0;
    for (const s of searchSeeds) {
      const tm = terms.get(s);
      if (tm === undefined ? matchesSavedQuery(s.query!, l, today) : tm ? tm(l, f) : false) {
        contribs.push({ seed: s, c: s.w * 0.6 });
        if (tm) sharpen = Math.max(sharpen, Math.min(0.35, 2 * s.w));
      }
    }
    if (!contribs.length) continue;
    contribs.sort((a, b) => b.c - a.c);
    const tasteV = (contribs[0].c + 0.35 * (contribs[1]?.c ?? 0) + 0.15 * (contribs[2]?.c ?? 0)) * (contribs.length > 1 ? 1 + sharpen : 1);
    const fin = finish(l, f, tasteV, close);
    if (fin.score <= 0) continue;
    const sig = contribs[0].seed.kind === 'signal' ? undefined : contribs.find(x => x.seed.kind === 'signal');
    rows.push({ l, score: fin.score, taste: tasteV, best: contribs[0], f, flagged: fin.flagged, inBand: fin.inBand, inStated: fin.inStated, out: fin.out, sig });
  }
  const order = (a: Row, b: Row) => (b.score - a.score) || (a.l.id < b.l.id ? -1 : 1);
  rows.sort(order);
  const inRange = rows.filter(r => !r.out);
  const outside = rows.filter(r => r.out);
  if (inRange.length >= Math.max(LADDER_NEED, (opts.n ?? 0) * 2) || !anchors.length) return [...inRange, ...outside];

  // THE LADDER — only when the real ties run short; rung by rung, each
  // rung's rows after every row above it (a family stranger never outranks
  // the name you follow); inside a stated range only
  const have = new Set(rows.map(r => r.l));
  const rungs: Record<LadderTier, Row[]> = { 2: [], 3: [], 4: [] };
  const anchorCats = new Set(anchors.map(a => a.cat));
  for (const o of open) {
    const { l, close } = o;
    if (have.has(l) || !anchorCats.has(o.cat)) continue;
    const f = o.f ?? featOf(l, nowMs);
    if (!o.f && deskTwin(l, f)) continue;
    if (!kindFits({ ...l, ek: f.ek })) continue;
    if (taste.stated && f.logA != null && !statedFit(f.logA, taste.stated).inside) continue;
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
  let ceil = inRange.length ? inRange[inRange.length - 1].score : Infinity;
  const ladder: Row[] = [];
  for (const t of [2, 3, 4] as LadderTier[]) {
    const r = rungs[t].sort(order);
    if (!r.length) continue;
    const top = r[0].score;
    const k = Number.isFinite(ceil) && top >= ceil ? (ceil * 0.98) / top : 1;
    for (const x of r) x.score *= k;
    ceil = r[r.length - 1].score;
    ladder.push(...r);
  }
  // in range, then the rungs, then the real ties far outside the stated range
  return [...inRange, ...ladder, ...outside];
}

/** a tie to a NAME — the same maker / player / subject / card as a seed, or
 *  a followed name — barely discounts its own repeats; everything else
 *  (a cut, a broad follow, a rung, a search) is spread hard */
function namedTie(r: Pick<ScoredRow, 'best'>): boolean {
  const b = r.best;
  if (b.ladder) return false;
  if (b.parts) return b.parts.entity || b.parts.card;
  return !!b.seed.follow && !b.seed.broad && (b.seed.follow.kind === 'maker' || b.seed.follow.kind === 'entity');
}

/** the seat (0-based) by which the device's i-th guaranteed pick is owed:
 *  3, 11, 19 in the first 24 for 3 seats, then one in every 8 — fixed, so a
 *  shorter deal (home's 20) is always the longer one's prefix */
function sigSlot(i: number, perDeal: number): number {
  const gap = Math.max(1, Math.floor(REC_DEAL / Math.max(1, perDeal)));
  return i < perDeal ? 3 + i * gap : REC_DEAL + (i - perDeal) * 8 + 3;
}

/**
 * Rank the live pool for one taste. Returns ≤ n picks, best first — fewer
 * when fewer lots truly match (never filler).
 */
export function recommend<L extends RecLot>(pool: readonly L[], taste: Taste, opts: RecOpts = {}): Rec<L>[] {
  const n = opts.n ?? 12;
  const T = tuneOf(opts);
  const rows = scoreLots(pool, taste, opts);
  if (!rows.length) return [];
  const lotSeeds = taste.seeds.filter(s => s.f);
  type Row = ScoredRow<L>;

  const out: Row[] = [];
  // a taste that IS one entity (a Star Wars desk, a Patek desk) is not
  // diversified away from it: the entity's share of the lot seeds' weight
  // softens its penalty and lifts its cap
  const seedW = new Map<string, number>();
  let seedTot = 0;
  for (const s of lotSeeds) { seedTot += s.w; if (s.f!.named && s.f!.ek) seedW.set(s.f!.ek, (seedW.get(s.f!.ek) ?? 0) + s.w); }
  // (r9, QA4 C1) a followed maker / player / subject IS a named entity of the
  // taste: it carries its weight to its entity key(s), so a reader who follows
  // only Warhol is a Warhol taste (share 1)
  for (const s of taste.seeds) {
    const fo = s.follow;
    if (!fo || (fo.kind !== 'entity' && fo.kind !== 'maker')) continue;
    seedTot += s.w;
    const eks = fo.kind === 'entity' ? [fo.key] : [`mk:${fo.key}`, `pl:${fo.key}`];
    for (const ek of eks) seedW.set(ek, (seedW.get(ek) ?? 0) + s.w);
  }
  const shareOf = (ek: string | null) => (ek && seedTot > 0 ? Math.min(1, (seedW.get(ek) ?? 0) / seedTot) : 0);
  // the caps read a fixed deal size, not n: home (20) and the profile (24)
  // deal the same list, so home is the profile's prefix (C7)
  const capN = Math.max(n, REC_DEAL);
  // the deal reads the top of the ranking — plus the best rows an on-device
  // signal ties (they sit low on a deep desk, and they are owed seats)
  const cand = rows.slice(0, Math.max(400, capN * 20));
  { const inCand = new Set(cand); let k = 0; for (const r of rows) { if (k >= capN) break; if ((r.sig || r.best.seed.kind === 'signal') && !inCand.has(r)) { cand.push(r); k++; } } }
  const perEnt = new Map<string, number>(), perSale = new Map<string, number>(), perSaleGen = new Map<string, number>(), perHouse = new Map<string, number>(), perSeed = new Map<Seed | string, number>();
  // what the device picked up quietly (views, pages, typed terms) speaks as
  // ONE voice in the deal: five page views are not five seeds each owed their
  // own share of the seats ("More like this" is a statement of its own)
  const seedKey = (s: Seed): Seed | string => (s.kind === 'signal' && s.verb !== 'asked for more like' ? 'signal' : s);
  const seen = new Set<string>();
  const keysOf = (r: Row) => ({
    // a collection bucket (cs:) is not one entity: its lots are spread by
    // the cut's own penalties, not discounted as repeats of one name
    ent: r.f.named && r.f.ek ? r.f.ek : `id:${r.l.id}`, sale: saleKeyOf(r.l), house: r.l.auctionHouse ?? '',
    thing: r.f.card ? `card:${r.f.card}` : `t:${r.l.auctionHouse}|${normTitle(r.l.title)}`,
  });
  const keys = new Map(cand.map(r => [r, keysOf(r)]));
  const used = new Set<Row>();
  const bump = <K,>(m: Map<K, number>, key: K) => m.set(key, (m.get(key) ?? 0) + 1);
  // PHASES: every real tie in range (0) before any fallback rung (1), every
  // rung before a real tie far outside a stated range (2) — a penalty never
  // lets a later phase jump an earlier one
  const phaseOf = (r: Row) => (r.out ? 2 : r.best.ladder ? 1 : 0);
  let phase = Math.min(...cand.map(phaseOf));
  // ONE SEED'S SHARE: no single seed — one "More like this" at .7, one save,
  // one category follow (a fifth) — takes more than ~40% of the seats while
  // another seed still has something to deal; ONE SALE never more than a
  // sixth of the GENERIC seats (R1: 22 of 24 from one RR sale, 7 from one
  // Bonhams sale). A one-seed / one-sale taste fills past the caps rather
  // than printing a short list (the caps lift one seat at a time).
  const seedCapOn = new Set(cand.map(r => seedKey(r.best.seed))).size > 1;
  const saleCapOn = new Set(cand.map(r => keys.get(r)!.sale)).size > 1;
  let lift = 0;
  // a followed name the taste is mostly about (a Star Wars reader who also
  // ticked "Props & Wardrobe") keeps up to 90% of its share; a broad seed a fifth
  const seedCap = (s: Seed) => Math.ceil(capN * (s.broad ? T.broadShare
    : s.follow && s.kind === 'follow' && seedTot > 0 ? Math.max(SEED_SHARE, 0.9 * s.w / seedTot) : SEED_SHARE)) + lift;
  const saleCap = () => Math.ceil(capN * T.saleShare) + lift;
  // what the device learned keeps a few seats once the reader has said
  // anything out loud (a deep desk otherwise never shows a view)
  const loud = taste.seeds.some(s => s.kind !== 'signal');
  const sigOn = loud && T.sigSeats > 0 && cand.some(r => r.sig || r.best.seed.kind === 'signal');
  let sigDealt = 0;
  const sigOwed = (seat: number) => { let k = 0; while (sigSlot(k, T.sigSeats) <= seat) k++; return k; };
  const penalty = (r: Row, k: ReturnType<typeof keysOf>, saleToo = true) => {
    const e = perEnt.get(k.ent) ?? 0;
    const share = r.f.named ? shareOf(r.f.ek) : 0;
    const named = namedTie(r);
    // a desk-wide cut tie names whichever save is strongest: its "seed" is
    // incidental, so it pays no per-seed discount (the sale and house do)
    return (named ? T.namedLift : 1) * Math.pow(named ? T.namedEnt + (0.99 - T.namedEnt) * share : r.f.named ? 0.8 + 0.15 * share : T.genEnt, e)
      * (saleToo ? Math.pow(named ? T.namedSale : T.genSale, perSale.get(k.sale) ?? 0) : 1)
      * (r.best.parts && !named && r.best.seed.kind !== 'signal' ? 1 : Math.pow(named ? T.namedSeed : T.genSeed, perSeed.get(seedKey(r.best.seed)) ?? 0))
      * Math.pow(T.house, perHouse.get(k.house) ?? 0);
  };
  const entCapOf = (r: Row) => Math.max(4, Math.ceil(capN * (T.entBase + T.entShare * (r.f.named ? shareOf(r.f.ek) : 0))));
  const take = (r: Row, k: ReturnType<typeof keysOf>) => {
    out.push(r);
    bump(perEnt, k.ent); bump(perSale, k.sale); bump(perHouse, k.house); bump(perSeed, seedKey(r.best.seed));
    if (!namedTie(r)) bump(perSaleGen, k.sale);
    seen.add(k.thing); seen.add(`id:${r.l.id}`);
    for (const x of r.l.crossLive || []) if (x?.id) seen.add(`id:${x.id}`);
    if (r.best.seed.kind === 'signal') sigDealt++;
  };
  while (out.length < n) {
    // the device's guaranteed seat, when one is owed here
    if (sigOn && sigDealt < sigOwed(out.length)) {
      let best: Row | null = null, bestV = 0;
      for (const r of cand) {
        if (used.has(r) || phaseOf(r) > phase) continue;
        const k = keys.get(r)!;
        if (seen.has(k.thing) || seen.has(`id:${r.l.id}`)) continue;
        const sigC = r.best.seed.kind === 'signal' ? r.best.c : r.sig?.c;
        if (!sigC) continue;
        if (r.f.named && (perEnt.get(k.ent) ?? 0) >= entCapOf(r)) continue;
        const v = r.score * (sigC / Math.max(1e-9, r.taste)) * penalty(r, k);
        if (v > bestV) { bestV = v; best = r; }
      }
      if (best) {
        used.add(best);
        // dealt under the signal's own reason ("Because you looked at …")
        take(best.best.seed.kind === 'signal' ? best : { ...best, best: best.sig!, score: best.score * (best.sig!.c / Math.max(1e-9, best.taste)) }, keys.get(best)!);
        continue;
      }
      sigDealt = Infinity; // nothing left a signal explains — stop owing seats
    }
    let best: Row | null = null, bestV = 0, capped = false;
    let overSale: Row | null = null, overV = 0, bestBare = 0;
    for (const r of cand) {
      if (used.has(r)) continue;
      if (phaseOf(r) > phase) continue;
      const k = keys.get(r)!;
      if (seen.has(k.thing) || seen.has(`id:${r.l.id}`)) { used.add(r); continue; }
      if (r.f.named && (perEnt.get(k.ent) ?? 0) >= entCapOf(r)) continue;
      // the seed cap is about one SEED's voice: a save's tie (to its name — the
      // entity cap bounds that — or a desk-wide cut, "More vintage PSA baseball
      // cards like yours", which names whichever save is strongest) is the
      // whole desk's, not one seed's
      const deskTie = !!r.best.parts && r.best.seed.kind !== 'signal';
      if (seedCapOn && !deskTie && (perSeed.get(seedKey(r.best.seed)) ?? 0) >= seedCap(r.best.seed)) { capped = true; continue; }
      if (saleCapOn && !namedTie(r) && (perSaleGen.get(k.sale) ?? 0) >= saleCap()) {
        // at its cap the sale's own repeat discount is spent: weigh it without
        capped = true;
        const v = r.score * penalty(r, k, false);
        if (v > overV) { overV = v; overSale = r; }
        continue;
      }
      const v = r.score * penalty(r, k);
      if (v > bestV) { bestV = v; best = r; }
      bestBare = Math.max(bestBare, r.score * penalty(r, k, false));
    }
    // the sale cap yields when nothing elsewhere comes close (weighed alike:
    // neither side's sale discount counts)
    if (overSale && overV * T.saleYield > bestBare) best = overSale;
    if (!best) {
      // stuck: open the fallback ladder before lifting a cap; lift the caps
      // (one seat at a time — the strongest seed takes the next, the others
      // keep pace) before reaching outside a stated range
      if (phase < 1 && cand.some(r => !used.has(r) && phaseOf(r) === 1)) { phase = 1; continue; }
      if (capped && lift < n) { lift++; continue; }
      if (phase < 2 && cand.some(r => !used.has(r) && phaseOf(r) === 2)) { phase = 2; continue; }
      break;
    }
    used.add(best);
    take(best, keys.get(best)!);
  }

  // (r9, QA4 C2) the same card in another grade lost its seat to the better
  // fit — the kept pick says the other is live too ("also live as PSA 10")
  const twinOf = new Map<string, Row>();
  const picked = new Set(out.map(r => r.l));
  for (const r of rows) {
    if (picked.has(r.l) || !r.f.card) continue;
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
    // already print a band, else the stated range it sits in — or, far
    // outside the stated range, which side; then the card's other grade live
    const band = r.inBand ? bandOfCat(taste.bands, r.f.cat) : null;
    const said = !band && r.inStated && taste.stated ? taste.stated.say : null;
    const off = r.out && taste.stated ? outsideWords(r.out, taste.stated) : null;
    const extra = [
      r.flagged ? ENGINE_NOTE : null,
      off ?? (!r.flagged && !/\$/.test(base) ? (band ? `in your ${band} range` : said) : null),
      twinNote,
    ].filter(Boolean).join(' · ');
    const reason = extra ? `${base} · ${extra}` : base;
    const short = baseShort ? (extra ? `${baseShort} · ${extra}` : baseShort) : reason;
    const rec: Rec<L> = {
      lot: r.l, score: Math.round(r.score * 1000) / 1000, taste: Math.round(r.taste * 1000) / 1000, reason, short, why, seed: r.best.seed,
      flagged: !!r.flagged, inBand: !!r.inBand, tier: r.best.ladder?.tier ?? 1,
    };
    if (r.out) rec.outOfRange = r.out;
    return rec;
  });
}

/** "below your $50K floor" / "above your $20K cap" */
function outsideWords(side: 'below' | 'above', b: StatedBand): string | null {
  if (side === 'below' && b.lo != null) return `below your ${usdWord(Math.round(Math.pow(10, b.lo)))} floor`;
  if (side === 'above' && b.hi != null) return `above your ${usdWord(Math.round(Math.pow(10, b.hi)))} cap`;
  return null;
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
  if (s.market) return { reason: `You picked ${s.market}`, why: ['picked market'] };
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
  else if (p.price != null && p.price >= 0.6 && inDeskSpan(f, lotSeeds)) why.push('in your price range');
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
        if (hi / lo <= 20) band = bandSuffix(a, lo, hi);
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
    if (hi / lo <= 40) band = bandSuffix(a, lo, hi);
  }
  if (p.weak) return `More ${noun} in your range${band}`;
  if (!words.length) return null;
  return `More ${words.join(' ')} ${noun} like yours${band}`;
}
/** a desk band printed after a reason: the band itself only when the lot
 *  sits in it (R3: a $566 Kobe read "· $190–380"), "near your …" when it is
 *  within ×1.6 of it, nothing further out */
function bandSuffix(a: number, lo: number, hi: number): string {
  if (a >= lo * 0.97 && a <= hi * 1.03) return ` · ${bandText(lo, hi)}`;
  if (a >= lo / 1.6 && a <= hi * 1.6) return ` · near your ${bandText(lo, hi)}`;
  return '';
}
/** the lot sits inside the span of what the desk saved in its category */
function inDeskSpan(f: Feat, lotSeeds: readonly Seed[]): boolean {
  if (f.logA == null) return false;
  const ps = lotSeeds.filter(x => x.f!.cat === f.cat && x.f!.logA != null).map(x => x.f!.logA!);
  if (!ps.length) return false;
  return f.logA >= Math.min(...ps) - 0.05 && f.logA <= Math.max(...ps) + 0.05;
}
const rankCut = (k: string) => (k.startsWith('era-') ? 0 : k.startsWith('lang-') ? 1 : /^(?:psa|sgc|bgs|cgc|tag)$/.test(k) ? 2 : 3);

/** the note a row prints: the reason, then the first matched fact the
 *  reason does not already say */
export function recNote(r: Pick<Rec, 'reason' | 'why'> & { short?: string }, opts: { short?: boolean } = {}): string {
  if (opts.short && r.short) return r.short;
  const extra = r.why.find(w => !/^(?:followed|saved search|picked market)/.test(w) && !r.reason.toLowerCase().includes(w.toLowerCase()));
  return extra && !/^(?:Like your|More )/.test(r.reason) ? `${r.reason} · ${extra}` : r.reason;
}

/* ── the return loop ────────────────────────────────────────────────────── */

/** "tonight" ends at the 4am after the reader's evening (an evening close at
 *  a West Coast or Asian house still lands before their morning), on the
 *  reader's calendar: 00:40 Sunday's tonight is Sunday night. The one
 *  definition lives in app/lib/close-time. */
export { tonightEndMs };

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
