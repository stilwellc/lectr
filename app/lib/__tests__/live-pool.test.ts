/**
 * THE LIVE POOL IS THE EAGER BOOK (r9, QA4 B1). Opening a comps modal loads
 * the corpus shards; on Oct 10 those still carried 1,249 closed lots as
 * status 'upcoming', the phase-2 merge kept the shard status, and the live
 * book went 9,662 → 10,842. A corpus row may ENRICH a lot, never add,
 * resurrect or re-open one.
 */
import { test } from 'node:test';
import * as assert from 'assert';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { mergeCorpusOverEager, settleCorpusRow, overlayEager } from '../live-pool';
import { isOnBlock, getUpcomingCounts } from '../../utils';
import type { AuctionLot } from '../../types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const UP = path.join(ROOT, 'public/data/ray/upcoming.json');
const NOW = Date.parse('2026-10-09T20:00:00Z');   // Oct 9 4pm ET (the served book's day)
const TODAY = '2026-10-09';

function eagerBook(): AuctionLot[] {
  if (existsSync(UP)) return (JSON.parse(readFileSync(UP, 'utf8')) as { lots: AuctionLot[] }).lots;
  // no served build on disk: a small synthetic book
  return Array.from({ length: 200 }, (_, i) => ({
    id: `x-${i}`, status: 'upcoming', saleDate: '2026-10-20', artist: i % 2 ? 'andy-warhol' : 'sports-cards',
    auctionHouse: i % 3 ? 'Goldin' : 'Phillips', title: `Lot ${i}`, currentBid: 100 + i, bidCount: 3,
  } as unknown as AuctionLot));
}

/** the shard snapshot as the Oct 10 nightly shipped it: every eager lot
 *  (nightly-stale bid state, stripped fields, a stale resultsPending), plus
 *  closed lots still saying 'upcoming' — dated into the future so a merge
 *  that kept their status would count every one */
function staleShards(eager: AuctionLot[], nStale: number): AuctionLot[] {
  const rows: AuctionLot[] = eager.map((l, i) => {
    const r = { ...l, currentBid: 1, bidCount: 0, priceUsd: null } as AuctionLot & Record<string, unknown>;
    delete r.saleDateTime; delete r.bidProj; delete r.signal;
    if (i % 7 === 0) r.resultsPending = true;
    return r;
  });
  for (let i = 0; i < nStale; i++) {
    const src = eager[i % eager.length];
    rows.splice((i * 37) % rows.length, 0, {
      ...src, id: `goldin-stale-${i}`, status: 'upcoming', saleDate: '2026-10-25', saleDateTime: undefined, currentBid: 700000,
    } as AuctionLot);
  }
  return rows;
}

const liveCount = (lots: AuctionLot[]) => lots.filter(l => isOnBlock(l, TODAY, NOW)).length;
const byKey = (lots: AuctionLot[], key: (l: AuctionLot) => string) => {
  const m: Record<string, number> = {};
  for (const l of lots) if (isOnBlock(l, TODAY, NOW)) { const k = key(l); m[k] = (m[k] || 0) + 1; }
  return m;
};

test('stale shard "upcoming" rows never change a live count', () => {
  const eager = eagerBook();
  const shards = staleShards(eager, 1249);
  const merged = mergeCorpusOverEager(eager, shards);

  // the pool: every count a surface prints, before and after the corpus lands
  assert.strictEqual(liveCount(merged), liveCount(eager), 'live book');
  assert.deepStrictEqual(byKey(merged, l => l.artist), byKey(eager, l => l.artist), 'per-maker (/makers, nav, ⌘K)');
  assert.deepStrictEqual(byKey(merged, l => l.auctionHouse), byKey(eager, l => l.auctionHouse), 'per-house');
  assert.deepStrictEqual(byKey(merged, l => String((l as { category?: string }).category)), byKey(eager, l => String((l as { category?: string }).category)), 'per-category tabs');
  assert.deepStrictEqual(getUpcomingCounts(merged), getUpcomingCounts(eager), 'getUpcomingCounts');
  // and the 'upcoming' status pool itself is exactly the eager ids
  const up = new Set(merged.filter(l => l.status === 'upcoming').map(l => l.id));
  assert.strictEqual(up.size, eager.length);
  for (const l of eager) assert.ok(up.has(l.id));
});

test('stale rows settle closed — kept as history, never "Current bid"', () => {
  const eager = eagerBook();
  const merged = mergeCorpusOverEager(eager, staleShards(eager, 50));
  const stale = merged.filter(l => l.id.startsWith('goldin-stale-'));
  assert.strictEqual(stale.length, 50, 'history rows are kept');
  for (const l of stale) {
    assert.strictEqual(l.status, 'unknown-result');
    assert.ok(!isOnBlock(l, TODAY, NOW));
  }
});

test('the eager row wins every field it carries; the shard only enriches', () => {
  const eager = eagerBook();
  const merged = mergeCorpusOverEager(eager, staleShards(eager, 10));
  const byId = new Map(merged.map(l => [l.id, l]));
  for (const e of eager.slice(0, 500)) {
    const m = byId.get(e.id)!;
    assert.ok(m, 'no eager lot is dropped');
    assert.strictEqual(m.status, e.status);
    assert.strictEqual(m.currentBid, e.currentBid);
    assert.strictEqual(m.bidCount, e.bidCount);
    assert.strictEqual(m.saleDateTime, e.saleDateTime);
    assert.strictEqual(!!m.resultsPending, !!e.resultsPending, 'a stale shard resultsPending never re-states the eager lot');
    assert.deepStrictEqual(m.signal, e.signal);
  }
  // shard-only fields ride through
  const e0 = eager[0];
  const o = overlayEager({ ...e0, repeatSaleGroupId: 'g1' } as AuctionLot, e0);
  assert.strictEqual(o.repeatSaleGroupId, 'g1');
});

test('an eager lot the shards miss is still live; a shard can never add one', () => {
  const eager = eagerBook();
  const merged = mergeCorpusOverEager(eager, staleShards(eager, 5).slice(20));
  assert.strictEqual(liveCount(merged), liveCount(eager));
});

test('off-tape rows (per-lot shard, maker shard, Supabase) settle against the eager ids', () => {
  const live = new Set(['a']);
  const closed = settleCorpusRow({ id: 'b', status: 'upcoming' as const, resultsPending: true }, live);
  assert.strictEqual(closed.status, 'unknown-result');
  assert.strictEqual(closed.resultsPending, undefined);
  assert.strictEqual(settleCorpusRow({ id: 'a', status: 'upcoming' as const }, live).status, 'upcoming');
  assert.strictEqual(settleCorpusRow({ id: 'c', status: 'sold' as const }, live).status, 'sold');
  // no eager book (legacy single load): rows stand as shipped
  assert.strictEqual(settleCorpusRow({ id: 'b', status: 'upcoming' as const }, null).status, 'upcoming');
});

test('the phase-2 merge and the off-tape resolvers go through live-pool', () => {
  const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
  assert.match(src('app/hooks/useRayData.ts'), /mergeCorpusOverEager\(up\.lots/);
  assert.match(src('app/components/LotPage.tsx'), /settleLiveRow\(offTape\)/);
  assert.match(src('app/hooks/useMakerRows.ts'), /settleLiveRow\(r\)/);
});
