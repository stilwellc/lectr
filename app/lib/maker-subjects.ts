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
  const pm = line.href.match(/^\/player\?id=(.+)$/);
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
    if (pm) return null;
    // (r5) a card with no number to key (pre-war, oddball issues: "1928 Exhibits Frank Frisch") —
    // the pipeline-stamped athlete, when the title spells that exact name
    const pn = l.playerName?.trim();
    const t = String(l.title || '');
    // …and the only name on it: never a multi-signed piece or a "Jordan/Bird/Magic" run
    const solo = pn && !/\b(?:Multi-Signed|Dual-Signed|Triple|Trio|Quad)\b/.test(t) && !t.includes(`${pn}/`) && !t.includes(`/${pn}`);
    const pslug = solo && nameTokensOk(pn.split(' ')) && t.includes(pn) ? playerSlugOf(pn) : null;
    if (pslug) return { key: `p:${pslug}`, name: pn!, kind: 'player', playerSlug: pslug };
  }
  if (l.artist === 'pokemon') {
    // the maker line carries a sealed lot's set too (r5) — that is a set row, not a Pokémon
    const g = cardGroupOf(l);
    if (g && line.name === g.name) return groupRow(g.name, g.kind);
    return line.name && line.name !== fallback ? { key: `k:${norm(line.name)}`, name: line.name, kind: 'pokemon', playerSlug: null } : null;
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
