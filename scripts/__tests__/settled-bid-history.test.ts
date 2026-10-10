/**
 * Bid history survives settlement on the sports-crawl houses: the settled
 * record replaces the live row by id (writeMergedSegmentWithLive /
 * writeMergedSegment), and now inherits the live row's {d,b,n} snapshots,
 * compacted to the first sighting + the last SETTLED_SNAP_TAIL — so the close-k
 * fit's obsFromBidHistory sees them on the sold row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// corpus-io resolves data/corpus/segments off process.cwd() at import time
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'settled-hist-'));
process.chdir(tmp);

type Snap = { d: string; b: number; n: number };
type Row = Record<string, unknown> & { id: string; status: string; bidHistory?: Snap[] };
const snaps = (k: number, start = '2026-09-01'): Snap[] =>
  Array.from({ length: k }, (_, i) => ({ d: new Date(Date.parse(`${start}T12:00:00Z`) + i * 864e5).toISOString(), b: 100 * (i + 1), n: i + 1 }));
const today = new Date().toISOString().slice(0, 10);

test('compactBidHistory keeps first + last 12, idempotent, short trails untouched', async () => {
  const { compactBidHistory, SETTLED_SNAP_TAIL } = await import('../lib/sports-crawl');
  assert.equal(SETTLED_SNAP_TAIL, 12);
  const h = snaps(40);
  const c = compactBidHistory(h);
  assert.equal(c.length, 13);
  assert.deepEqual(c[0], h[0]);
  assert.deepEqual(c.slice(1), h.slice(-12));
  assert.deepEqual(compactBidHistory(c), c);
  assert.deepEqual(compactBidHistory(snaps(5)), snaps(5));
  assert.deepEqual(compactBidHistory(snaps(13)), snaps(13));
});

test('withSettledHistory: settled inherits, upcoming untouched, own history wins', async () => {
  const { withSettledHistory } = await import('../lib/sports-crawl');
  const prev = { id: 'x', status: 'upcoming', bidHistory: snaps(20) } as never;
  const sold = withSettledHistory({ id: 'x', status: 'sold' } as never, prev) as unknown as Row;
  assert.equal(sold.bidHistory!.length, 13);
  assert.equal(sold.bidHistory![12].b, 2000);
  const live = { id: 'x', status: 'upcoming' } as never;
  assert.equal(withSettledHistory(live, prev), live);
  const own = withSettledHistory({ id: 'x', status: 'sold', bidHistory: snaps(2, '2026-08-01') } as never, prev) as unknown as Row;
  assert.equal(own.bidHistory![0].d.slice(0, 10), '2026-08-01');
  const bare = { id: 'y', status: 'sold' } as never;
  assert.equal(withSettledHistory(bare, undefined), bare);
});

test('writeMergedSegmentWithLive: a lot that settles tonight keeps its live snapshots', async () => {
  const { writeMergedSegmentWithLive } = await import('../lib/sports-crawl');
  const { writeSegment, readSegment } = await import('../corpus-io');
  writeSegment('t1', [
    { id: 'a', status: 'upcoming', saleDate: today, currentBid: 2000, bidCount: 20, bidHistory: snaps(20) },
    { id: 'b', status: 'upcoming', saleDate: today, currentBid: 50, bidCount: 1, bidHistory: snaps(1) },
    { id: 'c', status: 'sold', saleDate: '2026-01-01', priceUsd: 10 },
  ]);
  const r = writeMergedSegmentWithLive('t1',
    [{ id: 'a', status: 'sold', saleDate: today, priceUsd: 2600, hammerPrice: 2200 } as never],
    [{ id: 'b', status: 'upcoming', saleDate: today, currentBid: 75, bidCount: 2 } as never],
    true);
  assert.equal(r.upcoming, 1);
  const rows = new Map((readSegment('t1') as Row[]).map(l => [l.id, l]));
  const a = rows.get('a')!;
  assert.equal(a.status, 'sold');
  assert.equal(a.priceUsd, 2600);
  assert.equal(a.bidHistory!.length, 13);
  assert.equal(a.bidHistory![0].b, 100);
  assert.equal(a.bidHistory![12].b, 2000);
  assert.equal(rows.get('b')!.bidHistory!.length, 2, 'live leg still appends');
  assert.equal(rows.get('c')!.bidHistory, undefined);
});

test('a lot seen live AND settled in the same run keeps tonight\'s appended snapshot', async () => {
  const { writeMergedSegmentWithLive } = await import('../lib/sports-crawl');
  const { writeSegment, readSegment } = await import('../corpus-io');
  writeSegment('t3', [{ id: 'a', status: 'upcoming', saleDate: today, bidHistory: snaps(3) }]);
  writeMergedSegmentWithLive('t3',
    [{ id: 'a', status: 'sold', saleDate: today, priceUsd: 900 } as never],
    [{ id: 'a', status: 'upcoming', saleDate: today, currentBid: 777, bidCount: 9 } as never],
    true);
  const a = (readSegment('t3') as Row[])[0];
  assert.equal(a.status, 'sold');
  assert.equal(a.bidHistory!.length, 4);
  assert.equal(a.bidHistory![3].b, 777);
});

test('a mid-run settled flush (writeMergedSegment) carries the trail too, and a later re-settle keeps it', async () => {
  const { writeMergedSegment } = await import('../lib/sports-crawl');
  const { writeSegment, readSegment } = await import('../corpus-io');
  writeSegment('t2', [{ id: 'a', status: 'upcoming', saleDate: today, bidHistory: snaps(30) }]);
  writeMergedSegment('t2', [{ id: 'a', status: 'sold', saleDate: today, priceUsd: 1 } as never]);
  writeMergedSegment('t2', [{ id: 'a', status: 'sold', saleDate: today, priceUsd: 2 } as never]);
  const a = (readSegment('t2') as Row[])[0];
  assert.equal(a.priceUsd, 2);
  assert.equal(a.bidHistory!.length, 13);
  assert.equal(a.bidHistory![0].b, 100);
});

test('the carried trail feeds the close-k fit', async () => {
  const { withSettledHistory } = await import('../lib/sports-crawl');
  const { obsFromBidHistory } = await import('../lib/close-k-fit');
  const prev = { id: 'rea-1', status: 'upcoming', bidHistory: [{ d: '2026-09-20T12:00:00Z', b: 1000, n: 5 }, { d: '2026-09-25T12:00:00Z', b: 1500, n: 9 }] };
  const soldRow = { id: 'rea-1', status: 'sold', auctionHouse: 'REA', saleName: 'REA Fall 2026', title: '1952 Topps Mickey Mantle PSA 4', category: 'sports', saleDate: '2026-09-28', currency: 'USD', priceBasis: 'realized', priceUsd: 3000, hammerPrice: 2500 };
  assert.equal(obsFromBidHistory([soldRow as never]).length, 0);
  const after = obsFromBidHistory([withSettledHistory(soldRow as never, prev as never) as never]);
  assert.equal(after.length, 2);
  assert.ok(after.every(o => o.room === 'rea' && o.h === 2500));
});
