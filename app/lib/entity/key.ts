/**
 * key.ts — THE entity key of a lot (makers overhaul, Oct 10 2026).
 *
 * One function decides which entity a lot — live or sold — belongs to, so a
 * /makers row's "N live" and its dossier's "N sold" are attributed by the same
 * code. The build stamps it as `ek` on every served live lot (upcoming.json)
 * and every maker-shard row; the client reads `ek` and falls back to calling
 * this function on an older payload. Pure: no registries, no I/O.
 *
 *   mk:<artistSlug>              art / design / watch makers (the maker slug),
 *                                null when the attribution guard says the lot
 *                                is not by that maker (app/lib/attribution)
 *   pl:<playerSlug>              a sports lot's athlete (cards + memorabilia)
 *   st:<market>|s:<set>          a set / sealed product line
 *   sj:<market>|<subjectKey>     every other named subject — Pokémon (k:),
 *                                person (p:), film (f:), franchise / act (fr:),
 *                                mission (m:), team (t:), brand (b:)
 *   cs:<cat>:<sub>               a collection lot no reader names: its clean
 *                                taxonomy category + sub (app/lib/taxonomy).
 *                                The science collections with no reader
 *                                (meteorites, fossils, instruments, science-
 *                                tech) keep their collection as the sub.
 *
 * The subject readers are app/lib/maker-subjects (lotSubjectOf), which folds
 * subject.ts, subject-groups.ts and lot-labels.ts — never duplicated here.
 */
import { marketOf, MAKER_MARKETS, ARTIST_LABEL, type Market } from '../../constants';
import { isMisattributed } from '../attribution';
import { lotSubjectOf } from '../maker-subjects';
import { publicFigureCanon, publicFigureHome } from '../player-name';
import { playerSlugOf } from '../cards';
import { taxonOf, subLabel, CAT_LABEL, type CatKey } from '../taxonomy';
import type { EntityKind } from './model';

type KeyLot = Parameters<typeof lotSubjectOf>[0] & { description?: string | null };

/** science pseudo-makers no subject reader covers — kept apart as collections */
export const SCIENCE_COLLECTIONS: ReadonlySet<string> = new Set(['meteorites', 'fossils', 'scientific-instruments', 'science-tech']);

/** the market a clean category lives in (taxonomy MARKET_CATS, inverted) */
export const CAT_MARKET: Record<CatKey, Market> = {
  'fine-art': 'art', design: 'design', watches: 'watches',
  'sports-cards': 'sports', 'sports-memorabilia': 'sports', tcg: 'tcg',
  'space-science': 'science', entertainment: 'culture', historical: 'culture',
};

const memo = new WeakMap<object, { t: unknown; a: unknown; s: unknown; d: unknown; v: string | null }>();

/** the entity a lot belongs to, or null (a maker-market lot not by its maker) */
export function entityKeyOf(l: KeyLot): string | null {
  const hit = memo.get(l as object);
  if (hit && hit.t === l.title && hit.a === l.artist && hit.s === l.subCat && hit.d === l.drill) return hit.v;
  const v = read(l);
  memo.set(l as object, { t: l.title, a: l.artist, s: l.subCat, d: l.drill, v });
  return v;
}

function read(l: KeyLot): string | null {
  const artist = String(l.artist || '');
  const market = marketOf(artist);
  if (MAKER_MARKETS.has(market)) {
    if (isMisattributed(artist, String(l.title || ''), String(l.description || ''))) return null;
    return `mk:${artist}`;
  }
  const s = lotSubjectOf(l);
  if (s) {
    if (s.kind === 'person') {
      // (r8) ONE entity per tracked artist: their own work on a collectibles desk (RR's signed
      // Warhol screenprints) AND their autographs and ephemera file under the maker — the r7
      // "person · Culture" shell made ⌘K list Warhol and Picasso twice (three times, with a
      // sports-desk Warhol). A piece the attribution guard says is by someone else (a
      // photographer's portrait of Warhol) is no one's entity: its collection category.
      const mk = artistMakerOf(s.playerSlug);
      if (mk) return isMisattributed(mk, String(l.title || ''), String(l.description || '')) ? collectionKey(l, artist) : `mk:${mk}`;
      // (r8) a famous non-athlete files under ONE person in their home market (app/lib/
      // player-name publicFigureHome) — a president's baseball at a sports house, Marilyn's
      // DiMaggio photos, Einstein at a culture house — never a sports person, never a twin
      const pf = publicFigureCanon(s.name, true);
      const slug = pf ? playerSlugOf(pf) : null;
      if (pf && slug) return `sj:${publicFigureHome(pf)}|p:${slug}`;
      // a person no reader calls an athlete never keys to the sports market
      return `sj:${market === 'sports' ? 'culture' : market}|${s.key}`;
    }
    if (s.kind === 'player' && s.playerSlug) return `pl:${s.playerSlug}`;
    if (s.kind === 'set') return `st:${market}|${s.key}`;
    return `sj:${market}|${s.key}`;
  }
  return collectionKey(l, artist);
}

/** a lot no reader names: its clean collection category (cs:<cat>:<sub>) */
function collectionKey(l: KeyLot, artist: string): string {
  const t = taxonOf(l);
  const sub = t.cat === 'space-science' && t.sub === 'science' && SCIENCE_COLLECTIONS.has(artist) ? artist : t.sub;
  return `cs:${t.cat}:${sub}`;
}

/** the art / design maker a person subject's slug names (the maker slug IS the person's
 *  name slug: 'andy-warhol', 'pablo-picasso'), or null */
export function artistMakerOf(personSlug: string | null | undefined): string | null {
  if (!personSlug || !ARTIST_LABEL[personSlug]) return null;
  const m = marketOf(personSlug);
  return m === 'art' || m === 'design' ? personSlug : null;
}

const SUBKIND: Record<string, string> = {
  p: 'person', k: 'pokemon', f: 'film', fr: 'franchise', m: 'mission', t: 'team', s: 'set', b: 'brand',
};

export interface ParsedEntityId {
  id: string;
  kind: EntityKind;
  market: Market;
  /** the maker / player slug (mk / pl) */
  slug: string | null;
  /** the subject key inside its market (sj / st): 'k:charizard', 's:base-set' */
  subjectKey: string | null;
  subKind: string | null;
  /** the clean category + sub (cs) */
  cat: CatKey | null;
  sub: string | null;
}

/** parse an entity id (null on a malformed id) */
export function parseEntityId(id: string): ParsedEntityId | null {
  const head = id.slice(0, 3);
  const rest = id.slice(3);
  const base = { id, slug: null, subjectKey: null, subKind: null, cat: null, sub: null };
  if (!rest) return null;
  switch (head) {
    case 'mk:': return { ...base, kind: 'maker', market: marketOf(rest), slug: rest };
    case 'pl:': return { ...base, kind: 'player', market: 'sports', slug: rest, subKind: 'player' };
    case 'sj:':
    case 'st:': {
      const bar = rest.indexOf('|');
      if (bar <= 0) return null;
      const subjectKey = rest.slice(bar + 1);
      const pre = subjectKey.slice(0, subjectKey.indexOf(':'));
      return {
        ...base, kind: head === 'st:' ? 'set' : 'subject', market: rest.slice(0, bar) as Market,
        subjectKey, subKind: SUBKIND[pre] ?? null,
      };
    }
    case 'cs:': {
      const c = rest.indexOf(':');
      if (c <= 0) return null;
      const cat = rest.slice(0, c) as CatKey;
      if (!(cat in CAT_MARKET)) return null;
      return { ...base, kind: 'sub', market: CAT_MARKET[cat], cat, sub: rest.slice(c + 1) };
    }
    default: return null;
  }
}

/** a cs: entity's display label ("Sports Cards · Singles", "Meteorites") */
export function subEntityLabel(cat: CatKey, sub: string): string {
  if (cat === 'space-science' && SCIENCE_COLLECTIONS.has(sub)) return ARTIST_LABEL[sub] || sub;
  return `${CAT_LABEL[cat] || cat} · ${subLabel(cat, sub)}`;
}

/** the canonical page an entity id links to */
export function entityPageOf(id: string): string | null {
  const p = parseEntityId(id);
  if (!p) return null;
  if (p.kind === 'maker') return `/makers/${p.slug}`;
  if (p.kind === 'player') return `/player?id=${encodeURIComponent(p.slug!)}`;
  return `/entity?id=${encodeURIComponent(id)}`;
}
