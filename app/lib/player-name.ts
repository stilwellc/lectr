/**
 * player-name.ts — the ONE test of whether a name run is an athlete, and its
 * canonical spelling (r7, Oct 10 2026; moved out of maker-subjects so the
 * card labels (lot-labels), the pipeline roster (cards knownPlayerSet) and
 * players.json (build-market) read the same rule the entity key does — a
 * team card's "New York", a venue ("Yankee Stadium"), a surname-only
 * highlight card ("Mantle Hits") or a president on a sports-desk baseball
 * never becomes a /player).
 *
 * Pure: names and titles only — no registries beyond the word lists here.
 */
import { nameTokensOk } from './subject';

/* ── (r7, Oct 10) ONE ATHLETE PER PLAYER ROW ──────────────────────────────
   The readers above hand back a name RUN; three shapes of run minted rows
   that are no person (measured on the prod sports entities, Oct 10: 29 of
   5,355 player ids, ~400 sold lots; 3,161 of 19,674 ids over the full local
   corpus incl. one-sale ids):
     joined     two names fused into one: a given name + its quoted nickname
                ('Larry "Yogi" Berra' stamped "Larry Yogi Berra"), or a duo
                joined by a hyphen ("Yogi Berra-Phil Rizzuto Game-Worn …")
     run-on     the caption glued after the name ("Babe Ruth Hits 60th
                Homer", "LeBron James Diamond", "Jimmy Dykes Age 36",
                "Roberto Clemente White Base Bobblehead")
     not one    a subset / team / promo card the parser read as a name
                ("A.L. Batting Leaders", "Rival Fence Busters", "Buc Hill
                Aces", "Quaker Oats Premium")
   canonPlayerName is applied to EVERY player name before it becomes a key.
   (r7 data fix) + three more shapes, measured over the full local corpus:
     highlight  a surname-only subset card ("1959 Topps #461 Mantle Hits 42nd
                Homer", "Musial Raps Out", "Aaron Clubs") — no given name, so
                no one athlete it can be filed under with confidence
     place      a team / venue / school run ("New York", "Green Bay", "Yankee
                Stadium", "Notre Dame", "Gold Coin") read in the name slot
     truncated  a run cut before its surname ("Oscar De La" of Oscar De La Hoya)
   and athleteName adds the two the shape test cannot see: a famous
   NON-athlete on a sports desk (a president's signed baseball, Marilyn
   Monroe's DiMaggio-collection photos — a person, never a /player) and the
   one-word athletes the hobby files by one name (Pelé, Ichiro). */

/** words no athlete's name holds: the run is a subset / team / promo card, never a person */
export const NOT_PERSON_RUN = /\b(?:Perez-Steele|Berk Ross|Post Cereal|Leaders|Busters|Aces|Hitters|Sluggers|Bombers|Batterymates|Twins Trio|Trio|Variation|Showing|Brewing|Premium|Tournament|Winner|Moments|Co\.?|Inc\.?|Stadium|Coins?|Timers|Rookies|Clubbers|Hofers|Famers|Collection|Club|Crown|Full Name)(?=\s|$)/i;
/** caption words a house glues after the name — trimmed off the end of the run */
const RUN_ON_TAIL = /\s(?:Pittsburgh|Boston|Brooklyn|Philadelphia|Detroit|Baltimore|Seattle|Oakland|Minnesota|Milwaukee|Atlanta|Cleveland|Houston|Montreal|Toronto|Kansas|UDA|Perfect|Strip|Special|Blasts|News|Label|Hits|Throwing|Batting|Pitching|Fielding|Swinging|Sliding|Catching|Hurls|Clubs|Raps|Age|High|Low|Diamond|Supernova|Aquamarine|Emerald|Sapphire|Ruby|Boldly|Pants|MVP|Graded|Perforated|Proof|Contact-Proof|Day|Engraved|Pristine|Handwritten|Highlights|Chicago|Cincinnati|Endorsed|Pro|Photograph|Photo|Alive)$/i;
/** praise / issuer words a house leads the name with ("Extraordinary Babe Ruth Single-Signed…", "1959 Bazooka Mickey Mantle") */
const RUN_ON_LEAD = /^(?:MVP|ROY|HOFer|Extraordinary|Outstanding|Spectacular|Exceptional|Incredible|Remarkable|Stunning|Superb|Important|Historic|Rare|Scarce|Unique|Bazooka|Swell)\s/;
/** a colour the title binds to the card's back / base, never the athlete's surname ("Roberto Clemente White Base") */
const COLOUR_BACK = /^(?:White|Black|Red|Blue|Gray|Grey|Green|Yellow|Orange|Brown|Gold|Silver|Tan|Cream)\s+(?:Back|Base|Borders?|Background|Letter|Name|Cap|Jersey|Uniform)\b/;
/** nicknames that ARE the name the hobby files the athlete under ('Larry "Yogi" Berra' is Yogi Berra;
 *  'Walt "Clyde" Frazier' stays Walt Frazier) */
export const NICKNAME_IS_NAME: ReadonlySet<string> = new Set([
  'Yogi', 'Babe', 'Catfish', 'Honus', 'Dizzy', 'Whitey', 'Duke', 'Goose', 'Magic', 'Lefty', 'Cy', 'Rube', 'Satchel',
  'Mookie', 'Pee Wee', 'Smoky Joe', 'Shoeless Joe', 'Cool Papa', 'Pistol Pete', 'Bubba', 'Tiger', 'Bo',
]);
/** a whole run that is a team, venue, school or band — or a postcard photographer / publisher (J.D. McCarthy, A.C. Dietsche) — never the lot's athlete (every word passes the name-shape test) */
const PLACE_RUN = /^(?:J\.? ?D\.? McCarthy|A\.? ?C\.? Dietsche|Ohio State|Penn State|Michigan State|Notre Dame Fighting|Golden Ball|Base Ball|Basket Ball|Foot Ball|Rolling Stones|Grateful Dead|Beach Boys|Bee Gees|Green Bay|Tampa Bay|Notre Dame|Goal Line|Gold Coin|Golden State|Bay Area|Fc [A-Z][a-z]+|Ac Milan|Real Madrid)$/i;
/** a run that ENDS on a club's nickname is the club ("Green Bay Packers", "Colorado Rockies", "Ohio State Buckeyes") */
const TEAM_NICK_END = /\s(?:Yankees|Dodgers|Giants|Cubs|Cardinals|Tigers|Pirates|Athletics|Senators|Braves|Reds|Phillies|Orioles|Indians|Mets|Padres|Mariners|Astros|Rockies|Marlins|Rays|Nationals|Expos|Brewers|Diamondbacks|Royals|Twins|Angels|Guardians|Packers|Bears|Colts|Cowboys|Steelers|49ers|Raiders|Eagles|Lions|Rams|Chiefs|Broncos|Dolphins|Jaguars|Texans|Titans|Seahawks|Vikings|Buccaneers|Falcons|Panthers|Chargers|Bengals|Ravens|Commanders|Redskins|Oilers|Patriots|Jets|Celtics|Lakers|Bulls|Knicks|Warriors|Nets|Spurs|Hornets|Pacers|Pistons|Cavaliers|Bucks|Raptors|Wizards|Nuggets|Suns|Clippers|Grizzlies|Pelicans|Rockets|Mavericks|Timberwolves|Blazers|Canadiens|Bruins|Rangers|Penguins|Flyers|Capitals|Islanders|Sabres|Canucks|Blackhawks|Avalanche|Predators|Hurricanes|Buckeyes|Crimson Tide|Wolverines|Leagues|Publishing|Magazine)$/;
/** a club's city / state / school, as the last word of a run */
const CITY_END = /\s(?:Hawaii|Rochester|Syracuse|Toledo|Columbus|Louisville|Omaha|Tacoma|Spokane|Albuquerque|Nashville|Richmond|Norfolk|Durham|Hartford|Newark|Providence|Pawtucket|Scranton|Buffalo|Iowa|Indianapolis|Montgomery|Birmingham|Baltimore|Boston|Chicago|Detroit|Cleveland|Philadelphia|Pittsburgh|Brooklyn|Cincinnati|Milwaukee|Minnesota|Kansas City|Houston|Miami|Atlanta|Seattle|Oakland|Washington|Toronto|Montreal|Denver|Phoenix|Dallas|York|Angeles|Francisco|Diego|Louis|Bay|Tampa|Texas|Florida|Colorado|Arizona|California|Anaheim|Orleans|Vegas|Jersey|England|Carolina|Indianapolis|Jacksonville|Tennessee|Buffalo|Sacramento|Portland|Utah|Memphis|Charlotte|Orlando|State|Dame|Brooklyn|Expansion|Original|Amazing|Mighty|Miracle)$/;
/** a club's city leading a run that ended on a nickname */
const CITY_START = /^(?:Nashville|Kansas City|Homestead|Birmingham|Memphis|Newark|Baltimore|Boston|Chicago|Detroit|Cleveland|Philadelphia|Pittsburgh|Brooklyn|Cincinnati|Milwaukee|Minnesota|Houston|Miami|Atlanta|Seattle|Oakland|Washington|Toronto|Montreal|Denver|Phoenix|Dallas|New York|Los Angeles|San Francisco|San Diego|St\.? Louis|Tampa Bay|Indianapolis|Louisville|Columbus|Buffalo|Hilldale|Harrisburg)\b/;
/** the verb of a highlight / feat caption ("Mantle Hits 42nd Homer", "Musial Raps Out", "Jerry West Sets Record") */
const CAPTION_VERB = /^(?:Batting|Pitching|Fielding|Throwing|Hits|Blasts|Homers|Belts|Slams|Steals|Wins|Sets|Ties|Breaks|Clubs|Raps|Hurls|Fans|Whiffs|Smashes|Swipes|Scores|Drives|Launches|Wallops|Connects|Lashes|Socks|Clouts|Rips|Nabs|Robs|Clinches|Collects|Notches|Leads|Paces)$/;
/** a particle a name never ENDS on — the run was cut before the surname ("Oscar De La") */
const PARTICLE_END = /^(?:De|La|Del|Della|Da|Dos|Van|Von|Le|Di|Du|Mac|St\.?)$/;
const reEscN = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** (r7 data fix) a run in one case ("BEN HOGAN", "draymond green") read as a name: each word
 *  title-cased (roman suffixes and two-letter initials — "II", "OJ", "CC" — kept), so the shape
 *  test sees the athlete the desk printed in capitals (Christie's / Sotheby's NBA desks) */
const ROMAN = /^(?:II|III|IV|V|VI)$/i;
const caseWord = (w: string) => (ROMAN.test(w) ? w.toUpperCase()
  : /^[A-Za-z]{2}$/.test(w) && w === w.toUpperCase() ? w
  : w.toLowerCase().replace(/(^|[-'’.]|^mc)([a-zà-ÿ])/g, (_, a: string, b: string) => a + b.toUpperCase()));
const oneCase = (s: string) => (/[a-z]/.test(s) && /[A-Z]/.test(s) ? s : s.split(' ').map(caseWord).join(' '));
const bareName = (s: string) => oneCase(s.replace(/[()"“”]/g, '').replace(/\s+/g, ' ').trim()).replace(/(?<=[a-z])['’]$/, '')
  // "Y. A. Tittle" is "Y.A. Tittle"
  .replace(/\b([A-Z])\. ([A-Z])\.(?= )/g, '$1.$2.');

/**
 * The one athlete a reader's name run names — or null when the run is no
 * person. Pure: the run and the lot's own title only.
 */
export function canonPlayerName(name: string | null | undefined, title: string): string | null {
  let n = bareName(String(name || ''));
  if (!n) return null;
  const t = String(title || '');
  // a club nickname ending a 3+ word run is dropped ("Bill Skowran Yankees" → Bill Skowran) —
  // unless what is left ends on the club's city ("Amazing Baltimore Orioles" is the club)
  if (TEAM_NICK_END.test(n) && n.split(' ').length >= 3) {
    n = n.replace(TEAM_NICK_END, '');
    // …and the club's city with it ("Tony Gwynn Hawaii Islanders" → Tony Gwynn); a run that is
    // only the city and a word ("Amazing Baltimore Orioles") is the club
    // ("Nashville Elite Giants": a run LED by a city is the club, whatever follows)
    if (CITY_START.test(n)) return null;
    if (CITY_END.test(n)) {
      const rest = n.replace(CITY_END, '');
      if (rest.split(' ').length < 2 || !nameTokensOk(rest.split(' '))) return null;
      n = rest;
    }
  }
  if (NOT_PERSON_RUN.test(n) || PLACE_RUN.test(n) || TEAM_NICK_END.test(n)) return null;
  // highlight: a caption verb right after ONE word is a surname-only subset card — no athlete to file it
  // under; further in, it ends the name ("Jerry West Sets Scoring Mark" → Jerry West)
  {
    const w = n.split(' ');
    const v = w.findIndex((x, i) => i >= 1 && CAPTION_VERB.test(x));
    if (v === 1) return null;
    if (v > 1) n = w.slice(0, v).join(' ');
  }
  // truncated: a run cut before the surname takes the surname back off the title ("Elly De La"
  // → "Elly De La Cruz", "Jacob De" → "Jacob deGrom"); one that cannot is no name
  if (PARTICLE_END.test(n.split(' ').pop() || '')) {
    const m = new RegExp(`${reEscN(n)}\\s+([A-Z][\\w'’-]+|[a-z]{1,3}[A-Z][\\w'’-]+)`, 'i').exec(t);
    if (!m) return null;
    n = `${n} ${m[1]}`;
  }
  // joined: a duo fused by a hyphen ("Yogi Berra-Phil Rizzuto") — a duo files under its first-named
  const duo = n.match(/^(\S+ \S+?)-([A-Z]\S* \S+)$/);
  if (duo && nameTokensOk(duo[1].split(' ')) && nameTokensOk(duo[2].split(' '))) n = duo[1];
  // joined: given name + the quoted nickname the title prints between it and the surname
  const toks = n.split(' ');
  if (toks.length >= 3) {
    for (let i = 1; i < toks.length - 1; i++) {
      for (let k = 1; k <= 2 && i + k < toks.length; k++) {
        const nick = toks.slice(i, i + k).join(' ');
        const q = new RegExp(`${reEscN(toks.slice(0, i).join(' '))}\\s+[("“]${reEscN(nick)}[)"”]\\s+${reEscN(toks.slice(i + k).join(' '))}`);
        if (q.test(t)) {
          const keep = NICKNAME_IS_NAME.has(nick) ? [nick, ...toks.slice(i + k)] : [...toks.slice(0, i), ...toks.slice(i + k)];
          n = keep.join(' ');
          i = toks.length; break;
        }
      }
    }
  }
  // a reader that dropped the nickname ('Larry "Yogi" Berra' → "Larry Berra") gets it back when it IS the name
  const two = n.split(' ');
  if (two.length === 2) {
    const m = new RegExp(`(?:^|\\s)${reEscN(two[0])}\\s+[("“]([A-Z][A-Za-z]+(?: [A-Z][a-z]+)?)[)"”]\\s+${reEscN(two[1])}(?![A-Za-z])`).exec(t);
    if (m && NICKNAME_IS_NAME.has(m[1])) n = `${m[1]} ${two[1]}`;
  }
  // run-on: caption words after the name, and a colour bound to the back / base
  const ok = (x: string) => nameTokensOk(x.split(' ')) || nameTokensOk(x.normalize('NFD').replace(/[̀-ͯ]/g, '').split(' '));
  for (let i = 0; i < 3; i++) {
    const before = n;
    // a trim stands only when what is left still reads as a name ("Booker T. Washington" keeps its surname)
    if (n.split(' ').length > 2) { const c = n.replace(RUN_ON_TAIL, '').replace(RUN_ON_LEAD, ''); if (c !== n && ok(c)) n = c; }
    const w = n.split(' ');
    if (w.length > 2) {
      const last = w[w.length - 1];
      const at = t.search(new RegExp(`${reEscN(w.slice(0, -1).join(' '))}\\s+${reEscN(last)}\\s`));
      if (at >= 0 && COLOUR_BACK.test(t.slice(at + w.slice(0, -1).join(' ').length).trim()) && ok(w.slice(0, -1).join(' '))) n = w.slice(0, -1).join(' ');
    }
    if (n === before) break;
  }
  // (accents folded for the shape test only: "Alperen Şengün")
  return ok(n) ? n : null;
}


/** the run names no one athlete at all — a subset / team / venue / band / highlight caption —
 *  so not even its first two words may stand in ("Buc Hill Aces" is not "Buc Hill") */
export function notOnePerson(run: string | null | undefined): boolean {
  const n = bareName(String(run || ''));
  if (!n) return true;
  const w = n.split(' ');
  return NOT_PERSON_RUN.test(n) || PLACE_RUN.test(n) || (w.length <= 2 && TEAM_NICK_END.test(n)) || (w.length > 1 && CAPTION_VERB.test(w[1]));
}

/** famous people who are NOT athletes but whose pieces sell on the sports
 *  desks (a president's signed baseball, Marilyn Monroe's photos from the
 *  DiMaggio collection, a Beatle's autograph at a sports house). Measured on
 *  the full local corpus, Oct 10: every one of these had a /player id. Each
 *  stays a PERSON on the sports market (sj:sports|p:…), never a player. */
const PUBLIC_FIGURES: ReadonlySet<string> = new Set([
  // presidents, first ladies, statesmen
  // (never 'john adams' / 'andrew johnson': athletes share those names)
  'george washington', 'thomas jefferson', 'james monroe', 'john hancock', 'abraham lincoln', 'ulysses s grant',
  'rutherford b hayes', 'william mckinley', 'theodore roosevelt', 'william howard taft', 'woodrow wilson', 'warren g harding',
  'calvin coolidge', 'herbert hoover', 'george hw bush', 'franklin d roosevelt', 'franklin delano roosevelt', 'eleanor roosevelt', 'harry truman',
  'harry s truman', 'dwight d eisenhower', 'dwight eisenhower', 'mamie eisenhower', 'john f kennedy', 'jacqueline kennedy',
  'robert f kennedy', 'lyndon b johnson', 'lyndon johnson', 'richard nixon', 'richard m nixon', 'gerald ford', 'jimmy carter',
  'ronald reagan', 'nancy reagan', 'george h w bush', 'george bush', 'george w bush', 'bill clinton', 'hillary clinton',
  'barack obama', 'donald trump', 'joe biden', 'dan quayle', 'winston churchill', 'martin luther king jr', 'mother teresa',
  'pope john paul ii', 'benjamin franklin', 'albert einstein', 'thomas edison', 'henry ford', 'charles lindbergh', 'amelia earhart',
  // entertainers, musicians, artists
  'marilyn monroe', 'elvis presley', 'john lennon', 'paul mccartney', 'george harrison', 'ringo starr', 'michael jackson',
  'bob dylan', 'bruce springsteen', 'frank sinatra', 'bob hope', 'walt disney', 'charlie chaplin', 'john wayne', 'clint eastwood',
  'andy warhol', 'leroy neiman', 'norman rockwell', 'pablo picasso', 'salvador dali', 'jimi hendrix', 'madonna',
  // astronauts
  'neil armstrong', 'buzz aldrin', 'john glenn', 'alan shepard', 'sally ride',
  // (second pass over the no-card /player ids)
  // (never 'grover cleveland': Grover Cleveland Alexander pitched)
  'benjamin harrison', 'franklin roosevelt', 'teddy roosevelt', 'franklin pierce',
  'fidel castro', 'rosa parks', 'dalai lama', 'ernest hemingway', 'charles schulz', 'matt groening', 'mick jagger',
  'janis joplin', 'boris karloff', 'bela lugosi', 'bud abbott', 'lou costello', 'alfred hitchcock', 'greta garbo',
  'jean harlow', 'sib hashian', 'humphrey bogart', 'james dean', 'marlon brando', 'audrey hepburn', 'lucille ball',
]);
const foldName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim();
/** the famous non-athlete a name run names (PUBLIC_FIGURES), in the run's own spelling — also
 *  when a caption runs on after the name ("Ronald Reagan Typewritten Signed Letter", "Abraham
 *  Lincoln Albumen Photograph") or the run stops short of it ("Franklin Delano" of Roosevelt) */
export function publicFigureOf(name: string | null | undefined): string | null {
  const n = bareName(String(name || ''));
  const w = n.split(' ');
  if (w.length < 2) return null;
  for (let k = Math.min(w.length, 4); k >= 2; k--) if (PUBLIC_FIGURES.has(foldName(w.slice(0, k).join(' ')))) return w.slice(0, k).join(' ');
  const f = foldName(n);
  let full: string | null = null;
  PUBLIC_FIGURES.forEach(x => { if (!full && x.startsWith(`${f} `)) full = x; });
  return full ? String(full).split(' ').map(caseWord).join(' ') : null;
}
/** a famous non-athlete (PUBLIC_FIGURES) */
export function isPublicFigure(name: string | null | undefined): boolean {
  return !!publicFigureOf(name);
}
/** athletes the hobby files under ONE name */
const MONONYMS: Record<string, string> = {
  pele: 'Pelé', garrincha: 'Garrincha', eusebio: 'Eusébio', ronaldinho: 'Ronaldinho', kaka: 'Kaká', neymar: 'Neymar',
  zico: 'Zico', romario: 'Romário', rivaldo: 'Rivaldo', ichiro: 'Ichiro', maradona: 'Maradona',
};
/** the one-word athlete a run names, or null */
export function mononymOf(name: string | null | undefined): string | null {
  const f = foldName(String(name || ''));
  if (!f) return null;
  // "Neymar Jr.", "Vini Jr." — the one name plus the suffix the hobby files them under
  const jr = f.match(/^(\S+) jr$/);
  if (jr && JR_MONONYMS[jr[1]]) return JR_MONONYMS[jr[1]];
  return !f.includes(' ') ? MONONYMS[f] ?? null : null;
}
const JR_MONONYMS: Record<string, string> = { neymar: 'Neymar Jr.', vini: 'Vini Jr.', vinicius: 'Vinícius Jr.' };

/**
 * THE athlete test: the canonical athlete a name run names (canonPlayerName
 * + a one-word athlete), or null — no person, or a person who is not an
 * athlete (isPublicFigure). Every /player-making path reads this: the
 * entity key (maker-subjects), the card labels (lot-labels makerLineOf),
 * the pipeline roster (cards knownPlayerSet) and players.json.
 */
export function athleteName(name: string | null | undefined, title: string): string | null {
  const mono = mononymOf(name);
  if (mono) return mono;
  if (isPublicFigure(name)) return null;
  const n = canonPlayerName(name, title);
  return n && !isPublicFigure(n) ? n : null;
}
