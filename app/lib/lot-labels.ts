/**
 * lot-labels.ts — the name a lot is filed under on a card or row (Oct 9).
 *
 * Collection lots sit under pseudo-makers ("Sports Cards", "Graded Cards",
 * "Pokémon") — 6,000+ rows on the live book all reading the same two words in
 * the maker slot. When the lot names a real subject we can read with
 * confidence, that subject takes the slot instead: the card's player (parsed
 * year·set·# identity) or the Pokémon on a numbered card. Otherwise the
 * maker label stands, unchanged.
 *
 * Memorabilia & culture pseudo-makers ("Autographs", "Game Worn & Used",
 * "Film & TV", "Space Exploration") give way the same way to the subject the
 * title names — the signer/athlete, the film a prop came from, the mission
 * (app/lib/subject, rules measured ≥90% precise on the live book). An athlete
 * links to their /player dossier only when the dossier exists (page-stats
 * playerIndex, registered below) and the pipeline stamped the lot to them;
 * every other subject keeps the maker link.
 *
 * (r5) Collective subjects read the same way (app/lib/subject-groups): a
 * team-signed piece names its team-season, sealed wax / set lots their
 * product line + year, sealed Pokémon their set, an instrument its maker.
 */
import { ARTIST_LABEL } from '../constants';
import { parseCard, cardLadderKey, playerSlugOf } from './cards';
import { taxonOf, subLabel, CAT_LABEL, SPORTS, type CatKey } from './taxonomy';
import { cardBadgesOf } from './facets';
import { subjectOf, cardGroupOf } from './subject';
import { makerHref } from './entity/retired';
import { athleteName, notOnePerson } from './player-name';

const CARD_MAKERS = new Set(['sports-cards', 'graded-cards']);
const POKE_NAME = /#[\w-]+\s+(.+?)(?:\s+-\s|\s*$)/;
const POKE_NOISE = /\b(?:Holo|Reverse Holo|1st Edition|Shadowless|Unlimited)\b/g;
/** a person's name, 2–4 words — the parser sometimes runs on into card words ("Jackie Robinson Inaugural Bowman") */
const PERSON = /^[A-Z][\w.'’-]*(?: (?:[A-Z][\w.'’-]*|Jr\.?|Sr\.?|II|III|IV|de|van|da|del|la)){1,3}$/;
const CARD_WORD = /\b(?:Inaugural|Bowman|Topps|Fleer|Donruss|Panini|Prizm|Chrome|Refractor|Upper|Deck|Rookie|Card|Cards|Signed|Auto|Autograph|Autographs|Set|Team|Lot|Box|Pack|Base|Promo|Edition|Series|Parallel|Insert|Patch|Relic|Jersey|Gold|Silver|Black|Red|Blue|Green|Orange|Purple)\b/;

type NamedLot = { artist: string; title?: string | null; subCat?: string | null; drill?: string | null; playerName?: string | null; playerSlug?: string | null };

export interface MakerLine { name: string; href: string }

/** the /player dossiers that exist (page-stats playerIndex). Empty until the
 *  page-stats payload lands — until then athletes keep the maker link. */
let dossiers: ReadonlySet<string> = new Set();
let dossierVer = 0;
const listeners = new Set<() => void>();
export function registerPlayerDossiers(slugs: Iterable<string>): void {
  dossiers = new Set(slugs);
  dossierVer++;
  listeners.forEach(f => f());
}
export function onPlayerDossiers(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
export function playerDossierVersion(): number { return dossierVer; }

const memo = new WeakMap<object, { v: number; line: MakerLine }>();

export function makerLineOf(lot: NamedLot): MakerLine {
  const hit = memo.get(lot as object);
  if (hit && hit.v === dossierVer) return hit.line;
  const fallback: MakerLine = { name: ARTIST_LABEL[lot.artist] || lot.artist, href: makerHref(lot.artist) };
  let out = fallback;
  const title = String(lot.title || '');
  if (title && CARD_MAKERS.has(lot.artist) && taxonOf(lot).cat === 'sports-cards') {
    const id = parseCard(title);
    // a player only off a parsed card identity — never a guessed name from a memorabilia title
    if (!id.notCard && !id.multi && id.player && id.playerSlug && cardLadderKey(id) && PERSON.test(id.player) && !CARD_WORD.test(id.player.replace(/^Red (?=[A-Z][a-z])/, ''))) {
      // (r7 data fix) only an ATHLETE links to /player (app/lib/player-name): a team card's
      // "New York" ("1961 Topps #228 New York Yankees Team") linked to a phantom /player?id=new-york;
      // a surname-only highlight ("Mantle Hits") or a non-athlete is no /player either. The run-on's
      // first two words stand in when they are the athlete ("Duke Snider Play Brings")
      const two = id.player.split(' ').slice(0, 2).join(' ');
      const ath = notOnePerson(id.player) ? null : athleteName(id.player, title) ?? (two !== id.player ? athleteName(two, title) : null);
      const slug = ath ? playerSlugOf(ath) : null;
      if (ath && slug) out = { name: ath, href: `/player?id=${encodeURIComponent(slug)}` };
    }
  } else if (title && lot.artist === 'pokemon') {
    const m = title.match(POKE_NAME);
    const name = m?.[1].replace(POKE_NOISE, '').replace(/\s+/g, ' ').trim();
    if (name && name.split(' ').length <= 4 && /^[A-Z]/.test(name)) out = { name, href: fallback.href };
  } else if (title) {
    const sub = subjectOf(lot);
    if (sub) {
      const slug = sub.kind === 'person' ? playerSlugOf(sub.name) : null;
      const dossier = !!slug && lot.playerSlug === slug && dossiers.has(slug);
      out = { name: sub.name, href: dossier ? `/player?id=${encodeURIComponent(slug!)}` : fallback.href };
    }
  }
  // (r5) a set / sealed / team-card lot with no player or Pokémon: its set or team
  // ("1986 Fleer Basketball", "Base Set", "Boston Red Sox") — the same name its /makers row carries
  if (out === fallback && title && (CARD_MAKERS.has(lot.artist) || lot.artist === 'pokemon')) {
    const g = cardGroupOf(lot);
    if (g) out = { name: g.name, href: fallback.href };
  }
  memo.set(lot as object, { v: dossierVer, line: out });
  return out;
}

/** subs that say nothing on a card ("Singles", "Other") — the badges speak instead */
const QUIET_SUBS = new Set(['singles', 'other', 'objects', 'space-other']);

/**
 * The one label line a lot carries on cards and rows: its clean sub-category
 * (app/lib/taxonomy — the same words as the filter chips) plus up to two
 * facet badges (app/lib/facets.cardBadgesOf), e.g. "Pokémon · Vintage ·
 * PSA 10", "Space · Apollo · Signed · Flown". Quiet subs drop out; the
 * category stands in only when nothing else would print.
 */
export function labelLineOf(lot: Parameters<typeof cardBadgesOf>[0] & NamedLot): string {
  const t = taxonOf(lot);
  const parts: string[] = [];
  if (!QUIET_SUBS.has(t.sub)) parts.push(subLabel(t.cat, t.sub));
  for (const b of cardBadgesOf(lot)) if (!parts.includes(b)) parts.push(b);
  if (!parts.length) parts.push(CAT_LABEL[t.cat]);
  return parts.join(' · ');
}

/** the short table-column label: the sub, or the lead badge when the sub is quiet */
export function subColumnOf(lot: Parameters<typeof cardBadgesOf>[0] & NamedLot): string {
  const t = taxonOf(lot);
  if (!QUIET_SUBS.has(t.sub)) return subLabel(t.cat, t.sub);
  return cardBadgesOf(lot)[0] ?? CAT_LABEL[t.cat];
}

/**
 * The tag for the tightest slot (a wall plate's estimate line): the lead facet
 * badge when the lot has one ("GMT", "PSA 10", "Signed"), else the sub column.
 * Same words as labelLineOf — never a third vocabulary.
 */
export function labelTagOf(lot: Parameters<typeof cardBadgesOf>[0] & NamedLot): string {
  return cardBadgesOf(lot)[0] ?? subColumnOf(lot);
}

/** "Category · Sub" — the lot page's Category cell (quiet "Other …" subs drop) */
export function catSubLineOf(lot: NamedLot): string {
  const t = taxonOf(lot);
  const sub = subLabel(t.cat, t.sub);
  return /^Other\b/.test(sub) ? CAT_LABEL[t.cat] : `${CAT_LABEL[t.cat]} · ${sub}`;
}

const hayMemo = new WeakMap<object, string>();
/**
 * The lower-cased text a feed / board search matches against: the label
 * vocabulary (makerLineOf + labelLineOf, the words printed on the row — "PSA
 * 10", "Signed", "Rookie", "Apollo", the player) plus the maker, title, house
 * and sale. Memoised per lot object — the home feed filters 10K lots a keystroke.
 */
export function searchTextOf(lot: Parameters<typeof cardBadgesOf>[0] & NamedLot & { auctionHouse?: string | null; saleName?: string | null; medium?: string | null }): string {
  const hit = hayMemo.get(lot as object);
  if (hit != null) return hit;
  const t = taxonOf(lot);
  const s = [
    ARTIST_LABEL[lot.artist] || lot.artist,
    makerLineOf(lot).name,
    labelLineOf(lot),
    CAT_LABEL[t.cat],
    lot.title || '',
    lot.auctionHouse || '',
    lot.saleName || '',
    lot.medium || '',
  ].join(' ').toLowerCase();
  hayMemo.set(lot as object, s);
  return s;
}

/** a sports drill's kind (its subCat) in the filter-chip words */
const SPORTS_KIND: Record<string, string> = {
  cards: 'Cards', wax: 'Sealed Product', 'game-used': 'Game-Used & Worn', autographs: 'Autographs',
  photos: 'Photos', tickets: 'Tickets & Passes', programs: 'Programs & Publications',
  trophies: 'Trophies, Rings & Awards', equipment: 'Equipment & Collectibles', memorabilia: 'Memorabilia',
};
const MINOR_SPORT: Record<string, string> = { olympics: 'Olympics', tennis: 'Tennis', wrestling: 'Wrestling' };
/** drill slugs whose lot set IS one taxonomy sub — printed as that sub's label */
const DRILL_SUB: Record<string, [CatKey, string]> = {
  'art:prints': ['fine-art', 'prints'], 'art:originals': ['fine-art', 'unique'],
  'art:photographs': ['fine-art', 'photographs'], 'art:books': ['fine-art', 'books'],
  'design:seating': ['design', 'seating'], 'design:tables': ['design', 'tables'], 'design:case-storage': ['design', 'storage'],
  'pokemon-era:vintage': ['tcg', 'vintage'], 'pokemon-era:classic': ['tcg', 'classic'], 'pokemon-era:modern': ['tcg', 'modern'],
  'tcg:pokemon-sealed': ['tcg', 'sealed'],
  'space:apollo': ['space-science', 'apollo'], 'space:mercury-gemini': ['space-science', 'mercury-gemini'],
  'space:shuttle-iss': ['space-science', 'shuttle-iss'], 'space:soviet': ['space-science', 'soviet'],
  'culture:political': ['historical', 'political'], 'culture:royalty': ['historical', 'royalty'],
  'culture:military': ['historical', 'military'], 'culture:literary': ['historical', 'literary'],
  'culture:historic': ['historical', 'historic'],
};
/**
 * A sub-market (market.json drill) named in the label vocabulary: a drill whose
 * lot set is one taxonomy sub prints that sub's label ("Vintage (1996–2003)",
 * not "Vintage ≤'02"); a sport × kind drill prints "Football · Cards"; the rest
 * (watch families, card eras, design woods) keep the drill's own name.
 */
export function drillLabelOf(slug: string, fallback: string): string {
  const sub = DRILL_SUB[slug];
  if (sub) return subLabel(sub[0], sub[1]);
  if (slug === 'culture:hollywood') return 'Film & TV';
  const [kind, sport] = slug.split(':');
  const sportLabel = SPORTS.find(s => s.key === sport)?.label ?? MINOR_SPORT[sport];
  if (sportLabel && SPORTS_KIND[kind]) return `${sportLabel} · ${SPORTS_KIND[kind]}`;
  return fallback;
}
