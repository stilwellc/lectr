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
import { classifyForm } from '../../app/lib/comps';
import { leadsWithSetCode } from './set-codes';
import { ARTIST_MARKET } from '../../app/constants';
import { routeCulture, isCultureSale, cultureSlugOf } from '../culture';
import { routeRRLot, rrSportsPrior, rrAthleteRoute, rrSpaceTitle } from '../rr-auction';
import { routeSportsLot } from '../sports-sale';
import { athleteIn } from './athlete-roster';

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
  priceUsd?: number | null;
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
export const SLAB_GRADE_RE = /\b(?:psa|bgs|sgc|cgc|bvg|gma|hga|csg|beckett(?: auto)?)(?!\s*\/\s*dna)\s*(?:gem[- ]?(?:mt|mint)|mint|nm[- ]?mt\+?|nm\+?|ex[- ]?nm\+?|ex[- ]?mt\+?|ex\+?|vg[- ]?ex\+?|vg\+?|good|gd\+?|fair|fr|pr|poor|authentic|altered)?\s*\d/i;
/** title leads with a year (or a lot number + year): the card-title shape */
const YEAR_LEAD_RE = /^\s*(?:(?:signed|autographed)\s+)?(?:\d{1,4}\s+)?(?:['’]?\d{2}|1[89]\d{2}|20\d{2})(?:[-/]\d{2,4})?s?,?\s+\S/;
/** "11 T206 …", "11 E90-1 …" — Goldin's two-digit-year set-code titles */
const SHORT_YEAR_SET_CODE_RE = /^\s*\d{2}\s+(?:T\d{3}|E\d{2,3}|N\d{2,3}|R\d{3}|D\d{3}|M\d{3}|W\d{3})(?:-\d{1,2})?\b/;
const CARD_NO_RE = /#\s?[A-Za-z0-9][A-Za-z0-9/-]*/;
/** card product names (sets + manufacturers) */
const CARD_BRAND_RE = /\b(topps|bowman|panini|upper deck|fleer|donruss|goudey|play ball|o-pee-chee|score|pro set|hoops|skybox|prizm|optic|leaf|mosaic|stadium club|pinnacle|finest|metal universe|sp authentic|exquisite|national treasures|flawless|immaculate|kellogg'?s|bazooka|parkhurst|sportflics|playoff|contenders|spectra|obsidian|crown royale|zenith|flair|e-x2000|press pass|tobacco card)\b/i;
/** the physical OBJECT nouns that make a branded/graded title memorabilia, not a card */
const CARD_OBJECT_RE = /\b(jerseys?|uniform|bats?|gloves?|cleats|boots|helmet|trunks|shorts|jacket|shoes?|sneakers?|shirt|robe|photo|photograph|(?:signed|official|game|onl|oml|oal|obal|nfl|nba|wilson|spalding|rawlings) (?:base|basket|foot|soccer |golf )?ball|puck|pennant|banner|trophy|ring|belt|ticket|stub|pass|poster|painting|lithograph|display|plaque|bobblehead|statue|program|magazine|letter|check|contract|cut|envelope|cover|bobb(?:ing|in'?|le)[- ]?heads?|statues?|figurines?|miniatures?|pins?|pinbacks?|buttons?|coins?)\b/i;
const CARD_WORD_RE = /(?<!(?:line-?up|playing|index|business|schedule|cabinet|greeting|christmas|post|place|calling|report|score|signature|membership|id|identification|scorer'?s|admission|pass|program|trade|cigarette pack|souvenir|menu|lobby|title|window|wedding|signed|autographed|3x5|3 x 5|birthday|holiday|ration|draft|war|sympathy|note|recipe) )\bcards?\b(?![- ]used)|\bhand[- ]cut\b/i;
const FLAT_OBJECT_RE = /\b(?:photos?|photographs?|lithographs?|prints?|posters?|paintings?|canvas|display|framed|plaque|letter|check|contract|magazine)\b/i;
/** cards that are not trading cards (looksLikeCard reads "Golf Score Card" via the Score brand) */
const NON_TRADING_CARD_RE = /\b(?:index|business|score|greeting|lobby|3 ?x ?5|signature|membership|cabinet|place|calling|report) ?cards?\b/i;
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

/** (wave 2) graded/numbered objects that are not cards: a PSA-graded full
 *  ticket ("… Full Ticket - Mantle Hits #468 HR PSA 6"), a signed lineup card,
 *  an empty pack wrapper, a blown-up print of a card */
const NOT_A_CARD_OBJECT_RE = /\b(?:full )?tickets?\b|\bticket stubs?\b|\bstubs?\b|\bline-?up cards?\b|\bwrappers?\b|\bblown[- ]up\b/i;

/** Is this lot a trading CARD? (routing detector — see header) */
export function isCardTitle(title: string | null | undefined): boolean {
  const t = String(title || '');
  if (!t.trim()) return false;
  if (leadsWithSetCode(t) || SHORT_YEAR_SET_CODE_RE.test(t)) return true;
  if (PHOTO_FOR_CARD_RE.test(t)) return false;
  if (NOT_A_CARD_OBJECT_RE.test(t) && !/\bsets?\b|rookie tickets?|contenders|\bstubs?\b.*\bcards?\b/i.test(t)
    && !(/\bblown[- ]up\b/i.test(t) ? false : CARD_WORD_RE.test(t.replace(/\bline-?up cards?\b/gi, ' ')))) return false;
  if (NON_TRADING_CARD_RE.test(t) && !CARD_NO_RE.test(t) && !/\btrading cards?\b/i.test(t)) return false;
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
const TROPHY_RE = /\b(trophy|trophies|awards?|awarded|medals?|diplomas?|championship rings?|world series rings?|super bowl rings?|title belt|winners?'? medal|olympic (?:gold |silver |bronze )?medal|mvp award|heisman|plaque award|presentational ring|(?:final four|championship|title|world series|super bowl|pennant|all-star|league) rings?|presented to)\b/i;
const TICKET_RE = /\b(tickets?|stubs?|full ticket|season pass|press pass(?! (?:cards?|#))|credentials?|all[- ]access pass)\b/i;
const TYPE1_RE = /\b(type (?:1|i|one)\b|type-1|original (?:news service |wire |press )?photo(?:graph)?|wire photo|press photo|news service photo)\b/i;
/** an athlete's letter / check / contract is an autograph item */
const AUTOGRAPH_DOC_RE = /\b(letters?|contracts?|endorsements?)\b/i;
export const SIGNED_RE = /\b(signed|autograph(?:ed|s)?|signatures?|cut signature|auto\.)\b/i;

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
  if (SIGNED_RE.test(t) || AUTOGRAPH_DOC_RE.test(t)) return 'autographs';
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
  // (wave 2) a roster athlete is sports too, unless the object reads non-sport
  // (an autograph-album page is an autograph, not a record album)
  const sport = SPORT_WORD_RE.test(t) || (!!athleteIn(t) && !NON_SPORT_RE.test(t.replace(/\b(?:autograph(?:ed)? )?album pages?\b/gi, ' ')));
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

/** (wave 2) class 2 · CARD LOTS AND NON-SPORT CARDS AT THE SPORTS HOUSES —
 *  (a) a lot / collection / hoard of cards ("1948-1967 Football Singles Lot of
 *  (1170)", "(92) 1981-Modern Cal Ripken Jr. Graded & Rookie Collection") was
 *  filed memorabilia: isCardTitle reads one card, not a lot of them;
 *  (b) non-sport cards ("1962 Topps Mars Attacks", "1880s N245 Actors and
 *  Actresses", Garbage Pail Kids, Pokémon, CGC comics) rode graded-cards. A
 *  non-sport CARD (or comic / TCG) has no home; a Pokémon card goes to tcg; a
 *  non-sport 1/1 (original card artwork, a cel, a signature) is the sports
 *  houses' pop-memorabilia. */
const CARD_LOT_RE = /\(\d[\d,]*\+?\)[^.]{0,60}\b(?:singles|stars|rookies|inserts|commons|cards)\b|\b(?:singles|inserts|rookies?|rcs|commons|stars|hall of famers?|hofers?|graded|cards?|parallels?|refractors?|sets?)\b[^.]{0,50}\b(?:lots?|collections?|groups?|grouping|runs?|hoards?|assortments?|accumulations?|treasure chest|balance)\b|\b(?:lots?|collections?|groups?|accumulations?|hoards?)\b[^.]{0,40}\b(?:singles|rookies?|rcs|commons|inserts|cards?)\b/i;
const CARD_LOT_NOT_RE = /\b(?:photos?|photographs?|jerseys?|bats?|balls?|uniforms?|tickets?|stubs?|line-?up cards?|programs?|scorecards?|pins?|buttons?|pennants?|postcards?|wrappers?|display|signed|autographs?|autographed|cuts?|index cards?|magazines?|press|negatives?|letters?|checks?|contracts?|trophies|awards?|rings?|bobble\w*|figures?|statues?|posters?|game[- ]used|game[- ]worn|blankets?|rugs?|silks?|packages?|labels?|coupons?|lids?|coins?|advertising|premiums?|felts?|stamps?|decals?|stickers?|tattoos?|lobby cards?|movie|matchbooks?|menus?)\b/i;
const NON_SPORT_CARD_RE = /\b(?:garbage pail|wacky packages|howdy doody|presidents?|beauties|actors and actresses|actresses|mars attacks|star wars|star trek|disney|mickey mouse|marvel|batman|superman|wizard of oz|elvis|beatles|monkees|non-?sports?|nonsports?|pok[eé]mon|yu-?gi-?oh|magic:? the gathering|green hornet|munsters|rails and sails|krazy|civil war|world war|wwii|james bond|beverly hillbillies|bewitched|i love lucy|between the acts|indian chiefs|indian gum|automobile|flags of|wildlife|dinosaurs?|astronauts?|universal monsters|frankenstein|dracula|film stars|movie stars|comics?)\b/i;
export function sportsHouseCardLotKind(l: ClassifyLot): string | null {
  if (!SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '')) return null;
  const t = String(l.title || '');
  const sport = SPORT_WORD_RE.test(t) || !!athleteIn(t);
  if (l.artist === 'graded-cards' && !sport && NON_SPORT_CARD_RE.test(t)) {
    if (/pok[eé]mon/i.test(t) && !NON_SPORT_TCG_RE.test(t)) return 'pokemon';
    const cardish = /\bcards?\b|\bsets?\b|\bpsa\b|\bsgc\b|\bbgs\b|\bcgc\b|\bgraded\b|\buncut\b|\bstickers?\b|\bwrappers?\b|#\s?\d|\b(?:collection|lot|run|hoard|shoebox|grouping|treasure chest)\b|\(\d[\d,+]*\)|\brecords?\b|\b45 ?rpm\b/i.test(t) || leadsWithSetCode(t) || COMIC_RE.test(t) || NON_SPORT_TCG_RE.test(t);
    return cardish && !/original (?:card )?art(?:work)?|\bcels?\b/i.test(t) ? DROP : 'pop-memorabilia';
  }
  if ((l.artist === 'memorabilia' || l.artist === 'autographs' || l.artist === 'programs-publications') && CARD_LOT_RE.test(t) && !CARD_LOT_NOT_RE.test(t) && !NON_SPORT_CARD_RE.test(t)) return 'graded-cards';
  return null;
}

/** (wave 2) the reverse flip: a card-slug row at an expansion house that is a
 *  graded TICKET, a signed lineup card, a pack wrapper or a blown-up print —
 *  the card-first rule's grade/number test caught them ("Aug. 6, 1965 Detroit
 *  Tigers Full Ticket - Mantle Hits #468 HR PSA 6", "May 28, 1964 New York
 *  Mets Lineup Card Signed by Casey Stengel (PSA)"). */
export function expansionCardObject(l: ClassifyLot): string | null {
  if (!SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '') || l.artist !== 'graded-cards') return null;
  const t = String(l.title || '');
  if (!NOT_A_CARD_OBJECT_RE.test(t) || isCardTitle(t)) return null;
  return /\bwrappers?\b/i.test(t) && !SIGNED_RE.test(t) ? 'memorabilia' : sportsObjectKind(t, 'memorabilia');
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

/** (wave 2) A SIGNED or handwritten document/photo — the historic catch-all
 *  (entertainment-memorabilia) or science-tech for a scientist — even when the
 *  title also reads like a book ("Bound volume of 168 printed bills of lading
 *  … SIGNED ("John Hancock")", "Printed text of his last message as President
 *  signed", "Cabinet photograph signed on verso ('Charles Dickens')"). The
 *  book/lifedate evictions below swept 186 of these out of the corpus. Maker
 *  signatures on objects (a dial "signed Longines", an inro, a Japanese print
 *  "signed Goyo ga", a photographer's "colour print, signed") are not. */
export const SIGNED_DOC_RE = /\b(?:(?:autograph|typed|holograph)\s+(?:letters?|notes?|documents?|manuscripts?|endorsements?|quotations?|journals?|diar(?:y|ies)|memoranda|inventory|cards?)\b|(?:letters?|documents?|typescripts?|manuscripts?|endorsements?|photo(?:graph)?s?|contracts?|checks?|cheques?|commissions?|appointments?|deeds?|land grants?|proclamations?|certificates?|bills? of lading|printed text|portraits?|programmes?|programs?|menus?|cards?|books?|yearbooks?|pages?|notes?|speech|memorand(?:um|a))\b[^.;]{0,60}?\bsigned\b|\bsigned\b[^.;]{0,20}?\b(?:contracts?|letters?|photo(?:graph)?s?|documents?|checks?|programs?|programmes?|menus?|yearbooks?|books?|speech)\b|\bautographed\b)|\bsigned\s*\(\s*["“'‘]/i;
const MAKER_SIGNED_RE = /\b(?:watch|clock|dial|movement|chronometer|netsuke|inro|vase|bowl|gelatin silver|silver print|chromogenic|c-print|colou?r print|platinum print|albumen|woodblock|ukiyo|hitsu|ga and|signed and sealed)\b/i;
export function isSignedDocument(t: string): boolean {
  return SIGNED_DOC_RE.test(t) && !MAKER_SIGNED_RE.test(t) && !/\bunsigned\b/i.test(t.replace(/mostly unsigned|\d+ unsigned/gi, ''));
}
/** a Christie's/Sotheby's popular-culture SALE (Entertainment Memorabilia, Pop
 *  Memorabilia, Rock & Roll …) — its lots are culture lots, whatever slug a
 *  science regex once gave them ("TOM THUMB", "ORSON WELLES. Typescript …") */
const CULTURE_SALE_NAME_RE = /entertainment|pop memorabilia|pop culture|popular culture|rock (?:and|&|n'?)? ?(?:roll|pop)|rock roll|hollywood|film and|music memorabilia/i;

/** Re-validate a science slug from the lot's own title (+ sale name prior). */
export function scienceVerdict(l: ClassifyLot): string | null {
  const a = l.artist;
  if (!SCIENCE_SLUGS_ALL.has(a)) return null;
  const t = String(l.title || '');
  const sale = String(l.saleName || '');
  if (a === 'meteorites') return METEOR_RE.test(t) || METEOR_RE.test(String(l.medium || '')) ? null : DROP;
  if (a === 'space-exploration' && !SPACE_TOY_RE.test(t) && (SPACE_RE.test(t) || /space/i.test(sale))) return null;
  if (isSignedDocument(t)) return SCIENTIST_RE.test(t) ? 'science-tech' : 'entertainment-memorabilia';
  if (CULTURE_SALE_NAME_RE.test(sale) && !(a === 'scientific-instruments' && INSTRUMENT_RE.test(t))) {
    return SCIENTIST_RE.test(t) ? 'science-tech' : (routeCulture(t, String(l.description || '').slice(0, 300)) ?? DROP);
  }
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

// ═══════════════════════════════════════════════════════════════════════════
// (wave 2) 8 · ENTERTAINMENT HOUSES — the Julien's / Propstore parser
// (struts-auction.ts) runs the SPORTS classifier on every lot, so a Big
// Lebowski costume, Sinatra's bracelets or an Emmy became sports memorabilia /
// game-used / trophies (6.6k rows). At these houses a lot is sports only with
// SPORT evidence — a league/sport word, a roster athlete, game/fight-worn
// language, or a sports sale; everything else is a culture lot (or, in the
// house's decorative-arts / luxury-goods sales, has no home).
// ═══════════════════════════════════════════════════════════════════════════
export const ENTERTAINMENT_HOUSES = new Set(["Julien's", 'Propstore']);
/** a non-sport object leaving the sports market: its culture slug, or DROP
 *  when it is a mass item (the culture mass marks, a sealed / graded record,
 *  a re-release or reprint poster, a poster lot) — unless a celebrity SIGNED it */
const MASS_MEDIA_RE = /\b(?:vinyl|test pressing|vmg|amg|re-?release|reprint|reproduction|11\s*x\s*17|posters|tour poster)\b/i;
export function cultureHome(t: string, desc = ''): string {
  const signedPiece = SIGNED_RE.test(t) && !MASS_EVEN_SIGNED_RE.test(t) && !COMIC_RE.test(t) && !NON_SPORT_TCG_RE.test(t);
  if (!signedPiece && (CULTURE_MASS_RE.test(t) || MASS_MEDIA_RE.test(t) || COMIC_RE.test(t) || NON_SPORT_TCG_RE.test(t) || MASS_TOY_RE.test(t))) return DROP;
  return cultureSlugOf(t, desc);
}
/** sport words that cannot be a costume / prop / generic object */
export const SPORT_STRONG_RE = /\bali (?:and|&|vs\.?) |\b(?:and|&|vs\.?) ali\b|\b(frazier|baseball|football|basketball|hockey|boxing|boxer|golf|golfer|tennis|olympics?|soccer|wrestl(?:ing|er)|nascar|formula (?:1|one)|world series|super bowl|stanley cup|world cup|fifa|all[- ]star game|hall of fame|mlb|nfl|nba|nhl|ufc|wwe|wwf|heavyweight|(?:game|match|fight|race)[- ](?:used|worn|issued)|yankees|dodgers|red sox|white sox|cubs|lakers|celtics|bulls|knicks|packers|cowboys|steelers|49ers|canadiens|maple leafs|bruins|boca juniors|real madrid|barcelona|manchester united|aston villa|liverpool|juventus|pel[eé]|maradona|muhammad ali|babe ruth|mantle|gretzky)\b/i;
const SPORTS_SALE_NAME_RE = /\bsports?\b|baseball|basketball|football|boxing|golf|soccer|hockey|olympic|nba|nfl|holyfield|pel[eé]|di st[eé]fano/i;
const NO_HOME_SALE_RE = /fine and decorative arts|street art|gentleman'?s arcade|luxury treasures/i;
export function isSportsEvidence(title: string, saleName = ''): boolean {
  if (SPORT_STRONG_RE.test(title) || athleteIn(title)) return true;
  // a pure sports sale; a mixed one ("Sports Legends and Music Icons") needs the title to say so
  return SPORTS_SALE_NAME_RE.test(saleName) && !/music|hollywood|rock|film|icons? (?:&|and) idols(?!: sports)/i.test(saleName);
}
export function entertainmentHouseFix(l: ClassifyLot): string | null {
  if (!ENTERTAINMENT_HOUSES.has(l.auctionHouse || '') || !SPORTS_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  if (isSportsEvidence(t, String(l.saleName || ''))) return null;
  if (NO_HOME_SALE_RE.test(String(l.saleName || ''))) return DROP;
  return cultureHome(t, String(l.description || '').slice(0, 300).replace(/class="[^"]*"|lot closed[^]*$/i, ''));
}

// ═══════════════════════════════════════════════════════════════════════════
// (wave 2) 11 · GOLDIN'S ITEM-TYPE FACET — the crawl trusted Goldin's
// 'Game-Used Memorabilia' / 'Tickets and Passes' / 'Awards and Trophies' item
// types (goldin.ts GOLDIN_FACET_PASSES fallback) without its Sport category,
// so a sealed Beatles LP, a Star Wars costume piece, a Baywatch production
// garment or an Eminem tour poster became game-used. A sports-object row
// that reads music / film / TV and carries no sport evidence goes to the
// culture router (or, mass, nowhere).
// ═══════════════════════════════════════════════════════════════════════════
export const GOLDIN_NON_SPORT_RE = /\b(?:vinyl|test pressing|cassette|laserdisc|8-track|production[- ](?:made|used)|screen[- ](?:used|worn|matched)|ursa authentic|movie poster|film poster|concert poster|tour poster|star wars|star trek|marvel|disney|beatles|elvis presley|rolling stones|nirvana|hollywood|actor|actress|filming|baywatch|(?:from|in) (?:the )?(?:film|movie|tv series|series))\b/i;
const NON_CARD_SPORTS_SLUGS = new Set(['game-used', 'sports-memorabilia', 'tickets-passes', 'trophies-awards', 'type-1-photos', 'autographs', 'programs-publications', 'equipment-artifacts']);
export function goldinNonSportFix(l: ClassifyLot): string | null {
  if (l.auctionHouse !== 'Goldin' || !NON_CARD_SPORTS_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  if (!GOLDIN_NON_SPORT_RE.test(t) || isSportsEvidence(t)) return null;
  return cultureHome(t);
}

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
    // (wave 2) the space-sale default caught aviators listed by bare name
    const aviationCase = from === 'space-exploration' && !rrSpaceTitle(t);
    if (!spaceCase && !jerseyCase && !macCase && !aviationCase) return null;
    const to = routeRRLot(t, '', sale);
    if (spaceCase) return to === 'space-exploration' ? to : null;
    if (aviationCase) return to === 'space-exploration' ? null : to ?? DROP;
    return to ?? DROP;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7 · THE SPORTS-SALE CATCH-ALL — Christie's/Sotheby's/RR sports lots that
// routeSportsLot could not type went to sports-memorabilia (65% wrong) and
// programmes/scorecards to tickets. Re-run the shared ladder (sports-sale.ts
// routeSportsLot, RR's autograph-house prior) over those two buckets.
// ═══════════════════════════════════════════════════════════════════════════
const CATCH_ALL_HOUSES = new Set(["Christie's", "Sotheby's", 'RR Auction']);
export function sportsCatchAllFix(l: ClassifyLot): string | null {
  if (!CATCH_ALL_HOUSES.has(l.auctionHouse || '') || (l.artist !== 'sports-memorabilia' && l.artist !== 'tickets-passes')) return null;
  const t = String(l.title || '');
  const d = l.auctionHouse === 'RR Auction' ? '' : String(l.description || '');
  let k = routeSportsLot(t, d);
  if (!k) return null;
  if (l.auctionHouse === 'RR Auction') k = rrSportsPrior(k, `${t} ${d}`);
  return k;
}

// ═══════════════════════════════════════════════════════════════════════════
// 8 · WATCH MAKERS — jewellery is not a watch (Cartier Panthère necklaces,
// Patek 'Nautilus' cufflinks: 'jewelry is NOT a watch'), and Tudor is not
// Rolex. The form fixes themselves (pocket vs wrist, cushion-shaped cases,
// glued Sotheby's text) live in app/lib/comps.ts classifyForm.
// ═══════════════════════════════════════════════════════════════════════════
const WATCH_MAKERS = new Set(['rolex', 'patek-philippe', 'audemars-piguet', 'omega', 'cartier']);
export function watchMakerFix(l: ClassifyLot): string | null {
  if (!WATCH_MAKERS.has(l.artist)) return null;
  if (classifyForm({ title: l.title || '', medium: l.medium ?? null, category: (l.category || 'object') as never }) === 'jewelry') return DROP;
  if (l.artist === 'rolex') {
    const s = `${l.title || ''} ${(l.description || '').slice(0, 300)}`;
    if (/\btudor\b/i.test(s) && !/signed rolex|\b(?:omega|hamilton|longines|patek|cartier|bulova)\b/i.test(s)) return DROP;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 11 · ART / DESIGN ATTRIBUTION — a bare surname anywhere in the text routed
// lots that are not BY the maker: "After Pablo Picasso", "Attributed to",
// "Circle of", appropriations ("Jacqueline, after Picasso" by Vik Muniz,
// Mike Bidlo), offset exhibition posters, Joan Miró books published by the
// Pierre Matisse Gallery, Le Corbusier paintings under Jeanneret, Paloma
// Picasso jewellery. None has a tracked home → evicted.
// ═══════════════════════════════════════════════════════════════════════════
const MAKER_SURNAMES = 'picasso|warhol|matisse|haring|lichtenstein|basquiat|calder|koons|ruscha|kaws|condo|clemente|scharf|pettibon|bacon|nakashima|eames|prouv[ée]|jeanneret|le corbusier';
const NOT_BY_LEAD_RE = new RegExp(String.raw`^\s*(?:(?:after|d'apr[eè]s)\s+(?:a design by\s+)?(?:[a-z.'-]+\s+){0,2}(?:${MAKER_SURNAMES})\b|(?:attributed to|circle of|school of|follower of|manner of|in the manner of|style of|workshop of|studio of)\b)`, 'i');
const NOT_BY_INLINE_RE = new RegExp(String.raw`\b(?:${MAKER_SURNAMES})\s*,\s*after\b|\(after (?:[a-z.'-]+\s+)?(?:${MAKER_SURNAMES})\)|,\s*after (?:[a-z.'-]+\s+)?(?:${MAKER_SURNAMES})\b|\bafter (?:[a-z.'-]+\s+)?(?:${MAKER_SURNAMES})\s*(?:\(pictures of|['‘’"])`, 'i');
const ART_DESIGN_MAKERS = new Set(Object.entries(ARTIST_MARKET).filter(([, m]) => m === 'art' || m === 'design').map(([k]) => k));

export function attributionFix(l: ClassifyLot): string | null {
  if (!ART_DESIGN_MAKERS.has(l.artist)) return null;
  const t = String(l.title || '');
  const d = String(l.description || '').slice(0, 300);
  if (NOT_BY_LEAD_RE.test(t) || NOT_BY_LEAD_RE.test(d) || NOT_BY_INLINE_RE.test(t)) return DROP;
  if (/exhibition (?:poster|announcement)|poster for the exhibition|affiche (?:d.)?exposition/i.test(t) && !/\bsigned\b/i.test(t)) return DROP;
  const td = `${t} ${d}`;
  if (l.artist === 'henri-matisse' && /pierre matisse/i.test(td) && !/henri matisse|matisse, henri|h\. ?matisse/i.test(td)) return DROP;
  if (l.artist === 'pierre-jeanneret' && /le corbusier|charles-?[ée]douard/i.test(td) && !/pierre jeanneret|jeanneret, pierre|perriand/i.test(td)) return DROP;
  if (l.artist === 'pablo-picasso' && /paloma picasso/i.test(t) && /\b(?:by paloma|for tiffany|tiffany|earrings?|earclips?|necklace|bracelet|brooch|ring|pendant|jewel|sautoir|gold)\b/i.test(t)) return DROP;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 12 · CULTURE MASS LEAKS — the culture doctrine is NEVER mass items, but the
// gate only ran at crawl time and missed graded-collectible marks (IGS, WEGS,
// AFA/UKG/CAS toy grades), factory-sealed tapes/boxes and Beanie Babies; ~3k
// sat in culture. The same culture.ts gate (isMassCulture) now runs on every
// culture-slug row.
// ═══════════════════════════════════════════════════════════════════════════
// Narrower than culture.ts's crawl gate on purpose: original posters, first
// editions and printed documents are judged real culture lots in the audit;
// these are the marks of a MASS item only.
const CULTURE_MASS_RE = /\b(igs|wegs|wata|vga|cgc|cbcs|afa (?:qualified )?\d{2}|ukg \d{2}|cas \d{2}|vmg|factory[- ]sealed|sealed (?:video|vhs|cassette|cd|dvd|laserdisc|box|case|pack|game|tape)|hobby (?:box|case)|booster (?:box|pack)|blaster box|beanie bab(?:y|ies)|funko|action figures?|playset|video ?games?|nintendo|playstation|\bvhs\b|laserdisc|video 8|trading cards?|comic books?|comics)\b/i;
const HAKES_TOY_RE = /\b(?:boxed|in (?:original )?box|sealed box|carded|loose action|playsets?|model kits?|transformers|g\.?i\.? joe|masters of the universe|teenage mutant ninja turtles|he-man|micromasters?|hot wheels|matchbox|lionel|lunch ?box(?:es)?|board game|toy|toys)\b/i;
const CULTURE_MASS2_RE =/\b(?:pcgs|ngc|anacs)\b|\b(?:silver|morgan|peace|walking liberty|eagle) dollars?\b|\bdouble eagle\b|\bhalf dollars?\b|\bcoins?\b.{0,40}\b(?:ms|pr|pf)[- ]?\d{2}\b|\b(?:magazines?|newspapers?)\b.{0,40}\b(?:collection|lot|group|\(\d+\))|\b(?:collection|lot|group) of (?:\(?\d+\)? )?(?:magazines|newspapers)\b|\b(?:toy (?:truck|car|train)s?|tin toys?|die-?cast|buddy-?l|kickstradomis|designer toys?|vinyl figures?|model kits?)\b/i;

/** graded-slab / sealed-product marks: a SIGNED item carrying one is still a
 *  mass collectible (a signed CGC comic, a "Possible … Signed Cards" box) */
const MASS_EVEN_SIGNED_RE = /\b(?:igs|wegs|wata|vga|cgc|cbcs|afa|ukg|cas \d|vmg|amg|hobby (?:box|case)|booster|blaster|possible|factory[- ]sealed)\b|\b(?:psa|bgs|sgc)\s+(?:gem|mint|nm|ex|vg|good|\d)/i;
/** pre-war / vintage sports card issues that print no sport word ("1941 Double
 *  Play", "1952 Red Man", "1966 Philadelphia Gum Gale Sayers RC") */
const VINTAGE_SPORT_ISSUE_RE = /\b(?:goudey|cracker jack|topps|bowman|play ball|leaf|fleer|donruss|upper deck|panini|double play|red man|diamond stars|exhibits?|batter-up|turkey red|sweet caporal|old judge|mecca|hassan|kimball|allen & ginter|zeenut|obak|delong|national chicle|r\d{3}|philadelphia gum)\b/i;
/** a sports card by any of its marks: set code, sport word, a roster athlete, a sports issue */
export function isSportsCardText(t: string): boolean {
  return leadsWithSetCode(t) || SHORT_YEAR_SET_CODE_RE.test(t) || SPORT_WORD_RE.test(t) || !!athleteIn(t) || VINTAGE_SPORT_ISSUE_RE.test(t);
}
export function cultureMassFix(l: ClassifyLot): string | null {
  if (!CULTURE_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  // (wave 2) a celebrity-SIGNED piece is an autograph, not the mass object it
  // is signed on ("Al Pacino, James Caan, and Diane Keaton Signed LaserDisc
  // Sleeve", "Quentin Tarantino and Steve Buscemi Signed Laserdisc") — unless
  // it is slabbed / sealed product or a comic / non-sport TCG card
  const signedPiece = SIGNED_RE.test(t) && !MASS_EVEN_SIGNED_RE.test(t) && !COMIC_RE.test(t) && !NON_SPORT_TCG_RE.test(t);
  if ((CULTURE_MASS_RE.test(t) && !signedPiece) || NON_SPORT_TCG_RE.test(t)) return DROP;
  // (wave 2) class 3 · more mass marks the audit found kept: graded / bullion
  // coins, toy vehicles and designer toys, magazine & newspaper lots, a
  // Hake's slogan / litho / cartoon campaign button (a classic jugate stays),
  // and a Sotheby's Fashion Icons designer garment or costume-jewellery set
  // no celebrity wore or owned
  // a NAMED person's piece ("Dwight D. Eisenhower's Silver Dollar Belt Buckle",
  // "Audrey Hepburn's Givenchy … Gown") is provenance, not a mass object
  const personal = /\b[A-Z][\w.]*(?:\s+[A-Z][\w.]*)*['’]s\b/.test(t);
  if (!signedPiece && !personal && CULTURE_MASS2_RE.test(t)) return DROP;
  if (l.auctionHouse === "Hake's" && /\b(?:buttons?|pinbacks?)\b/i.test(t) && !/\b(?:jugate|classic|rare|unique|prototype|signed|original art|ferrotype)\b/i.test(t)) {
    // a mass-made campaign / cause button: dated 1920 or later, or a slogan /
    // litho / cartoon / member's button (a 1902 portrait button stays)
    const yr = (t.match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1];
    if ((yr && +yr >= 1920) || (!yr && /\b(?:slogan|litho|cartoon|member'?s|union|labor|symboliz\w*)\b/i.test(t))) return DROP;
  }
  if (l.auctionHouse === "Sotheby's" && /fashion icons/i.test(String(l.saleName || '')) && !personal && !/\b(?:worn|owned|property of|collection of|belonged|given to|gifted)\b/i.test(t)) return DROP;
  // a trading card in culture: a sports card goes home to sports, a non-sport
  // card has none. A "set" counts only when it is a set of CARDS ("near-complete
  // set of the USS Pueblo crew" signatures is not).
  const cardSet = CARD_SET_RE.test(t) && !/\b(?:crew|signatures?|autographs?|signed)\b/i.test(t);
  if (isCardTitle(t) && !SIGNED_RE.test(t) && (SLAB_GRADE_RE.test(t) || cardSet || leadsWithSetCode(t))) return isSportsCardText(t) ? 'graded-cards' : DROP;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 13 · POKÉMON IS THE ONE TCG — Yu-Gi-Oh / One Piece / Dragon Ball lots
// rode the 'pokemon' slug in from mixed TCG sweeps. (Singles vs sealed is a
// sub-cats.ts subCat fix.)
// ═══════════════════════════════════════════════════════════════════════════
export function pokemonOnlyFix(l: ClassifyLot): string | null {
  if (l.artist !== 'pokemon') return null;
  const t = String(l.title || '');
  return NON_SPORT_TCG_RE.test(t) && !/pok[eé]mon/i.test(t) ? DROP : null;
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

/** (wave 2) class 10 · ceramics / sculpture with no medium text: a Picasso
 *  Madoura form noun ("Oiseau au ver ashtray", "Visage No. 202", "Plaque Profil
 *  de Jacqueline", "Service poisson, bol H", "visage brun/bleu (alain ramié 2)"),
 *  a repoussé silver plate, a bronze cast, a KAWS vinyl / chrome figure */
const PICASSO_CERAMIC_RE = /\b(?:plates?|plat|assiette|pitchers?|pichet|cruchon|vases?|bowls?|bol|coupelle|ashtray|cendrier|plaques?|tiles?|carreaux?|dish|service poisson|tripode|pignate|jug|visage no\.?\s*\d+|alain rami[ée])\b/i;
const SCULPT_RE = /repouss|\b(?:bronze|patina|foundry|fonderie|cast (?:in|by)|lost[- ]wax|sculpture|marble|painted steel|stainless steel|chrome[- ]coated|resin)\b/i;
const KAWS_FIGURE_RE = /\b(?:companion|bff|chum|accomplice|dissected|small lie|together|time off|kubrick|be@?rbrick|vinyl|holiday|what party|clean slate|along the way|good intentions|passing through|resting place|gone|seeing|watching|share|take|figures?|plush)\b/i;
/** catalogue / edition evidence that a lot is a print (incl. the catalogue
 *  raisonné citations the Sotheby's text-less records print in the title) */
const PRINT_EVIDENCE_RE = /poster|affiche|lithograph|linocut|linogravure|etching|aquatint|screen ?print|silkscreen|s[ée]rigraph|woodcut|engraving|drypoint|offset|edition of|numbered|artist.s proof|\bprint(?:ed|s)?\b|gicl[ée]e|monotype|multiple|pochoir|photogravure|\bplates?\b|portfolio|\bfrom\b|\bsuite\b|f\.?\s*(?:&|and)\s*s\.?|feldman|schellmann|\bbloch\b|mourlot|\bbaer\b|cramer|corlett|gemini|ulae|duthuit|\([a-z]{1,3}\.\s*\d+[a-z]?\)|\b\d{1,3}\s*\/\s*\d{1,4}\b|\bhc\b|\bp\.?\s?p\.?\b|\bproof\b|\bimpression\b|\bsheet\b|catalogue|catalog\b|\bbooks?\b/i;
/** sales that do not sell prints: evening / day / works-on-paper / single-owner originals sales */
const ORIGINALS_SALE_RE = /\bevening\b|\bday (?:sale|auction)\b|works on paper|impressionist|masterworks|paintings|drawings|uniques?\b|souvenirs de vacances|picasso in private|man beast|marina picasso/i;
/** the houses whose originals sales are named as such (Rago / Wright / LAMA mix prints into "Post War + Contemporary Art") */
const ORIGINALS_SALE_HOUSES = new Set(["Christie's", "Sotheby's", 'Phillips', 'Bonhams']);
const PRINTS_SALE_RE = /prints?|multiples|editions?|posters?|photograph|design|showhouse|books?|literature/i;

/** The corrected art CATEGORY for a tracked art maker's lot, or null when the
 *  current one stands. Ceramic → sculpture; a unique medium → original. */
export function artCategoryFix(l: ClassifyLot): string | null {
  if (!ART_MAKERS.has(l.artist)) return null;
  const cat = l.category || 'unknown';
  if (cat === 'sculpture' || cat === 'photograph') return null;
  const s = artText(l);
  const tm = `${l.title || ''} | ${l.medium || ''}`;
  const sale = String(l.saleName || '');
  const printWord = ART_PRINT_WORD_RE.test(s);
  // (wave 2) a "knife engraving" / "engraved" decoration on a ceramic is not a print
  const strongPrint = /poster|affiche|lithograph|linocut|linogravure|etching|aquatint|screen ?print|serigraph|woodcut|drypoint|offset/i.test(s);
  const ceramic = CERAMIC_RE.test(s) || (l.artist === 'pablo-picasso' && (RAMIE_NO_RE.test(tm) || /alain rami[ée]/i.test(tm)));
  if (ceramic && !strongPrint) return 'sculpture';
  // (wave 2) class 10 · ceramic / sculpture forms with no medium text
  if (!strongPrint && !UNIQUE_MEDIUM_RE.test(s)) {
    const printRef = /\b(?:bloch|baer|cramer|mourlot|geiser|\d+ plates|plates? from|from the|suite)\b/i.test(s);
    if (l.artist === 'pablo-picasso' && !printRef && (PICASSO_CERAMIC_RE.test(l.title || '') || (cat === 'design' && !PRINT_EVIDENCE_RE.test(tm)))) return 'sculpture';
    if (SCULPT_RE.test(s) && !/\bon (?:paper|canvas|linen|board)\b/i.test(s)) return 'sculpture';
    if (l.artist === 'kaws' && KAWS_FIGURE_RE.test(tm) && !/\bon (?:paper|canvas)\b|portfolio|screenprint|print\b/i.test(s)) return 'sculpture';
  }
  if (cat === 'original') return null;
  if (UNIQUE_MEDIUM_RE.test(s) && !printWord) return 'original';
  // (wave 2) Warhol's canvases: "silkscreen ink" or "screenprint ink" on canvas
  if (/(?:silkscreen|screen ?print) inks?\b[^.;]{0,40}\bon (?:canvas|linen)/i.test(s) && !EDITION_MARK_RE.test(s)) return 'original';
  if (SILKSCREEN_CANVAS_RE.test(s) && !EDITION_MARK_RE.test(s)) return 'original';
  // (wave 2) class 6 · a 'print' (or design / unknown) with NO print evidence
  // anywhere: the crawler's edition-default artists filed every text-less
  // Sotheby's record as a print. The sale is the evidence — an evening / day /
  // works-on-paper / originals sale does not sell prints — and so is a price
  // no print of these makers reaches without saying so (≥ $300k).
  if ((cat === 'print' || cat === 'unknown' || cat === 'design') && !PRINT_EVIDENCE_RE.test(s)) {
    const price = Number(l.priceUsd || 0);
    // Warhol's portfolios (Kiku, Flowers, Marilyn sets) do sell in DAY sales:
    // for him only an evening sale or a price beyond any single print says so
    const saleSays = ORIGINALS_SALE_HOUSES.has(l.auctionHouse || '') && !PRINTS_SALE_RE.test(sale)
      && (l.artist === 'andy-warhol' ? /\bevening\b/i.test(sale) : ORIGINALS_SALE_RE.test(sale));
    if (saleSays || (price >= 500_000 && !/\b(?:set|portfolio|complete|suite)\b/i.test(s))) return 'original';
  }
  // (wave 2) class 9 · an art maker's lot is never 'design' (Wright / LAMA
  // "Modern Art & Design" sales stamped it): a print by its evidence, else unknown
  if (cat === 'design') return PRINT_EVIDENCE_RE.test(tm) ? 'print' : 'unknown';
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
        // (wave 2) Hake's toy titles: "TRANSFORMERS (1988) … BOXED", "MPC STAR
        // WARS … FACTORY SEALED MODEL KIT", "TMNT (1990) - … IN SEALED BOX"
        if ((MASS_TOY_RE.test(t) || TOY_GRADE_RE.test(t) || HAKES_TOY_RE.test(t)) && !SIGNED_RE.test(t)) return DROP;
        // (wave 2) Hake's is a pop / political house: a sports-slug lot with no
        // sport evidence (a Whig almanac, a Truman-Barkley jugate, an Eleanor
        // Roosevelt signature) is a culture lot
        if (SPORTS_SLUGS.has(l.artist) && !isSportsEvidence(t)) return cultureHome(t);
        return null;
      }
      if (l.artist !== 'pop-memorabilia' || !SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '')) return null;
      return sportsHousePopKind(l.title);
    },
  },
  { cls: 'sports-kind-card-first-gu-language', apply: expansionSportsKind },
  { cls: 'sports-card-slug-objects', apply: expansionCardObject },
  { cls: 'sports-house-card-lots-nonsport', apply: sportsHouseCardLotKind },
  {
    cls: 'science-title-object-noun',
    apply: l => (GENERALIST_HOUSES.has(l.auctionHouse || '') ? scienceVerdict(l) : null),
  },
  { cls: 'sale-name-gates', apply: saleGateFix },
  {
    cls: 'rr-athlete-autographs',
    apply: l => (l.auctionHouse === 'RR Auction' && CULTURE_SLUGS.has(l.artist) ? rrAthleteRoute(String(l.title || '')) : null),
  },
  { cls: 'sports-catch-all-programmes', apply: sportsCatchAllFix },
  { cls: 'entertainment-house-not-sports', apply: entertainmentHouseFix },
  { cls: 'goldin-facet-non-sport', apply: goldinNonSportFix },
  { cls: 'watch-jewelry-tudor', apply: watchMakerFix },
  { cls: 'art-design-attribution', apply: attributionFix },
  { cls: 'culture-mass-leaks', apply: cultureMassFix },
  { cls: 'pokemon-only-tcg', apply: pokemonOnlyFix },
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
