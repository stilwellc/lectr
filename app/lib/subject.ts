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

import { teamOf, teamCardOf, productLineOf, pokemonSetOf, POKE_SETLIKE, programOf, instrumentBrandOf } from './subject-groups';

const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
/** a leading date/era fragment: "Sep. 29, 1996 ", "1999 ", "94 ", "1980s ", "c. 1972-1985 ", "Aug. 23-25 1991 " */
const LEAD_DATE = new RegExp(
  `^(?:(?:c\\.|circa|ca\\.)\\s*)?(?:${MONTH}\\s+\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?[.,]*\\s+)?` +
  `(?:\\d{4}|\\d{2})(?:'?s)?(?:\\s*(?:to|[-–/])\\s*(?:\\d{4}|\\d{2})(?:'?s)?)?\\s+(?:[-–]\\s+)?`,
);

/** one-word cities: a team lead ("Boston Celtics", "Chicago Bulls") when FIRST, a surname
 *  after ("Whitney Houston", "George Washington", "Grover Cleveland", "John Denver") */
const CITY_FIRST = new Set('chicago boston philadelphia detroit cleveland pittsburgh brooklyn cincinnati milwaukee minnesota kansas houston miami atlanta seattle oakland washington baltimore toronto montreal denver phoenix dallas'.split(' '));

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
new york los angeles san st saint fort
agency company corporation records tribute tour concert era estate memorial funeral wedding party show
endorsement endorsements receipt deed note notes memo commission appointment warrant pardon
astronaut astronauts cosmonaut cosmonauts crew crews gang underworld court trial
outfielders infielders pitchers players legends greats champions teammates brothers sisters family members
exhibits salutation
mr mrs ms dr sir lady lord queen prince princess president general captain
rookie pre-rookie career debut first last spring training
weekly sports graphic number nike adidas rawlings topps fleer panini upper deck bowman
home away road blue red silver oversized large small mini limited personal
sox wings jays cross carpet hot devils pictures studios films entertainment factory sealed
war dated era period same national league american
pioneers moonwalkers commanders icons heroes winners
`.trim().split(/\s+/));

const NAME_TOKEN = /^(?:[A-ZÀ-Ý][a-zà-ÿ'’]*(?:[A-Z][a-zà-ÿ'’]+)?(?:-[A-ZÀ-Ý][a-zà-ÿ'’]+)?\.?|[A-Z]\.|[A-Z]\.[A-Z]\.|Jr\.?|Sr\.?|II|III|IV|de|van|von|da|del|la|le)$/;
const LETTERED = /^(?:JJ|CJ|AJ|TJ|DJ|PJ|RJ|OG|KJ|BJ|CC|JT|JD|JR|DK|JP|TK|AJ|JK|DJ)$/;
const SUFFIX = /^(?:Jr\.?|Sr\.?|II|III|IV)$/;
const PARTICLE = /^(?:de|van|von|da|del|la|le)$/;
const INITIAL = /^[A-Z]\.(?:[A-Z]\.)?$/;

/** what follows a person's name when the lot is THEIR piece */
const PERSON_VERB = /^(?:Signed|Game (?:Worn|Used|Issued)|Team Issued|Match (?:Worn|Used|Issued)|Autographed|Single-Signed|Twice-Signed|Signature|Cut Signature|Autograph|Typed Letter|Handwritten|Hand-Written|Letter|Check|Document|Contract|Manuscript|Game-Used|Game-Worn|Game-Issued|Match-Used|Match-Worn|Match-Issued|Race-Worn|Race-Used|Fight-Worn|Fight-Used|Bout-Worn|Screen-Used|Screen-Worn|Stage-Worn|Stage-Used|Stage-Played|Production-Used|Production-Worn|Personally[- ]Owned|Owned|Worn|Type I\b|Type 1\b|Rookie Type I|Pre-Rookie|Original Photo|Photograph|Photo\b|Handprints?\b|Hand-Signed|Inscribed|(?:MLB |NFL |NBA |NHL |WNBA |PGA |UFC |Major League |World Cup |Pro |Professional |Olympic )?Debut\b|\d+(?:st|nd|rd|th) Career\b|Career (?:Win|Home Run|Hit|Game|Touchdown|Goal|Start|Victory)\b|(?:Final|Last|First) (?:Career |MLB |NFL |NBA |NHL )?Game\b|Band[- ]Signed|Group[- ]Signed|(?:Framed )?RIAA\b|(?:Gold|Platinum|Multi-Platinum|Double-Platinum|Triple-Platinum) (?:Record|Album|Sales)\b|as (?=[A-Z]))/;
/** what follows a DUO ("Mickey Mantle and Roger Maris Dual-Signed…") */
const DUO_VERB = /^(?:Dual-Signed|Dual Signed|Multi-Signed|Co-Signed|Signed|Autographed)\b/;
/** words between a name and its verb that never change whose piece it is ("Charlie Duke Oversized Signed Photograph") */
const QUALIFIER = /^(?:\([^)]{1,40}\)\s+)?(?:["“][^"”]{1,50}["”]\s+)?(?:(?:Oversized|Vintage|Rare|Large|Early|Framed)\s+){0,2}/;
const verbAfter = (rest: string, re: RegExp = PERSON_VERB) => re.test(rest.replace(QUALIFIER, ''));


export function nameTokensOk(toks: string[]): boolean {
  if (toks.length < 2 || toks.length > 4) return false;
  if (PARTICLE.test(toks[0]) || SUFFIX.test(toks[0]) || PARTICLE.test(toks[toks.length - 1]) || INITIAL.test(toks[toks.length - 1])) return false;
  // "Kurt Cobain's Washburn Force" — a possessive ends the name, it never sits inside one
  if (toks.some(t => /['’]s?$/.test(t))) return false;
  // four words only with a suffix/initial/particle in them ("Martin Luther King Jr.") — not "Michael Jackson Victory Tour"
  if (toks.length === 4 && !toks.some(t => SUFFIX.test(t) || PARTICLE.test(t) || INITIAL.test(t) || /^(?:De|La|Del|Da|Van|Von|Le|Di|Du|Mac)$/.test(t))) return false;
  let words = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    // "JJ McCarthy", "CJ Stroud", "OG Anunoby" — a lettered first name, never "AL"/"NL" leaders
    if (!NAME_TOKEN.test(t) && !(i === 0 && LETTERED.test(t) && toks.length >= 2)) return false;
    const bare = t.replace(/[.'’]+$/g, '').toLowerCase();
    // "Red Schoendienst", "Red Grange" — the nickname, never "Red Sox" (sox is not a name)
    const nick = i === 0 && bare === 'red' && toks.length === 2;
    if (!nick && (NOT_NAME.has(bare) || bare.split('-').some(p => NOT_NAME.has(p)))) return false;
    if (i === 0 && CITY_FIRST.has(bare)) return false;
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

/** "Sylvester Stallone Signed…" → Sylvester Stallone. One person — a duo
 *  files under its first-named (r5); casts and teams stay null here. `knownName` is the pipeline-stamped
 *  athlete; it counts only when the title LEADS with it. */
export function personOf(title: string, knownName?: string | null): string | null {
  // a quoted nickname inside the name reads past: 'Walt "Clyde" Frazier Signed…' → Walt Frazier
  const t0 = leadOf(title).replace(/^([A-Z][a-z]+) ["“][A-Z][^"”]{0,20}["”] (?=[A-Z][a-z])/, '$1 ');
  // RR's "Band: Member Signed…" topic lead ("Queen: Freddie Mercury Signed Photograph") — the
  // member is the signer. A PERSON topic ("Al Capone: Courtland Butler Typed Letter…") is not
  // stripped: there the topic is the subject and the signer a correspondent.
  const topic = t0.match(/^((?:The )?[A-Z][\w'’.&-]*(?: [A-Z][\w'’.&-]*)?): (?=[A-Z])/);
  if (topic && !nameTokensOk(topic[1].split(' '))) {
    const inner = personOf(t0.slice(topic[0].length));
    if (inner) return inner;
    // "The Who: Daltrey and Entwistle Signed Album" — the band topic, when its members sign
    if (/^The [A-Z]/.test(topic[1]) && !NOT_ACT.test(topic[1]) && /\b(?:Signed|Autographed)\b/.test(t0)) return topic[1];
  }
  // "U. S. Grant Document Signed…" — the one president catalogued by initials
  if (/^U\.\s?S\. Grant\b/.test(t0) && verbAfter(t0.replace(/^U\.\s?S\. Grant\s+/, ''))) return 'Ulysses S. Grant';
  // "Collection of James Stewart Vintage Studio Photographs" — one person's archive
  const coll = t0.match(/^(?:Collection|Archive|Group|Lot) of (?:\(\d+\) )?((?:[A-Z][\w.'’-]*\s){1,3}?[A-Z][\w.'’-]*) (?:(?:Vintage|Original|Studio|Press|Publicity|Personal|Signed)\s+){0,3}(?:Photographs|Photos|Letters|Documents|Scripts|Negatives|Slides)\b/);
  if (coll && nameTokensOk(coll[1].split(' '))) return coll[1];
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
  // "Tom Seaver/Joe Namath Type I" — a slash joins two names like "and"
  const words = t.replace(/([a-z.])\/(?=[A-Z])/g, '$1 / ').split(' ');
  for (let n = 4; n >= 2; n--) {
    if (words.length <= n) continue;
    const toks = words.slice(0, n);
    const comma = toks[n - 1].endsWith(',');
    if (comma) toks[n - 1] = toks[n - 1].slice(0, -1);
    if (!nameTokensOk(toks)) continue;
    const name = toks.join(' ');
    const rest = words.slice(n).join(' ');
    if (verbAfter(rest)) {
      // a run-on lead that ENDS with the stamped athlete ("Salutation Exhibits Joe DiMaggio") is the athlete
      return knownName && name !== knownName && name.endsWith(` ${knownName}`) ? knownName : name;
    }
    // (r5) a DUO files under the first-named: "Mickey Mantle and Roger Maris Dual-Signed…",
    // "Glenn Frey, The Eagles Type I…", "Tom Seaver/Joe Namath Type I…". Exactly two parties —
    // a third name ("John Glenn, Charles Conrad, and Gordon Cooper") is a group, never a guess.
    if (duoTail(words.slice(n), comma)) return name;
  }
  // "Liza Minnelli's Rodolfo Valentino Award", "J. Edgar Hoover's (2) Dress Canes" — a possessive lead is the owner
  const poss = t.match(/^((?:[A-Z][\w.-]*\s){1,3}[A-Z][\w-]*?)['’]s\s+(?=[A-Z(])/);
  if (poss && nameTokensOk(poss[1].split(' '))) return poss[1];
  // royalty: "Queen Victoria Letter Signed", "King Edward VIII Typed Letter Signed"
  const royal = t.match(ROYAL);
  if (royal && !NOT_NAME.has(royal[2].toLowerCase()) && verbAfter(t.slice(royal[0].length))) return royal[0].trim();
  // a one-word signer — "Madonna Signed Photo", "Coldplay Signed Drumhead", "ABBA Signed Album",
  // "Soundgarden Type I Original Photo", "Geronimo Signature" — only straight before the verb, and
  // never an object/event word ("Framed Signed…")
  const one = t.match(ONE_WORD_SIGNER);
  if (one && !one[1].split(/[-.]/).some(p => NOT_NAME.has(p.toLowerCase()))) return one[1];
  return null;
}

const ROYAL = /^(King|Queen|Emperor|Empress|Pope|Tsar|Czar|Kaiser|Princess|Prince) ([A-Z][a-z]+)(?: (?:[IVX]{1,5}\b))? /;

/** the words after the first name of a duo: a second party (1–4 name words, or "The <Band>"), then the verb */
function duoTail(after: string[], comma: boolean): boolean {
  let i = 0;
  if (!comma) {
    if (!/^(?:and|&|\/)$/.test(after[0] || '')) return false;
    i = 1;
  }
  for (let m = 1; m <= 4; m++) {
    const toks = after.slice(i, i + m);
    if (toks.length < m) return false;
    const last = toks[m - 1];
    if (/,$/.test(last)) return false;  // a third party
    const bare = toks.map(x => x.replace(/[.'’]+$/g, ''));
    const party = nameTokensOk(toks)
      || (toks[0] === 'The' && m >= 2 && m <= 3 && bare.slice(1).every(x => /^[A-Z]/.test(x) && !NOT_NAME.has(x.toLowerCase())))
      || (m === 1 && /^[A-Z][A-Za-z!]+$/.test(toks[0]) && !NOT_NAME.has(bare[0].toLowerCase()))
      || (m === 2 && /^(?:Mr|Mrs|Ms|Dr)\.$/.test(toks[0]) && /^[A-Z]/.test(toks[1]));
    if (!party) continue;
    const rest = after.slice(i + m).join(' ');
    if (verbAfter(rest) || verbAfter(rest, DUO_VERB)) return true;
  }
  return false;
}

const ONE_WORD_SIGNER = /^([A-Z][A-Za-z0-9!]*(?:[-.][A-Z0-9][A-Za-z0-9]*)?) (?:\([^)]{1,30}\) )?(?:Signed|Twice-Signed|Band-Signed|Autographed|Signature\b|Type I\b|Type 1\b|Handwritten\b)/;

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

/** "Star Trek Cast-Signed Photo" / "Signed by the Cast of The Godfather" → the work */
const CAST_LEAD = /^["“]?([A-Z0-9][^"”,;()]{1,48}?)["”]?\s+(?:\((?:19|20)\d{2}\)\s+)?(?:Original\s+)?Cast[- ](?:Signed|Autographed|Multi-Signed)\b/;
const CAST_BY = /\bSigned by (?:the |The )?(?:Original )?Cast(?: Members)? of ["“]?((?:The |A )?[A-Z0-9][\w'’.&:-]*(?: (?:[A-Z0-9][\w'’.&:-]*|of|the|and|in|on|&)){0,6}?)["”]?(?=$|[\s,;(-])/;
export function castOf(title: string): string | null {
  const t = leadOf(title);
  const m = t.match(CAST_LEAD) || t.match(CAST_BY);
  const w = m?.[1]?.trim().replace(/[\s,:–-]+$/, '');
  if (!w || w.split(' ').length > 7 || NOT_FILM.test(w) || /['’]s?$/.test(w) || /^(?:The|A|An|Original|Full|Complete)$/i.test(w)) return null;
  // "Bob Weir & RatDog Cast…" is not a work — the run must not be two names
  if (/\b(?:and|&)\b/.test(w) && w.split(/\s+(?:and|&)\s+/).every(x => nameTokensOk(x.split(' ')))) return null;
  return w;
}

/** what follows a band name when the lot is the band's piece */
const BAND_VERB = /^(?:\([^)]{1,30}\)\s+)?(?:(?:Oversized|Vintage|Rare|Early|Framed|Original)\s+)?(?:Framed RIAA|RIAA|Band[- ]Signed|Group[- ]Signed|Multi-Signed|Fully Signed|Signed|Autographed|Type I\b|Type 1\b|Original Photo|Concert (?:Poster|Ticket|Handbill|Program)|Tour (?:Program|Book|Poster|Jacket)|Gold Record|Platinum Record|RIAA)/;
/** the run after "ACT - " that shows it is a music piece: a quoted album/single, or a music object */
const ACT_DASH_MUSIC = /^(?:["“]|.{0,60}?\b(?:Concert|Tour|Handbill|Vinyl|Album|LP|Cassette|Single|Record|Backstage|Setlist|Set List|Itinerary)\b)/;
const NOT_ACT = /\b(?:Hall|Arena|Stadium|Theatre|Theater|Ballroom|Coliseum|Garden|Festival|Fair|Records|Music|Radio|Auditorium|Center|Centre|Club|Amphitheater|Pavilion|Bowl|Forum|Fillmore|Winterland|Collection|Lot|Archive|Set)\b/;
const ACT_TOKEN = /^(?:[A-Z0-9][\w'’.!&+-]*|&|of|the|and|Mc[A-Z]\w*)$/;

/**
 * (r5) A band / act a music lot leads with: "The Beatles Signed…", "The Police
 * Signed Oversized Photograph", "Aerosmith - "Aerosmith" Signed Vinyl Sleeve",
 * "Led Zeppelin - Concert Poster". One act only; venues and festivals never.
 */
export function actOf(title: string): string | null {
  const t = leadOf(title);
  if (/^The [A-Z]/.test(t)) {
    const w = t.split(' ');
    // shortest band name first: "The Police Signed…", "The Jackson 5 Type I…"
    for (let n = 2; n <= 4 && n < w.length; n++) {
      const toks = w.slice(1, n);
      if (!/^[A-Z]/.test(toks[0]) || !toks.every(x => /^(?:[A-Z0-9][\w'’.!&-]*|of|and|&)$/.test(x))) break;
      const band = w.slice(0, n).join(' ');
      if (!BAND_VERB.test(w.slice(n).join(' ').replace(/^["“][^"”]{1,50}["”]\s+/, ''))) continue;
      if (toks.every(x => !NOT_NAME.has(x.toLowerCase().replace(/[.'’!]+$/, '')) || /^(?:of|and|&)$/.test(x)) && !NOT_ACT.test(band)) return band;
      break;
    }
  }
  const dash = t.match(/^([^-–"“:()]{2,40}?) [-–] (.*)$/);
  if (dash) {
    const act = dash[1].trim();
    const toks = act.split(' ');
    if (toks.length <= 5 && toks.every(x => ACT_TOKEN.test(x)) && !NOT_ACT.test(act) && !/^\d/.test(act)
      && !toks.some(x => NOT_NAME.has(x.toLowerCase().replace(/[.'’!]+$/, '')) && !/^(?:the|of|and|&)$/i.test(x))
      && ACT_DASH_MUSIC.test(dash[2])) return act;
  }
  return null;
}

export type SubjectKind = 'person' | 'film' | 'mission' | 'team' | 'set' | 'program' | 'brand';
/** a reader: the kinds above plus the two that print as one of them (a cast → its film, an act → a person row) */
type Reader = SubjectKind | 'cast' | 'act';
export interface Subject { name: string; kind: SubjectKind }

/** which readers each pseudo-maker runs, in order — props file under the film,
 *  space under the mission, everything else under the person; (r5) then the
 *  collective subjects: a team-signed piece under the team-season, a cast
 *  piece under its work, a band piece under the act, sealed wax under its
 *  product line, an un-numbered space piece under its program, an instrument
 *  under its maker */
const READERS: Record<string, Reader[]> = {
  'autographs': ['person', 'team'],
  'game-used': ['person', 'team'],
  'type-1-photos': ['person', 'team'],
  'tickets-passes': ['person'],
  'programs-publications': ['person', 'team'],
  'trophies-awards': ['person', 'team'],
  'sports-memorabilia': ['person', 'team'],
  'memorabilia': ['person', 'team'],
  'equipment-artifacts': ['person', 'team'],
  'unopened-wax': ['set'],
  'movie-tv': ['film', 'cast', 'person'],
  'entertainment-memorabilia': ['film', 'cast', 'brand', 'person', 'act'],
  'music-memorabilia': ['brand', 'person', 'act'],
  'pop-memorabilia': ['person', 'act'],
  'space-exploration': ['mission', 'person', 'program'],
  'science-tech': ['person'],
};

function readOne(kind: Reader, title: string, playerName?: string | null): Subject | null {
  let name: string | null;
  switch (kind) {
    case 'film': name = filmOf(title); break;
    case 'cast': name = castOf(title); return name ? { name, kind: 'film' } : null;
    case 'mission': name = missionOf(title); break;
    case 'act': name = actOf(title); return name ? { name, kind: 'person' } : null;
    case 'team': name = teamOf(title); break;
    case 'set': name = productLineOf(title); break;
    case 'program': name = programOf(title); break;
    case 'brand': name = instrumentBrandOf(title); break;
    default: name = personOf(title, playerName);
  }
  return name ? { name, kind } : null;
}

/** sports card lots that name a set, not one card */
const CARD_SETLIKE = /\b(?:Complete Set|Near Set|Partial Set|Master Set|Team Set|Factory Set|Starter Set|Set \(|Collection \(|Lot \(|Lot of|Uncut Sheet|Graded Collection|Factory-Sealed|Factory Sealed|Unopened|Sealed|Wax (?:Box|Pack)|Hobby Box|Blaster Box|Box \(|Pack \()/;

/** (r5) the set / team a card-maker or Pokémon lot names when no player / Pokémon reads */
export function cardGroupOf(lot: { artist: string; title?: string | null }): Subject | null {
  const title = String(lot.title || '');
  if (!title) return null;
  if (lot.artist === 'sports-cards' || lot.artist === 'graded-cards') {
    if (CARD_SETLIKE.test(title)) {
      const p = productLineOf(title);
      if (p) return { name: p, kind: 'set' };
    }
    const tc = teamCardOf(title);
    return tc ? { name: tc, kind: 'team' } : null;
  }
  if (lot.artist === 'pokemon' && POKE_SETLIKE.test(title)) {
    const s = pokemonSetOf(title);
    return s ? { name: s, kind: 'set' } : null;
  }
  return null;
}

/** the subject a pseudo-maker lot names, or null */
export function subjectOf(lot: { artist: string; title?: string | null; playerName?: string | null }): Subject | null {
  const order = READERS[lot.artist];
  const title = String(lot.title || '');
  if (!order || !title) return null;
  for (const kind of order) {
    const hit = readOne(kind, title, lot.playerName);
    if (hit) return hit;
  }
  return null;
}
