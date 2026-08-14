/**
 * comp-evidence.ts — lazy loader for the engine's comp-pool evidence rows.
 *
 * The build-time value engine draws its pools from the FULL corpus, including
 * the corpus-only tier that never ships to the browser — so `value.poolIds`
 * often can't resolve against the client's on-wire lots, and the comps surface
 * would contradict its own header ("8 sales" … "no comparable sales"). The
 * build writes comp-evidence.json (id → the pool's rows) for every
 * signal-carrying lot; this module fetches it once and converts rows to
 * display-grade pseudo-lots.
 */
import type { AuctionLot } from '../types';

export type EvRow = { i: string; t: string; h: string; d: string; p: number };

let cache: Promise<Record<string, EvRow[]> | null> | null = null;
export function loadCompEvidence(): Promise<Record<string, EvRow[]> | null> {
  if (!cache) {
    cache = fetch('/data/ray/comp-evidence.json')
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && j.byLot) || null)
      .catch(() => null);
  }
  return cache;
}

/** Display-grade pseudo-lots: enough fields for the comps rows (title, house,
 *  date, realized price). They are NOT full lots — no url/image — and must
 *  never be merged back into a corpus pool. */
export function evRowsToLots(rows: EvRow[], like: AuctionLot): AuctionLot[] {
  return rows.map(r => ({
    id: r.i,
    title: r.t,
    auctionHouse: r.h,
    saleDate: r.d,
    priceUsd: r.p,
    realizedUsd: r.p,
    status: 'sold',
    artist: like.artist,
    category: like.category,
  } as unknown as AuctionLot));
}
