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
import { isCardLotTitle, looksLikeCard, parseCard } from './cards';

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
    { key: 'sealed-wax', label: 'Sealed Product' },
  ],
  'sports-memorabilia': [
    { key: 'game-used', label: 'Game-Used & Worn' },
    { key: 'autographs', label: 'Autographs' },
    { key: 'photographs', label: 'Photos' },
    { key: 'tickets', label: 'Tickets & Passes' },
    { key: 'programs', label: 'Programs & Publications' },
    { key: 'trophies', label: 'Trophies, Rings & Awards' },
    { key: 'equipment', label: 'Equipment & Collectibles' },
  ],
  tcg: [
    { key: 'vintage', label: 'Vintage (1996–2003)' },
    { key: 'classic', label: 'Classic (2003–2016)' },
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
    // (Oct 9 labels audit) concert / screening tickets, backstage passes and
    // show programmes were filed with the photos — a NEW key, so old
    // photos-posters links hold
    { key: 'tickets', label: 'Tickets, Passes & Programs' },
    { key: 'animation', label: 'Animation & Production Art' },
    { key: 'other', label: 'Other Memorabilia' },
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
    { key: 'space-other', label: 'Rocketry & Other Space' },
    { key: 'science', label: 'Science, Tech & Natural History' },
  ],
  'fine-art': [
    { key: 'prints', label: 'Prints & Multiples' },
    { key: 'unique', label: 'Paintings & Works on Paper' },
    { key: 'ceramics', label: 'Ceramics' },
    { key: 'sculpture', label: 'Sculpture' },
    { key: 'photographs', label: 'Photographs' },
    { key: 'books', label: 'Books & Ephemera' },
    { key: 'other', label: 'Other Media' },
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
  photos: 'photos-posters', posters: 'photos-posters', tickets: 'tickets',
};
const SPACE_DRILL: Record<string, string> = {
  apollo: 'apollo', 'shuttle-iss': 'shuttle-iss', 'mercury-gemini': 'mercury-gemini', soviet: 'soviet',
};
const ART_SUB: Record<string, string> = {
  prints: 'prints', originals: 'unique', sculpture: 'sculpture', ceramics: 'ceramics', photographs: 'photographs', books: 'books',
};
const DESIGN_SUB: Record<string, string> = { seating: 'seating', tables: 'tables', lighting: 'lighting', 'case-storage': 'storage' };
const POKEMON_SUB: Record<string, string> = { 'pokemon-sealed': 'sealed', 'pokemon-lots': 'lots', 'pokemon-memorabilia': 'memorabilia' };

// ── title rules (Oct 9 labels audit) ────────────────────────────────────────
// The stamped subCat / drill are build-time reads (scripts/lib/sub-cats.ts,
// corpus-normalize) that land on the live book only after the nightly. These
// title rules are SHARED: the build imports them (so the next nightly stamps
// the same answer) and taxonOf applies them at view time (so the current
// payload reads right today). Each fixes one measured misfile class.

/** production art — an animation cel, concept art, a storyboard, a character /
 *  model sheet, a costume sketch ("Pink Panther in Cowboy Hat Animation Cel"
 *  is a cel, not a hat; "Who Framed Roger Rabbit Concept Artwork" was Other) */
export const PRODUCTION_ART_RE = /\b(?:animation (?:cels?|sequences?|drawings?|art(?:work)?|paper)|production (?:cels?|art(?:work)?|drawings?|sketch(?:es)?|backgrounds?|sheets?)|(?:hand[- ]painted|original) cels?|concept (?:art(?:work)?|illustrations?|drawings?|sketch(?:es)?|paintings?|designs?)|storyboards?|character (?:sheets?|designs?(?: sheets?)?|model sheets?|art(?:work)?|scale illustrations?|size comparison)|model sheets?|pre-production|costume (?:sketch(?:es)?|designs?|illustrations?|renderings?|concept))\b/i;
/** a photographic print named as one ("Les Paul Type I Original Photo" is a
 *  photo of the guitarist, not a guitar) */
const STRONG_PHOTO_RE = /\btype (?:i{1,3}|iv|[1-4]) (?:original )?photo(?:graph)?s?\b|\boriginal (?:test |press |vintage )?(?:photo(?:graph)?s?|polaroids?|negatives?)\b|\bpolaroids?\b/i;
/** an art / gig print or flyer ("Dumbo Mondo Print by Tom Whalen", a concert flyer) */
const POSTER_PRINT_RE = /\bmondo\b|\bwhalen\b|\bgicl[ée]e\b|\bscreen ?prints?\b|\bsilkscreens?\b|\bart prints?\b|\bhandbills?\b|\bflyers?\b(?!\s+(?:wing|fabric|relics?|propeller|replica|models?|linen|muslin))/i;
/** a ticket or a pass ("Full Ticket", "Backstage Cloth Passes", "Screening Pass") */
const TICKET_RE = /\b(?:tickets?|ticket stubs?|stubs?|(?:backstage|all[- ]access|access|screening|press|tour|crew|vip|cloth|concert|working) pass(?:es)?)\b|\bpasses\b(?=\s*(?:$|[(\-–—,:;]|(?:pair|set|lot|collection|group|and)\b))/i;
/** any other photo noun — named first, it keeps the lot a photo ("Signed Promo
 *  Photo Plus … Access Pass"); a photo-MATCHED costume is not a photo */
/** the Wright Flyer and the Philadelphia Flyers are no gig flyers — masked
 *  (length-preserving, so phrase positions hold) before the flyer reads; no
 *  lookbehind: this module ships to the browser */
const NOT_A_FLYER_RE = /\b(?:wright|brothers['’]?|philadelphia) flyers?\b/gi;
const maskFlyers = (t: string): string => t.replace(NOT_A_FLYER_RE, m => ' '.repeat(m.length));
const PHOTO_NOUN_RE = /\bphoto(?![- ]?match)(?:graph)?s?\b/i;
/** a production / screen piece: only production art outranks it ("Production-
 *  Made Airplane Tickets" from Fight Club are a prop) */
const PROP_PIECE_RE = /\bprops?\b|\bproduction[- ](?:made|used|worn)\b|\bscreen[- ](?:used|worn|matched)\b|\bhero\b/i;
const CULTURE_OBJECT_RULES: [RegExp, CultureObject | null][] = [
  [PRODUCTION_ART_RE, 'cel-art'], [STRONG_PHOTO_RE, 'photo'], [POSTER_PRINT_RE, 'poster'],
  [TICKET_RE, 'ticket'], [PHOTO_NOUN_RE, null],
];
export type CultureObject = 'cel-art' | 'photo' | 'poster' | 'ticket';
/** The STRONG object a culture title names, earliest first, as a culture
 *  itemClass — or null (nothing strong, a plain photo named first, or a prop
 *  piece that is not production art). Pattern 1 / 3 / 4 / 5. */
export function cultureObjectOf(title: string | null | undefined): CultureObject | null {
  return cultureObjectAt(title).kind;
}
/** ...with where its phrase starts (Infinity when none) — a poster / ticket
 *  phrase only outranks an object noun named BEFORE it ("Tour Crew Shirt and
 *  (5) Backstage Passes" is a shirt; "Acetate for 'Ticket to Ride'" a record) */
export function cultureObjectAt(title: string | null | undefined): { kind: CultureObject | null; at: number } {
  const t = maskFlyers(String(title || ''));
  let best: CultureObject | null = null, at = Infinity;
  for (const [re, k] of CULTURE_OBJECT_RULES) {
    const m = re.exec(t);
    if (m && m.index < at) { at = m.index; best = k; }
  }
  if (best && best !== 'cel-art' && PROP_PIECE_RE.test(t)) return { kind: null, at: Infinity };
  return { kind: best, at: best ? at : Infinity };
}
/** a garment named as WORN outranks the costume sketch that came with it */
export const WORN_RE = /\b(?:worn|wore)\b/i;
const CULTURE_OBJECT_SUB: Record<CultureObject, string> = { 'cel-art': 'animation', photo: 'photos-posters', poster: 'photos-posters', ticket: 'tickets' };
/** the entertainment subs each strong object may re-file at view time (the
 *  build stamps the same through cultureItemClass): production art from any
 *  sub (a storyboard was a 'script' document); a photo from an object sub (the
 *  hat / guitar named first); a poster / ticket only from the catch-alls (an
 *  autograph or a costume that mentions a ticket keeps its kind) — and a pass
 *  to an awards show is a ticket, not an award */
const ENT_REFILE: Record<CultureObject, Set<string>> = {
  'cel-art': new Set(['other', 'photos-posters', 'props-costumes', 'instruments-records', 'tickets', 'autographs-documents']),
  photo: new Set(['other', 'photos-posters', 'props-costumes', 'instruments-records', 'tickets']),
  poster: new Set(['other', 'photos-posters', 'tickets']),
  ticket: new Set(['other', 'photos-posters', 'tickets']),
};

/** a film / TV production piece (Goldin's "Ursa Authentic" film-archive COA,
 *  "Production-Worn … from Die Hart (2020-Present)") — never a historical or a
 *  sports artifact (Pattern 12: a John Wick costume was Military) */
const SHOWBIZ_WORD_RE = /\bursa authentic\b|\bproduction[- ](?:made|worn|used)\b|\bscreen[- ](?:used|worn|matched)\b/i;
const FILM_FROM_RE = /\bfrom (?:the )?[A-Z][^()]{1,60} \((?:19|20)\d\d(?:[-–](?:\d{2,4}|[Pp]resent))?\)/;
export function isShowbizTitle(title: string | null | undefined): boolean {
  const t = String(title || '');
  return SHOWBIZ_WORD_RE.test(t) || FILM_FROM_RE.test(t);
}
/** ...the strict read for a SPORTS lot: the production words only, never "from
 *  <Title> (<year>)" ("Jersey from Super Bowl LVII (2023)" is a game piece) —
 *  plus production art (a cartoon cel of Muhammad Ali is animation) */
export function isFilmProductionTitle(title: string | null | undefined): boolean {
  const t = String(title || '');
  return SHOWBIZ_WORD_RE.test(t) || (CARTOON_ART_RE.test(t) && !/\b(?:signed|autographed|autographs?|inscribed)\b/i.test(t));
}
/** cartoon / film art a sports house sells (a Goofy "How to Play Baseball"
 *  production drawing) — not a card's or a press pin's "production artwork" */
const CARTOON_ART_RE = /\b(?:animation (?:cels?|drawings?|art)|(?:production|original|hand[- ]painted) cels?|cartoon (?:original )?cels?|storyboards?|model sheets?|costume (?:sketch(?:es)?|designs?)|production (?:drawings?|backgrounds?))\b/i;
/** music words a historical drill misread ("Led Zeppelin" is no airship, an
 *  "Army Themed Guitar" no war relic, a "Battle Flyer Featuring Grandmaster
 *  Flash" no battle) — Pattern 2 */
export const HIST_MUSIC_RE = /\bled zeppelin\b|\bguitars?\b|\bgrandmaster (?:flash|caz)\b|\bflyer featuring\b/i;
/** the notorious a culture title names that the crime rule missed (Pattern 10 /
 *  11): the Massacre, Prohibition, the Capone family and the New York families */
export const CRIME_EXTRA_RE = /\b(?:(?:st\.?|saint) valentine['’]?s day massacre|capone|gigante|gotti|carlo gambino|gambino (?:crime )?family|genovese|murder,? inc\b|karpis|aiuppa|accardo)\b/i;
const PROHIBITION_CRIME_RE = /\bbureau of prohibition\b|\bprohibition(?:[- ]era| agents?| raids?| photographs?)\b|^prohibition\b/i;
/** the Prohibition PARTY (a jugate, a campaign ribbon, "Prohibition for President") is politics */
const PROHIBITION_POLITICAL_RE = /\bprohibition (?:party|for|ticket|convention|candidate)\b|\bjugate\b|\bcampaign\b|\bbuttons?\b|\bribbons?\b|\bstickpin\b|\blapel\b|\bw\.?\s?c\.?\s?t\.?\s?u\b/i;
export function isCrimeTitle(title: string | null | undefined): boolean {
  const t = String(title || '');
  return CRIME_EXTRA_RE.test(t) || (PROHIBITION_CRIME_RE.test(t) && !PROHIBITION_POLITICAL_RE.test(t));
}
/** the Mercury capsules by name ("Aurora 7 Flown Heat Shield") — Pattern 14 */
export const MERCURY_CAPSULE_RE = /\b(?:friendship|freedom|liberty bell|sigma|faith|aurora) 7\b/i;
/** WotC-era Pokémon sets a yearless title names ("Pokemon Japanese Jungle #25
 *  Pikachu") — Pattern 15 */
export const POKE_VINTAGE_SET_RE = /\b(?:base set|jungle|fossil|team rocket(?! returns)|gym (?:heroes|challenge)|neo (?:genesis|discovery|revelation|destiny)|legendary collection|southern islands|shadowless|vending|wizards of the coast|wotc|the first movie|e-?card|expedition|aquapolis|skyridge)\b/i;

/** a music / film object a science slug carries (Goldin's AC/DC single and
 *  Poison cassette as instruments, a Nirvana / Dinosaur Jr. flyer as a fossil,
 *  a Star Trek shooting model) — Pattern 13 */
export const SCIENCE_MUSIC_RE = /\bvinyl (?:records?|lps?|albums?|singles?|only|pressings?|copy)\b|\b(?:sealed|signed|original) vinyl\b|\bcassettes?\b|\b8-track\b|\brecords\b(?=\s*(?:-|$))|\bdinosaur jr\b|\bflyers?\b(?=\s*[-–—,]?\s*(?:featuring|for (?:the|a)\b|advertising))/i;
export const SCIENCE_FILM_RE = /\bstar trek\b|\bstar wars\b|\bshooting (?:scale )?models?\b|\bscreen[- ](?:used|worn)\b|\bproduction[- ](?:made|used)\b|\bursa authentic\b/i;
/** the culture slug a science-slug lot's title names, or null */
export function scienceCultureSlugOf(title: string | null | undefined): 'music-memorabilia' | 'movie-tv' | null {
  const t = maskFlyers(String(title || ''));
  // (a Star Wars NES prototype cartridge is tech)
  if (SCIENCE_FILM_RE.test(t) && !/\b(?:nintendo|cartridge|video ?game|wata|sega|atari)\b/i.test(t)) return 'movie-tv';
  // an Edison "Concert" phonograph and its records are the instrument
  if (SCIENCE_MUSIC_RE.test(t) && !/\b(?:phonograph|gramophone|graphophone|victrola|telescope|microscope|globe|sextant|calculator)\b/i.test(t)) return 'music-memorabilia';
  return null;
}

/** sports memorabilia: a pass / ticket and a magazine cover / programme filed
 *  in the Equipment junk drawer (Pattern 7), a SIGNED jersey / bat filed as a
 *  trophy by its house slug (Pattern 8) */
const MEM_PASS_RE = /\b(?:pass(?:es)?|tickets?|stubs?|credentials?)\b/i;
// a COVER only as a publication's ("AERA Shohei Ohtani Cover (Japan)", "…
// Cover - PSA 8", "on the Front Cover", "Cover Issues") — never a jar's, a
// club head's or a first-day cover
const MEM_PUBLICATION_RE = /\bcovers?\b(?=\s*(?:\(|[-–—]\s*(?:psa|sgc|bgs|cgc|pop)\b))|\bcovers? (?:photos?|story|stories|issues?|art)\b|\b(?:magazine|front|back) covers?\b|\bon (?:the )?(?:front )?cover\b|\bnotebook covers?\b|\bmagazines?\b|\bprogram(?:me)?s?\b|\byearbooks?\b|\bscorecards?\b|\bmedia guides?\b|\b1st appearance\b|\bnewspapers?\b/i;
const SIGNED_OBJECT_RE = /\bsigned\b[^-–—]{0,60}?\b(?:jerseys?|bats?|baseballs?|footballs?|basketballs?|balls?|helmets?|photos?|photographs?|programs?|cards?|gloves?|pucks?|sticks?)\b/i;
/** a sports memorabilia sub refined by its title: 'equipment' → tickets /
 *  programs, 'trophies' → autographs; any other sub as given */
export function sportsMemSubOf(title: string | null | undefined, sub: string): string {
  const t = String(title || '');
  if (!t) return sub;
  if (sub === 'equipment') {
    if (MEM_PASS_RE.test(t)) return 'tickets';
    if (MEM_PUBLICATION_RE.test(t)) return 'programs';
  }
  if (sub === 'trophies' && SIGNED_OBJECT_RE.test(t)) return 'autographs';
  return sub;
}
/** a trading card (or a lot of them) filed as sports memorabilia (Pattern 6:
 *  "1888 E223 … SGC 4", "T206 … PSA GOOD 2", an Exhibits collection) */
const MEM_NOT_CARD_RE = /\b(?:pass(?:es)?|tickets?|covers?|magazines?|pins?|pinbacks?|pennants?|postcards?|display|box(?:es)?|wrappers?|wax|paintings?|programs?|mailers?|notebooks?|bats?|balls?|sneakers|cleats|portfolio|playing cards|cabinets?|felts?|decals?|bottle caps|handwriting|cut|photo(?:graph)?s?|jerseys?|signed|autographed|packages?|tins?|cans?|pouch(?:es)?|jars?|signs?|posters?|advertis\w*|banners?|negatives?|plates?|proofs?|albums?|scrapbooks?|blankets?|rugs?|coins?|medals?|buttons?|stamps?|figurines?|statues?|dolls?|toys?|games?|rings?|leathers?|collectibles|pack)\b/i;
const PREWAR_CODE_RE = /\b[TEDMNRW]-?\d{1,3}(?:-\d)?\b/;
const CARD_ISSUE_RE = /\b(?:bazooka|exhibits?|goudey|old judge|hunter wieners|wheaties|sport thrills|kellogg'?s|post cereal|candy|chewing gum|gum|caramel|tobacco|cigarettes?|topps|bowman|fleer|leaf|swell|play ball|cracker jack|diamond stars)\b/i;
export function memIsCard(title: string | null | undefined): 'singles' | 'lots' | null {
  // a "Shoe Box" collection is cards (no lookbehind: browser module)
  const t = String(title || '').replace(/\bshoe ?box(es)?\b/gi, 'shoebox$1');
  if (!t || MEM_NOT_CARD_RE.test(t)) return null;
  if (!(PREWAR_CODE_RE.test(t) || CARD_ISSUE_RE.test(t) || looksLikeCard(t))) return null;
  const lot = isCardLotTitle(t);
  const c = parseCard(t);
  if (lot) return 'lots';
  return c.gradeCo || c.gradeTag ? 'singles' : null;
}

export interface Taxon { cat: CatKey; sub: string; sport?: string; domain?: string }

type LotLike = { artist?: string | null; subCat?: string | null; drill?: string | null; title?: string | null };

function sportOf(drill: string | null | undefined): string | undefined {
  if (!drill) return undefined;
  if (SPORT_KEYS.has(drill)) return drill;
  if (MINOR_SPORTS.has(drill)) return 'other-sports';
  return undefined;
}

/** an entertainment taxon for a culture / sports / science lot whose title
 *  says film or music */
function entertainmentOf(title: string, sub: string, domain: string | undefined): Taxon {
  const o = cultureObjectOf(title);
  const t: Taxon = { cat: 'entertainment', sub: o ? CULTURE_OBJECT_SUB[o] : sub };
  if (domain) t.domain = domain;
  return t;
}

// taxonOf runs per lot inside every feed / chip / facet pass; the title rules
// cost a few regexes, so the answer is memoised per lot object (re-derived
// when any field it reads changes)
const CACHE = new WeakMap<object, { a: unknown; s: unknown; d: unknown; t: unknown; v: Taxon }>();

/** The clean { cat, sub, sport? } for one lot. Total: every lot gets a cat.
 *  With a `title` it also applies the shared title rules above (view time). */
export function taxonOf(l: LotLike): Taxon {
  const hit = CACHE.get(l);
  if (hit && hit.a === l.artist && hit.s === l.subCat && hit.d === l.drill && hit.t === l.title) return { ...hit.v };
  const v = taxonOfRaw(l);
  CACHE.set(l, { a: l.artist, s: l.subCat, d: l.drill, t: l.title, v });
  return { ...v };
}

function taxonOfRaw(l: LotLike): Taxon {
  const a = String(l.artist || '');
  const s = l.subCat || '';
  const d = l.drill || '';
  const title = String(l.title || '');

  // non-Pokémon TCG (Yu-Gi-Oh!, One Piece, Magic…) keeps its slug for comps
  // isolation but belongs to the TCG category
  if (s === 'tcg-other') return { cat: 'tcg', sub: 'other-tcg' };
  if (a === 'sports-cards' || a === 'graded-cards') {
    // (Oct 9, Pattern 9) the title decides single vs lot when we have it — the
    // stamped 'card-lots' predates the Trio / Pair / one-slab fixes
    const lot = title ? isCardLotTitle(title) : s === 'card-lots';
    return { cat: 'sports-cards', sub: lot ? 'lots' : 'singles', sport: sportOf(d) };
  }
  if (a === 'unopened-wax') return { cat: 'sports-cards', sub: 'sealed-wax', sport: sportOf(d) };
  if (a in SPORTS_MEM) {
    // (Oct 9, Pattern 12) a film production piece (Rocky Balboa trunks, a Die
    // Hart ensemble, a Muhammad Ali cartoon cel) is entertainment
    if (title && isFilmProductionTitle(title)) {
      return entertainmentOf(title, PHOTO_NOUN_RE.test(title) ? 'photos-posters' : 'props-costumes', 'film-tv');
    }
    const sub = SPORTS_MEM_SUBCAT[s] || SPORTS_MEM[a];
    // (Oct 9, Pattern 6) a card in the junk drawer is a card
    if (sub === 'equipment' && title) {
      const card = memIsCard(title);
      if (card) return { cat: 'sports-cards', sub: card, sport: sportOf(d) };
    }
    return { cat: 'sports-memorabilia', sub: sportsMemSubOf(title, sub), sport: sportOf(d) };
  }
  if (a === 'pokemon') {
    if (POKEMON_SUB[s]) return { cat: 'tcg', sub: POKEMON_SUB[s] };
    if (d === 'vintage' || d === 'classic' || d === 'modern') return { cat: 'tcg', sub: d };
    // (Oct 9, Pattern 15) no year: a WotC set name is vintage
    return { cat: 'tcg', sub: POKE_VINTAGE_SET_RE.test(title) ? 'vintage' : 'modern' };
  }
  if (a === 'space-exploration') {
    return { cat: 'space-science', sub: SPACE_DRILL[d] || (MERCURY_CAPSULE_RE.test(title) ? 'mercury-gemini' : 'space-other') };
  }
  if (a === 'science-tech' || a === 'meteorites' || a === 'fossils' || a === 'scientific-instruments') {
    // (Oct 9, Pattern 13) a record, a cassette, a gig flyer, a Star Trek model
    const c = scienceCultureSlugOf(title);
    if (c) return c === 'movie-tv' ? entertainmentOf(title, 'props-costumes', 'film-tv') : entertainmentOf(title, 'instruments-records', 'music');
    return { cat: 'space-science', sub: 'science' };
  }
  if (CULTURE.has(a)) {
    const entSub = (): string => {
      const base = ENT_SUB[s] || 'other';
      const o = title ? cultureObjectOf(title) : null;
      if (!o) return base;
      if (o === 'cel-art' && WORN_RE.test(title)) return 'props-costumes';
      return ENT_REFILE[o].has(base) || (o === 'ticket' && s === 'awards') ? CULTURE_OBJECT_SUB[o] : base;
    };
    const artistDomain = a === 'movie-tv' ? 'film-tv' : a === 'music-memorabilia' ? 'music' : undefined;
    if (d in HIST_DRILL) {
      // (Oct 9, Patterns 2 / 12) Led Zeppelin, an Army-themed guitar, a film costume
      // (a statesman's signed guitar stays political)
      if (title && (d === 'aviation' || d === 'military' || d === 'historic' || d === 'royalty') && HIST_MUSIC_RE.test(title)) return entertainmentOf(title, entSub(), 'music');
      if (title && isShowbizTitle(title)) return entertainmentOf(title, entSub(), 'film-tv');
      // (Oct 9, Pattern 10) the Massacre / Prohibition read 'historic' off "newspaper"
      if (d === 'historic' && isCrimeTitle(title)) return { cat: 'historical', sub: 'crime' };
      return { cat: 'historical', sub: HIST_DRILL[d] };
    }
    if (d in SPACE_DRILL) return { cat: 'space-science', sub: SPACE_DRILL[d] };
    if (d === 'space-science') return { cat: 'space-science', sub: MERCURY_CAPSULE_RE.test(title) ? 'mercury-gemini' : 'space-other' };
    if (d === 'science') return { cat: 'space-science', sub: 'science' };
    // culture-house lots about athletes belong with the sports memorabilia
    if (d === 'sports') return { cat: 'sports-memorabilia', sub: SPORTS_MEM_SUBCAT[s] || 'equipment' };
    // (Oct 9, Pattern 11) the Capone family / the mob filed as entertainment
    if (title && isCrimeTitle(title) && !isShowbizTitle(title)) return { cat: 'historical', sub: 'crime' };
    const domain = ENT_DOMAIN[d] || artistDomain;
    const t: Taxon = { cat: 'entertainment', sub: entSub() };
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

/** ONE display vocabulary for a lot's sub-category — the label its filter chip,
 *  its feed row and its lot page all print ("Singles", "Photos & Posters",
 *  "Vintage (1996–2003)"). Pass the lot itself (artist / subCat / drill /
 *  title); the label is taxonOf's sub read through SUBS. */
export function subLabelOf(l: LotLike): string {
  const t = taxonOf(l);
  return subLabel(t.cat, t.sub);
}
/** the lot's category label ("Sports Cards", "Entertainment & Music") */
export function catLabelOf(l: LotLike): string {
  return CAT_LABEL[taxonOf(l).cat];
}

// ── the sub-category chip strip (Oct 9, chips audit) ────────────────────────
// ONE builder for every strip that offers sub-categories — the home feed's
// refine row + phone sheet (FeedToolbar), /value and /makers (TriageBar), a
// maker page's lot browser — so the same pool always reads the same chips.

/** each market's own clean categories: a stray lot filed in another category
 *  (a film costume a sports house sells) stays on the board and in the
 *  counts, it just gets no chip ("Props & Wardrobe 8" in Sports) */
export const MARKET_CATS: Record<string, CatKey[]> = {
  art: ['fine-art'], design: ['design'], watches: ['watches'],
  sports: ['sports-cards', 'sports-memorabilia'], tcg: ['tcg'], science: ['space-science'],
  culture: ['entertainment', 'historical'],
};
/** a category that shares a market's strip as a GUEST rides as one chip, its
 *  subs one tap deeper (Pop Culture: 7 entertainment subs + "Historical &
 *  Documents" instead of 14 interleaved subs, where "Autographs & Documents"
 *  sat next to "Presidential & Political" and read as the historical papers) */
const GUEST_CATS = new Set<CatKey>(['historical']);
/** the catch-all subs: never the lead chip, always last in their category */
const CATCH_ALL_SUBS = new Set([
  'fine-art:other', 'entertainment:other', 'space-science:space-other', 'design:objects', 'sports-memorabilia:equipment',
]);
/** a chip that keeps ≥95% of its pool cuts nothing worth a tap — hidden
 *  unless picked ("Wristwatches 70" of 72, "Signed 474" inside Autographs) */
export const NEAR_TOTAL = 0.95;
export const cutsSomething = (n: number, base: number) => n > 0 && n < NEAR_TOTAL * base;

export interface SubChip {
  /** "cat:sub", or "cat:" for a guest category's own chip */
  key: string;
  cat: CatKey;
  /** null = a guest category's chip (picks the category, no sub) */
  sub: string | null;
  label: string;
  n: number;
}

/**
 * The sub-category chips for `pool` (n = lots in that sub). `cats` limits the
 * chips to a market's own categories; `pick` is the reader's current cat /
 * sub (a picked chip always shows, at 0 if the other filters emptied it).
 * Order: categories by size, each one's subs by count with the catch-all
 * last; a guest category is one chip, its subs right after it once picked.
 * A chip that keeps ≥95% of the strip's lots is dropped (NEAR_TOTAL).
 */
export function subChipsOf(
  pool: readonly LotLike[],
  pick: { cat: CatKey | null; sub: string | null },
  cats?: readonly CatKey[] | null,
): SubChip[] {
  const by = new Map<CatKey, Map<string, number>>();
  let total = 0;
  for (const l of pool) {
    const t = taxonOf(l);
    if (cats && !cats.includes(t.cat)) continue;
    let m = by.get(t.cat);
    if (!m) by.set(t.cat, (m = new Map()));
    m.set(t.sub, (m.get(t.sub) || 0) + 1);
    total++;
  }
  if (pick.cat && (!cats || cats.includes(pick.cat))) {
    if (!by.has(pick.cat)) by.set(pick.cat, new Map());
    const m = by.get(pick.cat)!;
    if (pick.sub && !m.has(pick.sub)) m.set(pick.sub, 0);
  }
  const sum = (m: Map<string, number>) => { let s = 0; m.forEach(v => { s += v; }); return s; };
  const order = Array.from(by.entries()).map(([cat, m]) => ({ cat, m, n: sum(m) })).sort((a, b) => b.n - a.n);
  const multi = order.length > 1;
  const last = (cat: CatKey, sub: string) => (CATCH_ALL_SUBS.has(`${cat}:${sub}`) ? 1 : 0);
  const subsOf = (cat: CatKey, m: Map<string, number>, base: number, prefix: string): SubChip[] =>
    Array.from(m.entries())
      .filter(([sub, n]) => (pick.cat === cat && pick.sub === sub) || cutsSomething(n, base))
      .sort((a, b) => last(cat, a[0]) - last(cat, b[0]) || b[1] - a[1])
      .map(([sub, n]) => ({ key: `${cat}:${sub}`, cat, sub, label: prefix + subLabel(cat, sub), n }));
  const out: SubChip[] = [];
  order.forEach(({ cat, m, n }, i) => {
    if (multi && i > 0 && GUEST_CATS.has(cat)) {
      out.push({ key: `${cat}:`, cat, sub: null, label: CAT_LABEL[cat], n });
      if (pick.cat === cat) out.push(...subsOf(cat, m, n, ''));
      return;
    }
    // two categories in one strip (sports: cards + memorabilia) → the cards
    // subs say so, so "Sealed Product" never reads as memorabilia
    out.push(...subsOf(cat, m, total, multi && cat === 'sports-cards' ? 'Cards · ' : ''));
  });
  return out;
}
