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
import { sportWordOf } from './sub-cats';

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
  /** (wave 5) the house's size line — an object's depth / diameter is form evidence */
  dimensions?: string | null;
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
export const PUBLICATION_RE = /\b(sports illustrated|magazines?|newsstand|yearbooks?|media guides?|press guides?|programs?|programmes?|scorecards?|score cards?|newspapers?|publications?|annuals?|guides?|sports graphic number|weekly baseball|sport (?:magazine|issue)|baseball digest|the sporting news)\b/i;
/** comics and mass toys — never a home anywhere (culture doctrine: no mass items) */
export const COMIC_RE = /\b(comic books?|(?<!bazooka )comics?|marvel comics|dc comics|amazing spider-man|action comics|detective comics|graphic novel)\b|\((?:19|20)\d\d (?:marvel|dc)\)|\bvol\.?\s*\d+\s*#\d+\b/i;
/** mass-produced toys — no home unless an athlete SIGNED it (then an autograph) */
export const MASS_TOY_RE = /\b(funko|action figures?|carded figure|beanie bab(?:y|ies)|kenner|hasbro|mattel|afa (?:[a-z+-]+ )?\d{2}|roleplay toy)\b/i;

/** (wave 2) graded/numbered objects that are not cards: a PSA-graded full
 *  ticket ("… Full Ticket - Mantle Hits #468 HR PSA 6"), a signed lineup card,
 *  an empty pack wrapper, a blown-up print of a card */
const NOT_A_CARD_OBJECT_RE = /\b(?:full )?tickets?\b|\bticket stubs?\b|\bstubs?\b|\bline-?up cards?\b|\bwrappers?\b|\bblown[- ]up\b/i;

/** Is this lot a trading CARD? (routing detector — see header) */
/** an edition serial — "LE (#58/200)", "(#1/1)", "(/250)" — numbers a print
 *  run, not a card: on a jersey, poster or animation cel it read as a card
 *  number and filed ~330 live Goldin objects under sports cards (Oct 9) */
const EDITION_SERIAL_RE = /\(\s?#\s?\d*\s?\/\s?\d+\s?\)/g;
/** "#48" / "#DAP-SO" — a card number, never the "#15/50" of a serial */
const CARD_NUMBER_RE = /#\s?[A-Za-z0-9][A-Za-z0-9-]*\b(?!\s?\/)/;
export function isCardTitle(title: string | null | undefined): boolean {
  const t = String(title || '').replace(EDITION_SERIAL_RE, ' ');
  if (!t.trim()) return false;
  if (leadsWithSetCode(t) || SHORT_YEAR_SET_CODE_RE.test(t)) return true;
  if (PHOTO_FOR_CARD_RE.test(t)) return false;
  if (NOT_A_CARD_OBJECT_RE.test(t) && !/\bsets?\b|rookie tickets?|contenders|\bstubs?\b.*\bcards?\b/i.test(t)
    && !(/\bblown[- ]up\b/i.test(t) ? false : CARD_WORD_RE.test(t.replace(/\bline-?up cards?\b/gi, ' ')))) return false;
  // the card stands named: "Signed Card", "Signed Rookie Card"; or a card
  // brand with a card number and a year/slab ("Panini National Treasures #48
  // … Jersey Number – SGC 9" — the parallel's name is not a jersey)
  if (/\b(?:signed|autographed|rookie|relic|patch|auto(?:graph)?) cards?\b(?![- ]used)/i.test(t) && !/\b(?:index|post|greeting|business|playing) cards?\b/i.test(t)) return true;
  if (CARD_BRAND_RE.test(t) && CARD_NUMBER_RE.test(t) && (YEAR_LEAD_RE.test(t) || SLAB_GRADE_RE.test(t)) && !isPhotoTitle(t)) return true;
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
const SEALED_CORE_RE = /\b(unopened|factory[- ]sealed|sealed (?:box|case|pack)(?:e?s)?|wax (?:pack|box|case)(?:e?s)?|hobby (?:box|case)(?:e?s)?|blaster(?: box(?:es)?)?|cello (?:pack|box)(?:e?s)?|rack (?:pack|box)(?:e?s)?|jumbo (?:pack|box)(?:e?s)?|vending (?:box|case)(?:e?s)?|fat packs?|booster (?:box|pack)(?:e?s)?)\b/i;
/** (Oct 8 sports audit, E8) the PRODUCT a sealed lot is — "Three Dozen Unopened
 *  Official League Baseballs", "1950 Ted Williams 'Champ' Prophylactics
 *  Unopened Package", a "Baseball Card Vending Machine" or a "Topps Vending
 *  Hoard (1,375 cards)" are not wax. A Star Co. "Factory-Sealed" team bag
 *  names no pack/box word and stays. */
export const SEALED_PRODUCT_RE = /\b(?:packs?|box(?:es)?|cases?|cellos?|racks?|wax|blasters?|tins?|cartons?|bags?|sets?|bricks?|tubes?|factory[- ]sealed)\b/i;
export const SEALED_NOT_RE = /\b(?:vending|gum(?:ball)?|arcade|exhibit)(?:[- ]style)?(?: card)? machines?\b|\bmachines?\b/i;
export const SEALED_RE = { test: (t: string): boolean => SEALED_CORE_RE.test(t) && SEALED_PRODUCT_RE.test(t) && !SEALED_NOT_RE.test(t) };
/** EXPLICIT use language — a jersey is not game-used because it is a jersey */
export const GAME_USED_RE = /\b(game[- ]?(?:used|worn|issued)|match[- ]?(?:used|worn|issued)|player[- ]?worn|team[- ]?issued|fight[- ]?worn|tour(?:nament)?[- ]?(?:used|worn)|race[- ]?(?:used|worn)|warm[- ]?up[- ]?worn|practice[- ]?(?:worn|used)|bench[- ]?worn|event[- ]?worn|psa\/dna gu \d+|photo[- ]?match(?:ed)?|gamer|mears|meigray|worn by|used by)\b/i;
const TROPHY_RE = /\b(trophy|trophies|awards?|awarded|medals?|diplomas?|championship rings?|world series rings?|super bowl rings?|title belt|winners?'? medal|olympic (?:gold |silver |bronze )?medal|mvp award|heisman|plaque award|presentational ring|(?:final four|championship|title|world series|super bowl|pennant|all-star|league) rings?|presented to)\b/i;
const TICKET_RE = /\b(tickets?|stubs?|full ticket|season pass|press pass(?! (?:cards?|#))|credentials?|all[- ]access pass)\b/i;
const TYPE1_RE = /\b(type (?:1|i|one)\b|type-1|original (?:news service |wire |press )?photo(?:graph)?|wire photo|press photo|news service photo)\b/i;
/** (Oct 8 sports audit, E3/E6) ANY photograph — Type I–IV, a wire / press /
 *  news photo, an RPPC, a negative, a bare "Photo" / "Photograph" ("… Hoists
 *  Trophy … Type I Photo", "Babe Ruth Type III Composite Photo") — the object
 *  is the photo, not the trophy it shows or the catch-all */
const PHOTO_TYPED_RE = /\b(type[- ]?(?:1|i|one|2|ii|two|3|iii|three|4|iv|four)\b(?! (?:auto|card|jersey|patch|relic))|original (?:news service |wire |press )?photo(?:graph)?s?|wire photos?|press photos?|news (?:service )?photos?|rppc|real photo post ?cards?|(?:glass |film |original )?negatives?\b|cabinet photos?|carte de visite)/i;
/** a bare photo word — not a "Photo Pennant / Pin / Button / Ball / Card" (that object) */
const PHOTO_WORD_RE = /\b(?:photo(?:graph)?s?|snapshots?)\b(?![- ]match)(?!\s+(?:pennants?|pins?|pinbacks?|buttons?|balls?|bats?|cards?|linen|emblems?|frames?|albums?))/i;
/** a photo / ticket that only rides along with the lot's object ("Trophy with Photo") */
const ACCESSORY_PHOTO_RE = /\b(?:with|w\/|plus|including|includes|featuring|features)\s+(?:an?\s+|the\s+|\(\d+\)\s+|\d+\s+)?(?:[\w'.-]+\s+){0,3}(?:photos?|photographs?|negatives?|snapshots?)\b/gi;
const ACCESSORY_TICKET_RE = /\b(?:with|w\/|plus|including|includes|featuring)\s+(?:an?\s+|the\s+|\(\d+\)\s+|\d+\s+)?(?:[\w'.-]+\s+){0,3}(?:tickets?|stubs?|passes|credentials?)\b/i;
/** the lot IS a photo: a photo word outside any "with … photo" rider, named
 *  before any publication word ("Sports Illustrated … Sliding Photo on …
 *  Cover" and "Yearbook - Featuring … Photographs" are publications) */
export function isPhotoTitle(t: string): boolean {
  const own = t.replace(ACCESSORY_PHOTO_RE, ' ');
  // a TYPED photo ("Type I", "Original Photo", RPPC, negative) is a photo even
  // when it names the magazine it ran in ("S.I. Cover-Used Type I Original Photo")
  if (PHOTO_TYPED_RE.test(own)) return true;
  const m = PHOTO_WORD_RE.exec(own);
  if (!m) return false;
  const pub = PUBLICATION_RE.exec(own);
  return !pub || m.index < pub.index;
}
/** (Oct 8 sports audit, E5) the PHOTOGRAPHER signed the print ("Charles Conlon
 *  Signed Type I Photo", "signed by the photographer") — the photo is the
 *  object; an athlete's signature on it makes it an autograph */
export const PHOTOGRAPHER_SIGNED_RE = /\bphotographer(?:'s|’s)?[- ](?:signed|signature|autograph|stamp)|\bsigned by (?:the )?photographer\b|\b(?:neil leifer|walter iooss(?: jr\.?)?|charles (?:m\. )?conlon|george (?:grantham )?bain|carl horner|paul thompson|ozzie sweet|annie leibovitz|richard avedon|harry benson|john g\.? zimmerman|bill eppridge|barton silverman|lou requena|james drake|tony triolo|marvin newman|hy peskin|nat fein|charles hoff|barney stein|ernie sisto)\s+(?:hand[- ])?(?:signed|autographed)\b|\bsigned by (?:neil leifer|walter iooss|nat fein|charles conlon|ozzie sweet|annie leibovitz|harry benson)\b|\bsigned (?:in|on) (?:the )?(?:negative|print|plate|margin by (?:the )?photographer)\b/i;
export function isPhotographerSigned(t: string): boolean { return PHOTOGRAPHER_SIGNED_RE.test(t); }
/** an athlete's letter / check / contract is an autograph item */
const AUTOGRAPH_DOC_RE = /\b(letters?|contracts?|endorsements?)\b/i;
export const SIGNED_RE = /\b(signed|autograph(?:ed|s)?|signatures?|cut signature|auto\.)\b/i;

/** (wave 3) a signed ball / puck / bat / helmet / jersey — an autograph — never
 *  an award object itself (a signed trophy / ring / plaque stays an award) */
const SIGNED_OBJECT_NOUN_RE = /\b(?:(?:base|foot|basket|soccer |golf |hockey )?balls?|baseballs?|footballs?|basketballs?|pucks?|bats?|(?:mini[- ])?helmets?|jerseys?|gloves?)\b/i;
const AWARD_OBJECT_RE = /\b(?:trophy|trophies|rings?|medals?|plaques?|belts?|awards?|statuettes?)\b/i;
/** (wave 4) an award NAMED as who signed ("Heisman Trophy Award Winner
 *  Single-Signed Mini Helmets", "Gold Glove Award Winners Single-Signed
 *  Baseballs") is not an award object */
const AWARD_WINNER_PHRASE_RE = /\b(?:heisman|cy young|mvp|gold glove|silver slugger|vezina|hart|norris|conn smythe|triple crown|batting title|rookie of the year|award|trophy)(?:\s+(?:trophy|award))*\s+winners?(?:['’]s?)?(?=\W|$)/gi;
export const stripAwardWinners = (t: string): string => t.replace(AWARD_WINNER_PHRASE_RE, ' ');
export function isSignedRetailObject(t: string): boolean {
  return /\b(?:signed|autographed)\b/i.test(t) && SIGNED_OBJECT_NOUN_RE.test(t) && !AWARD_OBJECT_RE.test(stripAwardWinners(t))
    && !GAME_USED_RE.test(t) && !CARD_NO_RE.test(t) && !SLAB_GRADE_RE.test(t);
}

/** Kind of a NON-card sports object. `catchAll` is the house's memorabilia
 *  twin ('sports-memorabilia' at Goldin/Christie's/Sotheby's, 'memorabilia' at
 *  the expansion houses). */
export function sportsObjectKind(title: string | null | undefined, catchAll: 'sports-memorabilia' | 'memorabilia' = 'sports-memorabilia'): string {
  const t = String(title || '');
  if (SEALED_RE.test(t)) return 'unopened-wax';
  if (GAME_USED_RE.test(t)) return 'game-used';
  // (Oct 8 sports audit) a PHOTO is a photo before it is a trophy / ticket /
  // catch-all (E3/E6) — unless an athlete SIGNED it: then an autograph (E5)
  const signed = SIGNED_RE.test(t);
  const photo = isPhotoTitle(t);
  if (photo && (!signed || isPhotographerSigned(t))) return 'type-1-photos';
  // (wave 3) a SIGNED ball / bat / helmet / jersey is an autograph even when
  // it commemorates an award ("Aaron Rodgers Signed '2021 MVP' Football")
  if (isSignedRetailObject(t)) return 'autographs';
  if (photo) return 'autographs';
  // (E2) a ticket before the award it commemorates ("… MVP World Series Game 5 … Ticket")
  const trophy = TROPHY_RE.test(stripAwardWinners(t));
  if (TICKET_RE.test(t) && !PUBLICATION_RE.test(t) && !(trophy && ACCESSORY_TICKET_RE.test(t))) return 'tickets-passes';
  if (trophy) return 'trophies-awards';
  if (PUBLICATION_RE.test(t) && !signed) return 'programs-publications';
  if (signed || AUTOGRAPH_DOC_RE.test(t)) return 'autographs';
  if (PUBLICATION_RE.test(t)) return 'programs-publications';
  return catchAll;
}

// ── 1 · GOLDIN SPORT FACET — "a Sport lot with no object signal is a card" was
// wrong for 69k rows (jerseys, balls, photos, sealed boxes, magazines, comics):
// the card detector decides card; everything else gets its object kind.
// Non-sport TCG (Yu-Gi-Oh / One Piece / Union Arena …) and comics have no home.
export const NON_SPORT_TCG_RE = /\b(yu-?gi-?oh!?|one piece|union arena|dragon ball|digimon|magic:? the gathering|\bmtg\b|weiss schwarz|lorcana|flesh and blood|jujutsu kaisen|naruto|my hero academia|demon slayer|star wars unlimited|black lotus|mox (?:sapphire|ruby|pearl|jet|emerald))\b/i;

const POP_PIECE_RE = /\b(animation (?:cel|cell)s?|production cel|looney tunes|warner bros|hanna[- ]barbera|disney|mondo|pearl jam|grateful dead|phish|gig poster)\b/i;
export function goldinSportKind(title: string | null | undefined): string {
  const t = String(title || '');
  if (NON_SPORT_TCG_RE.test(t) || COMIC_RE.test(t)) return DROP;
  if (MASS_TOY_RE.test(t) && !SIGNED_RE.test(t)) return DROP;
  if (SEALED_RE.test(t)) return 'unopened-wax';
  // (wave 3) "Roger Clemens Signed Commemorative 300th Win … OML Baseball" read as a card
  if (isSignedRetailObject(t)) return 'autographs';
  if (isCardTitle(t)) return 'sports-cards';
  // (Oct 9) Goldin's Sport book carries pop pieces (Looney Tunes cels, Pearl
  // Jam gig posters, Mondo prints) — with no sport evidence they are culture
  // — only on POSITIVE pop evidence (a sneaker or a bowl watch with no sport
  // word is still sports)
  if ((NON_SPORT_RE.test(t) || POP_PIECE_RE.test(t)) && !isSportsEvidence(t) && !SPORT_WORD_RE.test(t)) return cultureHome(t);
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
export const NON_SPORT_RE = /\b(riaa|grammys?|brit (?:certified|awards?)|(?:gold|platinum) (?:records?|albums?)|sales awards?|beatles|rolling stones|elvis|presley|beach boys|springsteen|concert|rock (?:and|&|n|'n'?) roll|albums?|vinyl|records?\b(?! book)|movie|film|hollywood|disney|mickey mouse|star wars|star trek|superman|batman|marvel|comics?|cartoons?|hanna[- ]barbera|television|tv show|howdy doody|monkees|kiss|guitar|jazz|sinatra|marilyn monroe|president(?:ial)?|political|campaign|lincoln|kennedy|eisenhower|nixon|roosevelt|truman|civil war|world war|wwii|apollo|nasa|astronaut|circus|wizard of oz|g\.?i\.? joe|barbie|non[- ]sport|three stooges|lone ranger|hopalong|roy rogers|gene autry|chaplin|laurel (?:and|&) hardy)\b/i;
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
const NON_SPORT_CARD_RE = /\b(?:power for peace|garbage pail|wacky packages|howdy doody|presidents?|beauties|actors and actresses|actresses|mars attacks|chiefs and rulers|savage and semi|star wars|star trek|disney|mickey mouse|marvel|batman|superman|wizard of oz|elvis|beatles|monkees|non-?sports?|nonsports?|pok[eé]mon|yu-?gi-?oh|magic:? the gathering|green hornet|munsters|rails and sails|krazy|civil war|world war|wwii|james bond|beverly hillbillies|bewitched|i love lucy|between the acts|indian chiefs|indian gum|automobile|flags of|wildlife|dinosaurs?|astronauts?|universal monsters|frankenstein|dracula|film stars|movie stars|comics?)\b/i;
export function sportsHouseCardLotKind(l: ClassifyLot): string | null {
  if (!SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '')) return null;
  const t = String(l.title || '');
  // (wave 3) a MIXED lot ("Multi/Non-Sport Treasure Chest … with Many Hall of
  // Famers") is a sports card lot — 55 H&S lots were evicted as non-sport
  const sport = SPORT_WORD_RE.test(t) || !!athleteIn(t) || /\bmulti[-/ ]?(?:sports?\b|\/)|\bhall of famers?\b|\bhofers?\b/i.test(t);
  // (wave 4) + non-sport WAX ("1954 Bowman "Power For Peace" Unopened Cello")
  if (l.artist === 'unopened-wax' && !sport && NON_SPORT_CARD_RE.test(t)) return /pok[eé]mon/i.test(t) && !NON_SPORT_TCG_RE.test(t) ? 'pokemon' : DROP;
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
  // (wave 3) a card LOT that also mentions its extras ("1970-79 Topps Baseball
  // Singles Collection (844) Plus (22) Wrappers") is still the card lot
  const head = t.split(/\b(?:plus|with|w\/|&|and)\b/i)[0];
  if (CARD_LOT_RE.test(head) && !NOT_A_CARD_OBJECT_RE.test(head)) return null;
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
const SPACE_RE = /\bapollo\s*\d|\bapollo (?:program|mission|lunar|command|capsule|spacecraft|astronaut|era|[ivx]+\b)|\bnasa\b|astronaut|cosmonaut|space ?suit|space[- ]flown|\bflown\b|lunar (?:module|surface|rover|sample|orbiter|landing|map)|moon (?:rock|landing|walk|map|globe)|sputnik|vostok|voskhod|soyuz|skylab|space shuttle|(?:project|capsule|program|friendship|faith) (?:mercury|gemini)|(?:mercury|gemini)[- ](?:\d|atlas|redstone|titan|astronaut|spacecraft|capsule|program|mission)|saturn v|space station|space exploration|spacecraft|rocket|launch|mission (?:patch|control|report|log|emblem|plan)|satellite|\biss\b|mir space|lunokhod|\bv-2\b|x-15|space program|space race/i;
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
/** (wave 4) a painting / drawing / print medium line ("oil on canvas", "signed and dated 'Souza 1966'") */
const ARTWORK_MEDIUM_RE = /\b(?:oil|acrylic|gouache|watercolou?r|tempera|pastel|charcoal|ink|mixed media|collage|woodcut|etching|lithograph|screenprint|aquatint|linocut)s?\b[^.;]{0,60}?\bon (?:canvas|linen|paper|board|panel|masonite|card)\b|\bsigned and dated\b|\b(?:oil|acrylic) painting\b|\bbronze with\b.{0,20}\bpatina\b/i;

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
  // (wave 4) an ARTWORK by a dated artist ("F. N. SOUZA (1924-2002) Astronaut",
  // "Belkis Ayón (1967-1999) Untitled (Sikan, Nasako …)") — a painting or print
  // of a space subject is not a space artifact, and its maker is untracked
  if (LIFEDATE_LEAD_RE.test(t) && !SCIENTIST_RE.test(t) && !isSignedDocument(t) && !/\b(?:photo(?:graph)?s?|letters?|documents?|flown|patch|flag|manuscript|typescript)\b/i.test(t) && ARTWORK_MEDIUM_RE.test(`${t} ${String(l.medium || '')} ${String(l.description || '').slice(0, 400)}`)) return DROP;
  if (a === 'space-exploration' && !SPACE_TOY_RE.test(t) && (SPACE_RE.test(t) || /space/i.test(sale))) return null;
  // (wave 4) class 7 · an astronaut's / a flown piece, or Hubble / shuttle
  // hardware, is space before any document or culture fallback below
  // ("SHEPARD, Alan (1923-1998), et al. Photograph signed")
  if (!SPACE_TOY_RE.test(t) && isSpaceLeadTitle(t, sale)) return a === 'space-exploration' ? null : 'space-exploration';
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
/** (Oct 8 sports audit, E4) + RIAA / BRIT certified sales awards, gold /
 *  platinum records, Grammys, animation cels, backstage / tour passes, studio
 *  photographs — Goldin's Thematic auctions filed them as trophies / game-used */
export const GOLDIN_NON_SPORT_RE = /\b(?:vinyl|test pressing|cassette|laserdisc|8-track|production[- ](?:made|used|cels?)|screen[- ](?:used|worn|matched)|ursa authentic|movie poster|film poster|concert poster|tour poster|star wars|star trek|marvel|disney|beatles|elvis presley|rolling stones|nirvana|hollywood|actor|actress|filming|baywatch|(?:from|in) (?:the )?(?:film|movie|tv series|series)|riaa|brit certified|brit awards?|(?:gold|platinum|silver|diamond) (?:records?|albums?|singles?)|(?:multi-|double |triple )?platinum (?:sales )?awards?|(?:record |single |album )?sales awards?|grammys?|grammy awards?|animation cels?|cels?|animation drawings?|backstage pass(?:es)?|tour (?:pass(?:es)?|laminates?)|studio photo(?:graph)?s?)\b/i;
/** Goldin's non-sport catch-all sale: its lots are sports only on evidence */
const GOLDIN_NON_SPORT_SALE_RE = /\bthematic\b/i;
/** explicit athlete-use language (not "worn by" / "used by": an actor's too) */
const SPORT_USE_RE = /\bwrestlemania\b|\b(?:fight|bout|ringside|boxing) (?:posters?|programs?|programmes?|tickets?|films?|photos?|photographs?)\b|\bplaybooks?\b|\b(?:efl|carabao cup|fa cup|coupe de france|copa (?:america|libertadores|del rey)|serie a|bundesliga|ligue 1|uefa|arsenal|chelsea|tottenham|everton|liverpool fc|leeds united|psg|paris saint-germain|ac milan|inter milan|bayern|ajax|benfica|flamengo|santos fc)\b|\b(?:game|match|fight|race|practice|warm[- ]?up|bench|event|player|team)[- ]?(?:used|worn|issued)\b|\bpro(?:fessional)?[- ]model\b/i;
/** a pro franchise named WITH its city ("Los Angeles Rams", "Orlando Magic") —
 *  the bare nickname is often a band or a film */
const CITY_TEAM_RE = /\b(?:arizona|atlanta|baltimore|boston|brooklyn|buffalo|carolina|charlotte|chicago|cincinnati|cleveland|colorado|dallas|denver|detroit|golden state|green bay|houston|indiana|indianapolis|jacksonville|kansas city|las vegas|los angeles|l\.?a\.?|memphis|miami|milwaukee|minnesota|montreal|nashville|new england|new jersey|new orleans|new york|n\.?y\.?|oakland|oklahoma city|orlando|ottawa|philadelphia|phoenix|pittsburgh|portland|sacramento|san antonio|san diego|san francisco|san jose|seattle|st\.? louis|tampa bay|tennessee|texas|toronto|utah|vancouver|vegas|washington|winnipeg|calgary|edmonton|anaheim|florida|columbus|tampa)\s+(?:rams|chiefs|eagles|giants|jets|patriots|bills|dolphins|ravens|steelers|browns|bengals|texans|colts|jaguars|titans|broncos|raiders|chargers|cowboys|commanders|redskins|bears|lions|packers|vikings|falcons|panthers|saints|buccaneers|cardinals|49ers|seahawks|lakers|clippers|warriors|kings|suns|celtics|nets|knicks|76ers|raptors|bulls|cavaliers|pistons|pacers|bucks|hawks|hornets|heat|magic|wizards|nuggets|timberwolves|thunder|trail blazers|jazz|mavericks|rockets|grizzlies|pelicans|spurs|yankees|mets|red sox|white sox|cubs|dodgers|angels|astros|athletics|mariners|rangers|blue jays|orioles|rays|guardians|indians|tigers|royals|twins|brewers|reds|pirates|phillies|marlins|nationals|braves|padres|rockies|diamondbacks|bruins|sabres|red wings|canadiens|senators|lightning|maple leafs|hurricanes|blue jackets|devils|islanders|flyers|penguins|capitals|blackhawks|avalanche|stars|wild|predators|blues|jets|ducks|flames|oilers|canucks|sharks|kraken|golden knights|coyotes|galaxy|fc|sounders|united|cosmos)\b/i;
/** (Oct 8 sports audit, E1) the lot's own title says sports: a strong sport
 *  word / roster athlete (isSportsEvidence), a sport / league / club word
 *  (sub-cats sportWordOf), athlete-use language, or a city + franchise */
export function hasSportsTitleEvidence(t: string): boolean {
  return isSportsEvidence(t) || !!sportWordOf(t) || SPORT_USE_RE.test(t) || CITY_TEAM_RE.test(t);
}
const NON_CARD_SPORTS_SLUGS = new Set(['game-used', 'sports-memorabilia', 'tickets-passes', 'trophies-awards', 'type-1-photos', 'autographs', 'programs-publications', 'equipment-artifacts']);
export function goldinNonSportFix(l: ClassifyLot): string | null {
  if (l.auctionHouse !== 'Goldin' || !NON_CARD_SPORTS_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  if (isSportsEvidence(t)) return null;
  // (Oct 8 sports audit, E1) a Goldin THEMATIC-auction lot (animation cels,
  // Madonna backstage passes, RIAA awards, Bob Hope studio photos — 410 live)
  // is sports only on sports evidence: a strong sport word, a roster athlete,
  // or a sport / league / club the title names
  if (GOLDIN_NON_SPORT_SALE_RE.test(String(l.saleName || ''))) return hasSportsTitleEvidence(t) ? null : cultureHome(t);
  if (!GOLDIN_NON_SPORT_RE.test(t)) return null;
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
  // (wave 4) papers / boxes / tools / displays / pens with no timepiece in the
  // lot ("PATEK PHILIPPE. AN ATTESTATION FOR A SET OF REF. 5075", "rolex |
  // day-date, a gilt brass … retailer's window display", "easy oyster opener")
  const t = String(l.title || '');
  if (WATCH_ACCESSORY_RE.test(t) && !TIMEPIECE_RE.test(t)) return DROP;
  // a Gilbert Albert jewellery set for Omega with no watch in it
  if (l.artist === 'omega' && /gilbert albert/i.test(`${t} ${(l.description || '').slice(0, 300)}`) && !TIMEPIECE_RE.test(`${t} ${(l.description || '').slice(0, 300)}`)) return DROP;
  return null;
}
const WATCH_ACCESSORY_RE = /\b(?:attestations?|extracts? from the (?:patek philippe )?archives|archive extracts?|presentation box(?:es)?|boxes|fitted box(?:es)? only|tools?|screwdrivers?|case openers?|oyster opener|bezel remover|staking tool|window display|retailer'?s (?:window )?display|light box|fountain pen|ballpoint pen|pens?|cufflinks|key ?rings?|lighters?|advertising (?:sign|display)|counter display)\b/i;
// a prefix match: Phillips glues the next word on ("wristwatchwith emerald green dial")
const TIMEPIECE_RE = /\b(?:wrist ?watch|wriswatch|watch|chronometer|chronograph|timepiece|clock|montre|tourbillon|pendant[- ]watch|movement)/i;

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
/** (wave 4) the tracked ART maker whose full name LEADS a title ("ROY
 *  LICHTENSTEIN …", "Andy Warhol (1928-1987) …"), or null */
const ART_MAKER_LEAD: [RegExp, string][] = Object.entries(ARTIST_MARKET).filter(([, m]) => m === 'art')
  .map(([slug]) => [new RegExp(`^\\s*${slug.split('-').map(w => w.replace(/[^a-z0-9]/g, '')).join('[\\s.-]+')}\\b`, 'i'), slug] as [RegExp, string]);
export function leadArtMakerOf(t: string): string | null {
  for (const [re, slug] of ART_MAKER_LEAD) {
    const m = re.exec(t);
    if (!m) continue;
    // a co-maker list ("KEITH HARING AND ANDY WARHOL", "Jean-Michel Basquiat &
    // Andy Warhol (1960-1988 & 1928-1987)", "Andy Warhol, Jean-Michel
    // Basquiat, …") is a collaboration — whichever tracked maker holds it stays
    if (/^\s*(?:\([^)]*\)\s*)?(?:,|&|\+|and\b|with\b)/i.test(t.slice(m[0].length))) return null;
    return slug;
  }
  return null;
}

export function attributionFix(l: ClassifyLot): string | null {
  if (!ART_DESIGN_MAKERS.has(l.artist)) return null;
  const t = String(l.title || '');
  const d = String(l.description || '').slice(0, 300);
  if (NOT_BY_LEAD_RE.test(t) || NOT_BY_LEAD_RE.test(d) || NOT_BY_INLINE_RE.test(t)) return DROP;
  // (wave 3) "Signed in print" / "signed in the plate" is the printed name, not a signature
  if (/exhibition (?:poster|announcement)|poster for the exhibition|affiche (?:d.)?exposition/i.test(t) && !/\bsigned\b/i.test(t.replace(/\bsigned (?:and dated )?in (?:the )?(?:print|plate|stone|negative)\b/gi, ' '))) return DROP;
  // (wave 3) appropriation / homage: Sturtevant's "Warhol Gold Marilyn", a
  // "Hommage à Picasso" portfolio by other artists
  if (/^\s*(?:elaine )?sturtevant\b|\bmike bidlo\b/i.test(t)) return DROP;
  // (wave 4) another TRACKED art maker leads the title: the lot is theirs
  // ("ROY LICHTENSTEIN Still Life with Picasso, from Hommage à Picasso (C. 127)")
  const leadMaker = leadArtMakerOf(t);
  if (leadMaker && leadMaker !== l.artist) return leadMaker;
  const homage = t.match(/\bhomm?age (?:[àa]|to) (picasso|matisse|warhol)\b/i);
  if (homage && l.artist.endsWith(homage[1].toLowerCase())) return DROP;
  // (wave 3) ANOTHER person leads the title and the maker is its subject:
  // "Jacques-Henri Lartigue: Spanish painter Pablo Picasso … reclining",
  // "jasper johns | cup 2 picasso (see ulae 123)"
  const lead = t.match(/^\s*([A-Za-zÀ-ɏ.'’ -]{4,40}?)\s*(?::|\|)\s+\S/);
  // (wave 4) a print catalogue citation says the maker MADE it ("Retour aux
  // sources: Picasso touriste … plate 81 from Série 347 (Bl. 1561, Ba. 1577)")
  if (lead && ARTIST_MARKET[l.artist as keyof typeof ARTIST_MARKET] === 'art' && !PRINT_CAT_REF_RE.test(t) && !/^\s*(?:untitled|portrait|lot|set|pair|two|three|four|five|six|seven|eight|nine|ten|\d|a |an |the |verve|portfolio|works?|suite|series|collection|books?|catalogue|exhibition)/i.test(lead[1]) && lead[1].trim().split(/\s+/).length <= 4) {
    const sur = l.artist.split('-');
    const leadWords = lead[1].toLowerCase();
    const rest = t.slice(lead[0].length - 1).toLowerCase();
    if (!sur.some(w => w.length > 2 && leadWords.includes(w)) && sur.some(w => w.length > 3 && rest.includes(w))) return DROP;
  }
  const td = `${t} ${d}`;
  if (l.artist === 'henri-matisse' && /pierre matisse/i.test(td) && !/henri matisse|matisse, henri|h\. ?matisse/i.test(td)) return DROP;
  if (l.artist === 'pierre-jeanneret' && /le corbusier|charles-?[ée]douard/i.test(td) && !/pierre jeanneret|jeanneret, pierre|perriand/i.test(td)) return DROP;
  if (l.artist === 'pablo-picasso' && /paloma picasso/i.test(t) && /\b(?:by paloma|for tiffany|tiffany|earrings?|earclips?|necklace|bracelet|brooch|ring|pendant|jewel|sautoir|gold)\b/i.test(t)) return DROP;
  // (wave 4) Francis Bacon the PHILOSOPHER (1561–1626): the Bonhams book sales
  // file his Essayes / Sylva Sylvarum / Historie of Henry VII under the painter
  if (l.artist === 'francis-bacon' && isBaconPhilosopher(td)) return DROP;
  // (wave 4) a Daum (glass house) piece under Prouvé with no Prouvé in the title
  if (l.artist === 'jean-prouve' && /\bdaum\b/i.test(t) && !/prouv[ée]/i.test(t)) return DROP;
  return null;
}
const BACON_PHILOSOPHER_RE = /\b1561\s*[-–]\s*1626\b|\bsir francis bacon\b|\bbacon, sir francis\b|\bviscount st\.? alban|\blord verulam|\bsylva sylvarum|\bnovum organum|\binstauratio|\bessayes\b|advancement of learning|historie of the raigne|history of the reigns? of (?:king )?henry|\bresuscitatio\b|apophthegm|naturall historie|new atlantis|letters and remains|declaration of the practises|history naturall/i;
function isBaconPhilosopher(td: string): boolean {
  if (/\b1909\b|\b1992\b|derri[eè]re le miroir|marlborough|tate gallery/i.test(td)) return false;
  if (BACON_PHILOSOPHER_RE.test(td)) return true;
  // an early imprint: every year the lot names is before 1900
  const yrs = (td.match(/\b(1[5-9]\d\d|20\d\d)\b/g) || []).map(Number);
  return yrs.length > 0 && yrs.every(y => y < 1900) && /\b(?:london|printed|edition|vols?\.|folio|press|parts? in one|works|essays?)\b/i.test(td);
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
/** (wave 4) class 5 · mass pieces the re-audit #3 found kept at any culture
 *  house: an unsigned retail record (LP / 45 / vinyl reissue), a campaign
 *  pin / button / bumper-sticker lot (the Hake's doctrine — 1920 or later,
 *  or a modern campaign — at every house), a collectible figurine run
 *  (Danbury Mint, Ertl), and the encapsulated designer-toy / graded-tape
 *  marks Goldin's culture desk sells ("PiggyBanx Encapsulated", "Rewind 9.4") */
const MASS_RECORD_RE = /\b(?:vinyl|lps?|(?:33|45|78) ?rpm|7-inch single|12-inch single|vinyl album collection)\b/i;
const RECORD_ONE_OFF_RE = /\b(?:acetates?|test pressings?|demo|master|gold record|platinum record|riaa|award|owned|personal(?:ly)?|from the (?:collection|estate)|archive|prototype|artwork|original art|mock-?up)\b/i;
const MASS_PIN_RE = /\b(?:pins|pinbacks?|(?:campaign |slogan |litho )?buttons|stick ?pins?|bumper stickers?|campaign (?:pins?|buttons?))\b/i;
const PIN_ONE_OFF_RE = /\b(?:uniform|jacket|coat|waistcoat|vest|ferrotype|jugate|prototype|original art|unique|insignia|owned|worn|from (?:the )?(?:closet|wardrobe|desk|family collection))\b/i;
const MODERN_FIGURE_RE = /\b(?:kennedy|jfk|nixon|eisenhower|ike|reagan|carter|clinton|obama|trump|biden|bush|johnson|lbj|humphrey|goldwater|mcgovern|dukakis|mondale|truman|martin luther king|mlk)\b/i;
const MASS_FIGURE_RE = /\b(?:danbury mint|ertl|hummel|lladr[oó]|bobble-?heads?|figurines? collection|collection of figurines|statues? figurines)\b/i;
const CULTURE_MASS3_RE = /\b(?:piggybanx|diamond cutz|jerski|rewind \d|vhsdna|kidrobot|bootleg toy|skateboard decks?)\b/i;
const PROVENANCE_HOUSES = new Set(["Julien's", 'Propstore']);
function cultureMass3(l: ClassifyLot, t: string, signed: boolean, personal: boolean): boolean {
  if (signed || personal || PROVENANCE_HOUSES.has(l.auctionHouse || '') || isSportsCardText(t)) return false;
  if (CULTURE_MASS3_RE.test(t)) return true;
  if (MASS_RECORD_RE.test(t) && !RECORD_ONE_OFF_RE.test(t) && !/\balbums? (?:pages?|of|photos?)\b|\bphoto(?:graph)? albums?\b|\bautograph albums?\b/i.test(t)) return true;
  if (MASS_PIN_RE.test(t) && !PIN_ONE_OFF_RE.test(t)) {
    const yr = +((t.match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1] || 0);
    if (!/\b(?:letters?|photos?|photographs?|documents?|archive|signed)\b/i.test(t) && (yr >= 1920 || (!yr && (MODERN_FIGURE_RE.test(t) || /\b(?:slogan|litho|bumper)\b/i.test(t))))) return true;
  }
  return MASS_FIGURE_RE.test(t) && !/\b(?:bronze|artist'?s proof|original|prototype|maquette|sculpture)\b/i.test(t);
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
  if (cultureMass3(l, t, SIGNED_RE.test(t), personal)) return DROP;
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
/** (wave 4) Pokémon merchandise that is not a card or sealed card product:
 *  sealed VHS / DVD tapes, plush, toys, Funko / vinyl figures, battle figures,
 *  video games — the tcg vertical is cards (a "Figure Collection" BOX is card
 *  product: it holds booster packs and a promo) */
const TCG_MERCH_RE = /\b(?:vhs|dvd|blu-?ray|video ?tapes?|plush(?:es)?|plushies|funko|vinyl figures?|battle figures|toys?|video games?|game ?boy|nintendo|cartridges?|figurines?)\b/i;
const TCG_CARD_PRODUCT_RE = /\b(?:cards?|packs?|booster|promo|#\s?[A-Za-z0-9]|box(?:es)?|collection box|elite trainer|tins?|psa|bgs|cgc \d|tcg)\b/i;
export function pokemonOnlyFix(l: ClassifyLot): string | null {
  if (l.artist !== 'pokemon') return null;
  const t = String(l.title || '');
  if (NON_SPORT_TCG_RE.test(t) && !/pok[eé]mon/i.test(t)) return DROP;
  // a toy / tape is merchandise unless the title names card product ("Figure Collection … 4-Card Packs")
  if (TCG_MERCH_RE.test(t) && (/\b(?:vhs|dvd|blu-?ray|video ?tapes?|plush\w*|funko|vinyl figures?|video games?|game ?boy)\b/i.test(t) || !TCG_CARD_PRODUCT_RE.test(t))) return DROP;
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
const UNIQUE_MEDIUM_RE = /\b(?:oil|acrylic|tempera|gouache|watercolou?r|pastel|charcoal|chalk|crayon|graphite|pencil|ballpoint|pen|ink|felt[- ]tip|marker|oil ?stick|spray ?paint|enamel|synthetic polymer|gunpowder|collage|mixed media)s?\b[^.;]{0,60}?\bon\s+(?:canvas|linen|panel|board|paper|card|masonite|wood|metal|aluminum|cardboard|glass|plexiglas|vellum)(?![a-z])/i;
/** Warhol's painting medium: silkscreen INK on canvas is a unique painting */
const SILKSCREEN_CANVAS_RE = /silkscreen inks?\b[^.;]{0,30}\bon (?:canvas|linen)/i;
const EDITION_MARK_RE = /edition of|numbered|\b\d{1,3}\s*\/\s*\d{1,4}\b/i;
/** (wave 3) an estate / foundation / authentication-board inventory number */
const ESTATE_NO_RE = /\b(?:and )?numbered\s+['‘’"]?[A-Z]{0,4}\d{1,4}\.\d{2,4}[A-Z]?['‘’"]?|\bnum[ée]rot[ée]\s+['‘’"]?[A-Z]{0,4}\d{1,4}\.\d{2,4}['‘’"]?/gi;
/** (wave 3) the French unique-medium line ("peinture … et encres sérigraphiques sur toile") */
const FR_UNIQUE_MEDIUM_RE = /\b(?:huile|acrylique|peinture|encres?|gouache|fusain|aquarelle|crayon)\b[^.;]{0,80}?\bsur (?:toile|panneau)\b/i;
/** (wave 5) a French drawing medium on paper ("Snail, gouache sur papier") — the
 *  'unknown' pile's French-titled originals (crayon is excluded: "signée au
 *  crayon … sur papier Arches" is a print's signature line) */
const FR_PAPER_MEDIUM_RE = /\b(?:gouache|fusain|aquarelle|encre de chine|huile|acrylique)\b[^.;]{0,40}?\bsur papier\b/i;

/** (wave 5) a title naming the suite / series / portfolio the sheet comes from */
const FROM_SET_TITLE_RE = /,\s*from\s+(?!the\s+(?:collection|estate|property)|a\s+private|an?\s+important)(?:the\s+)?[A-Z'"«“]|\(from (?:the )?[^)]*\b(?:series|portfolio|suite)\)/;
const artText = (l: ClassifyLot) => `${l.title || ''} | ${l.medium || ''} | ${(l.description || '').slice(0, 600)}`;

/** (wave 2) class 10 · ceramics / sculpture with no medium text: a Picasso
 *  Madoura form noun ("Oiseau au ver ashtray", "Visage No. 202", "Plaque Profil
 *  de Jacqueline", "Service poisson, bol H", "visage brun/bleu (alain ramié 2)"),
 *  a repoussé silver plate, a bronze cast, a KAWS vinyl / chrome figure */
const PICASSO_CERAMIC_RE = /\b(?:plates?|plat|assiette|pitchers?|pichet|cruchon|chope|gobelet|vases?|bowls?|bol|coupelle|ashtray|cendrier|plaques?|tiles?|carreaux?|dish|service poisson|tripode|pignate|jug|visage no\.?\s*\d+|alain rami[ée])\b/i;
// (wave 5) + Calder's mobiles / stabiles and the sheet / painted metal of
// Calder's and Haring's standing works ("Sheet metal, wire, and paint",
// "painted aluminum") — the 'unknown' pile held them
const SCULPT_RE = /repouss|\b(?:bronze|patina|foundry|fonderie|cast (?:in|by)|lost[- ]wax|sculpture|marble|painted steel|stainless steel|chrome[- ]coated|resin|(?:standing |hanging )?mobile|stabile|sheet metal|painted (?:metal|aluminu?m|aluminium)|welded)\b/i;
const KAWS_FIGURE_RE = /\d00%|\b(?:companion|bff|chum|accomplice|dissected|small lie|together|time off|kubrick|be@?rbrick|bearbrick|pinocchio|vinyl|holiday|what party|clean slate|along the way|good intentions|passing through|resting place|gone|seeing|watching|share|take|figures?|plush)\b/i;
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
/** (wave 4) a PRINT catalogue raisonné citation: Bloch / Baer / Mourlot /
 *  Duthuit / Cramer / Czwiklitzer / Corlett / Feldman & Schellmann numbers
 *  ("(B. 152; Ba. 304)", "(Bl. 1561, Ba. 1577)", "(D. 515)", "(M. 129)",
 *  "(C. 127)") and the Picasso print suites (Vollard, 347, 156) */
const PRINT_CAT_WORD_RE = /\b(?:bloch|baer|mourlot|duthuit|cramer|czwiklitzer|corlett|geiser|feldman)\s*(?:no\.?\s*)?\d+|\bs[ée]rie (?:347|156)\b|\bsuite (?:vollard|347|156)\b|\bf\.?\s*(?:&|and)\s*s\.?\s*[ivx]+/i;
/** the initials form is case-sensitive: "(B. 152; Ba. 304)", "(Bl. 1561, Ba. 1577)", "(D. 515)", "(C. 127)" — a lone 4-digit "(B. 1977)" is a birth year */
const PRINT_CAT_INIT_RE = /\((?:[^()]*[;,]\s*)?(?:(?:B|Bl|Ba)\.\s*(?:\d{1,3}\b|\d{4}\s*[;,])|(?:M|D|C|G)\.\s*\d{1,3}\b)/;
/** (wave 5) a print SUITE's plate reference ("plate 141 from Série 156", "pl.
 *  12", "from the Série 347") and the spelled-out Feldman & Schellmann cite
 *  ("(feldman & schellmann ii.251)") — "plate" alone is also a Madoura form
 *  noun, so without this the Picasso ceramic-noun rule filed the Série 156
 *  etchings as sculpture and the sculpture branch filed them back as prints on
 *  their Bloch number, flipping on every normalize run. 1–3 digits: "plate,
 *  1956" is a dated ceramic plate. */
const PLATE_REF_RE = /\b(?:plates?|pl\.)\s*(?:no\.?\s*)?(?:\d{1,3}|[ivxlc]{1,6})(?![\w½¼¾⅛⅜⅝⅞⅓⅔/]|[.,]\d|\s*(?:cm|mm|in\b|inch|")|\s+\d+\/\d)|\bfrom (?:the )?s[ée]rie\b|\bfeldman\s*(?:&|and)\s*schellmann\b|\bf\.?\s*&\s*s\.?\s*(?:[ivx]+|\d)/i;
const PRINT_CAT_REF_RE = { test: (x: string): boolean => PRINT_CAT_WORD_RE.test(x) || PRINT_CAT_INIT_RE.test(x) || PLATE_REF_RE.test(x) };
/** (wave 5) a photographic process named in the medium / object line */
const PHOTO_PROCESS_RE = /\b(?:gelatin silver|silver gelatin|polaroid|chromogenic|c-print|dye[- ]transfer|cibachrome|type[- ]c print|platinum print|palladium print)\b/i;
/** (wave 5) unicode / mixed fractions in a size line → a number */
function sizeNum(x: string): number {
  const F: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅓': 0.333, '⅔': 0.667 };
  let v = 0;
  const m = x.match(/(\d+(?:[.,]\d+)?)?(?:\s+(\d+)\/(\d+))?\s*([½¼¾⅛⅜⅝⅞⅓⅔])?/);
  if (!m) return NaN;
  if (m[1]) v += parseFloat(m[1].replace(',', '.'));
  if (m[2]) v += +m[2] / +m[3];
  if (m[4]) v += F[m[4]];
  return v || NaN;
}
const SZ = String.raw`(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?[½¼¾⅛⅜⅝⅞⅓⅔]?|[½¼¾⅛⅜⅝⅞⅓⅔])`;
const UNIT_CM: Record<string, number> = { cm: 1, mm: 0.1, in: 2.54, '"': 2.54 };
/** (wave 5) an OBJECT's depth / diameter in cm read off its size line, and
 *  whether it was labelled ("10 d", "17¼ dia", "diameter 33cm") or only the
 *  third of three measures ("63.5 x 40 x 36.8cm", "495 by 450 by 345 mm").
 *  A frame's depth is never an object's: a line naming a frame reads null. */
export function objectDepthCm(text: string): { cm: number; labelled: boolean } | null {
  const t = String(text || '');
  if (!t || /\bfram(?:e|ed|ing)\b|\bencadr/i.test(t)) return null;
  let best: { cm: number; labelled: boolean } | null = null;
  const take = (cm: number, labelled: boolean) => { if (cm > 0 && cm < 2000 && (!best || cm > best.cm)) best = { cm, labelled }; };
  // Wright / Rago: "28½ h × 14 w × 10 d in (72 × 36 × 25 cm)", "4¾ d × 10⅜ dia in"
  const wr = t.match(new RegExp(String.raw`((?:${SZ}\s*(?:h|w|d|dia|l)\s*[×x]\s*)*${SZ}\s*(?:h|w|d|dia|l))\s*(in|cm)\b`, 'i'));
  if (wr) {
    const unit = UNIT_CM[wr[wr.length - 1].toLowerCase()];
    for (const part of wr[1].split(/\s*[×x]\s*/)) {
      const pm = part.match(/^(.*?)\s*(h|w|d|dia|l)$/i);
      if (pm && /^(?:d|dia)$/i.test(pm[2])) take(sizeNum(pm[1]) * unit, true);
    }
  }
  // "diameter 13in (33cm)", "Diam. 30 cm"
  const dia = t.match(new RegExp(String.raw`\b(?:diameter|diam\.?|dia\.)\s*:?\s*${SZ}\s*(cm|mm|in\b|")`, 'i'));
  if (dia) take(sizeNum(dia[1]) * UNIT_CM[dia[2].toLowerCase()], true);
  // three measures: the third is the depth
  const tri = new RegExp(String.raw`${SZ}\s*(?:x|×|by)\s*${SZ}\s*(?:x|×|by)\s*${SZ}\s*(cm|mm|in\b|")`, 'gi');
  for (let m: RegExpExecArray | null; (m = tri.exec(t));) take(sizeNum(m[3]) * UNIT_CM[m[4].toLowerCase()], false);
  return best;
}
/** a ceramic OBJECT's own medium line (a "céramique" exhibition poster is a print) */
const CERAMIC_OBJECT_RE = /madoura|earthenware|fa[iï]ence|terre cuite|terracotta|glazed|engobe|stoneware|porcelain|white clay|\bclay\b|empreinte originale|turned (?:vase|pitcher)/i;
export function artCategoryFix(l: ClassifyLot): string | null {
  if (!ART_MAKERS.has(l.artist)) return null;
  const cat = l.category || 'unknown';
  // (wave 3) an estate / foundation INVENTORY number ("numbered '221.032'", "A117.962") is not an edition
  const s = artText(l).replace(ESTATE_NO_RE, " ");
  const tm = `${l.title || ''} | ${l.medium || ''}`;
  const sale = String(l.saleName || '');
  const printWord = ART_PRINT_WORD_RE.test(s);
  // (wave 2) a "knife engraving" / "engraved" decoration on a ceramic is not a print
  const strongPrint = /poster|affiche|lithograph|linocut|linogravure|etching|aquatint|screen ?print|serigraph|woodcut|drypoint|offset/i.test(s);
  // (wave 4) a print catalogue number is print evidence before any ceramic or
  // sculpture word ("Sculpteur, Modèle et Sculpture assise, from La Suite
  // Vollard (B. 146; Ba. 297)", "exposition céramique vallauris (bloch 1286)")
  const catRef = PRINT_CAT_REF_RE.test(tm) || PRINT_CAT_REF_RE.test(s);
  // (wave 5) a photographic process on the medium / object line is a
  // photograph (Warhol's Polaroids and gelatin silver prints sat in prints);
  // a Feldman & Schellmann-numbered "photograph" is a screenprint
  const photoProcess = PHOTO_PROCESS_RE.test(`${tm} | ${(l.description || '').slice(0, 300)}`);
  if (cat === 'photograph') return catRef && !photoProcess ? 'print' : null;
  if (photoProcess && cat !== 'sculpture' && !strongPrint && !UNIQUE_MEDIUM_RE.test(s)) return 'photograph';
  // (wave 5) an object's depth / diameter: a print or drawing has none. 8 cm
  // clears a deep frame or a stretcher; a Picasso Madoura plate or plaque is
  // shallow, so his labelled depth / diameter counts from 3 cm (Wright's
  // "Tête", ¾ h × 12 dia in, sat in prints)
  const dep = objectDepthCm(`${l.dimensions || ''} | ${l.title || ''} | ${l.medium || ''}`);
  const deep = !!dep && (dep.cm >= 8 || (l.artist === 'pablo-picasso' && dep.labelled && dep.cm >= 3));
  const ceramicObject = CERAMIC_OBJECT_RE.test(s) || (l.artist === 'pablo-picasso' && (RAMIE_NO_RE.test(tm) || /alain rami[ée]/i.test(tm)));
  if (cat === 'sculpture') {
    // a lithograph / etching filed sculpture off a "Sculpture" / "Figure" title word
    const castMedium = /\b(?:bronze|patina|foundry|fonderie|cast (?:in|by)|lost[- ]wax|marble|painted steel|stainless steel|resin|wood)\b/i.test(String(l.medium || '') + ' ' + String(l.description || '').slice(0, 300).replace(/\bsculpt\w*/gi, ' '));
    return (strongPrint || catRef) && !ceramicObject && !castMedium ? 'print' : null;
  }
  const ceramic = CERAMIC_RE.test(s) || (l.artist === 'pablo-picasso' && (RAMIE_NO_RE.test(tm) || /alain rami[ée]/i.test(tm)));
  if (ceramic && !strongPrint && !(catRef && !ceramicObject)) return 'sculpture';
  // (wave 3) Koons's porcelain / balloon / vase multiples are sculpture ("Puppy (vase)")
  // (wave 4) + polychromed wood / steel / glass / aluminium editions ("Ushering in Banality")
  // (wave 5) + the balloon / Puppy / bust / crystal multiples ("Balloon Dog
  // (Magenta)", "Puppy", "Baccarat Bar Set") — 'unknown' with no medium line
  if (l.artist === 'jeff-koons' && /\b(?:vase|porcelain|inflatable|balloon|puppy|rabbit|bust|crystal|baccarat|stainless|sculpture|figure|polychrom\w*|wood|steel|aluminium|aluminum|glass|plastic|marble|granite|bronze|mirror[- ]polished)\b/i.test(s) && !strongPrint && !catRef && !/skate ?(?:board|deck)/i.test(s)) return 'sculpture';
  // (wave 2) class 10 · ceramic / sculpture forms with no medium text
  // (wave 5) every rule here yields to a print catalogue / plate reference —
  // the sculpture branch above files a catRef lot back to print, so a rule
  // that ignored it flipped the lot on every run
  if (!strongPrint && !UNIQUE_MEDIUM_RE.test(s)) {
    const printRef = catRef || /\b(?:bloch|baer|cramer|mourlot|geiser|\d+ plates|plates? from|from the|suite)\b/i.test(s);
    if (l.artist === 'pablo-picasso' && !printRef && (PICASSO_CERAMIC_RE.test(l.title || '') || (cat === 'design' && !PRINT_EVIDENCE_RE.test(tm)))) return 'sculpture';
    // (a "Landscape Mobile (Study)" is the study for the mobile, not the mobile)
    if (!catRef && SCULPT_RE.test(s) && !/\bon (?:paper|canvas|linen|board)\b/i.test(s)
      && !(/\bstud(?:y|ies)\b/i.test(l.title || '') && !SCULPT_RE.test(s.replace(/\b(?:standing |hanging )?(?:mobile|stabile)s?\b/gi, ' ')))) return 'sculpture';
    // (wave 5) the fabricator's "printed on the underside" is not a print medium
    if (l.artist === 'kaws' && !catRef && KAWS_FIGURE_RE.test(tm) && !/\bon (?:paper|canvas)\b|portfolio|screen ?print|silkscreen|lithograph|serigraph/i.test(s)) return 'sculpture';
    // (wave 5) a measured depth / diameter (KAWS "Bendy", Haring's painted
    // aluminum, Calder's standing works, Picasso's Madoura plates)
    // (a boxed "Package Painting" is still a painting)
    if (deep && !catRef && !/\bon (?:paper|canvas|linen|board|panel)\b|\bsur (?:papier|toile)\b/i.test(s) && !/\bpaintings?\b/i.test(l.title || '')) return 'sculpture';
  }
  if (cat === 'original') return null;
  if ((UNIQUE_MEDIUM_RE.test(s) || FR_PAPER_MEDIUM_RE.test(s)) && !printWord) return 'original';
  // (wave 4) a unique medium whose only "print" word is the artist's dated
  // numbering ("signed, dated and numbered 'Picasso 6.1.54. XII' … brush and
  // pen and India ink on paper") is a drawing
  if (UNIQUE_MEDIUM_RE.test(s) && !strongPrint && !catRef && !/edition of|\b\d{1,3}\s*\/\s*\d{1,4}\b|artist.s proof|\bprint(?:ed|s)?\b|gicl[ée]e|monotype|multiple|pochoir|photogravure|portfolio|\bplates?\b/i.test(s)) return 'original';
  // (wave 4) an unknown-category lot with a printmaking medium line ("aquatint
  // in grey, 1992, on wove paper") is a print
  // (wave 5) + a design-stamped lot the same way (the last rule sends it to
  // 'unknown', and the next run would read it again)
  const unknownish = cat === 'unknown' || cat === 'design';
  if (unknownish && (strongPrint || catRef) && !UNIQUE_MEDIUM_RE.test(s)) return 'print';
  // (wave 5) the 'unknown' pile's edition evidence: a sheet "from" a named
  // suite / series / portfolio ("Nude Reading, from the Nude Series", "Right
  // panel, from Triptych 1991"), a portfolio, a gallery mailer, a multiple,
  // and a Phillips EDITIONS sale (department 030 in the sale code)
  if (unknownish && !UNIQUE_MEDIUM_RE.test(s) && !FR_PAPER_MEDIUM_RE.test(s)
    && (FROM_SET_TITLE_RE.test(l.title || '') || /\bportfolio\b|\bmailer\b|\bmultiple\b/i.test(s) || /^phillips-[a-z]{2}030/i.test(String(l.id || '')))) return 'print';
  // (wave 3) a work on CANVAS / linen with no edition is a painting —
  // Warhol's "silkscreen ink, acrylic and ballpoint pen on linen", "encres
  // sérigraphiques sur toile", "screenprint ink, and diamond dust on canvas"
  if ((/\bon (?:canvas|linen)\b|\bsur toile\b/i.test(s) || FR_UNIQUE_MEDIUM_RE.test(s)) && !EDITION_MARK_RE.test(s.replace(/\b\d{1,3}\s+\d{1,2}\s*\/\s*\d{1,2}\b/g, " "))
    && !/gicl[ée]e|offset|lithograph|poster|reproduction|print(?:ed)? on canvas|canvas board print/i.test(s)) return 'original';
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
// (wave 3) 5 · SPORTS MISROUTES (Oct 6 re-audit #2, ~40k rows)
//  (a) Goldin's item-type facet filed graded "… Rookie Ticket … #138 … Rookie
//      Card – PSA 9" CARDS as tickets, and the facet fix then evicted them on
//      "Gold Vinyl" (a parallel name) — a numbered, slabbed card title is a card;
//  (b) a "Game Used Football … Notable Play … TD Pass" filed as a ticket;
//  (c) a president's / celebrity's autograph on a sports slug ("Dwight D.
//      Eisenhower Signed Typed Letter", "Billy Joel Signed Baseball", "Michelle
//      Obama Baseball") is a culture lot when no athlete is named.
// ═══════════════════════════════════════════════════════════════════════════
export function goldinObjectIsCard(l: ClassifyLot): string | null {
  if (l.auctionHouse !== 'Goldin' || !NON_CARD_SPORTS_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  return CARD_NO_RE.test(t) && SLAB_GRADE_RE.test(t) && /\bcards?\b/i.test(t) && isCardTitle(t) ? 'sports-cards' : null;
}
export function signedObjectNotAward(l: ClassifyLot): string | null {
  return l.artist === 'trophies-awards' && isSignedRetailObject(String(l.title || '')) ? 'autographs' : null;
}
export function ticketIsGameUsed(l: ClassifyLot): string | null {
  if (l.artist !== 'tickets-passes') return null;
  const t = String(l.title || '');
  return GAME_USED_RE.test(t) && !/\b(?:tickets?|stubs?|credentials?)\b/i.test(t) ? 'game-used' : null;
}
// (wave 4) + the film / TV / music names the sports houses sell (a James
// Stewart signed photo, a John Wayne first day cover, a Charlie Sheen custom
// jersey, an Elvis concert ticket) — and Goldin, and the photo / ticket /
// game-used slugs. A HOF player's "Presidential Luncheon Invitation" stays
// sports (lotg-19041): "(HOF)" and a quoted nickname no longer hide the athlete.
const NON_ATHLETE_PERSON_RE = /\b(?:president(?:ial)?|first lady|vice president|obama|trump|biden|eisenhower|truman|kennedy|nixon|reagan|clinton|roosevelt|political|politicians?|coolidge|hoover|lincoln|sinatra|elvis|beatles|billy joel|orville wright|wright brothers|marilyn monroe|james stewart|jimmy stewart|john wayne|clint eastwood|bob hope|bing crosby|charlie sheen|marlon brando|humphrey bogart|james dean|charlie chaplin|walt disney|audrey hepburn|cary grant|gary cooper|clark gable|bette davis|shirley temple|tom hanks|kevin costner|bill murray|billy crystal|jack nicholson|will ferrell|adam sandler)\b/i;
const NON_ATHLETE_HOUSES = new Set(['RR Auction', 'Goldin', ...Array.from(SPORTS_EXPANSION_HOUSES)]);
const NON_ATHLETE_SLUGS = new Set(['autographs', 'sports-memorabilia', 'memorabilia', 'type-1-photos', 'tickets-passes', 'game-used']);
export function nonAthleteAutograph(l: ClassifyLot): string | null {
  if (!NON_ATHLETE_HOUSES.has(l.auctionHouse || '') || !NON_ATHLETE_SLUGS.has(l.artist)) return null;
  // Goldin's own sports facets keep their old slugs unless the facet fix moved them
  if (l.auctionHouse === 'Goldin' && (l.artist === 'game-used' || l.artist === 'tickets-passes') && !SIGNED_RE.test(String(l.title || ''))) return null;
  const t = String(l.title || '');
  if (!NON_ATHLETE_PERSON_RE.test(t) || athleteIn(t) || /\b(?:team|yankees|dodgers|red sox|giants|world series|all[- ]star|hall of fame|hof|hofers?|first pitch|opening day|stadium|ballpark|babe ruth|ruth|dimaggio|mantle|gehrig)\b/i.test(t) || PRO_TEAM_RE.test(t)) return null;
  return cultureHome(t);
}

// ═══════════════════════════════════════════════════════════════════════════
// (wave 3) 6 · CULTURE LEAKS — (a) a NASA / Apollo / astronaut photo or piece
// filed in culture is a space lot (207 space-titled culture rows); (b) RR's
// category-prefixed sports titles ("Horse Racing: Cauthen, Steve") are athlete
// autographs; (c) Hake's campaign buttons / pins (any year, unsigned — the
// re-audit dropped jugates too), toy accessory sets, and magazine runs
// ("Beatles Monthly") are mass items.
// ═══════════════════════════════════════════════════════════════════════════
const SPACE_STRONG_RE = /\b(?:hubble )?space telescope\b|\bnasa\b|\bapollo \d|\bastronauts?\b|\bcosmonauts?\b|\bspace shuttle\b|\bskylab\b|\bgemini \d|\bmercury[- ]\d|\bmoon ?walk|\blunar (?:module|surface|landing)\b|\bbuzz aldrin\b|\bneil armstrong\b/i;
const SPACE_FICTION_RE = /\b(?:movie|film|screen[- ](?:used|worn)|production|props?|costume|replica|toy|model kit|star trek|star wars|cufflinks?|watch)\b/i;
/** (wave 4) class 7 · the ASTRONAUTS an autograph house titles by bare name
 *  ("Jim Irwin Signed Photograph", "Edgar Mitchell Publication", "Sally Ride
 *  Group Lot") — an astronaut's signed piece is a space lot (the hand labels
 *  file every one in space-exploration); ~2k sat in culture. Names shared with
 *  famous non-astronauts (Michael Collins, John Young, David Scott, Ed White)
 *  need a space word beside them. */
const ASTRONAUT_RE = /\b(?:neil (?:a\. )?armstrong|buzz aldrin|edwin (?:e\. )?(?:"buzz" )?aldrin|alan (?:b\. )?shepard|john (?:h\. )?glenn|gus grissom|virgil (?:i\. )?(?:"gus" )?grissom|scott carpenter|wally schirra|walter (?:m\. )?schirra|gordon cooper|l\. gordon cooper|deke slayton|donald (?:k\. )?(?:"deke" )?slayton|pete conrad|charles (?:"pete" )?conrad|alan (?:l\. )?bean|jim lovell|james (?:a\. )?lovell|frank borman|bill anders|william (?:a\. )?anders|gene cernan|eugene (?:a\. )?cernan|harrison (?:h\. )?(?:"jack" )?schmitt|charlie duke|charles (?:m\. )?duke|edgar (?:d\. )?mitchell|stuart (?:a\. )?roosa|jim irwin|james (?:b\. )?irwin|al worden|alfred (?:m\. )?worden|rusty schweickart|russell (?:l\. )?schweickart|fred (?:w\. )?haise|jack swigert|john (?:l\. )?swigert|ken mattingly|thomas (?:k\. )?mattingly|ron(?:ald)? evans|roger (?:b\. )?chaffee|tom stafford|thomas (?:p\. )?stafford|walt(?:er)? cunningham|donn eisele|jim mcdivitt|james (?:a\. )?mcdivitt|dick gordon|sally (?:k\. )?ride|christa mcauliffe|judith resnik|yuri gagarin|valentina tereshkova|alexei leonov|gherman titov|story musgrave|eileen collins|mae jemison|guion bluford|bruce mccandless|owen garriott|jack lousma|joe engle|sergei krikalev|chris hadfield|wernher von braun|gene kranz|chris(?:topher)? kraft|elliot see|charles bassett|ed mitchell)\b/i;
const ASTRONAUT_AMBIG_RE = /\b(?:michael collins|john (?:w\. )?young|dave scott|david (?:r\. )?scott|ed(?:ward)? (?:h\. )?white(?: ii)?|scott kelly|mark kelly)\b/i;
const SPACE_CONTEXT_RE = /\b(?:apollo|gemini|mercury|nasa|space|astronauts?|moon|lunar|flown|mission|shuttle|orbit\w*|launch|skylab|eva|rocket)\b/i;
const SPACE_FLOWN_RE = /\b(?:eva|expedition \d+|sts-\d+|space station|beta cloth|robbins medallion|soyuz|mir)\b[^.]{0,40}\bflown\b|\bflown\b[^.]{0,40}\b(?:eva|beta cloth|robbins|space|shuttle|soyuz|mir|iss)\b/i;
const SCIENTIST_NAMES = String.raw`albert einstein|isaac newton|charles (?:robert )?darwin|marie (?:sk[lł]odowska[- ])?curie|pierre curie|nikola tesla|thomas (?:a\.|alva )?\s?edison|galileo galilei|johannes kepler|michael faraday|niels bohr|(?:j\. )?robert oppenheimer|richard (?:p\. )?feynman|stephen hawking|max planck|werner heisenberg|erwin schr[oö]dinger|enrico fermi|john von neumann|guglielmo marconi|louis pasteur|sigmund freud|edwin (?:p\. )?hubble|carl sagan|francis crick|ernest rutherford|paul (?:a\. ?m\. )?dirac|wolfgang pauli|robert (?:a\. )?millikan|arthur (?:h\. )?compton|albert (?:a\. )?michelson|wilhelm (?:conrad )?r[oö]ntgen|(?:antoine-)?henri becquerel|leo szilard|edward teller|jonas salk|albert (?:b\. )?sabin|alexander fleming|linus pauling|max born|otto hahn|lise meitner|james clerk maxwell|alexander graham bell|samuel (?:f\. ?b\. )?morse|hans bethe|murray gell-mann|glenn (?:t\. )?seaborg|ernest (?:o\. )?lawrence|harold urey|rosalind franklin|ada lovelace|charles babbage|alan turing|steve jobs|steve wozniak|bill gates`;
const SCIENTIST_SURNAME_FIRST = 'einstein|newton|darwin|curie|tesla|edison|faraday|bohr|oppenheimer|feynman|hawking|planck|heisenberg|schr[oö]dinger|fermi|marconi|pasteur|freud|hubble|sagan|crick|dirac|pauli|millikan|r[oö]ntgen|becquerel|szilard|teller|salk|sabin|fleming|pauling|meitner|maxwell|bethe|seaborg|urey|turing|babbage';
/** a scientist LEADS the title: "Max Planck: …", "Guglielmo Marconi Signed …", "BECQUEREL, Antoine-Henri (1852-1908)." */
const SCIENTIST_LEAD_RE = new RegExp(String.raw`^\s*(?:(?:dr\.|sir|professor|prof\.)\s+)?(?:${SCIENTIST_NAMES})\b|^\s*(?:${SCIENTIST_SURNAME_FIRST}),\s+[^()]{2,40}\(\s*(?:b\.\s*)?1[5-9]\d\d`, 'i');
export function isSpaceLeadTitle(t: string, sale = ''): boolean {
  if (SPACE_FICTION_RE.test(t)) return false;
  if (SPACE_STRONG_RE.test(t) || SPACE_FLOWN_RE.test(t) || ASTRONAUT_RE.test(t)) return true;
  return ASTRONAUT_AMBIG_RE.test(t) && (SPACE_CONTEXT_RE.test(t) || /\bspace\b/i.test(sale));
}
export function cultureLeakFix(l: ClassifyLot): string | null {
  if (!CULTURE_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  if (isSpaceLeadTitle(t, String(l.saleName || ''))) return 'space-exploration';
  // (wave 4) a SCIENTIST's piece leading the title ("Max Planck: To a fellow
  // Nobel laureate", "Guglielmo Marconi Signed Photograph", "BECQUEREL,
  // Antoine-Henri (1852-1908). Autograph manuscript …") is science-tech; the
  // aviators (Orville Wright, Earhart) stay the historic catch-all
  if (SCIENTIST_LEAD_RE.test(t) && !SPACE_FICTION_RE.test(t)) return 'science-tech';
  if (l.auctionHouse === 'RR Auction' && /^\s*(?:horse racing|auto racing|racing|boxing|baseball|football|basketball|golf|tennis|hockey|olympics?|wrestling|soccer)\s*:/i.test(t)) return 'autographs';
  const signed = SIGNED_RE.test(t);
  // the wave-2 button doctrine (a 1920+ or slogan / staff piece is mass; a
  // classic jugate or an early portrait button stays) extended to pins / badges
  if (l.auctionHouse === "Hake's" && !signed && /\b(?:buttons?|pinbacks?|pins?|badges?|tokens?|ribbons?)\b/i.test(t)
    && !/\b(?:original art|prototype|unique|ferrotype|banners?|flags?|posters?|classic|jugate|portrait|rare)\b/i.test(t)) {
    const yr = +((t.match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1] || 0);
    if (yr >= 1920 || (!yr && /\b(?:staff|slogan|litho|cartoon|member'?s|union|labor|club)\b/i.test(t))) return DROP;
  }
  if (l.auctionHouse === "Hake's" && !signed && /\b(?:accessory sets?|accessories|dolls?|games?|puzzles?|figures?|premiums?|decoder|rings?)\b/i.test(t) && /\(\d{4}\)/.test(t)) return DROP;
  // a magazine RUN / lot is mass; a star's own magazines, a garment from a
  // magazine shoot or a magazine's original art are not
  if (!signed && l.auctionHouse !== 'RR Auction' && /\b(?:magazines|fanzines|newsletters)\b|\bmonthly\b(?=\s*(?:book|magazine|issues?|no\.?|[-–]\s*a complete run|\(|$))/i.test(t)
    && !/\b(?:original art|cover art|artwork|photograph|worn|owned|personal(?:ly)?|library|jacket|blouse|dress|gown|collection of|film magazines?|camera)\b|[A-Za-z]['’]s\b/i.test(t)) return DROP;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// (wave 4) 9 · SPORTS KIND (re-audit #3, ~28k rows)
//  (a) a BRANDED, NUMBERED, graded / serial card filed as an object
//      ("2003 Fleer Avant Football #AGW/50 Tom Brady Game-Worn Jersey … SGC",
//      "1995 Fleer Award Winners #1 Frank Thomas - PSA MINT 9" in trophies);
//  (b) a signed DISPLAY, a signed (plaque) POSTCARD, a single signed card with
//      no set / number / year ("Ronald Acuna Jr. Signed Trading Card") is an
//      autograph, not a card / equipment / award;
//  (c) a PENNANT is memorabilia, not a publication (909 in programs).
// ═══════════════════════════════════════════════════════════════════════════
const OBJECT_SPORT_SLUGS = new Set(['game-used', 'trophies-awards', 'tickets-passes', 'memorabilia', 'sports-memorabilia', 'autographs', 'equipment-artifacts', 'type-1-photos', 'programs-publications']);
const SERIAL_NO_RE = /#\s?[A-Za-z0-9-]*\d\s*\/\s*\d{1,4}\b|\(\s*#?\s*\d{1,4}\s*\/\s*\d{1,4}\s*\)|\b\d{1,4}\s*\/\s*\d{1,4}\b/;
const GRADER_WORD_RE = /\b(?:psa|bgs|sgc|cgc|bvg|beckett)\b(?!\s*\/\s*dna)/i;
export function brandedNumberedCard(l: ClassifyLot): string | null {
  if (!OBJECT_SPORT_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  if (SEALED_RE.test(t) || !YEAR_LEAD_RE.test(t) || !CARD_BRAND_RE.test(t) || !CARD_NO_RE.test(t)) return null;
  if (!(SLAB_GRADE_RE.test(t) || GRADER_WORD_RE.test(t) || SERIAL_NO_RE.test(t))) return null;
  // a graded ticket / magazine / program keeps its kind ("Sports Illustrated … #1 … CGC 9.4")
  if ((NOT_A_CARD_OBJECT_RE.test(t) && !/\brookie tickets?\b|\bcontenders\b/i.test(t)) || (PUBLICATION_RE.test(t) && !/\bcards?\b/i.test(t))) return null;
  // a photo USED for a card, a framed collage / display, a signed ball: the object
  if (PHOTO_FOR_CARD_RE.test(t) || (/\b(?:framed|collage|display|plaque|lithograph|photo(?:graph)?|(?:signed|autographed|official) (?:base|foot|basket)?ball|helmet|bat)\b/i.test(t) && !/\bcards?\b/i.test(t))) return null;
  return SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '') ? 'graded-cards' : 'sports-cards';
}
const SIGNED_DISPLAY_RE = /\b(?:signed|autographed)\b[^.]{0,60}\bdisplays?\b|\bdisplays?\b[^.]{0,30}\b(?:signed|autographed)\b/i;
const SIGNED_POSTCARD_RE = /\b(?:signed|autographed)\b[^.]{0,60}\b(?:plaque )?post ?cards?\b|\b(?:plaque )?post ?cards?\b[^.]{0,30}\b(?:signed|autographed)\b/i;
const SINGLE_SIGNED_CARD_RE = /\b(?:signed|autographed)(?:,? inscribed)? (?:trading |index |3x5 |3 x 5 |government )?cards?\b/i;
export function signedFlatAutograph(l: ClassifyLot): string | null {
  const a = l.artist;
  if (!SPORTS_SLUGS.has(a) || a === 'autographs' || a === 'game-used' || a === 'unopened-wax' || a === 'programs-publications') return null;
  const t = String(l.title || '');
  if (!SIGNED_RE.test(t) || GAME_USED_RE.test(t) || CARD_NO_RE.test(t) || leadsWithSetCode(t)) return null;
  const branded = CARD_BRAND_RE.test(t) || /perez[- ]steele|goal line art|exhibits?\b/i.test(t);
  if (SIGNED_DISPLAY_RE.test(t) && !branded) return 'autographs';
  if (SIGNED_POSTCARD_RE.test(t) && !/perez[- ]steele|\bsets?\b/i.test(t)) return 'autographs';
  if (SINGLE_SIGNED_CARD_RE.test(t) && !branded && !YEAR_LEAD_RE.test(t) && !/\(\d+\)|\blots?\b|\bcollections?\b|\bsets?\b|\bgroup\b/i.test(t)) return 'autographs';
  return null;
}
/** (wave 4) a CARD lot of which some are signed ("90s Baseball Hall of
 *  Famers Card Collection (24) Including (10) Signed Cards", "(10) … Cards -
 *  Featuring 7 Signed") is a card lot, not an autograph */
export function signedSubsetCardLot(l: ClassifyLot): string | null {
  if (l.artist !== 'autographs') return null;
  const t = String(l.title || '');
  if (!/\bcards?\b/i.test(t) || !/\b(?:including|featuring|with)\s*\(?\d+\)?\s*(?:signed|autographed|autographs?)\b/i.test(t)) return null;
  if (!/\bcards?\s+(?:collection|lot|group)\b|\b(?:collection|lot|group)\s*\(\d+\)|\(\d+\)[^.]{0,40}\bcards\b/i.test(t)) return null;
  return SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '') ? 'graded-cards' : 'sports-cards';
}
export function pennantNotProgram(l: ClassifyLot): string | null {
  if (l.artist !== 'programs-publications') return null;
  const t = String(l.title || '');
  const p = t.search(/\bpennants?\b/i);
  if (p < 0) return null;
  const pub = t.search(PUBLICATION_RE);
  if (pub >= 0 && pub < p) return null;
  return SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '') ? 'memorabilia' : 'sports-memorabilia';
}
/** (wave 4) class 3 · an ATHLETE's piece in culture: game-worn / game-used
 *  with sport evidence ("SPARKY ANDERSON DETROIT TIGERS GAME WORN UNIFORM"),
 *  an athlete-signed ball / bat / jersey / helmet, or (RR) a bare team name
 *  ("Boston Red Sox", "1927 New York Yankees") — RR titles a team-signed piece
 *  by the team. */
const PRO_TEAM_RE = /\b(?:redskins|commanders|broncos|raiders|chargers|seahawks|vikings|falcons|buccaneers|patriots|dolphins|ravens|bengals|texans|jaguars|astros|mariners|padres|rockies|marlins|expos|brewers|nets|spurs|nuggets|pistons|cavaliers|mavericks|penguins|flyers|islanders|sabres|oilers|canucks)\b/i;
const TEAM_NAME_RE = /\b(?:yankees|red sox|white sox|dodgers|giants|cubs|cardinals|tigers|pirates|athletics|senators|browns|braves|reds|phillies|orioles|indians|mets|packers|bears|colts|steelers|cowboys|49ers|raiders|celtics|lakers|bulls|knicks|canadiens|maple leafs|bruins|red wings|blackhawks)\b/i;
const BARE_TEAM_RE = /^\s*(?:(?:18|19|20)\d\d(?:-\d{2,4})?\s+)?(?:(?:new york|ny|n\.y\.|boston|brooklyn|chicago|st\.? louis|detroit|pittsburgh|philadelphia|cleveland|cincinnati|washington|baltimore|milwaukee|los angeles|la|san francisco|green bay|oakland|kansas city|montreal|toronto)\s+)?(?:yankees|red sox|white sox|dodgers|giants|cubs|cardinals|tigers|pirates|athletics|a'?s|senators|browns|braves|reds|phillies|orioles|indians|mets|packers|bears|colts|steelers|cowboys|49ers|raiders|celtics|lakers|bulls|knicks|canadiens|maple leafs|bruins|red wings|blackhawks)(?:\s+(?:team|team-signed|signed|autographs?|lot|group lot))*\s*$/i;
const ATHLETE_OBJECT_RE = /\b(?:baseballs?|footballs?|basketballs?|hockey pucks?|pucks?|bats?|helmets?|mini[- ]helmets?|jerseys?|uniforms?|gloves?|boxing gloves?|golf balls?)\b/i;
export function cultureAthleteToSports(l: ClassifyLot): string | null {
  if (!CULTURE_SLUGS.has(l.artist) || ENTERTAINMENT_HOUSES.has(l.auctionHouse || '')) return null;
  const t = String(l.title || '');
  if (SPACE_FICTION_RE.test(t) || /\b(?:film|movie|tv series|television|screen[- ]used|stage[- ]worn|costume)\b/i.test(t)) return null;
  const athlete = !!athleteIn(t);
  // a president's / celebrity's piece stays culture (a JFK-signed ball)
  if (!athlete && NON_ATHLETE_PERSON_RE.test(t)) return null;
  if (GAME_USED_RE.test(t) && (athlete || SPORT_STRONG_RE.test(t) || TEAM_NAME_RE.test(t))) return routeSportsLot(t, '') ?? 'game-used';
  if (SIGNED_RE.test(t) && ATHLETE_OBJECT_RE.test(t) && (athlete || TEAM_NAME_RE.test(t)) && !NON_ATHLETE_PERSON_RE.test(t)) return 'autographs';
  if (l.auctionHouse === 'RR Auction' && BARE_TEAM_RE.test(t)) return 'autographs';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// (wave 4) 8 · CULTURE SUB-SLUG — a screen-used prop or a film costume filed
// under the historic catch-all (or under 'pop-memorabilia', the SPORTS houses'
// pop slug, at Julien's / Propstore) is a movie-tv lot; a stage-worn /
// stage-played piece a music lot. Propstore sells only production material.
// The film / music context may come from the sale ("Icons & Idols Hollywood").
// ═══════════════════════════════════════════════════════════════════════════
const FILM_OBJECT_RE = /\b(?:costumes?|props?|wardrobe|maquettes?|animatronics?|stunt|hero|screen[- ](?:used|worn|matched)|production[- ](?:used|made))\b/i;
const FILM_CONTEXT_RE = /\b(?:film|films|movie|movies|motion picture|tv series|television|sitcom|episode|hollywood)\b|\((?:19|20)\d\d\)/i;
const STAGE_RE = /\b(?:stage|tour|concert|performance)[- ](?:worn|played|used)\b|\b(?:worn|played) on stage\b|\bstudio[- ](?:played|used)\b/i;
const MUSIC_OBJECT_RE = /\b(?:guitars?|bass|drums?|drumheads?|drum ?sticks?|keyboards?|amplifiers?|microphones?|stage costumes?|stage outfits?)\b/i;
const MUSIC_SALE_RE = /\bmusic\b|\brock\b|\broll\b|\bguitars?\b/i;
export function cultureSubSlugFix(l: ClassifyLot): string | null {
  const a = l.artist;
  if (!CULTURE_SLUGS.has(a) || a === 'movie-tv' || a === 'music-memorabilia') return null;
  const house = l.auctionHouse || '';
  // 'pop-memorabilia' is the sports houses' own slug — only re-homed at the entertainment houses
  if (a === 'pop-memorabilia' && !ENTERTAINMENT_HOUSES.has(house)) return null;
  if (house === 'Propstore') return 'movie-tv';
  const t = String(l.title || '');
  const d = String(l.description || '').slice(0, 300).replace(/class="[^"]*"|lot closed[^]*$/i, '');
  const sale = String(l.saleName || '');
  const s = cultureSlugOf(t, d);
  if (s !== 'entertainment-memorabilia') return s;
  if (STAGE_RE.test(t)) return 'music-memorabilia';
  if (FILM_OBJECT_RE.test(t) && (FILM_CONTEXT_RE.test(t) || (/\bhollywood\b|\bfilm\b|\bmovie/i.test(sale) && !MUSIC_SALE_RE.test(sale)))) return 'movie-tv';
  if (MUSIC_OBJECT_RE.test(t) && MUSIC_SALE_RE.test(sale) && !/\bhollywood\b|\bfilm\b/i.test(sale)) return 'music-memorabilia';
  return a === 'pop-memorabilia' ? 'entertainment-memorabilia' : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// (Oct 8 2026 sports audit) — the sports KIND, re-applied to the back-catalogue
//  E2/E3 a TICKET or a PHOTO filed as a trophy ("… MVP World Series Game 5 …
//        Full Ticket", "… Hoists Trophy … Type I Photo");
//  E5   a SIGNED photo is an autograph — unless the photographer signed it
//        (2,199 signed photos sat under Photographs);
//  E6   the Equipment & Other catch-all (memorabilia / sports-memorabilia /
//        equipment-artifacts) gets its object's kind: photos (Type II/III,
//        RPPC, negatives), magazines (Sports Illustrated, Sports Graphic
//        Number, Weekly Baseball, yearbooks), tickets, trophies, autographs;
//  E7   NFL Auction "Game Issued" jerseys / balls and coin-toss coins are
//        game-used (the use language wins there over ticket / autograph);
//  E8   an 'unopened-wax' lot naming no pack / box / case / set ("Three
//        Dozen Unopened Official League Baseballs", "Baseball Card Vending
//        Machine", "1966 Topps Vending Hoard (1,000 Cards)") is not wax.
// ═══════════════════════════════════════════════════════════════════════════
const objectCatchAll = (house: string | null | undefined): 'memorabilia' | 'sports-memorabilia' =>
  SPORTS_EXPANSION_HOUSES.has(house || '') ? 'memorabilia' : 'sports-memorabilia';
export function trophyIsTicketOrPhoto(l: ClassifyLot): string | null {
  if (l.artist !== 'trophies-awards') return null;
  const k = sportsObjectKind(l.title, objectCatchAll(l.auctionHouse));
  return k === 'tickets-passes' || k === 'type-1-photos' || (k === 'autographs' && isPhotoTitle(String(l.title || ''))) ? k : null;
}
export function signedPhotoAutograph(l: ClassifyLot): string | null {
  if (l.artist !== 'type-1-photos') return null;
  const t = String(l.title || '');
  return SIGNED_RE.test(t) && !isPhotographerSigned(t) && !GAME_USED_RE.test(t) ? 'autographs' : null;
}
const CATCH_ALL_OBJECT_SLUGS = new Set(['memorabilia', 'sports-memorabilia', 'equipment-artifacts']);
export function catchAllObjectKind(l: ClassifyLot): string | null {
  if (!CATCH_ALL_OBJECT_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  if (isCardTitle(t)) return null; // the card rules own card titles
  const k = sportsObjectKind(t, 'memorabilia');
  // "Turkish Trophies" is a cigarette brand (S81 silks displays)
  if (k === 'trophies-awards' && /\bturkish trophies\b/i.test(t)) return null;
  return k === 'memorabilia' ? null : k;
}
const COIN_TOSS_RE = /\b(?:coin toss|toss coin|flip coin|coin flip)\b/i;
export function nflGameUsed(l: ClassifyLot): string | null {
  if (l.auctionHouse !== 'NFL Auction' || l.artist === 'game-used' || !SPORTS_SLUGS.has(l.artist)) return null;
  const t = String(l.title || '');
  return GAME_USED_RE.test(t) || COIN_TOSS_RE.test(t) ? 'game-used' : null;
}
export function sealedNotWax(l: ClassifyLot): string | null {
  if (l.artist !== 'unopened-wax') return null;
  const t = String(l.title || '');
  if (SEALED_PRODUCT_RE.test(t) && !SEALED_NOT_RE.test(t)) return null;
  const exp = SPORTS_EXPANSION_HOUSES.has(l.auctionHouse || '');
  // a vending machine is the machine, whatever cards it dispensed
  if (!SEALED_NOT_RE.test(t) && (isCardTitle(t) || (CARD_LOT_RE.test(t) && !CARD_LOT_NOT_RE.test(t)))) return exp ? 'graded-cards' : 'sports-cards';
  return sportsObjectKind(t, objectCatchAll(l.auctionHouse));
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
  // (wave 3) before the facet fix: a slabbed, numbered card is not a ticket
  { cls: 'goldin-object-is-card', apply: goldinObjectIsCard },
  // (wave 4) any house: a branded, numbered, graded / serial card is a card
  { cls: 'branded-numbered-card', apply: brandedNumberedCard },
  { cls: 'goldin-facet-non-sport', apply: goldinNonSportFix },
  { cls: 'ticket-is-game-used', apply: ticketIsGameUsed },
  { cls: 'signed-object-not-award', apply: signedObjectNotAward },
  { cls: 'non-athlete-autograph', apply: nonAthleteAutograph },
  // (Oct 8 sports audit) the sports kind (after the non-athlete gate: a TV Guide lot or JFK medals
  // filed memorabilia leave for culture first) — E7, E8, E2/E3, E5, E6
  { cls: 'nfl-game-issued-is-game-used', apply: nflGameUsed },
  { cls: 'sealed-names-no-product', apply: sealedNotWax },
  { cls: 'trophy-is-ticket-or-photo', apply: trophyIsTicketOrPhoto },
  { cls: 'signed-photo-is-autograph', apply: signedPhotoAutograph },
  { cls: 'catch-all-object-kind', apply: catchAllObjectKind },
  // (wave 4) signed displays / postcards / bare signed cards; pennants
  { cls: 'signed-flat-autograph', apply: signedFlatAutograph },
  { cls: 'pennant-not-program', apply: pennantNotProgram },
  { cls: 'signed-subset-card-lot', apply: signedSubsetCardLot },
  // (wave 4) an athlete's game-used / signed piece in culture is sports
  { cls: 'culture-athlete-to-sports', apply: cultureAthleteToSports },
  { cls: 'watch-jewelry-tudor', apply: watchMakerFix },
  { cls: 'art-design-attribution', apply: attributionFix },
  { cls: 'culture-leaks-space-racing-hakes-magazines', apply: cultureLeakFix },
  { cls: 'culture-mass-leaks', apply: cultureMassFix },
  { cls: 'pokemon-only-tcg', apply: pokemonOnlyFix },
  // (wave 4) last: only a culture lot that survived the mass gates is re-slugged
  { cls: 'culture-sub-slug', apply: cultureSubSlugFix },
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
