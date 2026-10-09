/**
 * taxonomy.ts — ONE clean two-level category for every lot (Oct 8).
 *
 * The raw fields can't be filtered on: `category` is an art-medium enum that is
 * 'unknown'/'object' for ~93% of the live book, the real vertical hides in the
 * `artist` slug (pseudo-artists like 'sports-cards'), and `drill` means sport,
 * era, space program, culture domain or watch family depending on the lot.
 * This folds artist + subCat + drill into a stable { cat, sub } pair plus a
 * separate `sport` facet, so sport (Baseball…) and format (Cards, Game-Used…)
 * are two filters instead of one mixed chip list.
 *
 * A pure function of fields every served lot carries, so the client computes
 * it (no payload weight) and the pipeline logs the counts nightly.
 * Keys are URL-safe slugs and never change; labels are display copy.
 */
import { marketOf } from '../constants';

export type CatKey =
  | 'sports-cards' | 'sports-memorabilia' | 'tcg' | 'entertainment' | 'historical'
  | 'space-science' | 'fine-art' | 'watches' | 'design';

export const CATS: { key: CatKey; label: string }[] = [
  { key: 'fine-art', label: 'Fine Art' },
  { key: 'design', label: 'Design' },
  { key: 'watches', label: 'Watches' },
  { key: 'sports-cards', label: 'Sports Cards' },
  { key: 'sports-memorabilia', label: 'Sports Memorabilia' },
  { key: 'tcg', label: 'Pokémon & TCG' },
  { key: 'entertainment', label: 'Entertainment & Music' },
  { key: 'historical', label: 'Historical & Documents' },
  { key: 'space-science', label: 'Space & Science' },
];
export const CAT_LABEL: Record<CatKey, string> = Object.fromEntries(CATS.map(c => [c.key, c.label])) as Record<CatKey, string>;

/** sub key → label, per category (display order = array order) */
export const SUBS: Record<CatKey, { key: string; label: string }[]> = {
  // Oct 9 (subcategory audit): keys are never renamed — follows and shared
  // links store them — so new cuts are ADDED keys and old ones keep working
  // (see SUB_ALIASES). Labels are display copy and may change freely.
  'sports-cards': [
    { key: 'singles', label: 'Singles' },
    { key: 'lots', label: 'Lots & Sets' },
    { key: 'sealed-wax', label: 'Sealed Packs & Boxes' },
  ],
  'sports-memorabilia': [
    { key: 'game-used', label: 'Game-Used & Worn' },
    { key: 'autographs', label: 'Autographs' },
    { key: 'photographs', label: 'Photographs' },
    { key: 'tickets', label: 'Tickets & Passes' },
    { key: 'programs', label: 'Programs & Publications' },
    { key: 'trophies', label: 'Trophies, Rings & Awards' },
    { key: 'equipment', label: 'Vintage Collectibles & Equipment' },
  ],
  tcg: [
    { key: 'vintage', label: 'Vintage (WotC era)' },
    { key: 'classic', label: 'Mid-era (2003–2016)' },
    { key: 'modern', label: 'Modern (2017+)' },
    { key: 'sealed', label: 'Sealed Product' },
    { key: 'lots', label: 'Lots & Sets' },
    { key: 'memorabilia', label: 'Art & Memorabilia' },
    { key: 'other-tcg', label: 'Other TCGs' },
  ],
  entertainment: [
    { key: 'props-costumes', label: 'Props & Wardrobe' },
    { key: 'instruments-records', label: 'Instruments, Records & Awards' },
    { key: 'autographs-documents', label: 'Autographs & Documents' },
    { key: 'photos-posters', label: 'Photos & Posters' },
    { key: 'animation', label: 'Animation & Production Art' },
    { key: 'other', label: 'Other' },
  ],
  historical: [
    { key: 'political', label: 'Presidential & Political' },
    { key: 'royalty', label: 'Royalty & World Leaders' },
    { key: 'military', label: 'Military & Wartime' },
    { key: 'aviation', label: 'Aviation & Exploration' },
    { key: 'crime', label: 'Crime & Notorious' },
    { key: 'literary', label: 'Arts & Letters' },
    { key: 'historic', label: 'Historic Americana & Events' },
  ],
  'space-science': [
    { key: 'apollo', label: 'Apollo' },
    { key: 'shuttle-iss', label: 'Shuttle & ISS' },
    { key: 'mercury-gemini', label: 'Mercury & Gemini' },
    { key: 'soviet', label: 'Soviet' },
    { key: 'space-other', label: 'Space · Other' },
    { key: 'science', label: 'Science, Tech & Natural History' },
  ],
  'fine-art': [
    { key: 'prints', label: 'Prints & Multiples' },
    { key: 'unique', label: 'Paintings & Works on Paper' },
    { key: 'ceramics', label: 'Ceramics' },
    { key: 'sculpture', label: 'Sculpture' },
    { key: 'photographs', label: 'Photographs' },
    { key: 'books', label: 'Books & Ephemera' },
    { key: 'other', label: 'Other' },
  ],
  watches: [
    { key: 'wristwatches', label: 'Wristwatches' },
    { key: 'pocket', label: 'Pocket & Pendant' },
    { key: 'clocks', label: 'Clocks & Accessories' },
  ],
  design: [
    { key: 'seating', label: 'Seating' },
    { key: 'tables', label: 'Tables' },
    { key: 'storage', label: 'Storage' },
    { key: 'lighting', label: 'Lighting' },
    { key: 'objects', label: 'Objects & Other' },
  ],
};

/** A retired sub key → the keys it now spans. Old follows / links stay valid. */
export const SUB_ALIASES: Record<string, string[]> = {
  'sports-memorabilia:tickets-programs': ['tickets', 'programs'],
};

/** Does a lot's sub satisfy a wanted (possibly legacy) sub key? */
export function subMatches(cat: string, wanted: string, actual: string): boolean {
  if (wanted === actual) return true;
  return SUB_ALIASES[`${cat}:${wanted}`]?.includes(actual) ?? false;
}

/** the separate entertainment DOMAIN facet (how Hollywood vs music buyers shop) */
export const DOMAINS: { key: string; label: string }[] = [
  { key: 'film-tv', label: 'Film & TV' },
  { key: 'music', label: 'Music' },
];

/** the separate sport facet (sports cards + sports memorabilia only) */
export const SPORTS: { key: string; label: string }[] = [
  { key: 'baseball', label: 'Baseball' },
  { key: 'basketball', label: 'Basketball' },
  { key: 'football', label: 'Football' },
  { key: 'soccer', label: 'Soccer' },
  { key: 'hockey', label: 'Hockey' },
  { key: 'racing', label: 'Racing' },
  { key: 'boxing-mma', label: 'Boxing & MMA' },
  { key: 'golf', label: 'Golf' },
  { key: 'other-sports', label: 'Other Sports' },
];
const SPORT_KEYS = new Set(SPORTS.map(s => s.key));
const MINOR_SPORTS = new Set(['olympics', 'tennis', 'wrestling']);

const SPORTS_MEM: Record<string, string> = {
  'game-used': 'game-used', 'equipment-artifacts': 'equipment', 'sports-memorabilia': 'equipment',
  memorabilia: 'equipment', 'trophies-awards': 'trophies', 'tickets-passes': 'tickets',
  'programs-publications': 'programs', autographs: 'autographs', 'type-1-photos': 'photographs',
};
/** a sports lot's raw subCat, when it names the object more precisely than its slug */
const SPORTS_MEM_SUBCAT: Record<string, string> = {
  tickets: 'tickets', programs: 'programs', publications: 'programs', photos: 'photographs',
  autographs: 'autographs', trophies: 'trophies', 'game-used': 'game-used',
};
const CULTURE = new Set(['entertainment-memorabilia', 'movie-tv', 'music-memorabilia', 'pop-memorabilia']);
const HIST_DRILL: Record<string, string> = {
  political: 'political', royalty: 'royalty', military: 'military', literary: 'literary', historic: 'historic',
  aviation: 'aviation', crime: 'crime',
};
const ENT_DOMAIN: Record<string, string> = { hollywood: 'film-tv', 'film-tv': 'film-tv', music: 'music' };
const ENT_SUB: Record<string, string> = {
  'cel-art': 'animation', animation: 'animation',
  props: 'props-costumes', 'worn-personal': 'props-costumes',
  instruments: 'instruments-records', records: 'instruments-records', awards: 'instruments-records',
  autographs: 'autographs-documents', documents: 'autographs-documents',
  photos: 'photos-posters', posters: 'photos-posters', tickets: 'photos-posters',
};
const SPACE_DRILL: Record<string, string> = {
  apollo: 'apollo', 'shuttle-iss': 'shuttle-iss', 'mercury-gemini': 'mercury-gemini', soviet: 'soviet',
};
const ART_SUB: Record<string, string> = {
  prints: 'prints', originals: 'unique', sculpture: 'sculpture', ceramics: 'ceramics', photographs: 'photographs', books: 'books',
};
const DESIGN_SUB: Record<string, string> = { seating: 'seating', tables: 'tables', lighting: 'lighting', 'case-storage': 'storage' };
const POKEMON_SUB: Record<string, string> = { 'pokemon-sealed': 'sealed', 'pokemon-lots': 'lots', 'pokemon-memorabilia': 'memorabilia' };

export interface Taxon { cat: CatKey; sub: string; sport?: string; domain?: string }

type LotLike = { artist?: string | null; subCat?: string | null; drill?: string | null };

function sportOf(drill: string | null | undefined): string | undefined {
  if (!drill) return undefined;
  if (SPORT_KEYS.has(drill)) return drill;
  if (MINOR_SPORTS.has(drill)) return 'other-sports';
  return undefined;
}

/** The clean { cat, sub, sport? } for one lot. Total: every lot gets a cat. */
export function taxonOf(l: LotLike): Taxon {
  const a = String(l.artist || '');
  const s = l.subCat || '';
  const d = l.drill || '';

  // non-Pokémon TCG (Yu-Gi-Oh!, One Piece, Magic…) keeps its slug for comps
  // isolation but belongs to the TCG category
  if (s === 'tcg-other') return { cat: 'tcg', sub: 'other-tcg' };
  if (a === 'sports-cards' || a === 'graded-cards') {
    return { cat: 'sports-cards', sub: s === 'card-lots' ? 'lots' : 'singles', sport: sportOf(d) };
  }
  if (a === 'unopened-wax') return { cat: 'sports-cards', sub: 'sealed-wax', sport: sportOf(d) };
  if (a in SPORTS_MEM) {
    return { cat: 'sports-memorabilia', sub: SPORTS_MEM_SUBCAT[s] || SPORTS_MEM[a], sport: sportOf(d) };
  }
  if (a === 'pokemon') {
    if (POKEMON_SUB[s]) return { cat: 'tcg', sub: POKEMON_SUB[s] };
    return { cat: 'tcg', sub: d === 'vintage' || d === 'classic' || d === 'modern' ? d : 'modern' };
  }
  if (a === 'space-exploration') return { cat: 'space-science', sub: SPACE_DRILL[d] || 'space-other' };
  if (a === 'science-tech' || a === 'meteorites' || a === 'fossils' || a === 'scientific-instruments') {
    return { cat: 'space-science', sub: 'science' };
  }
  if (CULTURE.has(a)) {
    if (d in HIST_DRILL) return { cat: 'historical', sub: HIST_DRILL[d] };
    if (d in SPACE_DRILL) return { cat: 'space-science', sub: SPACE_DRILL[d] };
    if (d === 'space-science') return { cat: 'space-science', sub: 'space-other' };
    if (d === 'science') return { cat: 'space-science', sub: 'science' };
    // culture-house lots about athletes belong with the sports memorabilia
    if (d === 'sports') return { cat: 'sports-memorabilia', sub: SPORTS_MEM_SUBCAT[s] || 'equipment' };
    const domain = ENT_DOMAIN[d] || (a === 'movie-tv' ? 'film-tv' : a === 'music-memorabilia' ? 'music' : undefined);
    const t: Taxon = { cat: 'entertainment', sub: ENT_SUB[s] || 'other' };
    if (domain) t.domain = domain;
    return t;
  }
  const m = marketOf(a);
  if (m === 'watches') {
    if (s === 'clocks' || s === 'watch-accessories') return { cat: 'watches', sub: 'clocks' };
    return { cat: 'watches', sub: s === 'pocket-watches' ? 'pocket' : 'wristwatches' };
  }
  if (m === 'design') return { cat: 'design', sub: DESIGN_SUB[s] || 'objects' };
  return { cat: 'fine-art', sub: ART_SUB[s] || 'other' };
}

export function subLabel(cat: CatKey, sub: string): string {
  return SUBS[cat]?.find(x => x.key === sub)?.label ?? sub;
}
