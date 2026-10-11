/**
 * your-market.ts — THE "YOUR MARKET" DIGEST (N5, Oct 11 2026). Pure reads
 * behind app/profile/YourMarket.tsx: for the names a reader follows and
 * owns, what happened in their market this week (or since the last visit).
 * In-product only — never an email.
 *
 * Every figure is a published read, never one the browser invents:
 *   move      the entity's YoY from pages/entities-<market>.json — printed
 *             only with its 90% interval and n, at the build's own n-gates
 *             (MIN_YOY_PAIRS matched / index, MIN_YOY_N median); neutral
 *             when the interval spans 0
 *   record    the detail bucket's top results (entity-<bb>.json `top`, the
 *             all-time highest; top[0] is the record) dated in the window
 *   biggest   the window's largest sale, from `top` ∪ `recent` — said for
 *             the whole window only when those rows provably cover it
 *             (biggestIn), else for the days they do cover
 *   live      the reader's live book, joined on the lot's entity key
 *             (entity/live entityIdOf): on the block now, isFlagged (the ONE
 *             below-market predicate), closing within seven days
 *
 * RANKING (rankNames): new record > clear move > below-market flags > volume.
 */
import { MAKER_MARKETS, ARTIST_MARKET, ARTIST_LABEL } from '../constants';
import type { AuctionLot } from '../types';
import type { EntityYoy, EntityDetail, EntityResultRow } from './entity/model';
import { SCIENCE_COLLECTIONS } from './entity/key';
import { entityIdOf } from './entity/live';
import { MIN_YOY_N, MIN_YOY_PAIRS, RESULT_ROWS } from './entity/stats';
import { affinityOf, type Follow } from './follows';
import { lotFollowOf } from './lot-follow';
import { isFlagged } from './flags';
import { closeMsOf } from './priority';
import { isNewLot, type HouseBaselines } from './feed-filters';
import { isOnBlock } from '../utils';

/** names whose sold side is read (each costs an entity-<bb>.json bucket) */
export const MAX_READ = 12;
/** a "new record" looks back this far in week mode */
export const RECORD_DAYS = 30;
export const WEEK_DAYS = 7;
const DAY = 86_400_000;

/* ── the names ── */

export interface MarketName {
  /** stable key: the entity id, or the follow's kind:key when it has none */
  key: string;
  /** the entity whose sold history is read (null: a category / pseudo-maker
   *  follow — live facts only; its entities-file row is not that scope) */
  id: string | null;
  label: string;
  /** the follow that matches its live lots (affinityOf — the recommender's matcher) */
  follow: Follow;
  followed: boolean;
  /** owned pieces filed under this name */
  owned: number;
}

/** a maker/player follow's slug → its entity id */
export function makerEntityId(slug: string): string | null {
  if (!slug) return null;
  // (marketOf defaults an unknown slug to art — an athlete is not on the roster)
  const m = ARTIST_MARKET[slug];
  if (m && MAKER_MARKETS.has(m)) return `mk:${slug}`;
  // a science collection (Meteorites, Fossils) is its own clean sub
  if (SCIENCE_COLLECTIONS.has(slug)) return `cs:space-science:${slug}`;
  // any other roster pseudo-maker (Sports Cards, Pokémon …) is a whole
  // collection, not a name: live facts only
  if (ARTIST_LABEL[slug]) return null;
  return `pl:${slug}`;
}

/** a follow's entity id (null: no entity row speaks for it) */
export function entityIdOfFollow(f: Follow): string | null {
  if (f.kind === 'maker') return makerEntityId(f.key);
  if (f.kind === 'entity') return f.key.startsWith('sj:') || f.key.startsWith('st:') ? f.key : null;
  return null;
}

type OwnLot = Parameters<typeof lotFollowOf>[0];

/** the reader's names: follows (houses are not a name), then the names their
 *  owned pieces file under — once each, owned counted on the followed row */
export function marketNamesOf(follows: readonly Follow[], owned: readonly OwnLot[]): MarketName[] {
  const out: MarketName[] = [];
  const byKey = new Map<string, MarketName>();
  for (const f of follows) {
    if (f.kind === 'house') continue;
    const id = entityIdOfFollow(f);
    const key = id ?? `${f.kind}:${f.key}`;
    if (byKey.has(key)) continue;
    const n: MarketName = { key, id, label: f.label, follow: f, followed: true, owned: 0 };
    byKey.set(key, n); out.push(n);
  }
  for (const l of owned) {
    const f = lotFollowOf(l);
    if (!f) continue;
    const id = entityIdOfFollow(f);
    const key = id ?? `${f.kind}:${f.key}`;
    const hit = byKey.get(key);
    if (hit) { hit.owned++; continue; }
    const n: MarketName = { key, id, label: f.label, follow: f, followed: false, owned: 1 };
    byKey.set(key, n); out.push(n);
  }
  return out;
}

/* ── days ── */

/** YYYY-MM-DD `n` days before `day` */
export function daysBefore(day: string, n: number): string {
  const t = Date.parse(`${day}T12:00:00Z`) - n * DAY;
  return new Date(t).toISOString().slice(0, 10);
}

/* ── the move ── */

export interface Move {
  pct: number; n: number; basis: EntityYoy['basis'];
  lo: number; hi: number;
  /** 'flat' = the interval spans 0 — printed, never toned, never "news" */
  tone: 'up' | 'down' | 'flat';
}

/** the published YoY, at the build's n-gates, with its interval — else null */
export function moveOf(y: EntityYoy | null | undefined): Move | null {
  if (!y || !Number.isFinite(y.pct) || !Number.isFinite(y.n)) return null;
  const min = y.basis === 'median' ? MIN_YOY_N : MIN_YOY_PAIRS;
  if (y.n < min) return null;
  // the interval IS the claim: an older payload without one prints nothing
  if (y.lo == null || y.hi == null || !Number.isFinite(y.lo) || !Number.isFinite(y.hi) || y.lo > y.hi) return null;
  const tone = y.lo > 0 ? 'up' : y.hi < 0 ? 'down' : 'flat';
  return { pct: y.pct, n: y.n, basis: y.basis, lo: y.lo, hi: y.hi, tone };
}

/* ── records ── */

export interface RecordHit {
  row: EntityResultRow;
  /** 1 = the all-time record; k = the k-th highest result on file */
  rank: number;
  /** inside the short window (this week / since the last visit) */
  fresh: boolean;
}

/** the best-ranked all-time top result dated on/after `from` (fresh: on/after `freshFrom`) */
export function recordIn(detail: Pick<EntityDetail, 'top'> | null | undefined, from: string, freshFrom: string = from): RecordHit | null {
  const top = detail?.top;
  if (!top?.length) return null;
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    if (r && r.d >= from && r.p > 0) return { row: r, rank: i + 1, fresh: r.d >= freshFrom };
  }
  return null;
}

/** the record's newsworthiness: 4 a fresh all-time record … 1 an older top result */
export function recordLevel(h: RecordHit | null): number {
  if (!h) return 0;
  return h.rank === 1 ? (h.fresh ? 4 : 3) : (h.fresh ? 2 : 1);
}

/* ── the window's biggest sale ── */

export interface Biggest {
  /** null = provably no sale in the window (whole) */
  row: EntityResultRow | null;
  /** the rows cover the whole window — else only the days on/after `from` */
  whole: boolean;
  from: string;
  /** the window's sale count — only when the recent rows hold all of it */
  n: number | null;
}

/**
 * The largest sale on/after `from`. `recent` is the newest RESULT_ROWS sales
 * (newest day first, each day by price), `top` the highest RESULT_ROWS ever:
 *   - a top row in the window → the window's max IS a top row (exact);
 *   - recent reaching past `from` (or holding < RESULT_ROWS) → it holds
 *     every window sale (exact, and countable);
 *   - else recent covers only its own days — each day's largest sales lead
 *     it, so the max over [recent's oldest day, …] is exact: said as such.
 */
export function biggestIn(detail: Pick<EntityDetail, 'top' | 'recent'> | null | undefined, from: string): Biggest | null {
  if (!detail) return null;
  const top = (detail.top || []).filter(r => r.d >= from && r.p > 0);
  const recentAll = detail.recent || [];
  const recent = recentAll.filter(r => r.d >= from && r.p > 0);
  const covers = recentAll.length < RESULT_ROWS || (recentAll[recentAll.length - 1]?.d ?? '') < from;
  const best = (xs: EntityResultRow[]) => xs.reduce<EntityResultRow | null>((m, r) => (!m || r.p > m.p ? r : m), null);
  if (top.length) {
    const seen = new Set(top.map(r => r.id));
    return { row: best([...top, ...recent.filter(r => !seen.has(r.id))]), whole: true, from, n: covers ? recent.length : null };
  }
  if (covers) return { row: best(recent), whole: true, from, n: recent.length };
  const oldest = recentAll[recentAll.length - 1].d;
  return { row: best(recent), whole: false, from: oldest, n: null };
}

/* ── live ── */

export interface LiveFacts {
  live: number;
  flagged: number;
  closing: number;
  /** first seen since the last visit (since mode only; else 0) */
  fresh: number;
  /** the flagged lots, soonest close first (the row links the first) */
  flaggedLots: AuctionLot[];
}

/** the name's live lots in the reader's book (the recommender's matcher) */
export function liveFactsOf(name: Pick<MarketName, 'follow' | 'id'>, book: readonly AuctionLot[], o: { nowMs?: number; today?: string; since?: string | null; baselines?: HouseBaselines | null } = {}): LiveFacts {
  const now = o.nowMs ?? Date.now();
  const by = now + WEEK_DAYS * DAY;
  let live = 0, closing = 0, fresh = 0;
  const flaggedLots: AuctionLot[] = [];
  for (const l of book) {
    if (!(o.today ? isOnBlock(l, o.today, now) : isOnBlock(l, undefined, now))) continue;
    // a name with an entity: the lot's entity key (the build's `ek`, else the
    // same function computed — the /makers attribution); else the follow's matcher
    if (name.id ? entityIdOf(l) !== name.id : affinityOf(l, [name.follow]) <= 0) continue;
    live++;
    if (isFlagged(l)) flaggedLots.push(l);
    const c = closeMsOf(l);
    if (c != null && c > now && c <= by) closing++;
    if (o.since && isNewLot(l, { today: o.today, prevVisitDay: o.since, baselines: o.baselines })) fresh++;
  }
  flaggedLots.sort((a, b) => (closeMsOf(a) ?? Infinity) - (closeMsOf(b) ?? Infinity));
  return { live, flagged: flaggedLots.length, closing, fresh, flaggedLots };
}

/* ── one name's digest + the ranking ── */

export interface NameDigest {
  name: MarketName;
  move: Move | null;
  record: RecordHit | null;
  biggest: Biggest | null;
  live: LiveFacts;
  /** sold in the trailing year (volume tiebreak) */
  sold12m: number;
  /** the sold side was read (false: not read yet / a live-only name / over MAX_READ) */
  read: boolean;
  page: string | null;
}

/** anything worth a line: a record, a clear move or a below-market flag */
export function isNews(d: Pick<NameDigest, 'move' | 'record' | 'live'>): boolean {
  return recordLevel(d.record) > 0 || (!!d.move && d.move.tone !== 'flat') || d.live.flagged > 0;
}

/** a name with nothing to report at all — folded into the "quiet" line */
export function isQuiet(d: NameDigest): boolean {
  return !isNews(d) && !d.move && d.live.live === 0 && !d.biggest?.row;
}

/** newsworthy first: new record > clear move > flags > volume */
export function compareNews(a: NameDigest, b: NameDigest): number {
  const r = recordLevel(b.record) - recordLevel(a.record);
  if (r) return r;
  const ca = a.move && a.move.tone !== 'flat' ? 1 : 0, cb = b.move && b.move.tone !== 'flat' ? 1 : 0;
  if (ca !== cb) return cb - ca;
  if (a.live.flagged !== b.live.flagged) return b.live.flagged - a.live.flagged;
  // volume: what is live now, then the trailing year's sales
  if (a.live.live !== b.live.live) return b.live.live - a.live.live;
  if (a.sold12m !== b.sold12m) return b.sold12m - a.sold12m;
  // among clear moves of equal volume: the larger move
  const ma = Math.abs(a.move?.pct ?? 0), mb = Math.abs(b.move?.pct ?? 0);
  if (ma !== mb) return mb - ma;
  return a.name.label < b.name.label ? -1 : a.name.label > b.name.label ? 1 : 0;
}

export function rankNames(ds: readonly NameDigest[]): NameDigest[] {
  return ds.slice().sort(compareNews);
}

/** the section's one-line summary counts (a lot two names share — a
 *  followed maker and a followed category — is one flag, never two) */
export function digestTotals(ds: readonly NameDigest[]): { records: number; moves: number; flagged: number } {
  let records = 0, moves = 0;
  const flagged = new Set<string>();
  for (const d of ds) {
    if (recordLevel(d.record) > 0) records++;
    if (d.move && d.move.tone !== 'flat') moves++;
    for (const l of d.live.flaggedLots) flagged.add(l.id);
  }
  return { records, moves, flagged: flagged.size };
}
