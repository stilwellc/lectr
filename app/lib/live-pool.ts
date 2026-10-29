/**
 * live-pool.ts — THE LIVE POOL IS THE EAGER BOOK (r9, QA4 B1).
 *
 * The live pool — every live count (home, /makers, nav, /value, ⌘K) and every
 * "Current bid" — is defined by the eager upcoming.json (plus the intraday
 * close-board overlay, applied in place) and read through isOnBlock. The
 * corpus shards (lots-N.json, maker shards, the per-lot shard) are a nightly
 * HISTORY snapshot: they may ENRICH a lot with fields the eager row doesn't
 * carry, but they never add a live lot, resurrect a closed one, or overwrite
 * the eager row's newer live/closed state.
 *
 * Oct 10 2026: the shards still carried 1,249 lots as status 'upcoming' that
 * the eager build had already closed out (Goldin's Oct 10 sale ×1,180,
 * Phillips 49, Bonhams 12…). Opening any comps modal pulled the shards and
 * the merge kept the shard row's status, so the live book jumped 9,662 →
 * 10,842 and the closed $700K Ruth caramel read "Current bid".
 */
import type { AuctionLot } from '../types';
import { isOnBlock, localToday } from '../utils';

/** A corpus row that says 'upcoming' for a lot the eager book doesn't carry
 *  is STALE: the eager build closed it out. It settles to 'unknown-result'
 *  (closed, the house's result not reconciled yet) so no live surface reads
 *  it, while its history stays resolvable. `liveIds` null = no eager book
 *  (the legacy single-load path) — the row stands as shipped. */
export function settleCorpusRow<T extends Pick<AuctionLot, 'id' | 'status'>>(row: T, liveIds: ReadonlySet<string> | null): T {
  if (!liveIds || row.status !== 'upcoming' || liveIds.has(row.id)) return row;
  return { ...row, status: 'unknown-result', resultsPending: undefined } as T;
}

/** the live/closed STATE fields: the eager row's word is final even where it
 *  is silent (an eager lot without resultsPending is not pending, whatever
 *  last night's shard said) */
const STATE_KEYS = ['status', 'resultsPending', 'saleDate', 'saleDateTime', 'closeKind', 'currentBid', 'bidCount'] as const;

/** one lot: the shard row enriched, the eager row authoritative */
export function overlayEager(shard: AuctionLot, eager: AuctionLot): AuctionLot {
  const x = { ...shard, ...eager } as AuctionLot & Record<string, unknown>;
  for (const k of STATE_KEYS) if (!(k in eager)) delete x[k];
  return x;
}

/** The phase-2 merge: corpus rows in shard order, each eager lot laid OVER its
 *  shard row (eager wins on every field it carries — signal incl. explicit
 *  null, bid state, close time, value; the shard only fills fields the eager
 *  row lacks), stale 'upcoming' shard rows settled, and any eager lot the
 *  shards missed appended — so the live pool after the merge is exactly the
 *  eager pool. */
/* ── THE ON-BLOCK INDEX (Oct 29 2026, desk pass 6) ──
   Every room that asks "which lots are on the block?" used to scan the whole
   book — the provider's pool, each followed NAME in Names and Your market, the
   budget's buys: six names = seven scans of 300k lots on every desk change.
   The index reads the book ONCE per book identity, reader day and 10-minute
   clock bucket (the rooms' own grain: a lot's live edge moves rarely) and
   hands every caller the same array. Keyed on the array object (WeakMap): a
   new book is a new scan, an old one is collected with its book. The result
   is exactly isOnBlock's — same predicate, same day, same clock. */
const ON_BLOCK_GRAIN = 10 * 60_000;
const onBlockCache = new WeakMap<readonly BlockLot[], { today: string; bucket: number; lots: BlockLot[] }>();
type BlockLot = Parameters<typeof isOnBlock>[0] & { status: string };
export function onBlockOf<T extends BlockLot>(book: readonly T[], todayIso: string, nowMs: number): T[] {
  const bucket = Math.floor(nowMs / ON_BLOCK_GRAIN);
  const hit = onBlockCache.get(book) as { today: string; bucket: number; lots: T[] } | undefined;
  if (hit && hit.today === todayIso && hit.bucket === bucket) return hit.lots;
  const at = bucket * ON_BLOCK_GRAIN;
  const lots = book.filter(l => l.status === 'upcoming' && isOnBlock(l, todayIso, at));
  onBlockCache.set(book, { today: todayIso, bucket, lots });
  return lots;
}

/** THE BOOK INDEX (desk pass 6): id → lot for one book, built once per book
 *  identity and shared — the desk's save resolver, the taste's and the
 *  collection's each built their own 355k-entry Map of the same array on
 *  every book change (three ~40 ms tasks for one answer). A new book is a
 *  new index; an old one is collected with its book. */
const bookIndexCache = new WeakMap<readonly { id: string }[], Map<string, unknown>>();
export function bookIndex<T extends { id: string }>(book: readonly T[]): ReadonlyMap<string, T> {
  const hit = bookIndexCache.get(book) as Map<string, T> | undefined;
  if (hit) return hit;
  const m = new Map<string, T>();
  for (const l of book) m.set(l.id, l);
  bookIndexCache.set(book, m);
  return m;
}

interface MergeState { byId: Map<string, AuctionLot>; liveIds: Set<string>; seen: Set<string>; out: AuctionLot[] }
function mergeStart(eager: AuctionLot[]): MergeState {
  const byId = new Map<string, AuctionLot>();
  for (const l of eager) byId.set(l.id, l);
  return { byId, liveIds: new Set(byId.keys()), seen: new Set<string>(), out: [] };
}
/** the rows [from, to) of the shards, merged in order (one row's logic for the sync and the sliced merge) */
function mergeRows(s: MergeState, shards: readonly AuctionLot[], from: number, to: number): void {
  const { byId, liveIds, seen, out } = s;
  for (let i = from; i < to; i++) {
    const r = shards[i];
    if (seen.has(r.id)) continue;           // a shard boundary can repeat an id
    seen.add(r.id);
    const e = byId.get(r.id);
    out.push(e ? overlayEager(r, e) : r.status === 'upcoming' ? settleCorpusRow(r, liveIds) : r);
  }
}
function mergeEnd(s: MergeState, eager: AuctionLot[]): AuctionLot[] {
  for (const l of eager) if (!s.seen.has(l.id)) s.out.push(l);
  return s.out;
}

/** the on-block index for the reader's day and clock (the call most readers make) */
export function onBlockNow<T extends BlockLot>(book: readonly T[]): T[] { return onBlockOf(book, localToday(), Date.now()); }

export function mergeCorpusOverEager(eager: AuctionLot[], shards: AuctionLot[]): AuctionLot[] {
  const s = mergeStart(eager);
  mergeRows(s, shards, 0, shards.length);
  return mergeEnd(s, eager);
}

/** rows merged per slice between turns of the event loop */
const MERGE_SLICE = 40_000;
/** The same merge, sliced (desk pass 6): 355k rows in one synchronous pass
 *  was a ~100 ms task the moment the shards landed; this yields to the
 *  event loop between slices of MERGE_SLICE rows so no slice is a long task,
 *  and returns exactly mergeCorpusOverEager's array. */
export async function mergeCorpusOverEagerSliced(eager: AuctionLot[], shards: AuctionLot[]): Promise<AuctionLot[]> {
  const s = mergeStart(eager);
  for (let from = 0; from < shards.length; from += MERGE_SLICE) {
    if (from > 0) await new Promise<void>(r => setTimeout(r, 0));
    mergeRows(s, shards, from, Math.min(shards.length, from + MERGE_SLICE));
  }
  return mergeEnd(s, eager);
}
