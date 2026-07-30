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

// ── SPORTS — a signed jersey/ball/photo of an athlete is sports memorabilia.
// Broad athlete/discipline signal; routeSportsLot does the fine routing.
const SPORTS = /\b(baseball|basketball|football\b|nfl|nba|mlb|nhl|hockey|soccer|world cup|olympic|olympics|boxing|heavyweight|wrestling|golf|pga|masters tournament|tennis|wimbledon|nascar|jersey|game[- ]worn|game[- ]used|rookie|babe ruth|mickey mantle|muhammad ali|michael jordan|wayne gretzky|jackie robinson|lou gehrig|pel[eé]\b|jesse owens)\b/i;

// ── NATURAL HISTORY → meteorites / fossils
const METEORITE = /\b(meteorite|meteoritic|pallasite|chondrite|tektite|impactite|lunar meteorite|martian meteorite|widmanst[aä]tten)\b/i;
const FOSSIL = /\b(fossil|fossilized|dinosaur|[a-z]+saurus|tyrannosaur\w*|triceratops|raptor|ammonite|trilobite|megalodon|mammoth|mastodon|amber inclusion|petrified|skeleton|skull cast|prehistoric)\b/i;

// ── SPACE → space-exploration
const SPACE = /\b(nasa|apollo|gemini|mercury (program|capsule|mission)|astronaut|cosmonaut|spaceflight|spacecraft|space shuttle|lunar module|moon landing|moonwalk|flown to the moon|flown in space|space[- ]flown|saturn v|rocket engine|mission patch|robbins medal|spacesuit|space suit|neil armstrong|buzz aldrin|john glenn|yuri gagarin|scott carpenter|jim lovell|gus grissom|wally schirra|alan shepard|michael collins)\b/i;

// ── COMPUTING / TECH + hard-science documents → science-tech
const TECH = /\b(apple[- ]?1|apple[- ]?ii|apple lisa|macintosh|\bmac\b|iphone|ipod|ipad|newton messagepad|steve jobs|steve wozniak|woz\b|bill gates|paul allen|microsoft|altair 8800|commodore|amiga|atari (computer|800|2600 prototype)|ibm (pc|5150)|xerox parc|alto\b|next ?computer|next cube|circuit board|motherboard|microprocessor|integrated circuit|silicon chip|transistor|vacuum tube computer|punch card|magnetic core|enigma machine|turing|alan turing|ada lovelace|charles babbage|difference engine|prototype (board|computer|phone|device)|patent (model|application|drawing)|blueprint|schematic|first[- ]generation (iphone|ipod)|dev(elopment)? prototype|engineering prototype)\b/i;
const SCI_FIGURE = /\b(albert einstein|einstein|isaac newton|charles darwin|nikola tesla|thomas edison|marie curie|galileo|stephen hawking|richard feynman|niels bohr|robert oppenheimer|watson and crick|dna model|nobel prize in (physics|chemistry|medicine)|theory of relativity|periodic table)\b/i;

// ── SCIENTIFIC INSTRUMENTS (physical apparatus, not documents)
const INSTRUMENT = /\b(telescope|microscope|orrery|astrolabe|sextant|octant|slide rule|barograph|chronometer (?!watch)|planetarium|globe (celestial|terrestrial)|armillary|theodolite|spectroscope|calculating machine|mechanical calculator|abacus|sundial|surveying instrument|navigational instrument)\b/i;

export interface RRRoute { slug: string; }

/** Route an RR Auction lot to an entity slug, or null to drop it.
 *  Science is matched, never defaulted — unmatched lots go to routeCulture. */
export function routeRRLot(title: string, description = ''): string | null {
  const t = `${title} ${description}`.toLowerCase();

  // 1. sports memorabilia — an athlete's signed piece is sports
  if (SPORTS.test(t)) {
    const s = routeSportsLot(title, description);
    if (s) return s;
  }

  // 2. natural history
  if (METEORITE.test(t)) return 'meteorites';
  if (FOSSIL.test(t)) return 'fossils';

  // 3. space
  if (SPACE.test(t)) return 'space-exploration';

  // 4. computing / tech + hard-science documents
  if (TECH.test(t) || SCI_FIGURE.test(t)) return 'science-tech';

  // 5. physical scientific instruments
  if (INSTRUMENT.test(t)) return 'scientific-instruments';

  // 6. everything else → the pop-culture router (drops mass/graded → null)
  return routeCulture(title, description);
}
