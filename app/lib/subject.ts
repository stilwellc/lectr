/**
 * subject.ts — the real subject a memorabilia lot names (Oct 9, round 3).
 *
 * Memorabilia & culture lots sit under pseudo-makers ("Autographs", "Game Worn
 * & Used", "Film & TV", "Space Exploration") whose names only repeat the sub
 * label. When the title names its subject in a shape we can read with ≥90%
 * precision (40-lot spot checks per pseudo-maker on the live book), that
 * subject takes the maker slot. Otherwise null — never a guess.
 *
 * Three readers, per what collectors file a lot under:
 *   person  — "Sylvester Stallone Signed…", "Reggie Bush Game-Used…",
 *             "Al Capone Signature", "1999 Tiger Woods … Type I Original Photo"
 *   film    — screen/production pieces: "…Costume from 8 Mile (2002)",
 *             "Project Hail Mary (2026) Production-Made…"
 *   mission — space: "Apollo 11", "Gemini 4", "Mercury-Atlas 9"
 */

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
/** a leading date/era fragment: "Sep. 29, 1996 ", "1999 ", "94 ", "1980s ", "c. 1972-1985 ", "Aug. 23-25 1991 " */
const LEAD_DATE = new RegExp(
  `^(?:(?:c\\.|circa|ca\\.)\\s*)?(?:${MONTH}\\s+\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?[.,]*\\s+)?` +
  `(?:\\d{4}|\\d{2})(?:'?s)?(?:\\s*(?:to|[-–/])\\s*(?:\\d{4}|\\d{2})(?:'?s)?)?\\s+(?:[-–]\\s+)?`,
);

/** capitalised words that start object/event phrases, never a person's name */
const NOT_NAME = new Set(`
the a an of and or for with from by to in on at vs
signed autographed autograph autographs signature signatures inscribed cut dual twice single multi team cast band
game used worn issued match race fight bout screen stage production made personally owned
type original photo photograph photos photographs snapshot print wire press
framed display rare earliest known vintage complete official authentic unique important historic iconic famous
letter letters typed handwritten document documents check checks contract manuscript book books program programs ticket tickets stub pass
poster posters lobby card cards sheet script lyrics lyric
jersey jerseys bat bats ball baseball football basketball hockey soccer golf boxing glove gloves helmet shoe shoes cleats sneakers trunks robe
trophy trophies award awards ring rings medal medals plaque bobblehead pennant
collection collections archive lot lots pair set group copy replica prop props costume model maquette
nba nfl mlb nhl ncaa pga ufc wwe wwf fifa uefa usa
world series cup championship championships finals final super bowl all star stars hall fame famers olympic olympics
apollo gemini skylab nasa space shuttle mission flown lunar moon project seven
star wars marvel disney looney tunes potter
new york los angeles chicago boston san st saint fort philadelphia detroit cleveland pittsburgh brooklyn cincinnati milwaukee
minnesota kansas houston miami atlanta seattle oakland washington baltimore toronto montreal denver phoenix
agency company corporation records tribute tour concert era estate memorial funeral wedding party show
endorsement endorsements receipt deed note notes memo commission appointment warrant pardon
astronaut astronauts cosmonaut cosmonauts crew crews gang underworld court trial
outfielders infielders pitchers players legends greats champions teammates brothers sisters family members
exhibits salutation
mr mrs ms dr sir lady lord queen prince princess president general captain
rookie pre-rookie career debut first last spring training
weekly sports graphic number nike adidas rawlings topps fleer panini upper deck bowman
home away road blue red silver oversized large small mini limited personal
`.trim().split(/\s+/));

const NAME_TOKEN = /^(?:[A-ZÀ-Ý][a-zà-ÿ'’]*(?:[A-Z][a-zà-ÿ'’]+)?\.?|[A-Z]\.|[A-Z]\.[A-Z]\.|Jr\.?|Sr\.?|II|III|IV|de|van|von|da|del|la|le)$/;
const SUFFIX = /^(?:Jr\.?|Sr\.?|II|III|IV)$/;
const PARTICLE = /^(?:de|van|von|da|del|la|le)$/;
const INITIAL = /^[A-Z]\.(?:[A-Z]\.)?$/;

/** what follows a person's name when the lot is THEIR piece */
const PERSON_VERB = /^(?:Signed|Game (?:Worn|Used|Issued)|Team Issued|Match (?:Worn|Used|Issued)|Autographed|Single-Signed|Twice-Signed|Signature|Cut Signature|Autograph|Typed Letter|Handwritten|Hand-Written|Letter|Check|Document|Contract|Manuscript|Game-Used|Game-Worn|Game-Issued|Match-Used|Match-Worn|Match-Issued|Race-Worn|Race-Used|Fight-Worn|Fight-Used|Bout-Worn|Screen-Used|Screen-Worn|Stage-Worn|Stage-Used|Stage-Played|Production-Used|Production-Worn|Personally[- ]Owned|Owned|Worn|Type I\b|Rookie Type I|Pre-Rookie|Original Photo|Photograph|Photo\b)/;

export function nameTokensOk(toks: string[]): boolean {
  if (toks.length < 2 || toks.length > 4) return false;
  if (PARTICLE.test(toks[0]) || SUFFIX.test(toks[0]) || PARTICLE.test(toks[toks.length - 1])) return false;
  // "Kurt Cobain's Washburn Force" — a possessive ends the name, it never sits inside one
  if (toks.some(t => /['’]s?$/.test(t))) return false;
  // four words only with a suffix/initial/particle in them ("Martin Luther King Jr.") — not "Michael Jackson Victory Tour"
  if (toks.length === 4 && !toks.some(t => SUFFIX.test(t) || PARTICLE.test(t) || INITIAL.test(t))) return false;
  let words = 0;
  for (const t of toks) {
    if (!NAME_TOKEN.test(t)) return false;
    const bare = t.replace(/[.'’]+$/g, '').toLowerCase();
    if (NOT_NAME.has(bare)) return false;
    if (!SUFFIX.test(t) && !PARTICLE.test(t) && !INITIAL.test(t)) words++;
  }
  return words >= 2;
}

const NFL_TEAM = '(?:Cardinals|Falcons|Ravens|Bills|Panthers|Bears|Bengals|Browns|Cowboys|Broncos|Lions|Packers|Texans|Colts|Jaguars|Chiefs|Raiders|Chargers|Rams|Dolphins|Vikings|Patriots|Saints|Giants|Jets|Eagles|Steelers|49ers|Seahawks|Buccaneers|Titans|Commanders)';
/** NFL Auction's "Crucial Catch - Titans Jeffery Simmons Signed Game Worn Jersey" — promo + team lead */
const NFL_LEAD = new RegExp(`^(?:[^-|]{3,48} - )?${NFL_TEAM} (?=[A-Z])`);

/** the title past its leading date/era fragment (and an NFL promo · team lead) */
export function leadOf(title: string): string {
  return title.replace(/\s+/g, ' ').trim().replace(LEAD_DATE, '').replace(NFL_LEAD, '');
}

/** "Sylvester Stallone Signed…" → Sylvester Stallone. One person only —
 *  duos, casts and teams stay null. `knownName` is the pipeline-stamped
 *  athlete; it counts only when the title LEADS with it. */
export function personOf(title: string, knownName?: string | null): string | null {
  const t0 = leadOf(title);
  // RR's "Band: Member Signed…" topic lead ("Queen: Freddie Mercury Signed Photograph") — the
  // member is the signer. A PERSON topic ("Al Capone: Courtland Butler Typed Letter…") is not
  // stripped: there the topic is the subject and the signer a correspondent.
  const topic = t0.match(/^((?:The )?[A-Z][\w'’.&-]*(?: [A-Z][\w'’.&-]*)?): (?=[A-Z])/);
  if (topic && !nameTokensOk(topic[1].split(' '))) {
    const inner = personOf(t0.slice(topic[0].length));
    if (inner) return inner;
  }
  const t = t0;
  if (knownName) {
    const k = knownName.trim();
    const rest = t.slice(k.length);
    const solo = nameTokensOk(k.split(' '));
    // the lead, not a duo or a numbered title ("Kobe Bryant, Michael Jordan Type I", "Hulk Hogan, Mr. T", "Iron Man 2")
    if (solo && t.startsWith(k) && /^\s+[A-Za-z]/.test(rest) && !/^\s*(?:,|\/|&|and\b|vs\.?)\s*[A-Z]/.test(rest)) return k;
    // a magazine/program cover star: "Weekly Baseball Shohei Ohtani Cover (Japan)"
    if (solo && new RegExp(`(?:^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:(?:1st|First|Rookie|Debut)\\s+)?Cover\\b`).test(t)) return k;
  }
  const words = t.split(' ');
  for (let n = 4; n >= 2; n--) {
    if (words.length <= n) continue;
    const toks = words.slice(0, n);
    const comma = toks[n - 1].endsWith(',');
    if (comma) toks[n - 1] = toks[n - 1].slice(0, -1);
    if (!nameTokensOk(toks)) continue;
    if (!PERSON_VERB.test(words.slice(n).join(' '))) continue;
    const name = toks.join(' ');
    // a run-on lead that ENDS with the stamped athlete ("Salutation Exhibits Joe DiMaggio") is the athlete
    return knownName && name !== knownName && name.endsWith(` ${knownName}`) ? knownName : name;
  }
  // a one-word signer — "Madonna Signed Photo", "Coldplay Signed Drumhead", "ABBA Signed Album" —
  // only straight before Signed/Autographed, and never an object/event word ("Framed Signed…")
  const one = t.match(ONE_WORD_SIGNER);
  if (one && !one[1].split(/[-.]/).some(p => NOT_NAME.has(p.toLowerCase()))) return one[1];
  return null;
}

const ONE_WORD_SIGNER = /^([A-Z][A-Za-z0-9]*(?:[-.][A-Z0-9][A-Za-z0-9]*)?) (?:Signed|Twice-Signed|Autographed)\b/;

const YEAR_PAREN = '\\((?:19|20)\\d{2}(?:\\s*[-–]\\s*(?:(?:19|20)?\\d{2}|Present))?\\)';
const FROM = `\\b[Ff]rom (?:(?:the )?(?:Film|Movie|Series|TV Series|Show) |Season \\d+ of |the (?:Set|Production) of )?["“]?`;
/** "…Costume from 8 Mile (2002)" */
const FILM_FROM = new RegExp(`${FROM}([A-Z0-9][^()"”;]{0,58}?)["”]?\\s*${YEAR_PAREN}`);
/** "Project Hail Mary (2026) Production-Made…", "X-Men: Days of Future Past (2014) Production-Used…" */
const FILM_LEAD = new RegExp(`^["“]?([A-Z0-9][^()"”;]{0,58}?)["”]?\\s*${YEAR_PAREN}\\s+(?:[A-Z][\\w'-]+\\s+){0,2}(?:Screen|Production|Stunt|Hero|Cast|Original)`);
/** a yearless "…Prop from The Mandalorian - Ursa Authentic OOA" — the film runs to the " - " break */
const FILM_FROM_BARE = new RegExp(`${FROM}((?:The |A )?[A-Z0-9][\\w'’.&:,-]*(?: (?:[A-Z0-9][\\w'’.&:,-]*|of|the|and|a|in|on|vs\\.?|&)){0,7}?)["”]?(?:\\s+-\\s|\\s*$)`);
/** a numbered/coloned franchise leading a screen piece: "Gladiator II Screen-Used…", "Star Wars: Andor Production-Made…" */
const FILM_LEAD_BARE = /^([A-Z][\w'’.&-]*(?: [A-Z0-9][\w'’.&-]*){0,4}?(?:: [A-Z][\w'’.&-]*(?: [A-Z0-9][\w'’.&-]*){0,3}| (?:II|III|IV|V|VI|VII|\d)))\s+(?:Screen|Production)[- ](?:Used|Worn|Made)\b/;
const NOT_FILM = /\b(?:Various|Collection|Estate|Personal|Archive|Studios?|Productions|LOA|COA|OOA|LOP|Auction)\b/;
const SCREEN_WORD = /\b(?:Screen|Production|Prop|Props|Costume|Stunt|Hero|Set Decoration|Maquette|Puppet|Wardrobe)\b/i;

/** the film/series a screen-used or production piece comes from */
export function filmOf(title: string): string | null {
  const t = leadOf(title);
  // two different dated productions ("Batman Returns (1992) and Batman Forever (1995)") — no single film
  const years = new Set((t.match(new RegExp(YEAR_PAREN, 'g')) || []));
  if (years.size > 1) return null;
  let m = t.match(FILM_FROM) || t.match(FILM_LEAD);
  if (!m && SCREEN_WORD.test(t)) m = t.match(FILM_FROM_BARE) || t.match(FILM_LEAD_BARE);
  const f = m?.[1]?.trim().replace(/[\s,:–-]+$/, '') ?? null;
  if (!f) return null;
  const words = f.split(' ');
  if (words.length > 8 || f.length < 2 || (words.length === 1 && f.length <= 3 && !/^\d+$/.test(f))) return null;
  if (NOT_FILM.test(f) || /^(?:The|A|An)$/i.test(f) || /^(?:His|Her|Their|Its|My|Our)\b/i.test(f)) return null;
  return f;
}

const MISSION = /\b(Apollo(?: |-)\d{1,2}|Gemini(?: |-)(?:\d{1,2}|[IVX]+)\b|Mercury-(?:Redstone|Atlas) \d|Skylab(?: (?:\d|II|III|IV)\b)?|STS-\d{1,3}(?:-?[A-Z]\b)?|Vostok \d|Voskhod \d|Soyuz(?: |-)\d{1,2}|Artemis I{1,3}|Friendship 7|Freedom 7|Faith 7|Sigma 7|Aurora 7|Liberty Bell 7)\b/g;

/** the one space mission a lot names ("Apollo 11"); two different missions → null */
export function missionOf(title: string): string | null {
  const ROMAN: Record<string, string> = { II: '2', III: '3', IV: '4' };
  const hits = new Set((title.match(MISSION) || []).map(m => m
    .replace(/^(Apollo|Gemini|Soyuz)-/, '$1 ')
    .replace(/^Skylab (II|III|IV)$/, (_, r: string) => `Skylab ${ROMAN[r]}`)));
  return hits.size === 1 ? Array.from(hits)[0] : null;
}

export type SubjectKind = 'person' | 'film' | 'mission';
export interface Subject { name: string; kind: SubjectKind }

/** which readers each pseudo-maker runs, in order — props file under the film,
 *  space under the mission, everything else under the person */
const READERS: Record<string, SubjectKind[]> = {
  'autographs': ['person'],
  'game-used': ['person'],
  'type-1-photos': ['person'],
  'tickets-passes': ['person'],
  'programs-publications': ['person'],
  'trophies-awards': ['person'],
  'sports-memorabilia': ['person'],
  'memorabilia': ['person'],
  'equipment-artifacts': ['person'],
  'movie-tv': ['film', 'person'],
  'entertainment-memorabilia': ['film', 'person'],
  'music-memorabilia': ['person'],
  'pop-memorabilia': ['person'],
  'space-exploration': ['mission', 'person'],
  'science-tech': ['person'],
};

/** the subject a pseudo-maker lot names, or null */
export function subjectOf(lot: { artist: string; title?: string | null; playerName?: string | null }): Subject | null {
  const order = READERS[lot.artist];
  const title = String(lot.title || '');
  if (!order || !title) return null;
  for (const kind of order) {
    const name = kind === 'film' ? filmOf(title) : kind === 'mission' ? missionOf(title) : personOf(title, lot.playerName);
    if (name) return { name, kind };
  }
  return null;
}
