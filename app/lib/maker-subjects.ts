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
 *   mission   the one space mission a lot names (subject.missionOf)
 *
 * No reader → null: the page files the lot under its market's "everything
 * else" row so every live lot is still counted exactly once.
 */
import { marketOf, ARTIST_LABEL, type Market } from '../constants';
import { makerLineOf } from './lot-labels';
import { subjectOf } from './subject';
import { playerSlugOf } from './cards';
import { lotFacets, FACET_LABEL } from './facets';

export type SubjectKind = 'player' | 'pokemon' | 'person' | 'film' | 'franchise' | 'mission';

export interface LotSubject {
  /** stable within a market: `p:<player-slug>`, `k:<pokemon>`, `f:<film>`, `fr:<facet>`, `m:<mission>` */
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
    return { key: `p:${slug}`, name: line.name, kind: 'player', playerSlug: slug };
  }
  if (l.artist === 'pokemon') {
    return line.name && line.name !== fallback ? { key: `k:${norm(line.name)}`, name: line.name, kind: 'pokemon', playerSlug: null } : null;
  }
  const s = subjectOf(l);
  if (s?.kind === 'mission') return { key: `m:${norm(s.name)}`, name: s.name, kind: 'mission', playerSlug: null };
  if (s?.kind === 'person') {
    const slug = playerSlugOf(s.name);
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
