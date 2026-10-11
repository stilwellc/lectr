/**
 * entity/live.ts — THE LIVE JOIN (makers overhaul P1).
 *
 * One pass over the eager book: livePool → sortByPriority → passesTriage,
 * ONCE per (book, triage, sport), then every live lot is bucketed by its
 * entity id. It replaces /makers' four hand-rolled groupings (liveBySlug,
 * liveBySub, groupBySubject + subjectRow, the rest rows); the maker page and
 * /player keep their maker-pool readers until Phase 4 mounts them on the
 * same model.
 *
 * THE KEY. A lot's entity id is its build-stamped `ek`; a book that predates
 * the stamp falls back to calling app/lib/entity/key entityKeyOf — the very
 * function the build stamps with, so a stamped and an unstamped book bucket
 * identically. By category is the one cut that is NOT the entity: every lot
 * (named or not) under its clean sub-category (taxonomy).
 *
 * STABLE IDENTITY. Each bucket keeps its previous array/entry object when a
 * re-cut leaves its lots unchanged, so a memoized row whose pool did not move
 * does not re-render on a chip click.
 */
import { useMemo, useRef } from 'react';
import { marketOf, ARTIST_MARKET, MAKER_MARKETS, type Market } from '../../constants';
import type { AuctionLot } from '../../types';
import { lotSubjectOf, SUBJECT_MARKETS, type LotSubject } from '../maker-subjects';
import { entityKeyOf } from './key';
import { taxonOf } from '../taxonomy';
import { livePool, sortByPriority } from '../maker-pool';
import { passesTriage, isTriageActive, type TriageFilters, type HouseBaselines } from '../feed-filters';
import { priorityOf } from '../priority';
import { localToday } from '../../utils';
import { isFlagged } from '../flags';
import { subId } from './model';
import { restId } from './kinds';

type KeyLot = AuctionLot & { ek?: string | null; description?: string | null };

/** a lot's entity id: the build's `ek` stamp, else app/lib/entity/key
 *  entityKeyOf (the same function the build stamps with) — null = a
 *  maker-market lot the attribution guard says is not by its maker */
export function entityIdOf(l: KeyLot): string | null {
  return l.ek !== undefined ? l.ek : entityKeyOf(l);
}

/** the By-category bucket (a clean sub-category) every lot also has */
export function catIdOf(l: AuctionLot): string {
  const t = taxonOf(l);
  return subId(t.cat, t.sub);
}

/** a By-name bucket for an entity id: unnamed collection lots (cs:) fold
 *  into their market's remainder row */
export function nameBucketOf(id: string, l: AuctionLot): string {
  return id.startsWith('cs:') ? restId(marketOf(l.artist)) : id;
}

export interface LiveEntry {
  /** the live lots, what matters most first (a stable in-order slice of the pool) */
  lots: AuctionLot[];
  flags: number;
  /** "Matters" for the row: the summed priority of its three most important lots */
  score: number;
}
/** a By-name bucket also carries the spelling its lots use most, and the
 *  first lot's subject (the fail-soft summary's reader) */
export interface NameEntry extends LiveEntry { name: string; subject: LotSubject | null; market: Market }

export function mattersOf(lots: readonly AuctionLot[], nowMs?: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(3, lots.length); i++) s += priorityOf(lots[i], nowMs)?.score ?? 0;
  return s;
}

function entryOf(lots: AuctionLot[]): LiveEntry {
  let flags = 0;
  for (const l of lots) if (isFlagged(l)) flags++;
  return { lots, flags, score: lots.length ? mattersOf(lots) : -1 };
}

/** maker buckets: every live lot whose entity is a maker (`mk:<artist>`;
 *  the attribution guard has already dropped the lots not by their maker).
 *  (r8) a collectibles-desk lot of a tracked artist (RR's signed Warhol
 *  screenprint, a Picasso autograph) keys to the maker too — the build counts
 *  it on the maker's row, so the live join does */
export function groupByMaker(pool: readonly AuctionLot[]): Map<string, LiveEntry> {
  const by = new Map<string, AuctionLot[]>();
  for (const l of pool) {
    // an unstamped collection lot keys to a maker only through a person subject
    // that is a tracked artist — skip the subject read for the rest of them
    if (!MAKER_MARKETS.has(marketOf(l.artist)) && (l as KeyLot).ek === undefined && lotSubjectOf(l)?.kind !== 'person') continue;
    const k = entityIdOf(l);
    if (!k || !k.startsWith('mk:')) continue;
    const a = by.get(k); if (a) a.push(l); else by.set(k, [l]);
  }
  const out = new Map<string, LiveEntry>();
  by.forEach((lots, k) => out.set(k, entryOf(lots)));
  return out;
}

/** By-category buckets: every live lot under its clean sub (`cs:<cat>:<sub>`) */
export function groupByCat(pool: readonly AuctionLot[]): Map<string, LiveEntry> {
  const by = new Map<string, AuctionLot[]>();
  for (const l of pool) {
    const k = catIdOf(l);
    const a = by.get(k); if (a) a.push(l); else by.set(k, [l]);
  }
  const out = new Map<string, LiveEntry>();
  by.forEach((lots, k) => out.set(k, entryOf(lots)));
  return out;
}

/** By-name buckets: the collection markets' lots under their entity (pl: /
 *  sj: / st:), the unnamed under the market's remainder row (`~:<market>`) */
export function groupByName(pool: readonly AuctionLot[]): Map<string, NameEntry> {
  const by = new Map<string, { lots: AuctionLot[]; names: Map<string, number>; subject: LotSubject | null; market: Market }>();
  for (const l of pool) {
    const market = marketOf(l.artist);
    if (!SUBJECT_MARKETS.has(market)) continue;
    const id = entityIdOf(l);
    // (r8) a collectibles-desk piece of a tracked artist is the maker's row (groupByMaker)
    if (!id || id.startsWith('mk:')) continue;
    const k = nameBucketOf(id, l);
    // the spelling + subject come from the reader — a stamped book only needs
    // them for the fail-soft summary (entities files carry the label)
    const s = k.startsWith('~:') ? null : lotSubjectOf(l);
    let g = by.get(k);
    if (!g) by.set(k, g = { lots: [], names: new Map(), subject: s, market });
    g.lots.push(l);
    if (s) g.names.set(s.name, (g.names.get(s.name) || 0) + 1);
  }
  const out = new Map<string, NameEntry>();
  by.forEach((g, k) => {
    let name = g.subject?.name ?? '', n = 0;
    g.names.forEach((c, nm) => { if (c > n) { n = c; name = nm; } });
    out.set(k, { ...entryOf(g.lots), name, subject: g.subject, market: g.market });
  });
  return out;
}

const sameLots = (a: readonly AuctionLot[], b: readonly AuctionLot[]) => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** keep the previous entry object for every bucket whose lots did not change */
export function stabilize<E extends LiveEntry>(prev: Map<string, E> | null, next: Map<string, E>): Map<string, E> {
  if (!prev) return next;
  next.forEach((e, k) => {
    const p = prev.get(k);
    if (p && sameLots(p.lots, e.lots) && (!('name' in e) || (p as unknown as NameEntry).name === (e as unknown as NameEntry).name)) next.set(k, p);
  });
  return next;
}

export interface LivePoolOpts {
  /** the sports market's sport pick (taxonomy sport key) */
  sport?: string | null;
  prevVisitDay?: string | null;
  baselines?: HouseBaselines | null;
  /** build the By-name buckets (collection markets on By name) */
  names?: boolean;
  /** build the By-category buckets */
  cats?: boolean;
}

export interface LivePool {
  /** every live lot on the book, what matters most first */
  all: AuctionLot[];
  /** …passing the triage + sport pick */
  pass: AuctionLot[];
  byMaker: Map<string, LiveEntry>;
  byName: Map<string, NameEntry>;
  byCat: Map<string, LiveEntry>;
  /** the UNFILTERED By-name buckets — what a subject IS (label, face,
   *  discipline) never moves with the filters */
  namesAll: Map<string, NameEntry>;
  /** every live lot in the active market (the masthead's "of N") */
  marketAll: AuctionLot[];
  /** …inside the sport pick (the triage row's chip counts) */
  marketPool: AuctionLot[];
}

const EMPTY_MAP = new Map();

/** the sport pick narrows the SPORTS market's lots (a sport-less lot never passes it) */
export const sportOk = (l: AuctionLot, sp: string | null | undefined) =>
  !sp || marketOf(l.artist) !== 'sports' || taxonOf(l).sport === sp;

/**
 * useLivePool — the ONE filtered pool every /makers row, count and dossier
 * derives from (a row's live count is exactly the lots it lists). The buckets
 * span every market (compare picks and the cockpit read across markets);
 * `market` scopes the market-level pools the masthead and triage row count.
 */
export function useLivePool(allLots: readonly AuctionLot[], market: Market, triage: TriageFilters, opts: LivePoolOpts = {}): LivePool {
  const { sport = null, prevVisitDay = null, baselines = null, names = false, cats = false } = opts;
  const all = useMemo(() => sortByPriority(livePool(allLots)), [allLots]);
  // no filter → the pool IS the book (same array: the By-name buckets are reused)
  const pass = useMemo(() => {
    if (!sport && !isTriageActive(triage)) return all;
    const today = localToday();
    return all.filter(l => sportOk(l, sport) && passesTriage(l, triage, { today, prevVisitDay, baselines }));
  }, [all, triage, sport, prevVisitDay, baselines]);
  const prev = useRef<{ maker: Map<string, LiveEntry> | null; name: Map<string, NameEntry> | null; cat: Map<string, LiveEntry> | null }>({ maker: null, name: null, cat: null });
  const byMaker = useMemo(() => (prev.current.maker = stabilize(prev.current.maker, groupByMaker(pass))), [pass]);
  const namesAll = useMemo(() => (names ? groupByName(all) : EMPTY_MAP as Map<string, NameEntry>), [all, names]);
  const byName = useMemo(() => (names
    ? (prev.current.name = stabilize(prev.current.name, pass === all ? new Map(namesAll) : groupByName(pass)))
    : EMPTY_MAP as Map<string, NameEntry>), [pass, all, names, namesAll]);
  const byCat = useMemo(() => (cats ? (prev.current.cat = stabilize(prev.current.cat, groupByCat(pass))) : EMPTY_MAP as Map<string, LiveEntry>), [pass, cats]);
  // a lot the attribution guard drops (no entity) is on no row — and in no "of N"
  const marketAll = useMemo(() => all.filter(l => {
    const m = ARTIST_MARKET[l.artist];
    if (market === 'all' ? m == null : m !== market) return false;
    // only a maker-market lot can be unkeyed (the attribution guard)
    return !MAKER_MARKETS.has(m) || entityIdOf(l) != null;
  }), [all, market]);
  const marketPool = useMemo(() => (sport ? marketAll.filter(l => sportOk(l, sport)) : marketAll), [marketAll, sport]);
  return { all, pass, byMaker, byName, byCat, namesAll, marketAll, marketPool };
}
