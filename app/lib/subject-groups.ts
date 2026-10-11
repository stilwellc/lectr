/**
 * subject-groups.ts — the collective subjects a collection lot names (Oct 9, r5).
 *
 * subject.ts reads ONE person / film / mission. Half the live Pop Culture
 * book and ~1,700 sports lots name something else a collector files under:
 *
 *   team     a team-signed piece → the team-season ("1986 New York Mets"),
 *            a team card → the team
 *   set      sports sealed wax / set lots → product line + year
 *            ("1986 Fleer Basketball"); sealed Pokémon / set lots → the set
 *            ("Base Set", "Team Rocket Returns")
 *   program  a space piece with no numbered mission → its program ("Apollo")
 *   brand    an instrument → its maker ("Gibson", "Fender")
 *
 * Same contract as subject.ts: each reader returns null unless the title says
 * it in a shape measured ≥90% precise (40-lot spot checks per bucket on the
 * live book). Never a guess.
 */

// ── teams ──────────────────────────────────────────────────────────────
const MLB = `Arizona Diamondbacks|Atlanta Braves|Baltimore Orioles|Boston Red Sox|Chicago Cubs|Chicago White Sox|Cincinnati Reds|
Cleveland Indians|Cleveland Guardians|Colorado Rockies|Detroit Tigers|Houston Astros|Kansas City Royals|Kansas City Athletics|
Los Angeles Angels|California Angels|Anaheim Angels|Los Angeles Dodgers|Brooklyn Dodgers|Brooklyn Robins|Miami Marlins|Florida Marlins|
Milwaukee Brewers|Milwaukee Braves|Boston Braves|Minnesota Twins|New York Mets|New York Yankees|New York Giants|San Francisco Giants|
Oakland Athletics|Oakland A's|Philadelphia Athletics|Philadelphia A's|Philadelphia Phillies|Pittsburgh Pirates|San Diego Padres|
Seattle Mariners|Seattle Pilots|St\\. Louis Cardinals|St\\. Louis Browns|Tampa Bay Rays|Tampa Bay Devil Rays|Texas Rangers|
Toronto Blue Jays|Washington Nationals|Washington Senators|Montreal Expos|Houston Colt \\.45s|Homestead Grays|Kansas City Monarchs`;
const NBA = `Atlanta Hawks|St\\. Louis Hawks|Boston Celtics|Brooklyn Nets|New Jersey Nets|Charlotte Hornets|Charlotte Bobcats|Chicago Bulls|
Cleveland Cavaliers|Dallas Mavericks|Denver Nuggets|Detroit Pistons|Golden State Warriors|Philadelphia Warriors|Houston Rockets|
Indiana Pacers|Los Angeles Clippers|San Diego Clippers|Los Angeles Lakers|Minneapolis Lakers|Memphis Grizzlies|Vancouver Grizzlies|
Miami Heat|Milwaukee Bucks|Minnesota Timberwolves|New Orleans Pelicans|New Orleans Hornets|New York Knicks|Oklahoma City Thunder|
Orlando Magic|Philadelphia 76ers|Phoenix Suns|Portland Trail Blazers|Sacramento Kings|Kansas City Kings|Cincinnati Royals|
San Antonio Spurs|Seattle SuperSonics|Seattle Supersonics|Toronto Raptors|Utah Jazz|Washington Wizards|Washington Bullets|
Baltimore Bullets|Syracuse Nationals|Harlem Globetrotters`;
const NFL = `Arizona Cardinals|Chicago Cardinals|Atlanta Falcons|Baltimore Ravens|Baltimore Colts|Buffalo Bills|Carolina Panthers|Chicago Bears|
Cincinnati Bengals|Cleveland Browns|Dallas Cowboys|Denver Broncos|Detroit Lions|Green Bay Packers|Houston Texans|Houston Oilers|
Indianapolis Colts|Jacksonville Jaguars|Kansas City Chiefs|Las Vegas Raiders|Oakland Raiders|Los Angeles Raiders|Los Angeles Chargers|
San Diego Chargers|Los Angeles Rams|St\\. Louis Rams|Miami Dolphins|Minnesota Vikings|New England Patriots|Boston Patriots|
New Orleans Saints|New York Jets|Philadelphia Eagles|Pittsburgh Steelers|San Francisco 49ers|Seattle Seahawks|
Tampa Bay Buccaneers|Tennessee Titans|Washington Commanders|Washington Redskins|Washington Football Team`;
const NHL = `Anaheim Ducks|Boston Bruins|Buffalo Sabres|Calgary Flames|Carolina Hurricanes|Hartford Whalers|Chicago Blackhawks|Chicago Black Hawks|
Colorado Avalanche|Quebec Nordiques|Columbus Blue Jackets|Dallas Stars|Minnesota North Stars|Detroit Red Wings|Edmonton Oilers|
Florida Panthers|Los Angeles Kings|Minnesota Wild|Montreal Canadiens|Nashville Predators|New Jersey Devils|New York Islanders|
New York Rangers|Ottawa Senators|Philadelphia Flyers|Pittsburgh Penguins|San Jose Sharks|Seattle Kraken|St\\. Louis Blues|
Tampa Bay Lightning|Toronto Maple Leafs|Vancouver Canucks|Vegas Golden Knights|Washington Capitals|Winnipeg Jets|Atlanta Thrashers|
Utah Hockey Club|Utah Mammoth`;
const TEAM_ALT = [MLB, NBA, NFL, NHL].join('|').replace(/\s*\n\s*/g, '');
const TEAM_RE = new RegExp(`\\b(${TEAM_ALT})\\b`, 'g');
/** the season a team piece names, as written in the lead ("1986", "1979-80"), or a Goldin 2-digit "86" */
const SEASON = /^(?:(?:c\.|circa)\s*)?((?:18|19|20)\d{2}(?:[-–](?:\d{2}|\d{4}))?|\d{2}(?=\s))\s+(?![/\d])/;
/** the run between the season and the team: championship / event words only */
const TEAM_QUAL = /^(?:(?:World Series|World Champion(?:ship)?s?|Champions?|Championship|National League|American League|NL|AL|NBA|NFL|NHL|AFL|ABA|MLB|Super Bowl(?: [IVXL]+)?|Stanley Cup|Spring Training|Pennant|Pennant-Winning|Division|Conference|Eastern|Western|Champion)\s+){0,4}/;
/** what a team piece IS: signed by the team, or the team's own card/photo */
const TEAM_VERB = /^(?:\(.{1,30}?\)\s+)?(?:["“][^"”]{1,30}["”]\s+)?(?:(?:Super Bowl [IVXL]+|Reunion|Championship|Champions?|World Champions?|Starting \d|Team|Stars?|Hall of Famers?|Legends?|Greats|Alumni|Pennant|Spring Training)\s+){0,3}(?:Team[- ]Signed|Team[- ]Autographed|Multi-Signed|Mult-Signed|Signed|Autographed|Team-Issued|Team Issued|Team Photo|Team Ball|Team Baseball|Team Football|Team Basketball)\b/;

/** (r8) the season a team lot's title leads with ("1961 New York Yankees …" → "1961"), or null */
export function teamSeasonOf(title: string | null | undefined): string | null {
  return seasonOf(String(title || '').replace(/\s+/g, ' ').trim());
}
function seasonOf(lead: string): string | null {
  const m = lead.match(SEASON);
  if (!m) return null;
  let y = m[1];
  if (/^\d{2}$/.test(y)) y = `${+y <= 30 ? '20' : '19'}${y}`;
  return y.replace(/–/, '-');
}

/**
 * "1986 New York Mets Team-Signed Baseball" → "1986 New York Mets";
 * "1980 World Series Champion Philadelphia Phillies Team-Signed Poster" →
 * "1980 Philadelphia Phillies"; "New York Yankees Hall of Famers … Signed Cut
 * Collection" → "New York Yankees". One team only — a game ("Reds vs.
 * Dodgers") or two clubs is no team's piece.
 */
export function teamOf(title: string): string | null {
  const t = title.replace(/\s+/g, ' ').trim();
  const teams = new Set((t.match(TEAM_RE) || []).map(s => s.replace(/Supersonics/, 'SuperSonics').replace(/Oakland A's/, 'Oakland Athletics').replace(/Philadelphia A's/, 'Philadelphia Athletics')));
  if (teams.size !== 1) return null;
  if (/\bvs\.?\s/i.test(t)) return null;
  const season = seasonOf(t);
  let rest = season ? t.replace(SEASON, '') : t;
  rest = rest.replace(TEAM_QUAL, '');
  const m = rest.match(new RegExp(`^(${TEAM_ALT})\\s+`));
  if (!m) return null;
  if (!TEAM_VERB.test(rest.slice(m[0].length))) return null;
  const team = Array.from(teams)[0];
  return season ? `${season} ${team}` : team;
}

/** a team card: "1957 Topps #171 Boston Red Sox Team PSA NM 7" → "Boston Red Sox" */
export function teamCardOf(title: string): string | null {
  const m = title.match(new RegExp(`#\\w+ (${TEAM_ALT}) Team\\b(?! (?:Leaders|Signed|Set))`));
  if (!m) return null;
  const teams = new Set(title.match(TEAM_RE) || []);
  return teams.size === 1 ? m[1] : null;
}

// ── sports sealed wax / set lots → product line + year ────────────────
const CARD_BRAND = /^(?:Topps|Bowman|Fleer|Upper Deck|Donruss|Panini|Score|Leaf|SkyBox|Skybox|NBA Hoops|Hoops|Pro Set|O-Pee-Chee|OPC|Stadium Club|Goudey|Play Ball|Playoff|Pacific|Star Co\.?|Star(?! Wars| Trek)|Pinnacle|Select|Collector's Choice|Ultra|Flair|Finest|Sage|Press Pass|Classic|Kellogg's|Hostess|Post|Berk Ross|Bazooka|Parkhurst|Sportflics|Leaf|SP|Metal|Bowman's Best|Prizm|Optic|Mosaic|Contenders|Prestige|Absolute|Chronicles|Obsidian|Spectra|Revolution|Certified|Elite|Zenith|Immaculate|National Treasures|Flawless|Exquisite|Signature Rookies|Action Packed|Collector's Edge|Wild Card|Front Row|Diamond Kings|Red Man|Exhibits|Dan Dee|Jello|Nabisco|Wheaties|Scoops)\b/;
/** where a product line ends: the sealed / set form */
const PRODUCT_END = /\s(?:-\s|\(|(?:PSA|SGC|BGS|CGC|GAI|KSA|Beckett)\b|High[- ]Grade|Factory[- ]Sealed|Factory Set|Unopened|Opened|Sealed|Hobby|Retail|Blaster|Mega|Jumbo|Rack|Cello|Wax|Vending|Fat Pack|Hanger|Value|Box|Boxes|Pack|Packs|Case|Tin|Complete|Near|Partial|Master|Starter|Team Set|Set|Sets|Lot|Collection|Pair|Trio|PSA-Graded|BGS-Graded|SGC-Graded|CGC-Graded|Graded|Uncut|Break|Display|Bag|Bundle)\b/;

/**
 * "97 Upper Deck SP Basketball Factory-Sealed Hobby Box (30 Packs)" →
 * "1997 Upper Deck SP Basketball"; "1963 Fleer Football Complete Set (88)" →
 * "1963 Fleer Football". The run between the year and the sealed / set form,
 * led by a card brand, with no card number or player run in it.
 */
export function productLineOf(title: string): string | null {
  const t = title.replace(/\s+/g, ' ').trim();
  const season = seasonOf(t);
  if (!season) return null;
  const rest = t.replace(SEASON, '');
  if (!CARD_BRAND.test(rest)) return null;
  const end = rest.search(PRODUCT_END);
  if (end <= 0) return null;
  let line = rest.slice(0, end).trim();
  // a single card ("#327 Patrick Mahomes"), a featured player, a size — never a product line
  if (/#|\bFeaturing\b|\bwith\b|\d+x\d+/i.test(line)) return null;
  line = line.replace(/[-\s]+(?:Series|Ser\.)\s*(?:\d|One|Two|Three|I{1,3})$/, '').replace(/[\s,:-]+$/, '');
  // (r7 data fix) a print run inside the set is the set: "1952 Topps Low-Number", "… High Numbers",
  // "1960 Topps Second Series", "2022 Topps Series 1 Baseball" are 1952 / 1960 / 2022 Topps (they
  // were 46 set ids). A different product ("Update", "Heritage", "Chrome") keeps its name.
  line = line.replace(/[-\s]+(?:Low|High|Semi-High)[- ]Numbers?\b/gi, '')
    .replace(/[-\s]+(?:First|Second|Third|Fourth|Fifth|Sixth|Seventh|1st|2nd|3rd|[4-7]th|High|Low)[- ]Series\b/gi, '')
    .replace(/[-\s]+Series[- ](?:\d|One|Two|Three|I{1,3})\b/gi, '')
    // …and baseball is the default sport of an unnamed line: "1952 Topps Baseball" IS "1952 Topps"
    // (every other sport keeps its word — "1986 Fleer Basketball" is not "1986 Fleer")
    .replace(/\s+Baseball\b/g, '')
    .replace(/\s+/g, ' ').replace(/[\s,:-]+$/, '').trim();
  const words = line.split(' ');
  if (words.length > 5) return null;
  return `${season} ${line}`;
}

// ── Pokémon sets ───────────────────────────────────────────────────────
/** English + Japanese set names, longest first so "Team Rocket Returns" beats "Team Rocket" */
const POKE_SETS = `Base Set 2|Base Set|Jungle|Fossil|Team Rocket Returns|Team Rocket|Gym Heroes|Gym Challenge|Neo Genesis|Neo Discovery|Neo Revelation|
Neo Destiny|Legendary Collection|Expedition|Aquapolis|Skyridge|Southern Islands|Ruby & Sapphire|Sandstorm|Dragon Frontiers|Dragon|
Team Magma vs\\. Team Aqua|Team Magma vs Team Aqua|Hidden Legends|FireRed & LeafGreen|Deoxys|Emerald|Unseen Forces|Delta Species|Legend Maker|
Holon Phantoms|Crystal Guardians|Power Keepers|Mysterious Treasures|Secret Wonders|Great Encounters|Majestic Dawn|Legends Awakened|Stormfront|
Rising Rivals|Supreme Victors|Arceus|HeartGold & SoulSilver|Unleashed|Undaunted|Triumphant|Call of Legends|Emerging Powers|Noble Victories|
Next Destinies|Dark Explorers|Dragons Exalted|Boundaries Crossed|Plasma Storm|Plasma Freeze|Plasma Blast|Legendary Treasures|Flashfire|
Furious Fists|Phantom Forces|Primal Clash|Roaring Skies|Ancient Origins|BREAKthrough|BREAKpoint|Generations|Fates Collide|Steam Siege|
Evolutions|Guardians Rising|Burning Shadows|Shining Legends|Crimson Invasion|Ultra Prism|Forbidden Light|Celestial Storm|Dragon Majesty|
Lost Thunder|Team Up|Detective Pikachu|Unbroken Bonds|Unified Minds|Hidden Fates|Cosmic Eclipse|Rebel Clash|Darkness Ablaze|
Champion's Path|Vivid Voltage|Shining Fates|Battle Styles|Chilling Reign|Evolving Skies|Celebrations|Fusion Strike|Brilliant Stars|
Astral Radiance|Pokemon GO|Pokémon GO|Lost Origin|Silver Tempest|Crown Zenith|Paldea Evolved|Obsidian Flames|151|Paradox Rift|
Paldean Fates|Temporal Forces|Twilight Masquerade|Shrouded Fable|Stellar Crown|Surging Sparks|Prismatic Evolutions|Journey Together|
Destined Rivals|Black Bolt|White Flare|Phantasmal Flames|Ascended Heroes|Chaos Rising|Pitch Black|Mega Heroes|
Rocket Gang|Mystery of the Fossils|Leaders' Stadium|Challenge from the Darkness|Gold, Silver, to a New World|Crossing the Ruins|
Darkness, and to Light|Awakening Legends|Beat of the Frontier|Reviving Legends|SoulSilver Collection|HeartGold Collection|VSTAR Universe|
Shiny Treasure ex|Terastal Festival|Night Wanderer|Wild Force|Cyber Judge|Battle Partners|Hot Air Arena|Mega Brave|Mega Symphia|Inferno X|
Sinnoh Stars|Sun & Moon|Sword & Shield|Scarlet & Violet|Black & White|Diamond & Pearl|Mega Evolution|XY`;
const POKE_SET_RE = new RegExp(`(?:^|[\\s(])(${POKE_SETS.replace(/\s*\n\s*/g, '')})(?=$|[\\s),:-])`, 'g');
/** the bare series names: a set only when no named expansion follows */
const POKE_SERIES = new Set(['Sun & Moon', 'Sword & Shield', 'Scarlet & Violet', 'Black & White', 'Diamond & Pearl', 'Mega Evolution', 'XY', 'HeartGold & SoulSilver']);
/** what makes a TCG lot a set / sealed piece rather than one card */
export const POKE_SETLIKE = /\b(?:Factory[- ]Sealed|Sealed|Unopened|Booster|Box|Pack|Packs|Tin|Tins|Blister|Bundle|Elite Trainer|Collection Box|Premium Collection|Complete Set|Partial Set|Near Set|Master Set|Uncut Sheet|Theme Deck|Starter Deck|Display|Case)\b/;
const POKE_LANG = /\bPokemon\s+(Japanese|Korean|Chinese|Simplified Chinese|Traditional Chinese|Spanish|French|German|Italian|Portuguese|Thai|Indonesian)\b/i;

/**
 * The Pokémon set a sealed / set lot names: "2004 Pokemon EX Team Rocket
 * Returns Factory-Sealed Booster Box" → "Team Rocket Returns"; "1999 Pokemon
 * Base Set Unlimited Booster Box" → "Base Set". A non-English printing is a
 * different product: "Base Set (Japanese)". Two sets → null.
 */
export function pokemonSetOf(title: string): string | null {
  const t = title.replace(/\s+/g, ' ').replace(/Pokémon/g, 'Pokemon').trim();
  if (!/\bPokemon\b/i.test(t)) return null;
  // the set run sits before the first " - " (the "Possible Charizard…" tail names cards, not sets)
  const head = t.split(/\s[-–]\s/)[0];
  const hits = Array.from(head.matchAll(POKE_SET_RE)).map(m => m[1].replace(/Pokémon GO/, 'Pokemon GO').replace(/Team Magma vs Team Aqua/, 'Team Magma vs. Team Aqua'));
  const named = Array.from(new Set(hits.filter(h => !POKE_SERIES.has(h))));
  let set: string | null = null;
  if (named.length === 1) set = named[0];
  else if (!named.length) {
    const series = Array.from(new Set(hits));
    if (series.length === 1) set = series[0];
  }
  if (!set) return null;
  const lang = head.match(POKE_LANG)?.[1];
  return lang && !/^english$/i.test(lang) ? `${set} (${lang.replace(/^(\w)(\w*)$/, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase())})` : set;
}

// ── space programs ─────────────────────────────────────────────────────
const PROGRAM = /^(?:(?:NASA|Original|Flown|Vintage|Rare)\s+)?(Apollo[- ]Soyuz|Apollo|Gemini|Mercury|Space Shuttle|Skylab|Soyuz|Vostok|Voskhod|ISS|SpaceX|Blue Origin|Artemis|Mir)\b(?!-\d|\s\d)/;

/** "Apollo Command Module Globe Valve" → "Apollo" (a numbered mission reads first, in subject.ts) */
export function programOf(title: string): string | null {
  const m = title.replace(/\s+/g, ' ').trim().match(PROGRAM);
  if (!m) return null;
  const p = m[1].replace(/^Apollo[- ]Soyuz$/, 'Apollo-Soyuz');
  return p;
}

// ── instrument makers ──────────────────────────────────────────────────
const INSTRUMENT_BRAND = /^(?:(?:c\.|circa)\s*)?(?:(?:19|20)\d{2}s?\s+)?(Gibson|Fender|Epiphone|Martin|C\.F\. Martin|Gretsch|Rickenbacker|Ibanez|PRS|Paul Reed Smith|Taylor|Guild|Hofner|Höfner|Washburn|Jackson|ESP|LTD|Schecter|Yamaha|Ludwig|Steinway|Squier|Kramer|B\.C\. Rich|Charvel|Danelectro|Mosrite|Dobro|Silvertone|Harmony|Hamer|Music Man|Ernie Ball|G&L|Peavey|Takamine|Ovation|Gibson Custom|Fender Custom Shop|Marshall|Vox|Zildjian|Pearl|Tama|Rogers|Slingerland|Hammond|Moog|Roland|Korg)\b/;
const INSTRUMENT_WORD = /\b(?:Guitar|Bass|Stratocaster|Telecaster|Les Paul|SG|Explorer|Flying V|Jazzmaster|Jaguar|Precision|Acoustic|Electric|Hollow|Amplifier|Amp|Drum|Drums|Snare|Kit|Cymbal|Piano|Organ|Synthesizer|Violin|Mandolin|Banjo|Ukulele|Head|Cabinet|Hardshell|Case)\b/i;
const BRAND_CANON: Record<string, string> = { 'C.F. Martin': 'Martin', 'Höfner': 'Hofner', 'Paul Reed Smith': 'PRS', 'Gibson Custom': 'Gibson', 'Fender Custom Shop': 'Fender' };

/** "1984 Gibson Les Paul Custom - Cherry Sunburst" → "Gibson" — only an instrument the title leads with */
export function instrumentBrandOf(title: string): string | null {
  const t = title.replace(/\s+/g, ' ').trim();
  const m = t.match(INSTRUMENT_BRAND);
  if (!m || !INSTRUMENT_WORD.test(t)) return null;
  // a signed instrument files under its signer, never the factory
  if (/\b(?:Signed|Autographed|Multi-Signed|Played|Stage-Used|Owned)\b/i.test(t)) return null;
  return BRAND_CANON[m[1]] ?? m[1];
}
