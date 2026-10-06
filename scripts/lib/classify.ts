/**
 * classify.ts — ONE source for the lot-classification rules that the crawlers
 * apply at ingest AND corpus-normalize re-applies to the whole corpus every
 * nightly (reclassifyCorpus). A rule written here corrects both the rows a
 * house sends tomorrow and the ~1.1M rows already in the segments, so the two
 * paths can never drift apart.
 *
 * Measured against the Oct 6 2026 hand-labelled audit (1,648 lots, scratchpad
 * dd-cat): every rule below was tuned on the DEV half of the labels and scored
 * on the held-out TEST half; the corpus-wide blast radius of each rule was
 * sampled before it was kept.
 *
 * Conventions:
 *  · every detector is a pure function of the lot's own text fields (title,
 *    description, medium, sale name, house) — never of the crawl that found it;
 *  · a reclass rule returns the NEW artist slug, DROP (no valid home — evicted,
 *    the "untracked makers are never kept" doctrine), or null (no change);
 *  · rules are idempotent: a lot a rule moved never re-fires that rule.
 */
import { looksLikeCard } from '../../app/lib/cards';
import { leadsWithSetCode } from './set-codes';
import { ARTIST_MARKET } from '../../app/constants';
import { routeCulture, isCultureSale } from '../culture';
import { routeRRLot } from '../rr-auction';

export const DROP = 'DROP' as const;

/** The fields a classification rule may read. */
export interface ClassifyLot {
  id?: string;
  artist: string;
  title?: string | null;
  description?: string | null;
  medium?: string | null;
  category?: string | null;
  auctionHouse?: string | null;
  saleName?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CARDS — the shared "is this a trading card" detector. looksLikeCard (cards.ts)
// is deliberately conservative (it gates the relic-card reroute); this one is
// the ROUTING detector: it also reads the plain graded-card title shape every
// card house prints ("1990 Leaf #125 Bo Jackson - PSA GEM MT 10", "11 T206
// White Border Joe Tinker - SGC VG-EX 4", "1985 Topps … – PSA EX-MT 6"),
// which looksLikeCard misses because its grade regex wants "PSA <digit>".
// ═══════════════════════════════════════════════════════════════════════════

/** a slab grade: grader + optional descriptor + number. Never PSA/DNA (that
 *  authenticates a raw signed object, not a card). */
export const SLAB_GRADE_RE = /\b(?:psa|bgs|sgc|cgc|bvg|gma|hga|csg)(?!\s*\/\s*dna)\s*(?:gem[- ]?(?:mt|mint)|mint|nm[- ]?mt\+?|nm\+?|ex[- ]?nm\+?|ex[- ]?mt\+?|ex\+?|vg[- ]?ex\+?|vg\+?|good|gd\+?|fair|fr|pr|poor|authentic|altered)?\s*\d/i;
/** title leads with a year (or a lot number + year): the card-title shape */
const YEAR_LEAD_RE = /^\s*(?:\d{1,4}\s+)?(?:['’]?\d{2}|1[89]\d{2}|20\d{2})(?:[-/]\d{2,4})?s?,?\s+\S/;
/** "11 T206 …", "11 E90-1 …" — Goldin's two-digit-year set-code titles */
const SHORT_YEAR_SET_CODE_RE = /^\s*\d{2}\s+(?:T\d{3}|E\d{2,3}|N\d{2,3}|R\d{3}|D\d{3}|M\d{3}|W\d{3})(?:-\d{1,2})?\b/;
const CARD_NO_RE = /#\s?[A-Za-z0-9][A-Za-z0-9/-]*/;
/** card product names (sets + manufacturers) */
const CARD_BRAND_RE = /\b(topps|bowman|panini|upper deck|fleer|donruss|goudey|play ball|o-pee-chee|score|pro set|hoops|skybox|prizm|optic|leaf|mosaic|stadium club|pinnacle|finest|metal universe|sp authentic|exquisite|national treasures|flawless|immaculate|kellogg'?s|bazooka|parkhurst|sportflics|playoff|contenders|spectra|obsidian|crown royale|zenith|flair|e-x2000|press pass|tobacco card)\b/i;
/** the physical OBJECT nouns that make a branded/graded title memorabilia, not a card */
const CARD_OBJECT_RE = /\b(jerseys?|uniform|bats?|gloves?|cleats|boots|helmet|trunks|shorts|jacket|shoes?|sneakers?|shirt|robe|photo|photograph|(?:signed|official|game|onl|oml|oal|obal|nfl|nba|wilson|spalding|rawlings) (?:base|basket|foot|soccer |golf )?ball|puck|pennant|banner|trophy|ring|belt|ticket|stub|pass|poster|painting|lithograph|display|plaque|bobblehead|statue|program|magazine|letter|check|contract|cut|envelope|cover|bobb(?:ing|in'?|le)[- ]?heads?|statues?|figurines?|miniatures?|pins?|pinbacks?|buttons?|coins?)\b/i;
const CARD_WORD_RE = /(?<!(?:playing|index|business|schedule|cabinet|greeting|christmas|post|place|calling|report|score|signature|membership|id|identification|scorer'?s|admission|pass|program|trade|cigarette pack|souvenir|menu|lobby|title|window|wedding|signed|autographed|3x5|3 x 5|birthday|holiday|ration|draft|war|sympathy|note|recipe) )\bcards?\b(?![- ]used)|\bhand[- ]cut\b/i;
const FLAT_OBJECT_RE = /\b(?:photos?|photographs?|lithographs?|prints?|posters?|paintings?|canvas|display|framed|plaque|letter|check|contract|magazine)\b/i;
/** a photo USED for a card ("Image Used for 1933 Goudey Cards!") is a photo */
const PHOTO_FOR_CARD_RE = /\b(?:photo|photograph|image|negative|artwork)\b[^.]{0,60}\bused (?:for|on|as)\b/i;
/** card-ish words that only count when no object noun is named ("SGC Encapsulated" also slabs cut signatures) */
const CARD_WEAK_WORD_RE = /\b(?:psa|sgc|bgs|beckett)[- ]?(?:graded|encapsulated)\b|\bstickers?\b/i;
const CARD_SET_RE = /\b(?:complete|partial|near[- ]complete|master|team)(?: (?:&|and) partial)? (?:base )?sets?\b|\bset \(\d+/i;
/** paper publications (graded magazines read like slabs: "… Cover (Newsstand) - CGC 9.4") */
export const PUBLICATION_RE = /\b(sports illustrated|magazines?|newsstand|yearbooks?|media guides?|press guides?|programs?|programmes?|scorecards?|score cards?|newspapers?|publications?|annuals?|guides?)\b/i;
/** comics and mass toys — never a home anywhere (culture doctrine: no mass items) */
export const COMIC_RE = /\b(comic books?|(?<!bazooka )comics?|marvel comics|dc comics|amazing spider-man|action comics|detective comics|graphic novel)\b|\((?:19|20)\d\d (?:marvel|dc)\)|\bvol\.?\s*\d+\s*#\d+\b/i;
/** mass-produced toys — no home unless an athlete SIGNED it (then an autograph) */
export const MASS_TOY_RE = /\b(funko|action figures?|carded figure|beanie bab(?:y|ies)|kenner|hasbro|mattel|afa (?:[a-z+-]+ )?\d{2}|roleplay toy)\b/i;

/** Is this lot a trading CARD? (routing detector — see header) */
export function isCardTitle(title: string | null | undefined): boolean {
  const t = String(title || '');
  if (!t.trim()) return false;
  if (leadsWithSetCode(t) || SHORT_YEAR_SET_CODE_RE.test(t)) return true;
  if (PHOTO_FOR_CARD_RE.test(t)) return false;
  // a photo/print/display named without a card word or number is that object
  // (looksLikeCard reads "Signed 16 x 20 Photograph (Upper Deck)" as a card)
  if (FLAT_OBJECT_RE.test(t) && !CARD_WORD_RE.test(t) && !CARD_NO_RE.test(t)) return false;
  if (looksLikeCard(t)) return true;
  if (CARD_WORD_RE.test(t)) return true;
  const obj = CARD_OBJECT_RE.test(t);
  if (CARD_WEAK_WORD_RE.test(t) && !obj) return true;
  if (CARD_SET_RE.test(t) && !obj) return true;
  if (PUBLICATION_RE.test(t)) return false;
  const lead = YEAR_LEAD_RE.test(t);
  const grade = SLAB_GRADE_RE.test(t);
  if (lead && grade && !obj) return true;
  if (CARD_BRAND_RE.test(t) && lead && !obj) return true;
  const no = CARD_NO_RE.test(t);
  if (no && grade) return true;
  if (no && lead && !obj) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPORTS OBJECTS — the kind of a non-card sports lot. One ladder for every
// house (Goldin's Sport facet, the Christie's/Sotheby's sports-sale catch-all,
// the REA/H&S/Lelands/SCP/ML/LOTG expansion houses): the object's own words
// decide, most specific first.
// ═══════════════════════════════════════════════════════════════════════════
export const SEALED_RE = /\b(unopened|factory[- ]sealed|sealed (?:box|case|pack)(?:e?s)?|wax (?:pack|box|case)(?:e?s)?|hobby (?:box|case)(?:e?s)?|blaster(?: box(?:es)?)?|cello (?:pack|box)(?:e?s)?|rack (?:pack|box)(?:e?s)?|jumbo (?:pack|box)(?:e?s)?|vending (?:box|case)(?:e?s)?|fat packs?|booster (?:box|pack)(?:e?s)?)\b/i;
/** EXPLICIT use language — a jersey is not game-used because it is a jersey */
export const GAME_USED_RE = /\b(game[- ]?(?:used|worn|issued)|match[- ]?(?:used|worn|issued)|player[- ]?worn|team[- ]?issued|fight[- ]?worn|tour(?:nament)?[- ]?(?:used|worn)|race[- ]?(?:used|worn)|warm[- ]?up[- ]?worn|practice[- ]?(?:worn|used)|bench[- ]?worn|event[- ]?worn|psa\/dna gu \d+|photo[- ]?match(?:ed)?|gamer|mears|meigray|worn by|used by)\b/i;
const TROPHY_RE = /\b(trophy|trophies|awards?|awarded|championship rings?|world series rings?|super bowl rings?|title belt|winners?'? medal|olympic (?:gold |silver |bronze )?medal|mvp award|heisman|plaque award|presentational ring|(?:final four|championship|title|world series|super bowl|pennant|all-star|league) rings?|presented to)\b/i;
const TICKET_RE = /\b(tickets?|stubs?|full ticket|season pass|press pass(?! (?:cards?|#))|credentials?|all[- ]access pass)\b/i;
const TYPE1_RE = /\b(type (?:1|i|one)\b|type-1|original (?:news service |wire |press )?photo(?:graph)?|wire photo|press photo|news service photo)\b/i;
export const SIGNED_RE = /\b(signed|autograph(?:ed|s)?|inscribed|signatures?|cut signature|auto\.)\b/i;

/** Kind of a NON-card sports object. `catchAll` is the house's memorabilia
 *  twin ('sports-memorabilia' at Goldin/Christie's/Sotheby's, 'memorabilia' at
 *  the expansion houses). */
export function sportsObjectKind(title: string | null | undefined, catchAll: 'sports-memorabilia' | 'memorabilia' = 'sports-memorabilia'): string {
  const t = String(title || '');
  if (SEALED_RE.test(t)) return 'unopened-wax';
  if (GAME_USED_RE.test(t)) return 'game-used';
  if (TYPE1_RE.test(t) && !SIGNED_RE.test(t)) return 'type-1-photos';
  if (TROPHY_RE.test(t)) return 'trophies-awards';
  if (TICKET_RE.test(t) && !PUBLICATION_RE.test(t)) return 'tickets-passes';
  if (PUBLICATION_RE.test(t) && !SIGNED_RE.test(t)) return 'programs-publications';
  if (TYPE1_RE.test(t) && !SIGNED_RE.test(t)) return 'type-1-photos';
  if (SIGNED_RE.test(t)) return 'autographs';
  if (PUBLICATION_RE.test(t)) return 'programs-publications';
  return catchAll;
}

// ── 1 · GOLDIN SPORT FACET — "a Sport lot with no object signal is a card" was
// wrong for 69k rows (jerseys, balls, photos, sealed boxes, magazines, comics):
// the card detector decides card; everything else gets its object kind.
// Non-sport TCG (Yu-Gi-Oh / One Piece / Union Arena …) and comics have no home.
export const NON_SPORT_TCG_RE = /\b(yu-?gi-?oh!?|one piece|union arena|dragon ball|digimon|magic:? the gathering|\bmtg\b|weiss schwarz|lorcana|flesh and blood|jujutsu kaisen|naruto|my hero academia|demon slayer|star wars unlimited)\b/i;

export function goldinSportKind(title: string | null | undefined): string {
  const t = String(title || '');
  if (NON_SPORT_TCG_RE.test(t) || COMIC_RE.test(t)) return DROP;
  if (MASS_TOY_RE.test(t) && !SIGNED_RE.test(t)) return DROP;
  if (SEALED_RE.test(t)) return 'unopened-wax';
  if (isCardTitle(t)) return 'sports-cards';
  return sportsObjectKind(t, 'sports-memorabilia');
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · SPORTS-HOUSE POP-MEMORABILIA — REA / H&S / Lelands / LOTG / SCP / ML
// filed anything with poster|figure|record|memorabilia in it as
// 'pop-memorabilia' (a CULTURE slug): 79% were sports (fight posters, team
// postcards, card sets, publications). At these houses a lot is sports unless
// it reads non-sport; Hake's (a pop house) toys and comics have no home.
// ═══════════════════════════════════════════════════════════════════════════
export const SPORTS_EXPANSION_HOUSES = new Set(['REA', 'Huggins & Scott', 'Lelands', 'Love of the Game', 'SCP', 'Memory Lane']);
export const NON_SPORT_RE = /\b(beatles|rolling stones|elvis|presley|beach boys|springsteen|concert|rock (?:and|&|n|'n'?) roll|albums?|vinyl|records?\b(?! book)|movie|film|hollywood|disney|mickey mouse|star wars|star trek|superman|batman|marvel|comics?|cartoons?|hanna[- ]barbera|television|tv show|howdy doody|monkees|kiss|guitar|jazz|sinatra|marilyn monroe|president(?:ial)?|political|campaign|lincoln|kennedy|eisenhower|nixon|roosevelt|truman|civil war|world war|wwii|apollo|nasa|astronaut|circus|wizard of oz|g\.?i\.? joe|barbie|non[- ]sport|three stooges|lone ranger|hopalong|roy rogers|gene autry|chaplin|laurel (?:and|&) hardy)\b/i;
export const SPORT_WORD_RE = /\b(baseball|football|basketball|hockey|boxing|boxer|golf|tennis|olympics?|soccer|wrestling|racing|nascar|world series|super bowl|stanley cup|all[- ]star|hall of fame|hof|mlb|nfl|nba|nhl|pcl|nflpa|mlbpa|aba|afl|yankees|dodgers|giants|cubs|red sox|white sox|cardinals|tigers|pirates|athletics|senators|browns|braves|reds|phillies|orioles|indians|colts|packers|bears|celtics|lakers|bulls|knicks|canadiens|maple leafs|bruins|red wings|fight|bout|heavyweight|ali|babe ruth|gehrig|mantle|cobb|wagner|dimaggio|mays|aaron|koufax|robinson|clemente|thorpe|joe louis|dempsey|jordan|gretzky|pel[eé]|bats?|glove|mitt|helmet|jersey|uniform|pennant|scorecard|press pin|stadium|ballpark|team|league|champions?|pitcher|batter|catcher)\b/i;
/** graded/carded mass toys and comic books as the auction houses print them */
const TOY_GRADE_RE = /\b(afa (?:qualified |[a-z+-]+ )?\d{2}|ukg \d{2}|loose action|\d{1,2}[- ]back(?:-[a-z])?|vehicle (?:in|afa)|playset)\b/i;
const COMIC_ISSUE_RE = /#\d+[a-z]? (?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bcgc\b(?! (?:psa|card))|comic book page|comic strip|original art\b(?! ?work)/i;

/** Hake's toys / comics (any slug) → no home. */
export function isMassToyOrComic(title: string | null | undefined): boolean {
  const t = String(title || '');
  return COMIC_RE.test(t) || MASS_TOY_RE.test(t) || TOY_GRADE_RE.test(t) || COMIC_ISSUE_RE.test(t);
}

/** A sports expansion house's 'pop-memorabilia' lot → its real home. */
export function sportsHousePopKind(title: string | null | undefined): string | null {
  const t = String(title || '');
  const sport = SPORT_WORD_RE.test(t);
  if (!sport && isMassToyOrComic(t)) return DROP;
  if (!sport && NON_SPORT_RE.test(t)) return isCardTitle(t) || /non[- ]sport/i.test(t) ? DROP : null; // genuine pop item stays culture
  if (/\b(?:tickets?|stubs?)\b/i.test(t)) return 'tickets-passes';
  if (isCardTitle(t)) return 'graded-cards';
  return sportsObjectKind(t, 'memorabilia');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · SPORTS KIND AT THE EXPANSION HOUSES — classifySports tested autograph
// before card and called any jersey|bat|glove|helmet|worn 'game-used'. A
// signed card is a CARD (it comps as one); a signed retail bat is an
// AUTOGRAPH. Card first; game-used only with explicit use language.
// ═══════════════════════════════════════════════════════════════════════════
const NON_CARD_SPORT_SLUGS = new Set(['autographs', 'memorabilia', 'game-used', 'equipment-artifacts', 'type-1-photos', 'trophies-awards', 'programs-publications', 'tickets-passes']);
/** pro-model bats and graded GU stay game-used — the trade treats them as gamers */
const PRO_MODEL_RE = /\b(?:pro(?:fessional)?[- ]model|\bgu \d)\b/i;

export function expansionSportsKind(l: ClassifyLot): string | null {
  if (!SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '') || !NON_CARD_SPORT_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  if (COMIC_RE.test(t) && !SPORT_WORD_RE.test(t)) return DROP;
  if (!SEALED_RE.test(t) && isCardTitle(t)) return 'graded-cards';
  if (l.artist === 'game-used' && !GAME_USED_RE.test(t) && !(PRO_MODEL_RE.test(t) && !SIGNED_RE.test(t))) {
    return sportsObjectKind(t, 'memorabilia');
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · SCIENCE AT THE GENERALIST HOUSES — Christie's/Sotheby's lots were routed
// on the FULL description (apollo|lunar|rocket|celestial|calculat|anatomical|
// laboratory|prototype|computer|first edition …): a Bernini "Apollo e Dafne",
// a vanitas with a globe, Kepler's Dioptrice and wine lots became science
// (Christie's scientific-instruments 82% wrong). A science slug must now be
// earned by the TITLE: an instrument/space/fossil/meteorite object noun.
// Books and papers by a scientist → science-tech; historic letters →
// entertainment-memorabilia (the historic catch-all); everything else has no
// home and is evicted.
// ═══════════════════════════════════════════════════════════════════════════
export const GENERALIST_HOUSES = new Set(["Christie's", "Sotheby's", 'Bonhams', 'Phillips']);
const METEOR_RE = /meteorite|pallasite|tektite|moldavite|chondrite|gibeon|seymchan|impactite|campo del cielo|sikhote|muonionalusta|achondrite|martian|\bnwa \d|lunar (?:meteorite|rock)|mars rock|octahedrite|ataxite|iron,|\bslice\b|end piece|individual/i;
const FOSSIL_RE = /fossil|dinosaur|trilobite|ammonite|megalodon|mammoth|mastodon|mosasaur|tyrannosaur|triceratops|pterosaur|ichthyosaur|plesiosaur|raptor|saurus|\bskull\b|skeleton|\btooth\b|\bteeth\b|tusk|claw|amber|coprolite|stromatolite|crinoid|petrified|orthoceras|sabre[- ]tooth|saber[- ]tooth|cave bear|archaeopteryx|\beggs?\b|\bjaw\b|vertebra|femur|horn core|crocodile|palm frond/i;
const FOSSIL_NOT_RE = /\b(table|chair|cabinet|commode|console|desk|tazza|urn|lamp|photograph)\b/i;
const SPACE_RE = /\bapollo\s*\d|\bapollo (?:program|mission|lunar|command|capsule|spacecraft|astronaut|era|[ivx]+\b)|nasa|astronaut|cosmonaut|space ?suit|space[- ]flown|\bflown\b|lunar (?:module|surface|rover|sample|orbiter|landing|map)|moon (?:rock|landing|walk|map|globe)|sputnik|vostok|voskhod|soyuz|skylab|space shuttle|(?:project|capsule|program|friendship|faith) (?:mercury|gemini)|(?:mercury|gemini)[- ](?:\d|atlas|redstone|titan|astronaut|spacecraft|capsule|program|mission)|saturn v|space station|space exploration|spacecraft|rocket|launch|mission (?:patch|control|report|log|emblem|plan)|satellite|\biss\b|mir space|lunokhod|\bv-2\b|x-15|space program|space race/i;
const SPACE_TOY_RE = /battery[- ]operated|tin toy|\brobot\b|masudaya|yonezawa|\btoy\b|clockwork|friction/i;
const SCI_BOOK_RE = /\b(4to|8vo|12mo|16mo|folio|2°|4°|8°|vols?\.|volumes?|first edition|edited by|translated|london:|paris:|leipzig:|amsterdam:|berlin:|printed|treatise|monograph|edition|the life and letters|book of hours|illuminated manuscript|on vellum|atlas|journal|proceedings|transactions|offprint|pamphlet|essay|elements of)\b/i;
const SCI_LETTER_RE = /\b(autograph letters? signed|letters? signed|typed letters? signed|autograph (?:note|manuscript|document) signed|document signed|als|tls)\b/i;
const SCI_DOC_RE = /\b(autograph letter|letter signed|signed letter|typed letter|document signed|als|tls|manuscript|notebook|signed photograph|signed photo|autograph|inscribed|signature|letters?)\b/i;
export const SCIENTIST_RE = /einstein|newton|darwin|curie|tesla|edison|galile[oi]|kepler|copernic|pascal|laplace|faraday|\bbohr\b|oppenheimer|feynman|hawking|lovelace|babbage|turing|euclid|novum organum|boyle|hooke|huygens|leibniz|lavoisier|vesalius|harvey, william|halley|herschel|maxwell|planck|heisenberg|schr[oö]dinger|fermi|von neumann|wozniak|steve jobs|bill gates|marconi|alexander graham bell|bell, alexander|wright brothers|orville wright|wilbur wright|wright, orville|pasteur|freud|hubble|carl sagan|crick|benjamin franklin|franklin, benjamin|brah[eé]|ptolemy|lister|jenner|nobel|rabi\b|bernoulli|euler|helmholtz|gauss|samuel (?:f\. ?b\. )?morse|morse, samuel|volta\b|amp[eè]re|kelvin|joule|rutherford|dirac|pauli\b|hertz\b|uranometria|principia/i;
const INSTRUMENT_RE = /sph[eè]res? armillaires?|globe (?:terrestre|c[ée]leste)|longue[- ]vue|lunette|telescope|microscope|astrolab|sextant|octant|orrery|armillary|barometer|thermometer|theodolite|chronometer|slide rule|(?:terrestrial|celestial|library|pocket|table|lunar|relief|manuscript|floor|armillary|mars) globes?|globes? (?:by|maker)|enigma|cipher machine|calculating machine|calculator|computer|macintosh|apple[- ]?(?:1|i\b|ii)|altair|typewriter|scientific instrument|quadrant|planetarium|tellurion|sundial|diptych dial|compendium|nocturnal|circumferentor|graphometer|spectroscope|electrometer|galvanometer|electrical machine|air[- ]pump|magic lantern|phonograph|telegraph|transistor|integrated circuit|microprocessor|patent model|difference engine|punch card|mainframe|kenbak|trs-80|abacus|surveying|dip circle|planimeter|hydrometer|gyroscope|ophthalmoscope|stethoscope|surgical|apothecary|anatomical model|camera\b|\blens\b/i;
const INSTRUMENT_WEAK_RE = /globe|prototype|model of|clock|regulator|engine|radio|television|telephone|balance|compass|level|instrument|medical|dental|anatomical/i;
const SCI_SALE_RE = /scien|instrument|travel|natural history|technolog|camera|photographic|mechanical|cyber|computing|horolog|medicine|engineering|space/i;
/** "NAME (1738-1821) …", "HUANG YONGYU (b. 1924)" — an artwork or a book by a person */
const LIFEDATE_LEAD_RE = /^\s*[[A-Z][^()]{1,70}\((?:b\.|born|n[ée]e? en|fl\.|active|ca?\.?|circa|d\.)?\s?\d{3,4}/;
const SCIENCE_SLUGS_ALL = new Set(['meteorites', 'fossils', 'space-exploration', 'scientific-instruments']);

/** Re-validate a science slug from the lot's own title (+ sale name prior). */
export function scienceVerdict(l: ClassifyLot): string | null {
  const a = l.artist;
  if (!SCIENCE_SLUGS_ALL.has(a)) return null;
  const t = String(l.title || '');
  const sale = String(l.saleName || '');
  if (a === 'meteorites') return METEOR_RE.test(t) || METEOR_RE.test(String(l.medium || '')) ? null : DROP;
  if (a === 'space-exploration' && !SPACE_TOY_RE.test(t) && (SPACE_RE.test(t) || /space/i.test(sale))) return null;
  if (SCI_LETTER_RE.test(t)) return SCIENTIST_RE.test(t) ? 'science-tech' : 'entertainment-memorabilia';
  if (SCI_BOOK_RE.test(t)) return SCIENTIST_RE.test(t) ? 'science-tech' : DROP;
  if (a === 'scientific-instruments' && INSTRUMENT_RE.test(t) && !LIFEDATE_LEAD_RE.test(t)) return null;
  if (a === 'fossils' && FOSSIL_RE.test(t) && !FOSSIL_NOT_RE.test(t) && !LIFEDATE_LEAD_RE.test(t)) return null;
  if (SCI_DOC_RE.test(t)) return SCIENTIST_RE.test(t) ? 'science-tech' : 'entertainment-memorabilia';
  if (LIFEDATE_LEAD_RE.test(t)) return SCIENTIST_RE.test(t) ? 'science-tech' : DROP;
  if (a === 'scientific-instruments') {
    if (INSTRUMENT_WEAK_RE.test(t) && SCI_SALE_RE.test(sale)) return null;
    if (SPACE_RE.test(t) && !SPACE_TOY_RE.test(t)) return 'space-exploration';
    return DROP;
  }
  if (a === 'space-exploration') {
    if ((INSTRUMENT_RE.test(t) || (INSTRUMENT_WEAK_RE.test(t) && SCI_SALE_RE.test(sale))) && !SPACE_TOY_RE.test(t)) return 'scientific-instruments';
    return DROP;
  }
  return DROP; // fossils with no fossil noun
}

// ═══════════════════════════════════════════════════════════════════════════
// 6 · SALE-NAME GATES — (a) the bare 'memorabilia' sports-sale gate swept
// Christie's "Pop Memorabilia", "Television And Film Memorabilia" and
// ocean-liner/transport sales into sports (3.3k lots); (b) RR Auction: a
// "Space & Aviation" catalogue lists astronauts by bare name, so 5.8k space
// lots fell to culture; 'New Jersey' read as a sports jersey; 'Mac' (Fleetwood
// Mac) read as computing. The crawl-side fixes live in sports-sale.ts and
// rr-auction.ts; these rules re-apply them to the back-catalogue.
// ═══════════════════════════════════════════════════════════════════════════
const SPORTS_SLUGS = new Set(Object.entries(ARTIST_MARKET).filter(([, m]) => m === 'sports').map(([k]) => k));
const CULTURE_SLUGS = new Set(['movie-tv', 'music-memorabilia', 'entertainment-memorabilia', 'pop-memorabilia']);
/** sale names that are NOT sports sales but matched the old bare-'memorabilia' gate */
const NON_SPORT_SALE_RE = /pop memorabilia|pop culture|television|\bfilm\b|movie|posters|guitars?|rock (?:and|&|n)|rock roll|entertainment|music|ocean ?liner|transport/i;

export function saleGateFix(l: ClassifyLot): string | null {
  const t = String(l.title || '');
  const sale = String(l.saleName || '');
  if ((l.auctionHouse === "Christie's" || l.auctionHouse === "Sotheby's") && SPORTS_SLUGS.has(l.artist)) {
    if (!NON_SPORT_SALE_RE.test(sale) || SPORT_WORD_RE.test(t)) return null;
    if (/ocean ?liner|transport/i.test(sale)) return DROP; // no tracked home
    return isCultureSale(sale) ? (routeCulture(t) ?? DROP) : DROP;
  }
  if (l.auctionHouse === 'RR Auction') {
    const from = l.artist;
    const spaceCase = CULTURE_SLUGS.has(from);
    const jerseyCase = SPORTS_SLUGS.has(from) && /new jersey/i.test(t);
    const macCase = from === 'science-tech' && /\bmac\b/i.test(t);
    if (!spaceCase && !jerseyCase && !macCase) return null;
    const to = routeRRLot(t, '', sale);
    if (spaceCase) return to === 'space-exploration' ? to : null;
    return to ?? DROP;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · ART CATEGORY — Madoura ceramics and unique works filed as prints. The
// crawler's print test ran before its ceramic test and five artists defaulted
// to 'print' with no evidence; normalize never moved print → sculpture and
// skipped print → original whenever 'silkscreen' appeared (Warhol's canvases
// are "synthetic polymer and silkscreen inks on canvas"). Reads title +
// medium + the first 600 chars of the description (Christie's/Bonhams/
// Phillips print the medium line there).
// ═══════════════════════════════════════════════════════════════════════════
const ART_MAKERS = new Set(Object.entries(ARTIST_MARKET).filter(([, m]) => m === 'art').map(([k]) => k));
const CERAMIC_RE = /madoura|earthenware|fa[iï]ence|ceramic|c[ée]ramique|empreinte originale|rami[ée]\b|terracotta|terre cuite|glazed|engobe|stoneware|porcelain|turned (?:vase|pitcher)/i;
/** Alain Ramié catalogue number — Picasso's CERAMIC catalogue ("(A.R. 408)", "a. r. 156", "ar no. 165") */
const RAMIE_NO_RE = /\ba\.?\s?r\.?\s*(?:no\.?\s*)?\d{1,3}\b/i;
const ART_PRINT_WORD_RE = /poster|affiche|lithograph|linocut|linogravure|etching|aquatint|screen ?print|silkscreen|s[ée]rigraph|woodcut|engraving|drypoint|offset|edition of|numbered|artist.s proof|\bprint(?:ed|s)?\b|gicl[ée]e|monotype|multiple|pochoir|photogravure|\bplates?\b/i;
/** a unique medium on a support: "oil on canvas", "pen and India ink on paper", "acrylic, oilstick and paper collage on canvas" */
const UNIQUE_MEDIUM_RE = /\b(?:oil|acrylic|tempera|gouache|watercolou?r|pastel|charcoal|crayon|graphite|pencil|ballpoint|pen|ink|felt[- ]tip|marker|oil ?stick|spray ?paint|enamel|synthetic polymer|gunpowder|collage|mixed media)s?\b[^.;]{0,60}?\bon\s+(?:canvas|linen|panel|board|paper|card|masonite|wood|metal|aluminum|cardboard)(?![a-z])/i;
/** Warhol's painting medium: silkscreen INK on canvas is a unique painting */
const SILKSCREEN_CANVAS_RE = /silkscreen inks?\b[^.;]{0,30}\bon (?:canvas|linen)/i;
const EDITION_MARK_RE = /edition of|numbered|\b\d{1,3}\s*\/\s*\d{1,4}\b/i;

const artText = (l: ClassifyLot) => `${l.title || ''} | ${l.medium || ''} | ${(l.description || '').slice(0, 600)}`;

/** The corrected art CATEGORY for a tracked art maker's lot, or null when the
 *  current one stands. Ceramic → sculpture; a unique medium → original. */
export function artCategoryFix(l: ClassifyLot): string | null {
  if (!ART_MAKERS.has(l.artist)) return null;
  const cat = l.category || 'unknown';
  if (cat === 'sculpture' || cat === 'photograph') return null;
  const s = artText(l);
  const printWord = ART_PRINT_WORD_RE.test(s);
  const ceramic = CERAMIC_RE.test(s) || (l.artist === 'pablo-picasso' && RAMIE_NO_RE.test(`${l.title || ''} ${l.medium || ''}`));
  if (ceramic && !/poster|affiche|lithograph|linocut|linogravure|etching|aquatint|screen ?print|serigraph|woodcut|engraving|drypoint|offset/i.test(s)) return 'sculpture';
  if (cat === 'original') return null;
  if (UNIQUE_MEDIUM_RE.test(s) && !printWord) return 'original';
  if (SILKSCREEN_CANVAS_RE.test(s) && !EDITION_MARK_RE.test(s)) return 'original';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE RECLASS LADDER — applied to every corpus row by corpus-normalize. Each
// entry is one audited error class; `apply` returns the new artist, DROP, or
// null. Order matters only where noted.
// ═══════════════════════════════════════════════════════════════════════════
export interface ReclassRule {
  cls: string;
  apply: (l: ClassifyLot) => string | null;
}

export const RECLASS_RULES: ReclassRule[] = [
  {
    cls: 'goldin-sport-noncard',
    apply: l => {
      if (l.auctionHouse !== 'Goldin' || l.artist !== 'sports-cards') return null;
      const k = goldinSportKind(l.title);
      return k === 'sports-cards' ? null : k;
    },
  },
  {
    cls: 'sports-house-pop-memorabilia',
    apply: l => {
      if (l.auctionHouse === "Hake's") {
        const t = String(l.title || '');
        if (COMIC_RE.test(t) || COMIC_ISSUE_RE.test(t)) return DROP;
        return (MASS_TOY_RE.test(t) || TOY_GRADE_RE.test(t)) && !SIGNED_RE.test(t) ? DROP : null;
      }
      if (l.artist !== 'pop-memorabilia' || !SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '')) return null;
      return sportsHousePopKind(l.title);
    },
  },
  { cls: 'sports-kind-card-first-gu-language', apply: expansionSportsKind },
  {
    cls: 'science-title-object-noun',
    apply: l => (GENERALIST_HOUSES.has(l.auctionHouse || '') ? scienceVerdict(l) : null),
  },
  { cls: 'sale-name-gates', apply: saleGateFix },
];

/** Category rules: same contract, but they return the corrected CATEGORY. */
export const RECAT_RULES: ReclassRule[] = [
  { cls: 'art-ceramic-unique-vs-print', apply: artCategoryFix },
];

/** Run the ladder over one lot. Returns the classes that fired (in order) and
 *  whether the lot must be evicted; mutates artist (+ makerSlug when set). */
export function reclassifyLot(l: ClassifyLot & { makerSlug?: string | null }): { fired: string[]; drop: boolean } {
  const fired: string[] = [];
  for (const r of RECLASS_RULES) {
    const to = r.apply(l);
    if (to == null || to === l.artist) continue;
    fired.push(r.cls);
    if (to === DROP) return { fired, drop: true };
    l.artist = to;
    if (l.makerSlug) l.makerSlug = to;
  }
  for (const r of RECAT_RULES) {
    const to = r.apply(l);
    if (to == null || to === l.category) continue;
    fired.push(r.cls);
    l.category = to;
  }
  return { fired, drop: false };
}
