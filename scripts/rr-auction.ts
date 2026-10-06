/**
 * rr-auction.ts — per-lot vertical routing for RR Auction.
 *
 * RR Auction is a mixed house: a single catalogue mixes computing/space/
 * science with music, film, presidential/historical, and sports memorabilia.
 * So a lot is NEVER assigned by the house — it is classified by its own
 * subject. Science is a *matched* destination, not a default: anything that
 * doesn't read as science falls through to the pop-culture router (which
 * itself drops mass/graded junk), and only a genuine cultural artifact lands.
 *
 * Precedence (first match wins), mirroring sports-sale.ts / culture.ts:
 *   1. sports        → routeSportsLot (a signed ball is sports, not culture)
 *   2. natural history → meteorites / fossils
 *   3. space         → space-exploration
 *   4. computing/tech + hard-science documents → science-tech
 *   5. scientific instruments → scientific-instruments
 *   6. everything else → routeCulture (film / music / entertainment · historic),
 *                        or null if it's mass/graded and should be dropped
 *
 * Returns the entity slug (an ARTISTS slug) or null to drop the lot. The
 * caller maps slug → market via ARTIST_MARKET, so the vertical always follows
 * the slug and never drifts.
 */

import { routeCulture } from './culture';
import { routeSportsLot } from './sports-sale';
import { athleteIn, ATHLETES } from './lib/athlete-roster';

// ── SPORTS — a signed jersey/ball/photo of an athlete is sports memorabilia.
// Broad athlete/discipline signal; routeSportsLot does the fine routing.
const SPORTS = /\b(baseball|basketball|football\b|nfl|nba|mlb|nhl|hockey|soccer|world cup|olympic|olympics|boxing|heavyweight|wrestling|golf|pga|masters tournament|tennis|wimbledon|nascar|(?<!new )jersey|game[- ]worn|game[- ]used|rookie|babe ruth|mickey mantle|muhammad ali|michael jordan|wayne gretzky|jackie robinson|lou gehrig|pel[eé]\b|jesse owens)\b/i;

// ── NATURAL HISTORY → meteorites / fossils
const METEORITE = /\b(meteorite|meteoritic|pallasite|chondrite|tektite|impactite|lunar meteorite|martian meteorite|widmanst[aä]tten)\b/i;
const FOSSIL = /\b(fossil|fossilized|dinosaur|[a-z]+saurus|tyrannosaur\w*|triceratops|raptor|ammonite|trilobite|megalodon|mammoth|mastodon|amber inclusion|petrified|skeleton|skull cast|prehistoric)\b/i;

// ── SPACE → space-exploration
const SPACE = /\b(nasa|apollo|gemini|skylab|soyuz|sts-\d+|cosmonauts?|astronauts|robbins medals?|moonwalkers?|mercury (?:seven|7)|vostok|voskhod|lunokhod|luna-\d+|spacehab|space station|mir space station|apollo-soyuz|space (?:race|program|exploration)|mercury (program|capsule|mission)|astronaut|cosmonaut|spaceflight|spacecraft|space shuttle|lunar module|moon landing|moonwalk|flown to the moon|flown in space|space[- ]flown|saturn v|rocket engine|mission patch|robbins medal|spacesuit|space suit|neil armstrong|buzz aldrin|john glenn|yuri gagarin|scott carpenter|jim lovell|gus grissom|wally schirra|alan shepard|michael collins)\b/i;

// ── COMPUTING / TECH + hard-science documents → science-tech
const TECH = /\b(apple[- ]?(1|one|iii?\w{0,2})\b|apple computer|apple lisa|macintosh|iphone|ipod|ipad|newton messagepad|steve jobs|steve wozniak|woz\b|bill gates|paul allen|microsoft|altair \d{3,4}\w?|commodore|amiga|atari (computer|800|2600 prototype)|ibm (pc|5150)|xerox parc|alto\b|next ?computer|next cube|circuit board|motherboard|microprocessor|integrated circuit|silicon chip|transistor|vacuum tube computer|punch card|magnetic core|enigma machine|turing|alan turing|ada lovelace|charles babbage|difference engine|prototype (board|computer|phone|device)|patent (model|application|drawing)|blueprint|schematic|first[- ]generation (iphone|ipod)|dev(elopment)? prototype|engineering prototype)\b/i;
const SCI_FIGURE = /\b(albert einstein|einstein|isaac newton|charles darwin|nikola tesla|thomas edison|marie curie|galileo|stephen hawking|richard feynman|niels bohr|robert oppenheimer|watson and crick|dna model|nobel prize in (physics|chemistry|medicine)|theory of relativity|periodic table)\b/i;

// ── SCIENTIFIC INSTRUMENTS (physical apparatus, not documents)
const INSTRUMENT = /\b(telescope|microscope|orrery|astrolabe|sextant|octant|slide rule|barograph|chronometer (?!watch)|planetarium|globe (celestial|terrestrial)|armillary|theodolite|spectroscope|calculating machine|mechanical calculator|abacus|sundial|surveying instrument|navigational instrument)\b/i;

export interface RRRoute { slug: string; }

/** the title itself reads space (no sale-name prior) */
export const rrSpaceTitle = (title: string): boolean => SPACE.test(title.toLowerCase());

/** RR is an AUTOGRAPH house: a sports lot its title doesn't otherwise type
 *  ("Barry Bonds Baseball", "Joe Frazier Boxing Glove") is a signed piece —
 *  Olympic insignia/pins/medals/torches excepted. */
export function rrSportsPrior(slug: string, text: string): string {
  return slug === 'sports-memorabilia' && !/\b(olympics?|pins?|badges?|insignia|medals?|torch|pennants?|tickets?)\b/i.test(text) ? 'autographs' : slug;
}

/** (wave 2) RR titles an athlete's signed piece by the bare name ("Ty Cobb",
 *  "Ted Williams and Stan Musial", "Sugar Ray Robinson Signed Photograph") —
 *  no sport word, so step 1 below missed it and 14k sat in culture. A roster
 *  athlete (scripts/lib/athlete-roster.ts, the corpus's own card players) is
 *  sports, unless the title reads non-sport. */
export function rrAthleteRoute(title: string): string | null {
  // the signer LEADS an RR title (a nickname may precede: "“Pistol” Pete Maravich")
  if (!athleteIn(title, 2) || RR_NON_SPORT.test(title)) return null;
  // a pair title names two people: both must be sports ("Ted Williams and Stan
  // Musial" yes; "Gale Sayers and Billy Dee Williams" — Brian's Song — and
  // "Frank Thomas and Ollie Johnston" — Disney animators — no)
  const head = title.split(/[:(–—]|\s-\s/)[0]
    .replace(/\b(?:group lot|lot|signed|autographed|signatures?|photo(?:graph)?s?|documents?|letters?|cards?|books?|programs?|baseballs?|footballs?|basketballs?|balls?|bats?|items?)\b.*$/i, '').trim();
  const parts = head.split(/\s+(?:and|&)\s+|,\s+/i).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1 && parts.some(p => /^(?:[A-Z][\w.'’]*\s+){1,2}[A-Z][\w.'’]*$/.test(p) && !athleteIn(p) && !athleteNickname(p) && !SPORTS.test(p.toLowerCase()) && !/\b(?:team|club|greats|hall|famers?|senators|yankees|dodgers|giants|cardinals|red sox|cubs)\b/i.test(p))) return null;
  return rrSportsPrior(routeSportsLot(title, '') ?? 'sports-memorabilia', title);
}
/** "John Sain" ≈ roster "johnny sain": a two-word name whose first-name stem
 *  (3 letters) + surname match a roster athlete. Three-word names must match
 *  exactly ("Billy Dee Williams" is not Billy Williams). */
function athleteNickname(name: string): boolean {
  const w = name.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean);
  if (w.length !== 2 || w[0].length < 3) return false;
  for (const a of Array.from(ATHLETES)) {
    const aw = a.split(' ');
    if (aw.length === 2 && aw[1] === w[1] && aw[0].slice(0, 3) === w[0].slice(0, 3)) return true;
  }
  return false;
}
const RR_NON_SPORT =/\b(beatles|elvis|presley|president|presidential|white house|movie|film|hollywood|actor|actress|singer|band|album|record|guitar|concert|astronaut|apollo|nasa)\b/i;

/** Route an RR Auction lot to an entity slug, or null to drop it.
 *  Science is matched, never defaulted — unmatched lots go to routeCulture. */
// RR's SALE is a strong prior for space: a "Space & Aviation" catalogue lists
// lots by bare astronaut name ("John Young", "Gene Cernan"), which no title
// regex can read. In a space sale a lot is space unless it reads aviation /
// another domain (Oct 6 2026 audit: 5.8k space lots sat in culture).
const SPACE_SALE = /\b(space|apollo|nasa|astronaut)/i;
// (wave 2) the aviators a "Space & Aviation" catalogue also lists by bare name
// ("Jacqueline Cochran Signed Photograph", "Jimmy Doolittle", "Paul Tibbets")
// — they are aviation autographs (culture's historic catch-all), not space.
const NOT_SPACE_IN_SPACE_SALE = /\b(lindbergh|wright brothers|orville|wilbur|yeager|aviation|aviator|aviatrix|airplane|aircraft|airline|airship|zeppelin|hindenburg|b-\d{2}|p-\d{2}|pilot'?s license|earhart|howard hughes|air force|luftwaffe|wwi|wwii|world war|red baron|spirit of st\.? louis|telegraph|plymouth|meteorite|cochran|doolittle|rickenbacker|tibbets|enola gay|curtiss|wiley post|sikorsky|boyington|chennault|flying tigers|blue angels|concorde|bob hoover|bleriot|bl[ée]riot|amelia|piccard|fokker|richthofen|tuskegee|doolittle raid|bomber|fighter ace|flying ace|squadron)\b/i;

export function routeRRLot(title: string, description = '', saleName = ''): string | null {
  const t = `${title} ${description}`.toLowerCase();

  // 1. sports memorabilia — an athlete's signed piece is sports
  if (SPORTS.test(t)) {
    const s = routeSportsLot(title, description);
    if (s) return rrSportsPrior(s, t);
  }
  const athlete = rrAthleteRoute(title);
  if (athlete) return athlete;

  // 2. natural history
  if (METEORITE.test(t)) return 'meteorites';
  if (FOSSIL.test(t)) return 'fossils';

  // 3. space
  if (SPACE.test(t)) return 'space-exploration';

  // 4. computing / tech + hard-science documents
  if (TECH.test(t) || SCI_FIGURE.test(t)) return 'science-tech';

  // 5. physical scientific instruments
  if (INSTRUMENT.test(t)) return 'scientific-instruments';

  // 5b. a space sale's unmatched lot is space unless it reads otherwise
  if (SPACE_SALE.test(saleName) && !NOT_SPACE_IN_SPACE_SALE.test(t)) return 'space-exploration';

  // 6. everything else → the pop-culture router (drops mass/graded → null)
  return routeCulture(title, description);
}
