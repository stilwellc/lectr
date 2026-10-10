/**
 * maker-subjects.ts — who a collection lot is ABOUT, as a roster row (Oct 9, r4).
 *
 * On the art / design / watch books the roster's maker IS the name a collector
 * shops by. On the collection books (sports, TCG, science, pop culture) the
 * maker slot held pseudo-makers ("Graded Cards", "Autographs", "Space
 * Exploration") and then clean sub-categories ("Cards · Singles") — neither is
 * how a reader thinks. They think in players, Pokémon, people, films,
 * franchises and missions. This folds the readers we already trust into one
 * stable row key per lot:
 *
 *   player    a parsed card's player, or a memorabilia lot's athlete (keyed by
 *             the /player slug, so Ohtani's cards and his game-used bat share
 *             one row) — app/lib/lot-labels makerLineOf · app/lib/subject
 *   pokemon   the Pokémon a numbered card names (makerLineOf)
 *   person    a signer / owner the title leads with (subject.personOf)
 *   film      the film a screen-used piece comes from (subject.filmOf) — a
 *             Star Wars / Harry Potter / Marvel film files under its franchise
 *   franchise an entertainment lot with no person or film but a franchise facet
 *   mission   the one space mission a lot names (subject.missionOf), or (r5)
 *             its program when no numbered mission reads ("Apollo")
 *   team      (r5) a team-signed piece's team-season, a team card's team
 *   set       (r5) sealed wax / set lots: product line + year ("1986 Fleer
 *             Basketball"); sealed Pokémon / set lots: the set ("Base Set")
 *   brand     (r5) an instrument's maker ("Gibson")
 *
 * No reader → null: the page files the lot under its market's "everything
 * else" row so every live lot is still counted exactly once.
 */
import { marketOf, ARTIST_LABEL, type Market } from '../constants';
import { makerLineOf } from './lot-labels';
import { subjectOf, nameTokensOk, cardGroupOf, leadOf } from './subject';

const CARD_MAKERS = new Set(['sports-cards', 'graded-cards']);
import { playerSlugOf, parseCard, cardLadderKey } from './cards';
import { lotFacets, FACET_LABEL } from './facets';

export type SubjectKind = 'player' | 'pokemon' | 'person' | 'film' | 'franchise' | 'mission' | 'team' | 'set' | 'brand';

export interface LotSubject {
  /** stable within a market: `p:<player-slug>`, `k:<pokemon>`, `f:<film>`, `fr:<facet>`, `m:<mission>`,
   *  `t:<team>`, `s:<set>`, `b:<brand>` */
  key: string;
  name: string;
  kind: SubjectKind;
  /** the /player slug when the subject is a person (athlete or not) */
  playerSlug: string | null;
}

/** the markets whose roster lists subjects instead of makers */
export const SUBJECT_MARKETS: ReadonlySet<Market> = new Set<Market>(['sports', 'tcg', 'science', 'culture']);

/** film franchises a collector shops as one name (not studios: Disney stays per film) */
const FILM_FRANCHISE = new Set(['fr-starwars', 'fr-potter', 'fr-marvel']);

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type SubjectLot = Parameters<typeof makerLineOf>[0] & Parameters<typeof lotFacets>[0];

function franchiseOf(l: SubjectLot): string | null {
  let out: string | null = null;
  lotFacets(l).forEach(k => { if (!out && k.startsWith('fr-')) out = k; });
  return out;
}

const memo = new WeakMap<object, { t: string | null | undefined; v: LotSubject | null }>();

/** the subject row a collection lot files under, or null (no confident reader) */
export function lotSubjectOf(l: SubjectLot): LotSubject | null {
  const hit = memo.get(l as object);
  if (hit && hit.t === l.title) return hit.v;
  const v = read(l);
  memo.set(l as object, { t: l.title, v });
  return v;
}

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
   canonPlayerName is applied to EVERY player name before it becomes a key. */

/** words no athlete's name holds: the run is a subset / team / promo card, never a person */
const NOT_PERSON_RUN = /\b(?:Perez-Steele|Berk Ross|Post Cereal|Leaders|Busters|Aces|Hitters|Sluggers|Bombers|Batterymates|Twins Trio|Trio|Variation|Showing|Brewing|Premium|Tournament|Winner|Moments|Co\.?|Inc\.?)(?=\s|$)/i;
/** caption words a house glues after the name — trimmed off the end of the run */
const RUN_ON_TAIL = /\s(?:Pittsburgh|Boston|Brooklyn|Philadelphia|Detroit|Baltimore|Seattle|Oakland|Minnesota|Milwaukee|Atlanta|Cleveland|Houston|Montreal|Toronto|Kansas|UDA|Perfect|Strip|Special|Blasts|News|Label|Hits|Throwing|Batting|Pitching|Fielding|Swinging|Sliding|Catching|Hurls|Clubs|Raps|Age|High|Low|Diamond|Supernova|Aquamarine|Emerald|Sapphire|Ruby|Boldly|Pants|MVP|Graded|Perforated|Proof|Contact-Proof|Day|Engraved|Pristine|Handwritten|Highlights|Chicago|Cincinnati|Endorsed|Pro|Photograph|Photo|Alive)$/i;
/** praise / issuer words a house leads the name with ("Extraordinary Babe Ruth Single-Signed…", "1959 Bazooka Mickey Mantle") */
const RUN_ON_LEAD = /^(?:Extraordinary|Outstanding|Spectacular|Exceptional|Incredible|Remarkable|Stunning|Superb|Important|Historic|Rare|Scarce|Unique|Bazooka|Swell)\s/;
/** a colour the title binds to the card's back / base, never the athlete's surname ("Roberto Clemente White Base") */
const COLOUR_BACK = /^(?:White|Black|Red|Blue|Gray|Grey|Green|Yellow|Orange|Brown|Gold|Silver|Tan|Cream)\s+(?:Back|Base|Borders?|Background|Letter|Name|Cap|Jersey|Uniform)\b/;
/** nicknames that ARE the name the hobby files the athlete under ('Larry "Yogi" Berra' is Yogi Berra;
 *  'Walt "Clyde" Frazier' stays Walt Frazier) */
export const NICKNAME_IS_NAME: ReadonlySet<string> = new Set([
  'Yogi', 'Babe', 'Catfish', 'Honus', 'Dizzy', 'Whitey', 'Duke', 'Goose', 'Magic', 'Lefty', 'Cy', 'Rube', 'Satchel',
  'Mookie', 'Pee Wee', 'Smoky Joe', 'Shoeless Joe', 'Cool Papa', 'Pistol Pete', 'Bubba', 'Tiger', 'Bo',
]);
const reEscN = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bareName = (s: string) => s.replace(/[()"“”]/g, '').replace(/\s+/g, ' ').trim().replace(/(?<=[a-z])['’]$/, '');

/**
 * The one athlete a reader's name run names — or null when the run is no
 * person. Pure: the run and the lot's own title only.
 */
export function canonPlayerName(name: string | null | undefined, title: string): string | null {
  let n = bareName(String(name || ''));
  if (!n) return null;
  const t = String(title || '');
  if (NOT_PERSON_RUN.test(n)) return null;
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

/** a player row off a reader's name, canonical (null: no person) */
function playerRow(name: string | null | undefined, title: string, kind: SubjectKind = 'player'): LotSubject | null {
  const n = canonPlayerName(name, title);
  const slug = n ? playerSlugOf(n) : null;
  return n && slug ? { key: `p:${slug}`, name: n, kind, playerSlug: slug } : null;
}

function read(l: SubjectLot): LotSubject | null {
  if (!SUBJECT_MARKETS.has(marketOf(l.artist))) return null;
  const line = makerLineOf(l);
  const fallback = ARTIST_LABEL[l.artist] || l.artist;
  const title = String(l.title || '');
  // (Oct 10) only a CARD's parsed player reads off the maker line: a person's
  // /player link there depends on which dossiers the page registered, and the
  // row key must not (the build stamps it as `ek` with no registry) — people
  // on memorabilia read through subjectOf below, to the same `p:<slug>` key
  const pm = CARD_MAKERS.has(l.artist) ? line.href.match(/^\/player\?id=(.+)$/) : null;
  // (r7) a subset / leaders card the parser read as a name is no one's — not even its first two words
  if (pm && !NOT_PERSON_RUN.test(line.name)) {
    // the card parser can run a name on into the caption ("Mickey Mantle
    // Boasting Near-Perfect", "AL Home Run Leaders") — a row needs a person
    // (r7: canonPlayerName trims the caption run-ons it knows first)
    const r = nameTokensOk(line.name.split(' ')) || canonPlayerName(line.name, title) ? playerRow(line.name, title) : null;
    if (r) return r;
    // (r5) the run-on's first two words when they ARE a name ("Duke Snider Play Brings", "Roger Clemens Pre-Rookie")
    const two = line.name.split(' ').slice(0, 2);
    const r2 = two.length === 2 && nameTokensOk(two) ? playerRow(two.join(' '), title) : null;
    if (r2) return r2;
  }
  if (CARD_MAKERS.has(l.artist)) {
    const g = cardGroupOf(l);
    if (g) return groupRow(g.name, g.kind);
    // (r6) a slot run that is not a person falls through to the pipeline stamp below (rosterCardPlayerOf)
    // (r5) a card with no number to key (pre-war, oddball issues: "1928 Exhibits Frank Frisch") —
    // the pipeline-stamped athlete, when the title spells that exact name
    const pn = l.playerName?.trim();
    const t = String(l.title || '');
    // …and the only name on it: never a multi-signed piece or a "Jordan/Bird/Magic" run
    const solo = pn && !/\b(?:Multi-Signed|Dual-Signed|Triple|Trio|Quad)\b/.test(t) && !t.includes(`${pn}/`) && !t.includes(`/${pn}`);
    // (r6) a nickname the title quotes / parenthesises is part of the spelling ("Roberto (Bob) Clemente", 'Larry "Yogi" Berra')
    const spelled = !!pn && (t.includes(pn) || t.replace(/[()"“”]/g, '').replace(/\s+/g, ' ').includes(pn));
    const pr = solo && nameTokensOk(pn.split(' ')) && spelled ? playerRow(pn, t) : null;
    if (pr) return pr;
  }
  if (l.artist === 'pokemon') {
    // the maker line carries a sealed lot's set too (r5) — that is a set row, not a Pokémon
    const g = cardGroupOf(l);
    if (g && line.name === g.name) return groupRow(g.name, g.kind);
    if (!line.name || line.name === fallback) return null;
    // (Oct 10) one row per SPECIES: "Dark Charizard", "Blaine's Charizard",
    // "Charizard VMAX" and "Mega Charizard X ex" are all Charizard (the card
    // name split 105 live Charizard lots over 30 rows)
    const sp = pokemonSpeciesOf(line.name);
    return { key: `k:${norm(sp)}`, name: sp, kind: 'pokemon', playerSlug: null };
  }
  // (r5) a signed card catalogued under Autographs ("Signed 1989 Score #645 Randy Johnson Rookie") — the card's player
  if (l.artist === 'autographs' && /^Signed (?:18|19|20)\d{2}\b/.test(String(l.title || ''))) {
    const id = parseCard(String(l.title).slice(7));
    if (!id.multi && !id.notCard && id.player && cardLadderKey(id) && nameTokensOk(id.player.split(' '))) {
      const r = playerRow(id.player, title);
      if (r) return r;
    }
  }
  const s = subjectOf(l);
  // (Oct 10, P3) a sports OBJECT lot the title readers miss — lower-case
  // desk titles ("michael jordan 1998 nba finals ‘the last dance’ game worn
  // jersey"), ALL-CAPS ones, a lot-number lead ("182 Mickey Mantle Signed…"),
  // a name with no verb after it ("Michael Jordan 1992 Olympic … Jersey") —
  // files under the pipeline-stamped athlete when the title spells that one
  // name (stampedPlayerOf's guards). A team read yields to it only when the
  // athlete LEADS the title ("1938 Lou Gehrig New York Yankees Game-Used
  // Road Jersey" is Gehrig's, not the Yankees').
  if (marketOf(l.artist) === 'sports' && !CARD_MAKERS.has(l.artist) && (!s || s.kind === 'team')) {
    const sp = stampedPlayerOf(l, s?.kind === 'team');
    const r = sp ? playerRow(sp.name, title) : null;
    if (r) return r;
  }
  if (s?.kind === 'mission' || s?.kind === 'program') return { key: `m:${norm(s.name)}`, name: s.name, kind: 'mission', playerSlug: null };
  if (s?.kind === 'team' || s?.kind === 'set' || s?.kind === 'brand') return groupRow(s.name, s.kind);
  if (s?.kind === 'person') {
    // (r5) an act read off the title IS its franchise facet ("The Beatles" / fr-beatles,
    // "The Rolling Stones" / "Rolling Stones") — one row, the facet's
    const bare = (x: string) => norm(x).replace(/^the-/, '');
    const act = franchiseOf(l);
    if (act && !SOLO_ACT[act] && FACET_LABEL[act] && bare(FACET_LABEL[act]) === bare(s.name)) return { key: `fr:${act}`, name: FACET_LABEL[act], kind: 'franchise', playerSlug: null };
    // "The Clash Signed…" and "Clash Band-Signed…" are one act — the row key drops a leading "The"
    // sports memorabilia names an athlete — the same row as their cards (r7: one athlete,
    // canonical; a one-word signer — "Pele Signed…" — or an owner's possessive keeps its read)
    if (marketOf(l.artist) === 'sports') {
      if (NOT_PERSON_RUN.test(s.name)) return null;
      const r = playerRow(s.name, title);
      if (r) return r;
    }
    const slug = marketOf(l.artist) === 'culture' && /^The [A-Z]/.test(s.name) ? playerSlugOf(s.name.slice(4)) : playerSlugOf(s.name);
    if (!slug) return null;
    return { key: `p:${slug}`, name: s.name, kind: marketOf(l.artist) === 'sports' ? 'player' : 'person', playerSlug: slug };
  }
  const fr = franchiseOf(l);
  if (s?.kind === 'film') {
    if (fr && FILM_FRANCHISE.has(fr)) return { key: `fr:${fr}`, name: FACET_LABEL[fr], kind: 'franchise', playerSlug: null };
    return { key: `f:${norm(s.name)}`, name: s.name, kind: 'film', playerSlug: null };
  }
  if (fr) {
    // a solo act's facet IS a person — file it with their signed pieces
    const solo = SOLO_ACT[fr];
    if (solo) return { key: `p:${playerSlugOf(solo)}`, name: solo, kind: 'person', playerSlug: playerSlugOf(solo) };
    return { key: `fr:${fr}`, name: FACET_LABEL[fr], kind: 'franchise', playerSlug: null };
  }
  return null;
}
/** the trainers / teams a card names as the Pokémon's owner ("Blaine's Charizard") */
const POKE_OWNER = /^(?:(?:Team )?Rocket|Team (?:Magma|Aqua|Plasma|Galactic|Flare|Skull|Yell)|Blaine|Brock|Misty|Erika|Sabrina|Koga|Lt\. Surge|Giovanni|Lillie|Butler|Sky|Marnie|Cynthia|Iono|Ethan|Arven|Hop|Steven|Lance|Red|Blue|N|Mega Tokyo|Fukuoka|Tokyo|Osaka|Yokohama|Kyoto|Sapporo|Nagoya|Hiroshima|Tohoku)['’]s /;
/** the nouns of trainer / stadium cards an owner's name leads ("Rocket's Hideout") */
const TRAINER_WORD = /\b(?:Scheme|Hideout|Gym|Way|Plan|Wrath|Perfume|Quiz|Training|Method|Control|Tricks?|Tricky|Secret|Conspiracy|Invasion|Kindness|Rival|Protection|Gambit|Ambush|Fury|Mansion|Lab|Laboratory|Island|Badge|Ball|Energy|Stadium|Tower|Cave|Castle|Base|Ship|Machine|Order|Raid|Gift|Help|Resolve|Determination|Mischief|Pride|Care|Bargain|Request|Fighting Spirit|Assault|Attack)\b/;
/** the variant words a card name wraps around its species */
const POKE_PREFIX = /^(?:Dark|Light|Shining|Crystal|Gold Star|Radiant|Shadow|Ancient|Mega|M|Alolan|Galarian|Hisuian|Paldean|Baby|Cool|Mechanical)\s+/;
const POKE_SUFFIX = /\s+(?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|Prime|LEGEND|Star|δ|[CGF]B?\s*L[Vv]\.?\s*X|L[Vv]\.?\s*X|Lv\.?\s*\d+|Full Art|Holo|[XY](?= ex| EX|$))$/;
/** "Ivy Pikachu", "Red Cheeks Pikachu", "Special Delivery Pikachu" — promo names that end in the species */
const POKE_TAIL_SPECIES = /\s(Pikachu|Charizard|Mewtwo|Eevee|Snorlax|Magikarp)$/;

/** the species a Pokémon card name is about ("Mega Charizard X ex" → "Charizard");
 *  a name with no species pattern (a trainer card, a tag team) is returned as read */
export function pokemonSpeciesOf(name: string): string {
  let s = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/,.*$/, '').replace(/\s+/g, ' ').trim();
  if (/ & /.test(s)) return s; // tag team: its own card name
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(POKE_SUFFIX, '').replace(POKE_PREFIX, '').trim();
    // an owner's Pokémon, never an owner's trainer card ("Giovanni's Scheme")
    const owned = s.replace(POKE_OWNER, '');
    if (owned !== s && !TRAINER_WORD.test(owned)) s = owned.trim();
    if (s === before) break;
  }
  const tail = s.match(POKE_TAIL_SPECIES);
  if (tail) s = tail[1];
  return s || name;
}

/** sealed product is never one athlete's, whatever name the box carries */
const NOT_ONE_ATHLETE_MAKERS = new Set(['unopened-wax']);
/** a piece several people signed — never filed under one of them */
const GROUP_PIECE = /\b(?:multi|dual|team|triple|trio|quad|co|group|band|cast)[- ]?(?:signed|autographed)\b|\bsigned by (?:the |all |\(?\d)|\(\d+\+?\)\s*signatures\b|\b\d+\+?\s+signatures\b/i;
/** words that make the name a lot's highlight or a second party, not its subject */
const NAME_AFTER = /(?:\bwith|\bw\/|\bincluding|\bincl\.?|\bfeaturing|\bfeat\.?|\bplus|\band|&|\/|\bvs\.?|\bversus|,)\s*$/i;
/** another name joined straight after it — a duo / trio, not one athlete's piece */
const NAME_THEN_PARTY = /^\s*(?:,|&|\/|\band\b|\bvs\.?)\s*([A-Za-z][\w'’-]*)\s+([A-Za-z][\w'’-]*)/i;
/** a card parser's run-on into the card's own words ("Aaron Judge Prospect") */
const CARD_TAIL = /\s(?:Prospects?|Auto|Autos|Rc|Patch|Relic|Refractor|Parallel|Variation|Insert|Promo|Proof|Boldly|Nicely|Beautifully|Superbly|Neatly|Clearly|Wonderfully|Exceptionally|Originally)$/i;
/** place / product words a stamped "name" never holds ("Yankee Stadium", "High Grade") */
const NOT_STAMP_NAME = /\b(?:Stadium|Park|Field|Arena|Grade|Graded|Panel|Box|Set|Team|Club|Series|Cup|Bowl|Hall|Gum|Caramel|Tobacco|Postcards?|Exhibits?|Newly|Discovered|Example)\b/i;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&quot;|&#0?39;|&apos;/g, ' ').replace(/[.’'"“”‘()]/g, '').replace(/\s+/g, ' ').trim();
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capWord = (w: string) => (w === w.toUpperCase() || w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);

/**
 * (Oct 10, P3) the athlete the pipeline stamped on a sports OBJECT lot
 * (build-market playerOf over the corpus's known-player roster), when the
 * title backs it as the lot's ONE subject:
 *   - the stamped name reads as a person (nameTokensOk on its cased form —
 *     never "New York", "St. Louis", "Yankee Stadium Seat")
 *   - the title spells it (case, accents, punctuation folded)
 *   - not a multi/dual/team-signed piece, not a highlight ("… Lot with Ted
 *     Williams", "Silk w/Tris Speaker"), not a second party ("Ruth and
 *     Gehrig" stays off Gehrig), and no party joined straight after it
 *     ("Muhammad Ali & George Chuvalo …" stays unassigned here)
 *   - `mustLead`: the name opens the title past a lot number / date lead
 * Pure: reads the lot's own fields only.
 */
export function stampedPlayerOf(l: { artist: string; title?: string | null; playerName?: string | null; playerSlug?: string | null }, mustLead = false): { name: string; slug: string } | null {
  const raw = l.playerName?.trim();
  if (!raw || !l.playerSlug || NOT_ONE_ATHLETE_MAKERS.has(l.artist)) return null;
  const name = raw.split(/\s+/).map(capWord).join(' ');
  // (accents folded for the shape test only: "Alperen Şengün")
  if (!nameTokensOk(fold(name).split(' ')) || CARD_TAIL.test(name) || NOT_STAMP_NAME.test(name)) return null;
  const slug = playerSlugOf(name);
  if (!slug || slug !== l.playerSlug) return null;
  const title = fold(String(l.title || ''));
  if (!title || GROUP_PIECE.test(title)) return null;
  const m = new RegExp(`(^|[^A-Za-z0-9])${reEsc(fold(name))}(?![A-Za-z0-9])`, 'i').exec(title);
  if (!m) return null;
  const at = m.index + m[1].length;
  const before = title.slice(0, at), after = title.slice(at + fold(name).length);
  if (NAME_AFTER.test(before)) return null;
  const party = NAME_THEN_PARTY.exec(after);
  if (party && nameTokensOk([capWord(party[1]), capWord(party[2])])) return null;
  // the lead: nothing but a lot number and a date before the name
  if (mustLead && leadOf(`${before.replace(/^\d{1,4}\s+/, '')}Z`) !== 'Z') return null;
  return { name, slug };
}

function groupRow(name: string, kind: 'team' | 'set' | 'brand' | string): LotSubject {
  const k = kind === 'team' ? 'team' : kind === 'brand' ? 'brand' : 'set';
  return { key: `${k[0]}:${norm(name)}`, name, kind: k, playerSlug: null };
}
const SOLO_ACT: Record<string, string> = { 'fr-mj': 'Michael Jackson', 'fr-elvis': 'Elvis Presley' };

/** the row a live lot is counted under on the roster: `<market>|<subject key>`,
 *  or `<market>|~` (the market's "everything else" row) — null off the
 *  collection markets (those lots belong to their real maker row) */
export function subjectRowKeyOf(l: SubjectLot): string | null {
  const m = marketOf(l.artist);
  if (!SUBJECT_MARKETS.has(m)) return null;
  const s = lotSubjectOf(l);
  return `${m}|${s ? s.key : OTHER}`;
}
export const OTHER = '~';

/** the subject key alone (`p:<slug>`, `k:<pokémon>`, … or `~`) — the feed's
 *  exact `subj=` scope; null off the collection markets */
export function subjectKeyOf(l: SubjectLot): string | null {
  const id = subjectRowKeyOf(l);
  return id ? id.slice(id.indexOf('|') + 1) : null;
}

/** the home feed path for one subject row, exactly: its market's feed scoped
 *  by `subj=` to every live lot the row counts ("All lots") */
export function subjectFeedHref(market: Market, key: string): string {
  const p = new URLSearchParams();
  p.set('subj', key);
  p.set('tab', 'all');
  return `/${market}?${p.toString()}`;
}

export interface SubjectGroup<L> {
  /** `<market>|<key>` */
  id: string;
  market: Market;
  subject: LotSubject | null;
  /** the most common spelling across the row's lots */
  name: string;
  lots: L[];
}

/** group live lots into subject rows (every collection-market lot lands in exactly one) */
export function groupBySubject<L extends SubjectLot>(lots: readonly L[]): Map<string, SubjectGroup<L>> {
  const out = new Map<string, SubjectGroup<L> & { names: Map<string, number> }>();
  for (const l of lots) {
    const id = subjectRowKeyOf(l);
    if (!id) continue;
    const s = lotSubjectOf(l);
    let g = out.get(id);
    if (!g) out.set(id, g = { id, market: marketOf(l.artist) as Market, subject: s, name: s?.name ?? '', lots: [], names: new Map() });
    g.lots.push(l);
    if (s) g.names.set(s.name, (g.names.get(s.name) || 0) + 1);
  }
  out.forEach(g => {
    let best = g.name, n = 0;
    g.names.forEach((c, nm) => { if (c > n) { n = c; best = nm; } });
    g.name = best;
  });
  return out;
}
