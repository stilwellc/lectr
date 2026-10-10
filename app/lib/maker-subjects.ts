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
import { subjectOf, nameTokensOk, cardGroupOf } from './subject';

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

function read(l: SubjectLot): LotSubject | null {
  if (!SUBJECT_MARKETS.has(marketOf(l.artist))) return null;
  const line = makerLineOf(l);
  const fallback = ARTIST_LABEL[l.artist] || l.artist;
  // (Oct 10) only a CARD's parsed player reads off the maker line: a person's
  // /player link there depends on which dossiers the page registered, and the
  // row key must not (the build stamps it as `ek` with no registry) — people
  // on memorabilia read through subjectOf below, to the same `p:<slug>` key
  const pm = CARD_MAKERS.has(l.artist) ? line.href.match(/^\/player\?id=(.+)$/) : null;
  if (pm) {
    const slug = decodeURIComponent(pm[1]);
    // the card parser can run a name on into the caption ("Mickey Mantle
    // Boasting Near-Perfect", "AL Home Run Leaders") — a row needs a person
    if (nameTokensOk(line.name.split(' '))) return { key: `p:${slug}`, name: line.name, kind: 'player', playerSlug: slug };
    // (r5) the run-on's first two words when they ARE a name ("Duke Snider Play Brings", "Roger Clemens Pre-Rookie")
    const two = line.name.split(' ').slice(0, 2);
    const twoSlug = two.length === 2 && nameTokensOk(two) ? playerSlugOf(two.join(' ')) : null;
    if (twoSlug) return { key: `p:${twoSlug}`, name: two.join(' '), kind: 'player', playerSlug: twoSlug };
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
    const pslug = solo && nameTokensOk(pn.split(' ')) && spelled ? playerSlugOf(pn) : null;
    if (pslug) return { key: `p:${pslug}`, name: pn!, kind: 'player', playerSlug: pslug };
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
      const slug = playerSlugOf(id.player);
      if (slug) return { key: `p:${slug}`, name: id.player, kind: 'player', playerSlug: slug };
    }
  }
  const s = subjectOf(l);
  if (s?.kind === 'mission' || s?.kind === 'program') return { key: `m:${norm(s.name)}`, name: s.name, kind: 'mission', playerSlug: null };
  if (s?.kind === 'team' || s?.kind === 'set' || s?.kind === 'brand') return groupRow(s.name, s.kind);
  if (s?.kind === 'person') {
    // (r5) an act read off the title IS its franchise facet ("The Beatles" / fr-beatles,
    // "The Rolling Stones" / "Rolling Stones") — one row, the facet's
    const bare = (x: string) => norm(x).replace(/^the-/, '');
    const act = franchiseOf(l);
    if (act && !SOLO_ACT[act] && FACET_LABEL[act] && bare(FACET_LABEL[act]) === bare(s.name)) return { key: `fr:${act}`, name: FACET_LABEL[act], kind: 'franchise', playerSlug: null };
    // "The Clash Signed…" and "Clash Band-Signed…" are one act — the row key drops a leading "The"
    const slug = marketOf(l.artist) === 'culture' && /^The [A-Z]/.test(s.name) ? playerSlugOf(s.name.slice(4)) : playerSlugOf(s.name);
    if (!slug) return null;
    // sports memorabilia names an athlete — the same row as their cards
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
