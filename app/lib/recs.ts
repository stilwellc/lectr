/**
 * recs.ts — "Lots you may like" (Oct 10 2026; re-tuned Oct 11 against a
 * held-out eval, scripts/recs-eval.ts). ONE recommender for the profile's
 * For-you room and the home feed's For-you tab, so the two agree.
 *
 * THE STANDING LAW, in one page: docs/PICKS.md (what is weighed, what ties,
 * the ladder, the lane, the caps, the reason grammar, how to re-read picks).
 * This header is the long form.
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
 *
 * (Oct 29) THE DISCOVER LANE: about a quarter of the deal (every fourth seat,
 * from the third; ≥ 3 seats at n ≥ 12) is kept for lots the taste reaches
 * only SOFTLY — the same category · sub (· sport · era) as what the reader
 * saves, owns or follows by name, inside the band they learned or stated
 * (else near the cut's own prices), with a photo, closing inside 14 days —
 * that NO real tie reaches. Ranked by what matters most and the engine's
 * read, dealt one per name, spread across the reader's cuts. Each says only
 * what is true: "New to you · modern basketball cards in your $200–900 range
 * · engine reads below market". The lane is a Rec's `lane: 'discover'`.
 * ROTATION: rows within ~8% of each other swap seats by the day — a shuffle
 * seeded by the local date and the taste, so the list moves between visits
 * without turning random (one day, one list; home stays the profile's
 * prefix). VIEWED: a lot this device saw the reader open in the last 7 days
 * (recs-signals) is never dealt back — unless the engine now reads it below
 * market.
 *
 * (Oct 29, pass 2) THE LADDER'S ANCHOR LAW: a rung never deals on "same
 * sub-category" alone. Another PERSON (the sj:…|p family — every signer on
 * the culture market is one family) must share a real anchor with the
 * desk's lots: the franchise they keep, else their DOMAIN (film & TV, music,
 * a political / royal / military / literary line, a space program), an ERA
 * within ~25 years, or the FORM of the signed object (a photograph, a
 * letter, a cut, a document…) — and the reason says which ("Another film &
 * TV figure", "Another signed letter", "Another figure of the 1950s"). A
 * Karloff desk never gets a politician's cut. The price-only rung in cards
 * and space asks the same (an era or a shared facet); art, design and
 * watches keep theirs, where same sub at your price is the tie law.
 *
 * (Oct 29, pass 3) PRICE HOLDS WITHOUT A BAND: a desk too small for a
 * learned band (< BAND_MIN saves in a category), or whose band is too wide
 * to mean anything, still has a SPAN — the prices it owns and saves — and a
 * lot far outside it sinks on the band's own kernel (a $178K Venusaur was
 * seat 5 of a $2.8K Pokémon desk; a $300K Babe Ruth bat sat on a $500–3K
 * desk). A bare category follow leans to the category's own live price
 * level (a Prints follower led with $150K grails). A lot with no price yet
 * cannot lead on price it does not have (×0.8). The sport cut (lotSim): a
 * single of the same sport and sub near one save's price is a tie of its
 * own, so a one-card hockey desk gets hockey.
 *
 * (Oct 29, pass 4–5) THIS WEEK FIRST: of every 12-seat screen, no more than
 * a third go to lots closing past 14 days (or undated) while a nearer lot
 * weighs within 80% of the far one — the far lot waits, it is never dropped
 * (windowFactor's curve is untouched). EVIDENCE: a priced, dated lot with a
 * bid on it edges an equal tie that has none (×1.05 — under the rotation
 * band, so it breaks ties and nothing more). The discover lane also takes
 * lots only a WEAK tie reaches (another maker's print at your price, the
 * sport cut) — ranked by what matters most, not by likeness — and gates on
 * the interquartile span of the saves when the learned band is too wide to
 * print, so every desk with priced saves gets its seats. TOP OF THE DEAL (topOf): the Today
 * band's strip takes the deal's first n, any lane, never all n from one
 * house while another house's pick weighs within 80%.
 *
 * (W28, Oct 11) A REASON MUST BE TRUE, checked by recs-eval §4 over 22
 * personas: "Like your X prints" groups the desk's X's of the same MEDIUM (a
 * Polaroid set filed under Prints is a photograph) under the name the desk's
 * lots share; a catalogue that opens on another artist ("VIK MUNIZ (B. 1961)
 * Andy Warhol…") is not the maker's; a learned band wider than ×20 is never
 * printed; mixed money units each carry a sign ("$520–$130K"); another
 * maker's watch is "family" only near the anchor's prices (or in a stated
 * range); "screen used" asks for a used object. Fewer picks beat filler.
 * The scoring is memoized per (pool, taste, minute) — the deal and the
 * return loop's strips share one pass.
 */
import { taxonOf, subMatches, subLabel, SPORTS, MARKET_CATS, type CatKey } from './taxonomy';
import type { AuctionLot } from '../types';
import { imageOf } from './house-images';
import { lotFacets, FACET_LABEL } from './facets';
import { entityKeyOf } from './entity/key';
import { parseCard, cardLadderKey, cardSetKey, cardYearKey, type CardId } from './cards';
import { prioStatic, priorityOf, closeMsOf, saleKeyOf, EDGE_CATS } from './priority';
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
  /** the photo (a lot without one is half a pick — the row shows a letter) */
  imageUrl?: string | null;
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
  /** (Oct 29) lots this device saw the reader OPEN lately (recs-signals'
   *  VIEWED_DAYS): never dealt back — they have been seen — unless the
   *  engine now reads them below market */
  viewed?: Iterable<string>;
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
  /** (W28) a fine-art lot's MEDIUM when its title says it is not what its
   *  sub files it as: 'photo' (a Polaroid set filed under Prints & Multiples),
   *  'poster' (an offset poster) — else null (the sub stands) */
  medium?: 'photo' | 'poster' | null;
  /** (W28) the catalogue names ANOTHER artist first ("VIK MUNIZ (B. 1961)
   *  Andy Warhol (Pictures of Ink)" — Muniz's work, Warhol its subject): the
   *  lot's maker slug is its subject, so no maker tie or follow reads it */
  byOther?: boolean;
  /** (Oct 29) the year the title dates the object to (a card's issue year, a
   *  letter's date, a programme's season) — the ladder's era anchor */
  year?: number | null;
  /** (Oct 29) a signed / collected object's FORM (photograph, letter, cut,
   *  document, book, program, poster, prop, record) — the ladder's form anchor */
  form?: string | null;
  /** (Oct 29) the DOMAIN a lot about WHO or WHAT belongs to: film & TV or
   *  music (entertainment), its historical line (political, royalty, military,
   *  aviation, crime, literary, historic), its space program (apollo…) — the
   *  ladder's domain anchor; null where the sport or the sub is the gate */
  domain?: string | null;
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
  /** ids (with aliases) the device saw opened lately — dealt back only below market */
  viewed?: Set<string>;
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

/* (W28) a fine-art title that says what the object really is. A Polaroid
 * set or a gelatin silver print under "Prints & Multiples" is a photograph:
 * "Like your Andy Warhol prints" over Warhol's 10 Sports Polaroids told a
 * screenprint collector something false. (Title words only; the
 * sub stands when the title says nothing.) */
const ART_PHOTO = /\b(?:polaroids?|gelatin silver|chromogenic|c-print|platinum(?:\/palladium)? print|dye[- ]transfer|photographs?)\b/i;
const ART_POSTER = /\b(?:posters?|offset lithograph|signed in (?:the )?print)\b/i;
function artMediumOf(title: string): 'photo' | 'poster' | null {
  return ART_PHOTO.test(title) ? 'photo' : ART_POSTER.test(title) ? 'poster' : null;
}
const foldName = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '');
/** the catalogue opens on another artist's name and dates — "VIK MUNIZ (B. 1961)
 *  Andy Warhol (Pictures of Ink)", "JOHN DOE (1901-1980) …" — that is not
 *  the lot's maker slug (a subject lifted into the maker slot) */
export function byOtherArtist(l: Pick<RecLot, 'title' | 'artist'>): boolean {
  const m = String(l.title || '').match(/^([A-Z][A-Z .'’-]{3,}?)\s*\((?:B\.\s*\d{4}|\d{4}\s*[-–]\s*\d{4})/);
  if (!m) return false;
  const who = foldName(m[1]);
  const maker = foldName(ARTIST_LABEL[l.artist] || l.artist);
  return who.length >= 4 && !maker.includes(who.slice(0, Math.min(6, who.length))) && !who.includes(maker.slice(0, 6));
}

function ekOf(l: RecLot): string | null {
  return l.ek !== undefined ? l.ek ?? null : entityKeyOf(l);
}

/* ── the ladder's anchors, read off a lot (Oct 29) ───────────────────────── */

/** the first plausible year in a title (1600–2029) — a card's issue, a
 *  letter's date, a programme's season; null when the title carries none */
export function yearOf(title: string): number | null {
  const m = title.match(/\b(1[6-9]\d{2}|20[0-2]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}
/** categories whose objects have a FORM worth anchoring on (what a signer signed) */
const FORM_CATS: ReadonlySet<CatKey> = new Set<CatKey>(['entertainment', 'historical', 'sports-memorabilia', 'space-science']);
const FORMS: [string, RegExp][] = [
  ['prop', /\b(?:props?|costume|wardrobe|screen[- ](?:used|worn|matched)|production[- ](?:used|made)|hero prop)\b/i],
  // a photographic / art print BY a photographer is a print, not a figure's signed photograph (pass 6)
  ['print', /\b(?:photographic|art|gicl[ée]e|lithographic|archival|pigment|fine art) print\b|\bprint by\b/i],
  ['photograph', /\b(?:photo(?:graph)?s?|still|8\s?x\s?10|11\s?x\s?14|portrait|publicity shot)\b/i],
  ['letter', /\b(?:letter|ALS|TLS|typed letter|autograph letter|note|postcard|telegram)\b/i],
  ['document', /\b(?:cheque|check|contract|document|receipt|invoice|certificate|voucher|manuscript|agreement|affidavit)\b/i],
  ['book', /\b(?:book|first edition|presentation copy|copy of|novel|hardcover|paperback)\b/i],
  ['program', /\b(?:program(?:me)?|playbill|ticket|pass|menu|handbill)\b/i],
  ['poster', /\b(?:poster|lobby card|one[- ]sheet|half[- ]sheet|insert)\b/i],
  ['record', /\b(?:album|record|LP|vinyl|45\s?rpm|single)\b/i],
  ['cut', /\b(?:cut|signature|index card|album page|card signed|signed card|autograph card)\b/i],
];
/** what the object IS, among the forms collectors file signed pieces by */
export function formOf(title: string): string | null {
  for (const [k, re] of FORMS) if (re.test(title)) return k;
  return null;
}
/** a WHO-or-WHAT lot's domain: entertainment by its facet, historical by its
 *  line, space by its program; null in the markets where the sport or the sub
 *  is the gate already (a shared sport is not an anchor, it is the ante) */
function domainOf(cat: CatKey, sub: string, fx: ReadonlySet<string>): string | null {
  if (cat === 'entertainment') return fx.has('film-tv') ? 'film-tv' : fx.has('music') ? 'music' : null;
  if (cat === 'historical') return sub && sub !== 'other' ? sub : null;
  if (cat === 'space-science') return sub && sub !== 'science' && sub !== 'space-other' ? sub : null;
  return null;
}
/** a domain in a reason's voice ("film & TV", "political", "Apollo") */
function domainWord(cat: CatKey, domain: string): string {
  if (domain === 'film-tv') return 'film & TV';
  if (domain === 'music') return 'music';
  if (cat === 'historical') return ({ political: 'political', royalty: 'royal', military: 'military', aviation: 'aviation', crime: 'notorious', literary: 'literary', historic: 'historic' } as Record<string, string>)[domain] ?? domain;
  if (cat === 'space-science') return subLabel(cat, domain);
  return domain;
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
  const byOther = t.cat === 'fine-art' && byOtherArtist(l);
  const ek0 = ekOf(l);
  // another artist's work about this maker is not this maker's (no tie, no follow)
  const ek = byOther && ek0?.startsWith('mk:') ? null : ek0;
  let card: string | null = null;
  if (CARD_CATS.has(t.cat) && l.title) card = cardIdentityKey(parseCard(l.title), t.cat);
  const fx = new Set<string>();
  for (const k of Array.from(lotFacets(l))) if (TASTE_FX.test(k)) fx.add(k);
  const a = anchorOf(l, nowMs, estFallback);
  const title = String(l.title || '');
  const f: Feat = {
    cat: t.cat, sub: t.sub, ek, named: !!ek && !ek.startsWith('cs:'),
    card, drill: DRILL_CATS.has(t.cat) && l.drill ? l.drill : null, sport: t.sport ?? null, fx,
    logA: a ? Math.log10(a) : null, house: l.auctionHouse || null,
    medium: t.cat === 'fine-art' ? artMediumOf(title) : null, byOther,
    year: yearOf(title), form: FORM_CATS.has(t.cat) ? formOf(title) : null, domain: domainOf(t.cat, t.sub, fx),
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
  const viewed = new Set<string>();
  for (const id of Array.from(neg?.viewed ?? [])) for (const a of idAliases(id)) viewed.add(a);
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
  return { seeds, exclude, excludeKeys, down, counts: { owned, saved, follows: input.follows.length, searches, signals }, bands: learnBands(seeds), stated: statedBandOf(input.price), followedEks, viewed };
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
const SPAN_GRACE = 0.3;      // decades past the desk's span before the kernel bites (×2 each way)
const UNPRICED = 0.8;        // a lot with no price yet, against one that has
const EVIDENCE = 1.05;       // priced, dated, bid on — under the rotation band: it breaks ties, no more
const IQR_GRACE = 0.1;       // decades past the saves' interquartile span the lane still reaches (×1.26)

const medianOf = (xs: number[]) => { const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
/** the q-quantile of SORTED xs, interpolated */
const quantile = (xs: readonly number[], q: number) => { const p = (xs.length - 1) * q, i = Math.floor(p), f = p - i; return xs[i + 1] != null ? xs[i] + f * (xs[i + 1] - xs[i]) : xs[i]; };

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
  const text = lo != null && hi != null ? rangeWords(fmtK(lo), fmtK(hi)) : lo != null ? `${usdWord(lo)} and up` : `under ${usdWord(hi!)}`;
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
  // a photograph filed under Prints is not another print (W28)
  if (c.sub === s.sub && (c.medium ?? null) === (s.medium ?? null)) { v += 0.12; out.sub = true; }
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
  // a facet tie needs the same sport when either side names one (an
  // unlabeled 1973 Panini sticker pack is no answer to a Topps baseball save)
  const sameSport = c.sport === s.sport;
  const facetTie = out.sub && FACET_TIE_CATS.has(c.cat) && !eraClash && sameSport && priceOk(0.3)
    && (out.shared.length > 0 || (CARD_CATS.has(c.cat) && c.fx.has('graded') && s.fx.has('graded') && out.price != null && out.price >= 0.5));
  const strong = out.entity || out.card || out.franchise || (out.drill && out.sub) || facetTie;
  // (Oct 29, pass 3) THE SPORT CUT: a single of the same SPORT and sub near
  // the seed's price (within ~×2.5) is a tie of its own in cards — a Pokémon
  // single of the same sub (its era) likewise. A one-card hockey desk dealt
  // one pick: every other hockey single on the block was another era or
  // another grader. It spans eras (no era clash), it is weak (its reason
  // says only the cut), and the kind gate still asks for a card.
  const sportTie = !strong && out.sub && CARD_CATS.has(c.cat) && (c.cat === 'tcg' || (!!c.sport && c.sport === s.sport)) && out.price != null && out.price >= 0.5;
  if (sportTie) v += 0.1; else if (eraClash) v *= 0.75;
  out.weak = !strong && ((out.sub && PRICE_LINK_CATS.has(c.cat) && out.price != null && out.price >= 0.6) || sportTie);
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
  // "screen used", "game worn", "production made": the reader asked for the
  // USED object — a trading card of the film is no answer (W28: a 1977 Topps
  // Star Wars card for "star wars screen used")
  const usedAsk = /\b(?:screen|production|game|stage)[- ]?(?:used|worn|made)\b|\bhero prop\b/.test(key);
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
  if (usedAsk) facets.push({ re: /\b(?:screen|production|game|stage|set)[- ]?(?:used|worn|made|matched)\b|\bhero prop\b|\bprop\b|\bcostume\b|\bwardrobe\b/i });
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
    if (f.byOther) return 0;
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
  /** (Oct 29) the lane that dealt it: a real tie (the default) or the
   *  DISCOVER lane — a lot the taste reaches only softly (its cut, your
   *  price, no tie; the reason never claims one) */
  lane?: 'tie' | 'discover';
}

/** the suffix a below-market pick carries — the engine's read, said as one */
export const ENGINE_NOTE = 'engine reads below market';
/** a category's learned band in the house's money voice ("$200–900") — null
 *  when there is none, or when it spans more than ×BAND_SAY_MAX (a band that
 *  wide is not a range anyone would call theirs) */
export function bandOfCat(bands: ReadonlyMap<CatKey, PriceBand> | undefined, cat: CatKey): string | null {
  const b = bands?.get(cat);
  if (!b || Math.pow(10, b.hi - b.lo) > BAND_SAY_MAX) return null;
  return bandText(Math.pow(10, b.lo), Math.pow(10, b.hi));
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
  /** (Oct 29) the DISCOVER lane's share of the deal (every fourth seat; 0 shuts it) */
  discover: number;
  /** (Oct 29) ROTATION: rows this close in score (as a share) may swap seats
   *  by the day — 0 deals the same list every day */
  rotate: number;
  /** (pass 4) the most of the first WEEK_SEATS seats that may close past
   *  FAR_DAYS while a nearer lot weighs within farYield of the far one (1 = off) */
  farShare: number;
  farYield: number;
}
export const REC_TUNE: Readonly<RecTune> = {
  entityTie: 0.5, qBase: 0.8,
  namedEnt: 0.92, namedSale: 0.98, namedSeed: 0.98, namedLift: 1,
  genEnt: 0.7, genSale: 0.93, genSeed: 0.95,
  // (Oct 29) a repeat of the same house costs more — one house carrying your
  // names filled the whole deal
  house: 0.9,
  saleShare: 1 / 6, broadShare: 0.2, saleYield: 0.7, entBase: 0.4, entShare: 0.5,
  sigSeats: 3,
  discover: 0.25, rotate: 0.08,
  farShare: 1 / 3, farYield: 0.8,
};
/** the seats "this week first" reads (the first screen of the deal) */
export const WEEK_SEATS = 12;
/** a close past this many days is "far" (undated counts as far) */
export const FAR_DAYS = 14;

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

/** (Oct 29 tuning) a lot closing this week is a pick; one a month out is a
 *  note — the old curve (0.55 past 30 days, 0.6 with no clock) let far-off
 *  and undated lots crowd the deal */
function windowFactor(closeMs: number | null, nowMs: number): number {
  if (closeMs == null) return 0.45;
  const h = (closeMs - nowMs) / 3_600_000;
  if (h <= 0) return 0;
  return h <= 168 ? 1 : h <= 336 ? 0.8 : h <= 720 ? 0.55 : 0.35;
}

const fmtK = (n: number) => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${Math.round(n)}`;
};
/** "$20K–40K", "$800–$1.2K" → a band in the house's money voice: one unit
 *  shares its sign; mixed units each carry their own (W28: "$520–130K" read
 *  as $520 to $130 thousand… or 520 thousand) */
export function bandText(lo: number, hi: number): string {
  const r = (x: number) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))) - 1); return Math.round(x / p) * p; };
  const a = r(lo), b = r(hi);
  if (a === b) return `$${fmtK(a)}`;
  return rangeWords(fmtK(a), fmtK(b));
}
/** "$20K–40K" (one unit) / "$520–$130K" (mixed units) */
function rangeWords(a: string, b: string): string {
  const unit = (x: string) => x.match(/[KM]$/)?.[0] ?? '';
  return unit(a) === unit(b) ? `$${a}–${b}` : `$${a}–$${b}`;
}
/** a learned band wider than this (hi ÷ lo) says nothing about a budget — it
 *  still scores, it is never PRINTED ("in your $400–100K range", W28) */
export const BAND_SAY_MAX = 20;

const NOUN: Partial<Record<CatKey, string>> = {
  'sports-cards': 'cards', tcg: 'cards', watches: 'watches', design: 'pieces',
  'sports-memorabilia': 'pieces', entertainment: 'pieces', historical: 'pieces', 'space-science': 'pieces',
};
function nounOf(cat: CatKey, sub: string, medium?: Feat['medium']): string {
  if (cat === 'fine-art' && medium) return medium === 'photo' ? 'photographs' : 'posters';
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

/** what a desk group of one entity is called: the name its own lots agree on,
 *  else the entity's own name (a Pokémon's key, a maker's label) */
function groupName(group: readonly Seed[], f: Feat, l: RecLot): string {
  const whos = Array.from(new Set(group.map(x => x.who).filter((x): x is string => !!x)));
  if (whos.length === 1) return whos[0];
  const ek = f.ek ?? '';
  if (ek.startsWith('mk:') && ARTIST_LABEL[ek.slice(3)]) return ARTIST_LABEL[ek.slice(3)];
  const k = ek.match(/\|k:([a-z0-9-]+)$/);
  if (k) return k[1].split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return entityName(f, l);
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
export interface LadderHit { tier: LadderTier; /** the anchor's facts the rung reads */ anchor: LadderAnchor; /** (Oct 29) what the lot shares beyond its family / sub */ via?: LadderVia | null }

/** one scored lot before the diversity pass (the eval reads the full ranking) */
export interface ScoredRow<L extends RecLot = RecLot> {
  l: L; score: number; taste: number;
  best: { seed: Seed; c: number; parts?: SimParts; ladder?: LadderHit; discover?: DiscoverHit };
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
  /** (Oct 29) the anchors its lots agree on: the domain most carry, the
   *  median year of the dated ones, the form most are */
  domain: string | null;
  year: number | null;
  form: string | null;
}

/** how a rung REACHED a lot beyond its family / sub — the reason says it */
export interface LadderVia { kind: 'franchise' | 'domain' | 'era' | 'form'; word: string }
/** years apart two dated objects may be and still share an era */
const ERA_SPAN = 25;

/** the anchor a candidate shares with the desk's lots, strongest first: the
 *  franchise they keep, their domain, an era (the card buckets, else dated
 *  within ERA_SPAN years), the form of the object — null when nothing but
 *  the sub-category is shared (and the sub alone deals nothing) */
function anchorVia(c: Feat, a: LadderAnchor): LadderVia | null {
  if (a.fr && c.fx.has(a.fr)) return { kind: 'franchise', word: FACET_LABEL[a.fr] ?? 'the franchise' };
  if (a.domain && c.domain === a.domain) return { kind: 'domain', word: domainWord(c.cat, a.domain) };
  // two domains that disagree (a music signer for a film desk) share nothing,
  // whatever the date or the paper says
  if (a.domain && c.domain && a.domain !== c.domain) return null;
  const eraA = a.cut.find(k => k.startsWith('era-')), eraC = eraOf(c.fx);
  if (eraA && eraC && eraA === eraC) return { kind: 'era', word: FX_WORD[eraA] ?? 'the same era' };
  if (a.year != null && c.year != null && Math.abs(c.year - a.year) <= ERA_SPAN) return { kind: 'era', word: `the ${Math.floor(c.year / 10) * 10}s` };
  // a bare signature cut is what every autograph desk holds — no anchor
  if (a.form && a.form !== 'cut' && c.form === a.form) return { kind: 'form', word: a.form };
  return null;
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
    const ys = inCat.map(f => f.year).filter((x): x is number => x != null);
    out.push({
      seed: s, cat, sub, sport, fam, cut, logA: ps.length ? medianOf(ps) : null, fr,
      domain: modeOf(inCat.map(f => f.domain ?? null).filter((x): x is string => !!x)),
      year: ys.length ? medianOf(ys) : null,
      form: modeOf(inCat.map(f => f.form ?? null).filter((x): x is string => !!x)),
    });
  }
  return out;
}

/** the best rung one candidate reaches on one anchor (null = none), and
 *  what it shares beyond its family / sub when the rung asked for an anchor */
function ladderTier(c: Feat, a: LadderAnchor, stated = false): { tier: LadderTier; via: LadderVia | null } | null {
  if (c.cat !== a.cat) return null;
  // (Oct 29) an anchor with a sport asks for that sport: a card the taxonomy
  // cannot place is not "more '80s cards" for a Gretzky desk
  if (a.sport && c.sport !== a.sport) return null;
  const price = c.logA != null && a.logA != null ? Math.exp(-((c.logA - a.logA) ** 2) / (2 * PRICE_SIGMA * PRICE_SIGMA)) : null;
  if (a.fam && familyOf(c) === a.fam) {
    // another MAKER of the same category · sub is a family only near the
    // anchor's prices (W28: a $300 quartz Cartier was "another maker's
    // watch" for a $10K–80K Patek / Rolex desk) — or, when the reader stated
    // a range, inside it (the caller gates that: a $50K-and-up Patek reader
    // whose Patek lots on the block run $2K still wants the $60K Daytona)
    if (a.fam.startsWith('mk|')) { if (stated || price == null || price >= 0.3) return { tier: 2, via: null }; }
    // (pass 6) another PLAYER in memorabilia is a family inside the same sub
    // only — a ticket desk is not handed a bobblehead
    else if (a.fam.startsWith('pl|') && c.cat === 'sports-memorabilia') { if (c.sub === a.sub) return { tier: 2, via: null }; }
    else if (!a.fam.endsWith('|p')) return { tier: 2, via: null };
    else if (c.sub === a.sub) {
      // (Oct 29) another PERSON: every signer on the culture market is one
      // family (sj:culture|p), so the sub alone dealt a politician's cut to a
      // Karloff desk. The rung needs an anchor the desk's lots share — their
      // franchise (and ONLY that, when they keep one: a Star Wars signer's
      // next pick is Star Wars, never Houdini), else their domain, an era
      // within ERA_SPAN years, or the form of the object
      const via = anchorVia(c, a);
      if (via && (!a.fr || via.kind === 'franchise')) return { tier: 2, via };
    }
  }
  // memorabilia, entertainment and historical lots are about WHO or WHAT:
  // only the family rung reaches them (a shared "signed" or the same price
  // is no tie between Houdini and Star Wars — lotSim's FACET_TIE_CATS rule)
  if (!FACET_TIE_CATS.has(c.cat) && !PRICE_LINK_CATS.has(c.cat)) return null;
  const eraA = a.cut.find(k => k.startsWith('era-')), eraC = eraOf(c.fx);
  if (a.sub && c.sub === a.sub && !(eraA && eraC && eraA !== eraC) && a.cut.some(k => c.fx.has(k)) && (price == null || price >= 0.3)) return { tier: 3, via: null };
  if ((a.sub == null || c.sub === a.sub) && price != null && price >= 0.6) {
    // (Oct 29) the price-only rung in cards and space asks for an anchor too
    // (an era, a program, a shared facet): a 2021 raw card is not "more
    // baseball cards at your prices" for a 1952 desk. Art, design and watches
    // keep the rung as it was — there the same sub at your price is the tie
    // law itself (lotSim's PRICE_LINK_CATS)
    if (PRICE_LINK_CATS.has(c.cat)) return { tier: 4, via: null };
    const via = anchorVia(c, a);
    if (via) return { tier: 4, via };
  }
  return null;
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
  if (!taste.seeds.length) return [];
  const core = scoreCoreMemo(pool, taste, opts);
  // the ladder opens only when the real ties run short of what this deal needs
  if (core.inRange.length >= Math.max(LADDER_NEED, (opts.n ?? 0) * 2) || !core.anchored) return [...core.inRange, ...core.outside];
  // in range, then the rungs, then the real ties far outside the stated range
  return [...core.inRange, ...core.ladder(), ...core.outside];
}

/** (Oct 29) the DISCOVER lane's rows for one taste over the pool, best first
 *  — lots no real tie reaches that still stand in one of the reader's cuts at
 *  their price (see buildDiscover). Shares scoreLots' memo. */
export function discoverLots<L extends RecLot>(pool: readonly L[], taste: Taste, opts: RecOpts = {}): ScoredRow<L>[] {
  if (!taste.seeds.length) return [];
  return scoreCoreMemo(pool, taste, opts).discover();
}

/** one scoring of a pool for a taste: the real ties (in range / far outside a
 *  stated range) and, built only when a deal asks for it, the fallback ladder
 *  and the discover lane */
interface ScoreCore<L extends RecLot> { inRange: ScoredRow<L>[]; outside: ScoredRow<L>[]; anchored: boolean; ladder: () => ScoredRow<L>[]; discover: () => ScoredRow<L>[] }

/* (W28) THE SCORING IS MEMOIZED per (pool, taste) — the profile scores the
 * same taste twice per page (the deal, n=24, and the return loop's strips,
 * n=60), which put a second full pass between the reader and Top 3. Keyed by
 * the pool and taste OBJECTS (a new book or a changed taste is a new key) and
 * the clock to the minute (a deal and its strips cut in one render agree; a
 * tab left open re-scores as the block moves). A caller-supplied `onBlock`
 * gate is a closure — never memoized. Rows are shared: callers read them. */
const coreMemo = new WeakMap<object, WeakMap<Taste, Map<string, ScoreCore<RecLot>>>>();
function scoreCoreMemo<L extends RecLot>(pool: readonly L[], taste: Taste, opts: RecOpts): ScoreCore<L> {
  const nowMs = opts.nowMs ?? Date.now();
  if (opts.onBlock) return scoreCore(pool, taste, { ...opts, nowMs });
  let byTaste = coreMemo.get(pool);
  if (!byTaste) coreMemo.set(pool, (byTaste = new WeakMap()));
  let m = byTaste.get(taste);
  if (!m) byTaste.set(taste, (m = new Map()));
  const key = `${Math.floor(nowMs / 60_000)}|${opts.maxDays ?? ''}|${opts.tune ? JSON.stringify(opts.tune) : ''}`;
  let c = m.get(key) as ScoreCore<L> | undefined;
  if (!c) {
    // one clock per key: a tab open for days keeps only the current minute
    m.clear();
    c = scoreCore(pool, taste, { ...opts, nowMs });
    m.set(key, c as unknown as ScoreCore<RecLot>);
  }
  return c;
}

function scoreCore<L extends RecLot>(pool: readonly L[], taste: Taste, opts: RecOpts): ScoreCore<L> {
  const nowMs = opts.nowMs ?? Date.now();
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
      if (fo.kind === 'maker' && o.f.byOther) continue;
      if (deskTwin(l, o.f)) continue;
      let m = members.get(s); if (!m) members.set(s, (m = [])); m.push(o.f);
    }
    // (Oct 29) a lot the reader opened lately has been seen: it comes back
    // only when the engine now reads it below market (it still counts toward
    // a followed name's price level above)
    if (taste.viewed?.has(l.id) && !isFlagged(l as Parameters<typeof isFlagged>[0])) continue;
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

  // (pass 3) THE DESK'S SPAN per category — what the reader owns and saves,
  // for the categories with no band to learn (or one too wide to mean
  // anything); a lot far outside it sinks on the band's own kernel
  const span = new Map<CatKey, { lo: number; hi: number }>();
  for (const s of lotSeeds) {
    if ((s.kind !== 'owned' && s.kind !== 'saved') || s.f!.logA == null) continue;
    const x = span.get(s.f!.cat);
    if (!x) span.set(s.f!.cat, { lo: s.f!.logA, hi: s.f!.logA }); else { x.lo = Math.min(x.lo, s.f!.logA); x.hi = Math.max(x.hi, s.f!.logA); }
  }
  const spanFit = (f: Feat, band: PriceBand | null): number => {
    if (taste.stated || f.logA == null) return 1;
    if (band && Math.pow(10, band.hi - band.lo) <= BAND_SAY_MAX) return 1;
    const x = span.get(f.cat);
    if (!x) return 1;
    const d = f.logA < x.lo - SPAN_GRACE ? x.lo - SPAN_GRACE - f.logA : f.logA > x.hi + SPAN_GRACE ? f.logA - x.hi - SPAN_GRACE : 0;
    return d ? Math.max(BAND_FLOOR, Math.exp(-(d * d) / (2 * BAND_SIGMA * BAND_SIGMA))) : 1;
  };
  // (pass 3) a category's live price level, for a bare category follow with
  // nothing else to read (median log price of its open lots; lazily)
  const catLevel = new Map<CatKey, number | null>();
  const catLevelOf = (cat: CatKey): number | null => {
    if (catLevel.has(cat)) return catLevel.get(cat)!;
    const xs: number[] = [];
    for (const o of open) if (o.cat === cat) { const a = (o.f ?? featOf(o.l, nowMs)).logA; if (a != null) xs.push(a); }
    const m = xs.length >= 10 ? medianOf(xs) : null;
    catLevel.set(cat, m);
    return m;
  };

  /** quality × window × the reader's band (learned, else stated; else the desk's span) × "Not for me" */
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
    // (Oct 29) the engine's own read lifts a pick in the markets where
    // priority's edge term does NOT already carry it (cards, TCG, watches,
    // sports memorabilia — never a second lift where it does), and a lot with
    // no photo is half a pick — the owner's list led with letter tiles
    const lift = (flagged && !EDGE_CATS.has(f.cat) ? 1.2 : 1) * (imageOf(l as Pick<AuctionLot, 'id' | 'imageUrl'>) ? 1 : 0.5);
    // (pass 3) no price yet: it cannot lead on a price it does not have;
    // (pass 5) a priced, dated lot with a bid on it edges an equal tie without
    const placed = f.logA == null ? UNPRICED : close != null && (l.bidCount ?? 0) >= 1 ? EVIDENCE : 1;
    const score = tasteV * (T.qBase + (1 - T.qBase) * q) * windowFactor(close, nowMs) * band.fit * said.fit * spanFit(f, band.band) * placed * quiet * lift;
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
    // a category-level tie needs the lot to BE that kind of object (and a
    // photograph or a poster filed under Prints is not a print)
    const kind = kindFits({ ...l, ek: f.ek }) && !(f.cat === 'fine-art' && f.sub === 'prints' && f.medium);
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
        else if (fo.kind === 'cat' && !taste.stated && !taste.bands.has(f.cat)) {
          // (pass 3) nothing to read it through: lean to the category's own
          // live level, so a bare Prints follow is not led by its grails
          const m = catLevelOf(f.cat);
          if (m != null) v *= f.logA == null ? 0.85 : 0.6 + 0.4 * Math.exp(-((f.logA - m) ** 2) / (2 * 0.6 * 0.6));
        }
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
  let built: Row[] | null = null;
  let found: Row[] | null = null;
  return { inRange, outside, anchored: anchors.length > 0, ladder: () => (built ??= buildLadder()), discover: () => (found ??= buildDiscover()) };

  // THE DISCOVER LANE (Oct 29) — what no real tie reaches but the reader's
  // cuts do: the same category · sub (· sport · era · medium) as a save, an
  // owned lot, a "More like this" or a followed name's live lots, at their
  // price (the band they learned or stated; else near the cut's own level),
  // the kind of object the cut names, with a photo, closing inside
  // DISCOVER_DAYS. In the markets about WHO or WHAT (memorabilia,
  // entertainment, historical) the cut must also share a domain or a
  // franchise — Houdini is no Star Wars pick. Ranked by what matters most
  // and the engine's read (a lift only where priority's edge term does not
  // already carry it); the cut's weight orders the cuts. "Not for me" on the
  // card, the name or the cut shuts the lane for it.
  function buildDiscover(): Row[] {
    const cuts = tasteCuts(taste, members);
    if (!cuts.length) return [];
    // (pass 5) a lot only a WEAK tie reaches (another maker's print at your
    // price, the sport cut) is the lane's too — ranked by what matters most
    // and the engine's read, not by likeness to one save
    const have = new Set(rows.filter(r => !r.best.parts?.weak).map(r => r.l));
    // the saves' prices per category, for the lane's gate when the band says nothing
    const catSaves = new Map<CatKey, number[]>();
    for (const s of lotSeeds) {
      if ((s.kind !== 'owned' && s.kind !== 'saved') || s.f!.logA == null) continue;
      let xs = catSaves.get(s.f!.cat); if (!xs) catSaves.set(s.f!.cat, (xs = [])); xs.push(s.f!.logA);
    }
    catSaves.forEach(xs => xs.sort((a, b) => a - b));
    const byCat = new Map<CatKey, TasteCut[]>();
    for (const c of cuts) { let xs = byCat.get(c.cat); if (!xs) byCat.set(c.cat, (xs = [])); xs.push(c); }
    const found: Row[] = [];
    for (const o of open) {
      const { l, close } = o;
      if (have.has(l)) continue;
      const cs = byCat.get(o.cat);
      if (!cs || close == null || close - nowMs > DISCOVER_DAYS * 864e5) continue;
      if (!imageOf(l as Pick<AuctionLot, 'id' | 'imageUrl'>)) continue;
      const f = o.f ?? featOf(l, nowMs);
      if (f.logA == null || f.byOther) continue;
      if (!o.f && deskTwin(l, f)) continue;
      if (!kindFits({ ...l, ek: f.ek }) || (f.cat === 'fine-art' && f.sub === 'prints' && f.medium)) continue;
      if (taste.down?.size && ((f.card && taste.down.has(`card:${f.card}`)) || (f.ek && taste.down.has(f.ek)) || (!f.named && taste.down.has(cutKeyOf(f))))) continue;
      let best: TasteCut | null = null;
      for (const c of cs) {
        if (!(c.sub === f.sub || subMatches(c.cat, c.sub, f.sub))) continue;
        if ((c.medium ?? null) !== (f.medium ?? null)) continue;
        // a cut with a sport asks for that sport (a card the taxonomy cannot
        // place is not "baseball cards" — pass 2)
        if (c.sport && f.sport !== c.sport) continue;
        const era = c.fx.find(k => k.startsWith('era-')), ec = eraOf(f.fx);
        if (era && ec && era !== ec) continue;
        // a lot about WHO or WHAT: the franchise the cut keeps (a Star Wars desk
        // asks for Star Wars — already a real tie), else its domain (film & TV, music)
        if (!CUT_CATS.has(c.cat)) { const fr = c.fx.filter(k => k.startsWith('fr-')); const need = fr.length ? fr : c.fx.filter(k => k === 'film-tv' || k === 'music'); if (!need.some(k => f.fx.has(k))) continue; }
        if (!best || c.w > best.w) best = c;
      }
      if (!best) continue;
      const band = bandFit(f, taste.bands);
      const said = statedFit(f.logA, taste.stated);
      // a band too wide to print holds nothing: the cut's own level gates then
      // (a $100K print was "near your saves' prices" on a $7K–40K desk)
      const bandSays = !!band.band && Math.pow(10, band.band.hi - band.band.lo) <= BAND_SAY_MAX;
      // (pass 5) three or more priced saves: their interquartile span; fewer: the cut's own level
      const xs = catSaves.get(f.cat) ?? [];
      const priced = bandSays ? band.inside : taste.stated ? said.inside
        : xs.length >= 3 ? f.logA >= quantile(xs, 0.25) - IQR_GRACE && f.logA <= quantile(xs, 0.75) + IQR_GRACE
        : best.logA != null && Math.abs(f.logA - best.logA) <= CUT_PRICE_SPAN;
      if (!priced) continue;
      const pr = priorityOf(l, nowMs);
      const q = pr ? pr.score / 100 : 0.1;
      const flagged = isFlagged(l as Parameters<typeof isFlagged>[0]);
      const lift = flagged && !EDGE_CATS.has(f.cat) ? 1.2 : 1;
      const tasteV = Math.min(1, best.w) * DISCOVER_SIM;
      const score = tasteV * (0.3 + 0.7 * q) * lift * windowFactor(close, nowMs);
      if (score <= 0) continue;
      found.push({ l, score, taste: tasteV, best: { seed: best.seed, c: tasteV, discover: { cut: best } }, f, flagged, inBand: band.inside, inStated: said.inside });
    }
    return found.sort(order);
  }

  // THE LADDER — only when the real ties run short; rung by rung, each
  // rung's rows after every row above it (a family stranger never outranks
  // the name you follow); inside a stated range only
  function buildLadder(): Row[] {
    const have = new Set(rows.map(r => r.l));
    const rungs: Record<LadderTier, Row[]> = { 2: [], 3: [], 4: [] };
    const anchorCats = new Set(anchors.map(a => a.cat));
    for (const o of open) {
      const { l, close } = o;
      if (have.has(l) || !anchorCats.has(o.cat)) continue;
      const f = o.f ?? featOf(l, nowMs);
      if (!o.f && deskTwin(l, f)) continue;
      if (!kindFits({ ...l, ek: f.ek }) || (f.cat === 'fine-art' && f.sub === 'prints' && f.medium)) continue;
      if (taste.stated && f.logA != null && !statedFit(f.logA, taste.stated).inside) continue;
      let bestTier: LadderTier | 0 = 0, bestC = 0, bestA: LadderAnchor | null = null, bestVia: LadderVia | null = null;
      for (const a of anchors) {
        // a looked-at lot never stands in as its own kin
        if (a.seed.kind === 'signal' && a.seed.lotId === l.id) continue;
        const hit = ladderTier(f, a, !!taste.stated);
        if (!hit) continue;
        const t = hit.tier;
        // inside a rung, the anchor's price level leads (a $420K Kobe is a
        // stranger to a $96 Ewing rookie, however alike the family)
        const near = f.logA != null && a.logA != null ? Math.exp(-((f.logA - a.logA) ** 2) / (2 * 0.5 * 0.5)) : 0.5;
        const c = a.seed.w * LADDER_SIM[t] * (0.6 + 0.4 * near);
        if (!bestTier || t < bestTier || (t === bestTier && c > bestC)) { bestTier = t; bestC = c; bestA = a; bestVia = hit.via; }
      }
      if (!bestTier || !bestA) continue;
      const fin = finish(l, f, bestC, close);
      if (fin.score <= 0) continue;
      rungs[bestTier].push({ l, score: fin.score, taste: bestC, best: { seed: bestA.seed, c: bestC, ladder: { tier: bestTier, anchor: bestA, via: bestVia } }, f, flagged: fin.flagged, inBand: fin.inBand, inStated: fin.inStated });
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
    return ladder;
  }
}

/* ── the discover lane's cuts ───────────────────────────────────────────── */

/** one CUT the taste stands in — a category · sub (· sport · medium) the
 *  reader saves, owns, asked more of, or follows by name — read from the
 *  seeds that put them there (a category follow or a market already reaches
 *  its whole kind as a real tie, so it lends no cut) */
export interface TasteCut {
  key: string;
  cat: CatKey;
  sub: string;
  sport: string | null;
  medium: Feat['medium'];
  /** the facets at least half the cut's lots share (an era, a language, a domain, a franchise) */
  fx: string[];
  /** log10 median price of the cut's lots (null when none is priced) */
  logA: number | null;
  /** the seeds' weight, summed — orders the cuts */
  w: number;
  /** how many seeds stand in it */
  n: number;
  /** the strongest seed in it: the pick's `seed` field, never its reason */
  seed: Seed;
}
export interface DiscoverHit { cut: TasteCut }

/** facets a cut carries into the lane */
const CUT_FX = /^(?:era-.+|lang-(?:ja|zh)|film-tv|music|fr-.+)$/;
/** where a shared cut is a neighborhood of its own (lotSim's facet and price
 *  ties live there too); elsewhere the lane also needs a shared domain or
 *  franchise (a lot about WHO or WHAT) */
const CUT_CATS: ReadonlySet<CatKey> = new Set<CatKey>([...Array.from(FACET_TIE_CATS), ...Array.from(PRICE_LINK_CATS)]);
/** decades from the cut's own price level, when no band is learned or stated */
const CUT_PRICE_SPAN = 0.4;
/** the lane deals only lots closing inside this many days */
export const DISCOVER_DAYS = 14;
/** a soft reach's "similarity" — under every real tie (LOT_SIM_MIN) */
const DISCOVER_SIM = 0.2;

function tasteCuts(taste: Taste, members: Map<Seed, Feat[]>): TasteCut[] {
  type Acc = { cat: CatKey; sub: string; sport: string | null; medium: Feat['medium']; fs: Feat[]; w: number; n: number; seed: Seed };
  const acc = new Map<string, Acc>();
  const add = (s: Seed, cat: CatKey, sub: string, sport: string | null, medium: Feat['medium'], fs: Feat[]) => {
    const key = `${cat}|${sub}|${sport ?? ''}|${medium ?? ''}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { cat, sub, sport, medium, fs: [], w: 0, n: 0, seed: s }));
    a.fs.push(...fs); a.w += s.w; a.n++;
    if (s.w > a.seed.w) a.seed = s;
  };
  for (const s of taste.seeds) {
    if (s.f) {
      // a lot merely looked at lends no cut (a glance is not a taste)
      if (s.kind === 'signal' && s.verb !== 'asked for more like') continue;
      add(s, s.f.cat, s.f.sub, s.f.sport, s.f.medium ?? null, [s.f]);
      continue;
    }
    const fo = s.follow;
    if (!fo || (fo.kind !== 'maker' && fo.kind !== 'entity') || s.kind === 'signal') continue;
    const fs = members.get(s) ?? [];
    if (!fs.length) continue;
    const cat = modeOf(fs.map(f => f.cat))!;
    const inCat = fs.filter(f => f.cat === cat);
    add(s, cat, modeOf(inCat.map(f => f.sub))!, modeOf(inCat.map(f => f.sport)) ?? null, null, inCat);
  }
  const out: TasteCut[] = [];
  acc.forEach((a, key) => {
    const cnt = new Map<string, number>();
    for (const f of a.fs) for (const k of Array.from(f.fx)) if (CUT_FX.test(k)) cnt.set(k, (cnt.get(k) ?? 0) + 1);
    const fx: string[] = [];
    cnt.forEach((n, k) => { if (n * 2 >= a.fs.length) fx.push(k); });
    const ps = a.fs.map(f => f.logA).filter((x): x is number => x != null);
    out.push({ key, cat: a.cat, sub: a.sub, sport: a.sport, medium: a.medium, fx, logA: ps.length ? medianOf(ps) : null, w: a.w, n: a.n, seed: a.seed });
  });
  return out;
}

/* ── rotation ───────────────────────────────────────────────────────────── */

/** FNV-1a, 32-bit */
function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** the day's shuffle: one number in [0, 1) per lot id, fixed for the reader's
 *  LOCAL date and the taste (what is seeded, not the object) — the same all
 *  day on every surface, new tomorrow */
export function rotationOf(nowMs: number, taste: Pick<Taste, 'seeds'>): (id: string) => number {
  const d = new Date(nowMs);
  const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const key = taste.seeds.map(s => `${s.kind}:${s.lotId ?? (s.follow ? `${s.follow.kind}/${s.follow.key}` : s.label)}`).sort().join('|');
  const salt = fnv(`${day}|${key}`);
  return id => fnv(`${salt}|${id}`) / 4294967296;
}

/** a tie to a NAME — the same maker / player / subject / card as a seed, or
 *  a followed name — barely discounts its own repeats; everything else
 *  (a cut, a broad follow, a rung, a search) is spread hard */
function namedTie(r: Pick<ScoredRow, 'best'>): boolean {
  const b = r.best;
  if (b.ladder || b.discover) return false;
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
  // (Oct 29) the discover lane's rows (no real tie, the reader's cut at their
  // price) — the quota is a quarter of the seats, every fourth from the third
  const disc = T.discover > 0 ? discoverLots(pool, taste, opts) : [];
  if (!rows.length && !disc.length) return [];
  const discQuota = n >= 12 ? Math.max(3, Math.floor(n * T.discover)) : Math.floor(n * T.discover);
  const discSeat = (seat: number) => seat % 4 === 2;
  const lotSeeds = taste.seeds.filter(s => s.f);
  type Row = ScoredRow<L>;
  // (Oct 29) ROTATION: rows within T.rotate of each other may swap seats by
  // the day — a shuffle seeded by the local date and the taste, never the
  // clock (the deal is the same all day; home's 20 stays the profile's prefix)
  const spin = T.rotate > 0 ? rotationOf(opts.nowMs ?? Date.now(), taste) : null;
  const jit = (r: Row) => (spin ? 1 + T.rotate * (spin(r.l.id) - 0.5) : 1);

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
  for (const r of disc) keys.set(r, keysOf(r));
  const used = new Set<Row>();
  const bump = <K,>(m: Map<K, number>, key: K) => m.set(key, (m.get(key) ?? 0) + 1);
  // PHASES: every real tie in range (0) before any fallback rung (1), every
  // rung before a real tie far outside a stated range (2) — a penalty never
  // lets a later phase jump an earlier one
  const phaseOf = (r: Row) => (r.out ? 2 : r.best.ladder ? 1 : 0);
  let phase = cand.length ? Math.min(...cand.map(phaseOf)) : 0;
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
  // (Oct 29) a name the reader FOLLOWS is the taste — it keeps its share of the
  // deal (entBase + entShare × share). A name they merely SAVED holds a few
  // seats in proportion to its weight (a passed-on seed speaks less); a name
  // the device only saw them look at holds a flat fifth. It used to be 10–22
  // of 24 for any name: "more of what I already saved". Every cap lifts one
  // seat at a time when the deal is stuck.
  const entCapOf = (r: Row) => {
    const share = r.f.named ? shareOf(r.f.ek) : 0;
    const followed = r.f.named && !!r.f.ek && !!taste.followedEks?.has(r.f.ek);
    const base = followed ? T.entBase + T.entShare * share : r.best.seed.kind === 'signal' ? 0.2 : 0.08 + 0.24 * share;
    return Math.max(3, Math.ceil(capN * base)) + lift;
  };
  // (Oct 29) one house holds 40% of the deal at most when others are in reach
  const houseCapOn = new Set(cand.map(r => keys.get(r)!.house)).size > 1;
  const houseCap = () => Math.ceil(capN * 0.4) + lift;
  let discDealt = 0;
  const perCut = new Map<string, number>(), discEnts = new Set<string>();
  // (pass 4) THIS WEEK FIRST — how many of the seats so far close past FAR_DAYS
  const nowMs = opts.nowMs ?? Date.now();
  const isFar = (r: Row) => { const c = closeMsOf(r.l); return c == null || c - nowMs > FAR_DAYS * 864e5; };
  // far seats dealt, per 12-seat screen (pass 5: every screen, not only the first)
  const farBy: number[] = [];
  const farCap = Math.floor(WEEK_SEATS * T.farShare);
  /** the lane's next pick, under the deal's house and sale caps — false when none is left */
  const dealDiscover = (): boolean => {
    let best: Row | null = null, bestV = 0;
    for (const r of disc) {
      if (used.has(r)) continue;
      const k = keys.get(r)!;
      if (seen.has(k.thing) || seen.has(`id:${r.l.id}`)) { used.add(r); continue; }
      if (r.f.named && discEnts.has(k.ent)) continue;
      if (houseCapOn && (perHouse.get(k.house) ?? 0) >= houseCap()) continue;
      // the lane is not a generic tie: the sale cap does not shut it — a repeat
      // of the sale, the house or the cut only costs it
      const v = r.score * Math.pow(0.7, perCut.get(r.best.discover!.cut.key) ?? 0) * Math.pow(T.genSale, perSale.get(k.sale) ?? 0) * Math.pow(T.house, perHouse.get(k.house) ?? 0) * jit(r);
      if (v > bestV) { bestV = v; best = r; }
    }
    if (!best) return false;
    used.add(best);
    take(best, keys.get(best)!);
    return true;
  };
  const take = (r: Row, k: ReturnType<typeof keysOf>) => {
    out.push(r);
    if (isFar(r)) { const sc = Math.floor((out.length - 1) / WEEK_SEATS); farBy[sc] = (farBy[sc] ?? 0) + 1; }
    bump(perEnt, k.ent); bump(perSale, k.sale); bump(perHouse, k.house);
    // a discover pick is nobody's tie: it charges no seed, one per name, and
    // spreads across the reader's cuts
    if (r.best.discover) { discDealt++; bump(perCut, r.best.discover.cut.key); if (r.f.named) discEnts.add(k.ent); } else { bump(perSeed, seedKey(r.best.seed)); if (!namedTie(r)) bump(perSaleGen, k.sale); }
    seen.add(k.thing); seen.add(`id:${r.l.id}`);
    for (const x of r.l.crossLive || []) if (x?.id) seen.add(`id:${x.id}`);
    if (r.best.seed.kind === 'signal') sigDealt++;
  };
  while (out.length < n) {
    // the discover lane's seat (every fourth, from the third), while it has lots
    if (discDealt < discQuota && discSeat(out.length) && dealDiscover()) continue;
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
        if (houseCapOn && (perHouse.get(k.house) ?? 0) >= houseCap()) continue;
        const v = r.score * (sigC / Math.max(1e-9, r.taste)) * penalty(r, k) * jit(r);
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
    let near: Row | null = null, nearV = 0;
    for (const r of cand) {
      if (used.has(r)) continue;
      if (phaseOf(r) > phase) continue;
      const k = keys.get(r)!;
      if (seen.has(k.thing) || seen.has(`id:${r.l.id}`)) { used.add(r); continue; }
      if (r.f.named && (perEnt.get(k.ent) ?? 0) >= entCapOf(r)) { capped = true; continue; }
      if (houseCapOn && (perHouse.get(k.house) ?? 0) >= houseCap()) { capped = true; continue; }
      // the seed cap is about one SEED's voice: a save's tie (to its name — the
      // entity cap bounds that — or a desk-wide cut, "More vintage PSA baseball
      // cards like yours", which names whichever save is strongest) is the
      // whole desk's, not one seed's
      const deskTie = !!r.best.parts && r.best.seed.kind !== 'signal';
      if (seedCapOn && !deskTie && (perSeed.get(seedKey(r.best.seed)) ?? 0) >= seedCap(r.best.seed)) { capped = true; continue; }
      if (saleCapOn && !namedTie(r) && (perSaleGen.get(k.sale) ?? 0) >= saleCap()) {
        // at its cap the sale's own repeat discount is spent: weigh it without
        capped = true;
        const v = r.score * penalty(r, k, false) * jit(r);
        if (v > overV) { overV = v; overSale = r; }
        continue;
      }
      const v = r.score * penalty(r, k) * jit(r);
      if (v > bestV) { bestV = v; best = r; }
      if (v > nearV && !isFar(r)) { nearV = v; near = r; }
      bestBare = Math.max(bestBare, r.score * penalty(r, k, false) * jit(r));
    }
    // the sale cap yields when nothing elsewhere comes close (weighed alike:
    // neither side's sale discount counts)
    if (overSale && overV * T.saleYield > bestBare) best = overSale;
    // (pass 4) this week first: the first screen keeps at most a third of its
    // seats for lots closing past two weeks while something nearer weighs
    // within farYield of them — the far lot waits its turn, never dropped
    // (weighed without the day's jitter: the rule reads scores, not the shuffle)
    else if (best && T.farShare < 1 && isFar(best) && (farBy[Math.floor(out.length / WEEK_SEATS)] ?? 0) >= farCap && near && nearV / jit(near) >= T.farYield * (bestV / jit(best))) best = near;
    if (!best) {
      // stuck: open the fallback ladder before lifting a cap; lift the caps
      // (one seat at a time — the strongest seed takes the next, the others
      // keep pace) before reaching outside a stated range
      if (phase < 1 && cand.some(r => !used.has(r) && phaseOf(r) === 1)) { phase = 1; continue; }
      if (capped && lift < n) { lift++; continue; }
      if (phase < 2 && cand.some(r => !used.has(r) && phaseOf(r) === 2)) { phase = 2; continue; }
      // the ties ran dry: the lane's unspent quota closes the list (never past it)
      if (discDealt < discQuota && dealDiscover()) continue;
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
    const { reason: base, why, short: baseShort } = explain(r.l, r.f, r.best, lotSeeds, taste.bands, !!r.inBand, !!r.inStated, taste.stated);
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
      // a discover reason already says its price
      off ?? (!r.flagged && !r.best.discover && !/\$/.test(base) ? (band ? `in your ${band} range` : said) : null),
      twinNote,
    ].filter(Boolean).join(' · ');
    const reason = extra ? `${base} · ${extra}` : base;
    const short = baseShort ? (extra ? `${baseShort} · ${extra}` : baseShort) : reason;
    const rec: Rec<L> = {
      lot: r.l, score: Math.round(r.score * 1000) / 1000, taste: Math.round(r.taste * 1000) / 1000, reason, short, why, seed: r.best.seed,
      flagged: !!r.flagged, inBand: !!r.inBand, tier: r.best.ladder?.tier ?? 1,
    };
    if (r.out) rec.outOfRange = r.out;
    if (r.best.discover) rec.lane = 'discover';
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

function explain(l: RecLot, f: Feat, best: { seed: Seed; parts?: SimParts; ladder?: LadderHit; discover?: DiscoverHit }, lotSeeds: Seed[], bands?: ReadonlyMap<CatKey, PriceBand>, inBand = false, inStated = false, stated?: StatedBand | null): { reason: string; why: string[]; short?: string } {
  const s = best.seed;
  const why: string[] = [];
  // a discover pick ties to nothing: it says the cut it stands in and the price, no more
  if (best.discover) return discoverReason(f, best.discover.cut, bands, inBand, inStated, stated);
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
    // the group is the desk's lots of this name AND this kind: a Warhol
    // Polaroid set is not "like your Andy Warhol prints"
    const group = lotSeeds.filter(x => x.f!.ek === f.ek && x.f!.cat === f.cat && (x.f!.sub === f.sub || f.cat === 'sports-cards') && (x.f!.medium ?? null) === (f.medium ?? null));
    if (group.length >= 2) {
      // the name the DESK's lots carry ("Charizard"), never this lot's
      // variant ("Like your Charizard V cards" over a desk of Charizard ex)
      const name = groupName(group, f, l);
      const prices = group.map(x => x.f!.logA).filter((x): x is number => x != null).map(x => Math.pow(10, x));
      let band = '';
      if (prices.length >= 2 && f.logA != null) {
        const lo = Math.min(...prices), hi = Math.max(...prices);
        const a = Math.pow(10, f.logA);
        if (hi / lo <= BAND_SAY_MAX) band = bandSuffix(a, lo, hi);
      }
      // (pass 5) a named tie reaches whatever the name sold (an Omega menu is
      // still Omega's) — but the group noun promises a KIND: a Type I photo is
      // not one of "your Michael Jordan cards"
      const noun = kindFits({ ...l, ek: f.ek }) ? nounOf(f.cat, f.sub, f.medium) : 'pieces';
      return { reason: `Like your ${name} ${noun}${band}`, why };
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

/** a domain, in a reason's voice */
const DOMAIN_WORD: Record<string, string> = { 'film-tv': 'film & TV', music: 'music' };
/** the discover lane's reason — TRUE by construction, never a tie:
 *  "New to you · modern basketball cards in your $200–900 range",
 *  "New to you · prints near Andy Warhol’s prices" (no band learned or
 *  stated: the cut's own level, said as whose it is; the engine's note and
 *  a live twin ride after it, as on every pick) */
function discoverReason(f: Feat, cut: TasteCut, bands: ReadonlyMap<CatKey, PriceBand> | undefined, inBand: boolean, inStated: boolean, stated?: StatedBand | null): { reason: string; why: string[]; short: string } {
  const era = cut.fx.find(k => k.startsWith('era-'));
  const eraW = era && f.fx.has(era) ? FX_WORD[era] : null;
  const sport = f.sport ? SPORT_WORD[f.sport] : null;
  const sportW = sport && sport !== 'other sports' ? `${sport} ` : '';
  const dom = CUT_CATS.has(f.cat) ? null : cut.fx.find(k => k.startsWith('fr-') && f.fx.has(k) && FACET_LABEL[k]) ?? cut.fx.find(k => DOMAIN_WORD[k] && f.fx.has(k));
  const noun = f.cat === 'sports-cards' ? `${sportW}cards`
    : f.cat === 'tcg' ? 'Pokémon cards'
    : f.cat === 'fine-art' ? nounOf(f.cat, f.sub, f.medium)
    : f.cat === 'sports-memorabilia' ? `${sportW}${subLabel(f.cat, f.sub).toLowerCase()}`
    : f.cat === 'space-science' ? `${subLabel(f.cat, f.sub)} pieces`
    : dom ? `${DOMAIN_WORD[dom] ?? FACET_LABEL[dom]} ${nounOf(f.cat, f.sub)}`
    : subLabel(f.cat, f.sub).toLowerCase();
  const what = `${eraW ? `${eraW} ` : ''}${noun}`;
  const band = inBand ? bandOfCat(bands, f.cat) : null;
  const whose = cut.seed.follow ? `${cut.seed.label}’s` : cut.n === 1 ? 'your save’s' : 'your saves’';
  const price = band ? `in your ${band} range` : inStated && stated ? stated.say : `near ${whose} prices`;
  const reason = `New to you · ${what} ${price}`;
  return { reason, why: ['new to you', what, price], short: reason };
}

/** what a family is called, for "Another …" — a person by the anchor the
 *  rung stands on ("film & TV figure", "signed letter", "figure of the 1950s") */
function familyWord(a: LadderAnchor, via: LadderVia | null = null): string {
  const fam = a.fam ?? '';
  if (via && /\|p$/.test(fam)) {
    if (via.kind === 'franchise' || via.kind === 'domain') return `${via.word} figure`;
    if (via.kind === 'form') return `signed ${via.word}`;
    return `figure of ${via.word}`;
  }
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
  // an art / design / watch save's title rarely names its maker — say whose it was
  const what = s.f?.ek?.startsWith('mk:') && s.who && !s.label.toLowerCase().includes(s.who.toLowerCase()) ? `${s.who} · ${s.label}` : s.label;
  const src = s.kind === 'signal' ? `you ${s.verb} ${what}` : s.follow ? `you follow ${s.label}` : `you ${s.kind === 'owned' ? 'own' : s.live ? 'saved' : 'watched'} ${what}`;
  const whose = s.follow || s.kind === 'signal' ? s.label : 'your save';
  const sport = f.sport ? SPORT_WORD[f.sport] : null;
  const noun = f.cat === 'sports-cards' ? `${sport && sport !== 'other sports' ? `${sport} ` : ''}cards`
    : f.cat === 'tcg' ? 'Pokémon cards'
    : nounOf(f.cat, f.sub);
  let lead: string;
  const via = hit.via ?? null;
  if (hit.tier === 2) lead = `Another ${familyWord(a, via)}`;
  else if (hit.tier === 3) {
    const words = a.cut.filter(k => f.fx.has(k) && FX_WORD[k]).sort((x, y) => rankCut(x) - rankCut(y)).slice(0, 2).map(k => FX_WORD[k]);
    lead = `More ${words.length ? `${words.join(' ')} ` : ''}${noun}`;
  } else {
    const p = a.logA != null ? Math.pow(10, a.logA) : null;
    // (Oct 29) the anchor the price-only rung stands on, in the noun ("More
    // vintage baseball cards at…", "More Apollo pieces at…")
    const anchorW = via?.kind === 'era' && !/^the /.test(via.word) ? `${via.word} ` : via?.kind === 'domain' ? `${via.word} ` : '';
    const eraTail = via?.kind === 'era' && /^the /.test(via.word) ? ` of ${via.word}` : '';
    lead = `More ${anchorW}${noun}${eraTail} at ${whose === 'your save' ? 'your save’s' : `${whose}’s`} prices${p ? ` · ~${bandText(p, p)}` : ''}`;
  }
  const why = [hit.tier === 2 ? `another ${familyWord(a, via)}` : hit.tier === 3 ? 'same cut' : 'same price level'];
  if (via) why.push(via.kind === 'franchise' ? `also ${via.word}` : via.kind === 'domain' ? `same domain · ${via.word}` : via.kind === 'era' ? `same era · ${via.word}` : `same form · ${via.word}`);
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
    : nounOf(f.cat, f.sub, f.medium);
  // the band of the saves that share this cut (same sub, medium and sport)
  const group = lotSeeds.filter(x => x.f!.cat === f.cat && x.f!.sub === f.sub && (x.f!.medium ?? null) === (f.medium ?? null) && (x.f!.sport ?? null) === (f.sport ?? null));
  const prices = group.map(x => x.f!.logA).filter((x): x is number => x != null).map(x => Math.pow(10, x));
  let band = '';
  if (prices.length >= 2 && f.logA != null) {
    const lo = Math.min(...prices), hi = Math.max(...prices), a = Math.pow(10, f.logA);
    if (hi / lo <= BAND_SAY_MAX) band = bandSuffix(a, lo, hi);
  }
  // one priced save is a price, not a range; "in your range" only when the
  // band prints (inside or near it) — a $4K print for a $7K–40K desk is near
  // one save, not in the range (pass 6)
  if (p.weak) return prices.length >= 2 ? (band ? `More ${noun} in your range${band}` : `More ${noun} near your saves’ prices`) : `More ${noun} near your save’s price`;
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

/* ── the top of the deal ────────────────────────────────────────────────── */

/**
 * (pass 4) THE TOP n OF A DEAL — the Today band's strip. The deal's order
 * stands (any lane: a discover pick that ranks is in), skipping lots the
 * band already shows (`claimed`); and the strip never comes all from one
 * house while another house's pick weighs within `houseYield` of the one
 * it would displace — three Goldin cards in a row is one sale, not a desk.
 * Pure; the same n is the deal's prefix when the houses allow.
 */
export function topOf<R extends { lot: { id: string; auctionHouse?: string | null }; score: number }>(recs: readonly R[], n = 3, opts: { claimed?: ReadonlySet<string>; houseYield?: number } = {}): R[] {
  const yieldAt = opts.houseYield ?? 0.8;
  const out: R[] = [];
  const used = new Set<R>();
  const perHouse = new Map<string, number>();
  const houseOf = (r: R) => r.lot.auctionHouse ?? '';
  for (let i = 0; i < recs.length && out.length < n; i++) {
    const r = recs[i];
    if (used.has(r) || opts.claimed?.has(r.lot.id)) continue;
    let take = r;
    // the last seat would make the strip one house: the next other-house
    // pick within reach takes it instead
    if (n > 1 && out.length === n - 1 && (perHouse.get(houseOf(r)) ?? 0) === n - 1) {
      for (let j = i + 1; j < recs.length; j++) {
        const o = recs[j];
        if (used.has(o) || opts.claimed?.has(o.lot.id) || houseOf(o) === houseOf(r)) continue;
        if (o.score >= yieldAt * r.score) take = o;
        break;
      }
    }
    used.add(take);
    out.push(take);
    perHouse.set(houseOf(take), (perHouse.get(houseOf(take)) ?? 0) + 1);
  }
  return out;
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
