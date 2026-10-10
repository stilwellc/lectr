/**
 * entity/kinds.ts — THE KIND REGISTRY (makers overhaul P1).
 *
 * Everything that used to be a scattered `r.kind === 'subject'`,
 * `slug.startsWith('s:')`, `canCompare = kind !== …`, BID_MARKETS /
 * DISCIPLINE / NAME_HEAD constant on app/makers/page.tsx lives here: what a
 * kind is called, what its column head says, whether it can be compared or
 * followed, how its dossier prints, and where its page is.
 */
import { ARTIST_LABEL, MAKER_DISCIPLINE, type Market } from '../../constants';
import type { CatKey } from '../taxonomy';
import { SUBJECT_MARKETS, subjectFeedHref } from '../maker-subjects';
import { kindOfId, makerSlugOf, subPartsOf, subjectPartsOf, type EntityKind } from './model';

/* ── the curated disciplines (a roster maker's tag) — one copy, shared with
   the build (scripts/emit-entities) ── */
export const DISCIPLINE: Record<string, string> = MAKER_DISCIPLINE;

/** markets where a maker row is a bid market (the row's "bid market" tag).
 *  NOTE: the maker page (app/makers/[slug]) still passes `bidMarket` for
 *  sports + science — a hero-number change that waits for the Phase 4 page. */
export const BID_MARKETS: ReadonlySet<Market> = new Set<Market>(['sports', 'tcg']);

/** the name column's head, per market, when rows are subjects */
export const NAME_HEAD: Partial<Record<Market, string>> = {
  sports: 'Player', tcg: 'Pokémon', science: 'Mission · person', culture: 'Person · film · franchise',
};

/** the "everything else" row's tag, per market */
export const REST_TAG: Partial<Record<Market, string>> = { sports: 'no player named', tcg: 'no Pokémon named' };

/** franchise facets whose domain is music, not film */
export const FR_DOMAIN: Record<string, string> = { 'fr-beatles': 'Music', 'fr-stones': 'Music' };

/* ── COLLECTION MARKETS — where the "maker" is really a category: the roster
   lists subjects (By name) or clean sub-categories (By category). ── */
export const COLLECTION_CATS: { cat: CatKey; market: Market; prefix: string }[] = [
  { cat: 'sports-cards', market: 'sports', prefix: 'Cards' },
  { cat: 'sports-memorabilia', market: 'sports', prefix: 'Memorabilia' },
  { cat: 'tcg', market: 'tcg', prefix: 'Pokémon' },
  { cat: 'space-science', market: 'science', prefix: '' },
  { cat: 'entertainment', market: 'culture', prefix: 'Entertainment' },
  { cat: 'historical', market: 'culture', prefix: 'Historical' },
];
export const COLLECTION_MARKETS: ReadonlySet<Market> = new Set<Market>(COLLECTION_CATS.map(c => c.market));
export { SUBJECT_MARKETS };

/** a players.json cats key for a live lot's maker slug (graded slabs file under cards) */
export const PLAYER_CAT: Record<string, string> = { 'graded-cards': 'sports-cards' };

/** the ledger's row kinds: the five entity kinds + the market's remainder row */
export type RowKind = EntityKind | 'rest';

export interface KindSpec {
  /** what one of these is called in prose */
  noun: string;
  /** compare tray eligibility (the row's compare mark, the `c` key) */
  compare: boolean;
  /** the dossier prints inline (live book + whatever sold history the
   *  subject honestly has) rather than the maker's full read */
  inline: boolean;
}

export const KIND: Record<RowKind, KindSpec> = {
  maker: { noun: 'maker', compare: true, inline: false },
  sub: { noun: 'category', compare: true, inline: false },
  player: { noun: 'player', compare: false, inline: true },
  subject: { noun: 'name', compare: false, inline: true },
  set: { noun: 'set', compare: false, inline: true },
  rest: { noun: 'lots', compare: false, inline: true },
};

/** the remainder row's id, per market (`~` is maker-subjects' OTHER key) */
export const restId = (market: Market) => `~:${market}`;
export const isRestId = (id: string) => id.startsWith('~:');

/** a row id's kind (entity ids by prefix; the remainder row) */
export function rowKindOf(id: string): RowKind | null {
  return isRestId(id) ? 'rest' : kindOfId(id);
}

/** what follow toggles for a row: a maker's slug, a sub row's category
 *  follow key (`cs:<cat>:<sub>`), an athlete's /player slug when a dossier
 *  exists, a subject / set's own entity id (`sj:` / `st:` — app/lib/follows
 *  entityFollow: matched on the lot's build-stamped `ek`, r7) — else nothing
 *  (the remainder row) */
export function followKeyOf(id: string, opts: { playerDossier?: boolean } = {}): string | null {
  const k = rowKindOf(id);
  if (k === 'maker') return makerSlugOf(id);
  if (k === 'sub') return id;
  if (k === 'player') return opts.playerDossier ? id.slice(3) : null;
  if (k === 'subject' || k === 'set') return id;
  return null;
}
/** a follow key that IS an entity id (a subject / set) — stored as an entity follow */
export const isEntityFollowKey = (key: string) => key.startsWith('sj:') || key.startsWith('st:');

/** where a row's "Open the dossier" / "+N more" lead (before the /makers
 *  triage view is carried along — lot-browser liveBookHref) */
export function pageHrefOf(id: string, opts: { playerDossier?: boolean } = {}): string {
  const k = rowKindOf(id);
  if (k === 'maker') return `/makers/${makerSlugOf(id)}`;
  if (k === 'sub') {
    const p = subPartsOf(id)!;
    return `/?${new URLSearchParams({ cat: p.cat, sub: p.sub, tab: 'all' }).toString()}`;
  }
  if (k === 'player') {
    const slug = id.slice(3);
    return opts.playerDossier ? `/player?id=${encodeURIComponent(slug)}` : subjectFeedHref('sports', `p:${slug}`);
  }
  if (k === 'subject' || k === 'set') {
    const p = subjectPartsOf(id)!;
    return subjectFeedHref(p.market, p.key);
  }
  // the remainder row: its market's feed scoped to the lots no reader names
  return subjectFeedHref(id.slice(2) as Market, '~');
}

/**
 * THE PHASE-1 ROW POLICY — what a ledger row links to and offers, decided by
 * kind (this registry), never by a summary's caps: the entities file's caps
 * (compare on any entity with a spark, follow on every athlete, the
 * /entity?id= page) arrive with the Phase-2 ledger, behind the owner's
 * before/after review. Until then a row behaves exactly as it did.
 */
export interface RowPolicy {
  /** where "Open the dossier" / "+N more" lead */
  page: string;
  /** a non-maker row lands on a list ("See every lot"); a maker opens its page */
  lands: boolean;
  /** the athlete's /player dossier (only where page-stats lists one) */
  dossierHref: string | null;
  follow: string | null;
  compare: boolean;
  inline: boolean;
}
export function rowPolicy(id: string, opts: { playerDossier?: boolean } = {}): RowPolicy {
  const kind = rowKindOf(id) ?? 'subject';
  const spec = KIND[kind];
  const page = pageHrefOf(id, opts);
  return {
    page,
    lands: kind !== 'maker',
    dossierHref: kind === 'player' && opts.playerDossier ? page : null,
    follow: followKeyOf(id, opts),
    compare: spec.compare,
    inline: spec.inline,
  };
}

/** a roster maker's display label */
export const makerLabel = (slug: string) => ARTIST_LABEL[slug] || slug;
