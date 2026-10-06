/**
 * Title → tracked-maker/vertical routing shared by the Sotheby's/Christie's
 * auction crawlers (routeItem) and Goldin (goldinRoute + its gate regexes).
 *
 * Moved verbatim out of scripts/ray-crawl.ts (house split, Sep 2026).
 */
import { looksLikeCard } from '../../../app/lib/cards';
import { goldinSportKind, scienceVerdict, DROP } from '../classify';

// Tracked art & design makers → slug. Order: specific before ambiguous.
// Ambiguous surnames (condo=apartment, saul, sachs) require the full name.
const ART_MAKER_ROUTES: [RegExp, string][] = [
  [/\bgeorge condo\b/, 'george-condo'],
  [/\bkaws\b/, 'kaws'],
  [/\bandy warhol\b|\bwarhol\b/, 'andy-warhol'],
  [/\bkeith haring\b|\bharing\b/, 'keith-haring'],
  [/\bed(ward)? ruscha\b|\bruscha\b/, 'ed-ruscha'],
  [/\bpablo picasso\b|\bpicasso\b/, 'pablo-picasso'],
  [/\bhenri matisse\b|\bmatisse\b/, 'henri-matisse'],
  [/\btom sachs\b/, 'tom-sachs'],
  [/\bpeter saul\b/, 'peter-saul'],
  [/\braymond pettibon\b|\bpettibon\b/, 'raymond-pettibon'],
  [/\bbarry mcgee\b/, 'barry-mcgee'],
  [/\bfutura\s?2000\b|\bfutura\b/, 'futura-2000'],
  [/\brobert crumb\b|\br\.?\s?crumb\b/, 'r-crumb'],
  [/\bfab(ulous)?\s5\sfreddy\b|\bfred(erick)? brathwaite\b/, 'fab-5-freddy'],
  // full name only — bare "clemente" caught José Clemente OROZCO and Roberto
  // Clemente (the surname is Orozco's middle name, not his surname)
  [/\bfrancesco clemente\b/, 'francesco-clemente'],
  [/\beddie martinez\b/, 'eddie-martinez'],
  [/\bkenny scharf\b|\bscharf\b/, 'kenny-scharf'],
  // added Aug 2026 — blue-chip modern/contemporary. Distinctive surnames allowed;
  // Bacon (food/philosopher) and Johnson (common) require the full name.
  [/\bjean.?michel basquiat\b|\bbasquiat\b/, 'jean-michel-basquiat'],
  [/\broy lichtenstein\b|\blichtenstein\b/, 'roy-lichtenstein'],
  [/\bfrancis bacon\b/, 'francis-bacon'],
  [/\balexander calder\b|\bcalder\b/, 'alexander-calder'],
  [/\brashid johnson\b/, 'rashid-johnson'],
  [/\bjeff koons\b|\bkoons\b/, 'jeff-koons'],
  // design
  [/\bgeorge nakashima\b|\bnakashima\b/, 'george-nakashima'],
  [/\bcharles (and |& )?ray eames\b|\b(charles|ray) eames\b|\beames\b/, 'charles-eames'],
  [/\bprouv[eé]/, 'jean-prouve'],
  [/\bpierre jeanneret\b|\bjeanneret\b/, 'pierre-jeanneret'],
];

/**
 * ITEM-LEVEL routing — the doctrine. An auction is only a container; every
 * lot is classified on its OWN text, never by which sale it appeared in.
 * A Speedmaster in a Space Exploration sale is an Omega watch; a meteorite
 * in a jewelry sale would be a meteorite. A lot that matches nothing we
 * track is skipped — never guessed into a bucket.
 */
export function routeItem(creators: string | null, title: string, extra = ''): string | null {
  const slug = routeItemRaw(creators, title, extra);
  // SCIENCE must be earned by the lot's own words (Oct 6 2026 audit): the
  // science branches below read creators + title only, and the shared
  // classify.ts scienceVerdict (re-applied to the corpus nightly) can re-home
  // a book/letter (science-tech, entertainment-memorabilia) or reject it.
  if (slug && ['meteorites', 'fossils', 'space-exploration', 'scientific-instruments'].includes(slug)) {
    const v = scienceVerdict({ artist: slug, title: `${creators || ''} ${title}`.trim() });
    return v === DROP ? null : (v || slug);
  }
  return slug;
}

function routeItemRaw(creators: string | null, title: string, extra = ''): string | null {
  const t = `${creators || ''} ${title} ${extra}`.toLowerCase();
  // science branches read the lot's own words only — never the description
  const ts = `${creators || ''} ${title}`.toLowerCase();
  // NEVER cards — unambiguous trading-card signals gate EVERYTHING, before any
  // science/sports route can claim the lot (mirrors goldinRoute: exclusions
  // first). Deliberately narrower than the sports-route blocklist below: no
  // bare 'card'/'psa', or a Steve Jobs business card / PSA-DNA-authenticated
  // Apollo lot would be dropped.
  if (/\b(topps|bowman|panini|goudey|fleer|donruss|upper deck|rookie card|trading card|tobacco (card|silk)|pok[eé]mon|yu-?gi-?oh|\btcg\b)\b/.test(t)) return null;
  // tracked watch makers first — the strongest identity a lot can have
  if (/\brolex\b/.test(t)) return 'rolex';
  if (/\bpatek\b/.test(t)) return 'patek-philippe';
  if (/\baudemars\b/.test(t)) return 'audemars-piguet';
  if (/\bomega\b/.test(t)) return 'omega';
  if (/\bcartier\b/.test(t)) return 'cartier';
  // tracked art & design makers — the maker IS the identity (the creators field
  // carries it). Matched by name so a Condo/Warhol/Picasso lot in a Sotheby's
  // contemporary/modern sale routes correctly instead of being dropped. Full
  // names first; distinctive surnames allowed (ambiguous ones like Saul/Condo
  // require the full name). Untracked makers still fall through to null.
  for (const [re, slug] of ART_MAKER_ROUTES) if (re.test(t)) return slug;
  // science collections — positive signals only, no sale-level fallback
  if (/meteorite|pallasite|tektite|moldavite|chondrite|gibeon|seymchan|impactite|lunar meteorite|martian/.test(ts)) return 'meteorites';
  if (/fossil|dinosaur|trilobite|ammonite|megalodon|mammoth|mosasaur|tyrannosaur|triceratops|pterosaur|ichthyosaur|plesiosaur|neanderthal|paleolithic|petrified|tooth of|amber with|coprolite|stromatolite/.test(ts)) return 'fossils';
  // generic anatomy words are fossils ONLY with paleo context — a
  // "skeletonized" watch dial, skull-logo jersey, or Jaws poster is not a fossil
  if (/\b(skeletons?|skulls?|tusks?|claws?|jaws?)\b/.test(ts) && /\b(prehistoric|cretaceous|jurassic|triassic|permian|eocene|oligocene|miocene|pliocene|pleistocene|ice age|saber[- ]tooth(ed)?|cave (bear|lion)|woolly|dire wolf|raptor|extinct)\b/.test(ts)) return 'fossils';
  if (/apollo|nasa|space[- ]flown|space (exploration|shuttle|suit|program|station)|spacesuit|lunar|astronaut|cosmonaut|sputnik|gemini \d|soyuz|vostok|skylab|\brocket\b|x-15|satellite|mission (control|patch)|flight plan|star chart/.test(ts)) return 'space-exploration';
  // video games are NOT science (doctrine) — a Nintendo/Atari console prototype
  // must not fall into scientific-instruments via 'prototype'/'computer'
  if (/\b(nintendo|sega|playstation|\bxbox\b|game ?boy|atari (2600|vcs|jaguar|lynx|5200|7800)|super nintendo|sega (genesis|saturn|dreamcast)|\bnes\b|\bsnes\b|game cartridge|arcade (cabinet|machine)|video ?game)\b/.test(t)) return null;
  // political / literary / entertainment Americana is NOT science — it floods
  // in from Books & Manuscripts sales, where a loose science term (globe,
  // manuscript, patent) in a long description misroutes a Washington letter or
  // Marilyn Monroe script. Block it before the science branch. Franklin is
  // deliberately absent (his electrical work IS science); a hard instrument or
  // named-scientist signal overrides the block.
  if (/\b(washington|thomas jefferson|abraham lincoln|john adams|john quincy adams|alexander hamilton|james madison|james monroe|andrew jackson|ulysses grant|robert e\.? lee|general sherman|jefferson davis|john wilkes booth|confederate|civil war|continental (army|congress)|declaration of independence|revolutionary war|colonial governor|bunker hill|fort (sumter|ticonderoga)|emancipation|hemingway|walt whitman|washington irving|ezra pound|marilyn monroe|bette davis|marlene dietrich|bruce springsteen|jacqueline (bouvier|kennedy)|cotton mather|ecclesiastical history)\b/.test(t)
      && !/telescope|microscope|astrolab|sextant|orrery|armillary|chronometer|patent (model|no|for)|scientific instrument|albert einstein|isaac newton|thomas edison|nikola tesla|charles darwin|\bsmyth\b|orville|atomic|nuclear|manhattan project/.test(t)) return null;
  if (/telescope|microscope|astrolabe|sextant|octant|orrery|armillary|barometer|theodolite|chronometer\b|slide rule|surveying (instrument|compass|chain|cross)|(terrestrial|library|pocket|table) globe|globe by|celestial|enigma machine|cipher|calculat(or|ing)|typewriter|computer|macintosh|apple[- ](1|ii)|altair|commodore|prototype|patent model|anatomical|medical (instrument|kit)|laboratory|albert einstein|isaac newton|charles darwin|marie curie|nikola tesla|thomas edison|bell labs|bell telephone laborator|transistor|semiconductor|integrated circuit|microprocessor|vacuum tube|punch(ed)? card|mainframe|eniac|univac|\bcray\b|\bibm\b|pdp-\d|\bvax\b|apple lisa|\bnext(cube|step)?\b|xerox (alto|parc|star)|difference engine|analytical engine|babbage|\bturing\b|von neumann|shockley|grace hopper|wozniak|steve jobs|kenbak|imsai|trs-80|\bamiga\b|osborne 1|manuscript.*(scien|math|physic)|first edition.*(scien|math|physic)/.test(ts)) return 'scientific-instruments';
  // sports objects — Christie's/Sotheby's sports sales, same doctrine as
  // Goldin: game-used, trophies & awards, tickets & passes. NEVER cards.
  if (/\b(cards?|n172|t20[0-9]|tobacco (card|silk)|psa\b|sgc\b|topps|bowman|panini|goudey|leaf\b|cabinet (photo|card)|carte de visite)\b/.test(t)) return null;
  if (/\b(game[- ](used|worn|issued)|match[- ](used|worn)|player[- ]worn|team[- ]issued|tour[- ](used|worn)|worn (jersey|uniform|cleats|boots|gloves|jacket|cap|shirt)|game (bat|ball|jersey|uniform|glove|worn)|match[- ]worn (shirt|jersey|boots))\b/.test(t)) return 'game-used';
  if (/\b(trophy|championship (ring|trophy|belt|pennant)|title belt|winners? medal|olympic (medal|torch)|world series (ring|trophy)|super bowl ring|mvp award|heisman|vince lombardi|stanley cup|green jacket|lombardi trophy)\b/.test(t)) return 'trophies-awards';
  if (/\b(full ticket|ticket stub|game[- ]used ticket|world series ticket|super bowl ticket|world cup (ticket|final ticket)|olympic ticket|season pass|press pass|all[- ]access (pass|credential))\b/.test(t)) return 'tickets-passes';
  return null; // nothing we track — never guess
}

export const GOLDIN_CARD_MAKERS = /\b(topps|panini|bowman|upper deck|fleer|donruss|prizm|optic|mosaic|refractor|rookie card|\brc\b|pok[eé]mon|yu-?gi-?oh|magic the gathering|\bmtg\b|\btcg\b|booster|wax pack|hobby box|checklist|parallel|kakawow|skybox|pro set|leaf\b|trading card|patch card|sticker)\b/i;

const GOLDIN_GRADED = /\b(psa|bgs|sgc|cgc|slab|gem m(in)?t)\b/i;

export const GOLDIN_EXCLUDE_GAMES = /\b(video game|nintendo|playstation|\bps[1-5]\b|xbox|sega|atari|game ?boy|n64|game ?cube|wii|famicom|wata|vga\b|sealed game|arcade)\b/i;

export const GOLDIN_EXCLUDE_MISC = /\b(sports illustrated|magazine|newsstand|comic|shonen|disney(land)?|universal studios|concert|music festival|movie (prop|pass|premiere)|screening pass|production[- ]used)\b/i;

// Leaked internal consignment notes that ride in on a lot title ("DO NOT LIST
// IN AUCTION - PER Shaneeza/Wagner …"). These are private staff annotations,
// never a public lot — filtered at both ingest paths so they can never reach
// lots.json OR sold-archive.json, where a surface could render them verbatim.
export const GOLDIN_LEAK_NOTE = /\bdo not list\b|per shaneeza|per wagner|do not sell\b/i;

// POKÉMON — the one allowlisted Non-Sport TCG line (Collin, Aug 2026): routed
// to the 'pokemon' culture slug, never a sports slug. Checked BEFORE the card
// gates in goldinRoute/ingest so (a) the dedicated Non-Sport passes keep their
// lots and (b) a Pokémon card surfacing in a MIXED sweep (the §3b per-auction
// recent-close sweep runs sportScoped over ALL completed auctions, TCG Weekly
// included) routes 'pokemon' instead of falling through looksLikeCard into
// sports-cards. Other TCG (Magic/YGO/One Piece/…) stays excluded.
export const GOLDIN_POKEMON = /\bpok[eé]mon\b/i;

const GOLDIN_GAME_USED = /\b(game[- ](used|worn|issued)|match[- ](used|worn)|player[- ]worn|team[- ]issued|fight[- ]worn|tour[- ](used|worn)|warm[- ]?up[- ]worn|practice[- ]worn|game bat|game ball|photo[- ]?match(ed)?|mears\b)\b/i;

const GOLDIN_TROPHY = /\b(trophy|award|championship ring|title belt|winners? medal|olympic medal|plaque|mvp\b|heisman|hall of fame ring|championship pendant)\b/i;

const GOLDIN_TICKET = /\b(tickets?\b|stub|full ticket|season pass|press pass|credential|all[- ]access pass)\b/i;

// Returns a routing slug, 'blocked' (hard exclusion — the facet fallback must
// NEVER override it, or the slab gate is dead code on the fallback passes), or
// null (no signal — the facet fallback may apply).
//
// sportScoped: the lot came from a query filtered to Goldin's own `category:
// ['Sport']`, which already excludes Pokémon/TCG (those are Non-Sport). In that
// context a card is a SPORTS CARD we want (→ 'sports-cards'), not blocked; and a
// Sport lot with no object signal is, overwhelmingly, a card. Unscoped passes
// keep the original doctrine (cards blocked) since they can surface Non-Sport.
export function goldinRoute(title: string, sportScoped = false): string | null {
  const t = title.toLowerCase();
  if (GOLDIN_EXCLUDE_GAMES.test(t)) return 'blocked';   // never video games (incl. sealed Pokémon games)
  if (GOLDIN_EXCLUDE_MISC.test(t)) return 'blocked';    // magazines, theme parks, props
  // Pokémon wins BEFORE every card gate — including the sportScoped card
  // fallback, so a TCG lot in a mixed sweep can never land in sports-cards.
  if (GOLDIN_POKEMON.test(t)) return 'pokemon';
  if (!sportScoped && GOLDIN_CARD_MAKERS.test(t)) return 'blocked'; // unscoped: never cards
  // sports objects win over the card default — a game-used jersey in a Sport
  // pass is game-used, not a card (checked before the sportScoped card fallback)
  const objectSignal = GOLDIN_GAME_USED.test(t) ? 'game-used'
    : GOLDIN_TROPHY.test(t) ? 'trophies-awards'
    : GOLDIN_TICKET.test(t) ? 'tickets-passes'
    : null;
  // RELIC-CARD GATE (sport-scoped only): a "Game-Used Relic CARD" / "Autograph
  // Patch #DAP-SO" fires the game-used OBJECT signal above, but it IS a trading
  // card (a card product + card number) and must comp on its EXACT-card value —
  // not a broad player-median in the game-used vertical. When the lot clearly
  // reads as a card, the card wins over the object signal → 'sports-cards'. This
  // is the SPORT card path (Pokémon/TCG already excluded from category:['Sport']),
  // so it honours the never-non-sport-cards doctrine. A RAW object (jersey/bat/
  // ball with game-used wording but no card product/number) has looksLikeCard
  // false and keeps the object routing below.
  // A Sport lot with no object signal is NOT presumed a card (Oct 6 2026 audit:
  // 69k jerseys/balls/photos/sealed boxes/comics sat in sports-cards). The
  // shared ladder decides — the same one corpus-normalize re-applies to the
  // back-catalogue (classify.ts goldinSportKind): card detector → card, else
  // the object's kind; non-sport TCG / comics → blocked.
  if (sportScoped) {
    if (objectSignal && !looksLikeCard(title)) return objectSignal;
    const k = goldinSportKind(title);
    return k === DROP ? 'blocked' : k;
  }
  if (objectSignal) return objectSignal;
  // space first — Apollo/NASA artifacts head the science vertical's space slug
  if (/\b(apollo|nasa|lunar|moon landing|astronaut|spacesuit|space suit|mercury (program|capsule)|gemini (program|capsule)|saturn v|cosmonaut|sputnik|space[- ]?flown)\b/.test(t)) return 'space-exploration';
  // then computing/tech: an Apple-1 or a sealed iPhone is science even in a sports house
  if (/\b(apple[- ]?(1|i{1,3}|ii)|iphone|ipod|macintosh|apple lisa|steve jobs|wozniak|apple computer|commodore|ibm\b|altair|enigma|bell labs|transistor|semiconductor|integrated circuit|microprocessor|vacuum tube|punch(ed)? card|eniac|univac|\bcray\b|pdp-\d|\bvax\b|\bnext(cube|step)?\b|xerox (alto|parc)|difference engine|babbage|\bturing\b|kenbak|imsai|trs-80)\b/.test(t)) return 'scientific-instruments';
  if (/\b(meteorite|pallasite|tektite)\b/.test(t)) return 'meteorites';
  if (/\b(fossil|dinosaur|trilobite|ammonite|megalodon|mammoth|amber with|t[- ]rex|raptor)\b/.test(t)) return 'fossils';
  if (GOLDIN_GRADED.test(t)) return 'blocked';          // graded, no object signal = a slab
  return null;
}
