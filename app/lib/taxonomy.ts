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
  'sports-cards': [
    { key: 'singles', label: 'Graded & Raw Singles' },
    { key: 'sealed-wax', label: 'Sealed Wax' },
  ],
  'sports-memorabilia': [
    { key: 'game-used', label: 'Game-Used & Worn' },
    { key: 'autographs', label: 'Autographs' },
    { key: 'tickets-programs', label: 'Tickets & Programs' },
    { key: 'photographs', label: 'Photographs' },
    { key: 'equipment', label: 'Equipment & Other' },
    { key: 'trophies', label: 'Trophies & Awards' },
  ],
  tcg: [
    { key: 'vintage', label: 'Vintage Singles' },
    { key: 'classic', label: 'Classic Singles' },
    { key: 'modern', label: 'Modern Singles' },
    { key: 'sealed', label: 'Sealed Product' },
  ],
  entertainment: [
    { key: 'props-costumes', label: 'Props & Costumes' },
    { key: 'instruments-records', label: 'Instruments, Records & Awards' },
    { key: 'autographs-documents', label: 'Autographs & Documents' },
    { key: 'photos-posters', label: 'Photos & Posters' },
    { key: 'other', label: 'Other' },
  ],
  historical: [
    { key: 'political', label: 'Political' },
    { key: 'royalty', label: 'Royalty' },
    { key: 'military', label: 'Military' },
    { key: 'literary', label: 'Literary' },
    { key: 'historic', label: 'Historic' },
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
    { key: 'sculpture', label: 'Sculpture & Ceramics' },
    { key: 'photographs', label: 'Photographs' },
    { key: 'books', label: 'Books & Ephemera' },
    { key: 'other', label: 'Other' },
  ],
  watches: [
    { key: 'wristwatches', label: 'Wristwatches' },
    { key: 'pocket', label: 'Pocket Watches' },
  ],
  design: [
    { key: 'seating', label: 'Seating' },
    { key: 'tables', label: 'Tables' },
    { key: 'lighting', label: 'Lighting' },
    { key: 'objects', label: 'Objects & Other' },
  ],
};

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
  memorabilia: 'equipment', 'trophies-awards': 'trophies', 'tickets-passes': 'tickets-programs',
  'programs-publications': 'tickets-programs', autographs: 'autographs', 'type-1-photos': 'photographs',
};
const CULTURE = new Set(['entertainment-memorabilia', 'movie-tv', 'music-memorabilia', 'pop-memorabilia']);
const HIST_DRILL: Record<string, string> = {
  political: 'political', royalty: 'royalty', military: 'military', literary: 'literary', historic: 'historic',
};
const ENT_SUB: Record<string, string> = {
  props: 'props-costumes', 'worn-personal': 'props-costumes',
  instruments: 'instruments-records', records: 'instruments-records', awards: 'instruments-records',
  autographs: 'autographs-documents', documents: 'autographs-documents',
  photos: 'photos-posters', posters: 'photos-posters', tickets: 'photos-posters',
};
const SPACE_DRILL: Record<string, string> = {
  apollo: 'apollo', 'shuttle-iss': 'shuttle-iss', 'mercury-gemini': 'mercury-gemini', soviet: 'soviet',
};
const ART_SUB: Record<string, string> = {
  prints: 'prints', originals: 'unique', sculpture: 'sculpture', photographs: 'photographs', books: 'books',
};
const DESIGN_SUB: Record<string, string> = { seating: 'seating', tables: 'tables', lighting: 'lighting' };

export interface Taxon { cat: CatKey; sub: string; sport?: string }

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

  if (a === 'sports-cards' || a === 'graded-cards') return { cat: 'sports-cards', sub: 'singles', sport: sportOf(d) };
  if (a === 'unopened-wax') return { cat: 'sports-cards', sub: 'sealed-wax', sport: sportOf(d) };
  if (a in SPORTS_MEM) return { cat: 'sports-memorabilia', sub: SPORTS_MEM[a], sport: sportOf(d) };
  if (a === 'pokemon') {
    if (s === 'pokemon-sealed') return { cat: 'tcg', sub: 'sealed' };
    return { cat: 'tcg', sub: d === 'vintage' || d === 'classic' || d === 'modern' ? d : 'modern' };
  }
  if (a === 'space-exploration') return { cat: 'space-science', sub: SPACE_DRILL[d] || 'space-other' };
  if (a === 'science-tech' || a === 'meteorites' || a === 'fossils' || a === 'scientific-instruments') {
    return { cat: 'space-science', sub: 'science' };
  }
  if (CULTURE.has(a)) {
    if (d in HIST_DRILL) return { cat: 'historical', sub: HIST_DRILL[d] };
    if (d === 'space-science') return { cat: 'space-science', sub: 'space-other' };
    return { cat: 'entertainment', sub: ENT_SUB[s] || 'other' };
  }
  const m = marketOf(a);
  if (m === 'watches') return { cat: 'watches', sub: s === 'pocket-watches' ? 'pocket' : 'wristwatches' };
  if (m === 'design') return { cat: 'design', sub: DESIGN_SUB[s] || 'objects' };
  return { cat: 'fine-art', sub: ART_SUB[s] || 'other' };
}

export function subLabel(cat: CatKey, sub: string): string {
  return SUBS[cat]?.find(x => x.key === sub)?.label ?? sub;
}
