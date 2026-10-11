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
export function mergeCorpusOverEager(eager: AuctionLot[], shards: AuctionLot[]): AuctionLot[] {
  const byId = new Map<string, AuctionLot>();
  for (const l of eager) byId.set(l.id, l);
  const liveIds = new Set(byId.keys());
  const seen = new Set<string>();
  const out: AuctionLot[] = [];
  for (const r of shards) {
    if (seen.has(r.id)) continue;           // a shard boundary can repeat an id
    seen.add(r.id);
    const e = byId.get(r.id);
    out.push(e ? overlayEager(r, e) : settleCorpusRow(r, liveIds));
  }
  for (const l of eager) if (!seen.has(l.id)) out.push(l);
  return out;
}
