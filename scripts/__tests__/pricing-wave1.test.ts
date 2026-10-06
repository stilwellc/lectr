/**
 * Pricing fix wave 1 (Oct 6 2026) — the publish-side contracts: the live-bid
 * floor on every served value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorAtBid, BID_FLOOR_LATE_LIFT, type ValueResult } from '../../app/lib/value';
import { lotAllInFactor } from '../../app/lib/premiums';

const NOW = Date.parse('2026-10-05T13:00:00Z');
const v = (o: Partial<ValueResult> = {}): ValueResult => ({
  poolIds: [], n: 5, compValueUsd: 1220, low: 900, high: 1600, compRatio: null, signal: null, estimateUsd: 1220,
  vsBid: { label: 'above recent comps', pct: 40 }, confidence: 'medium', exact: null,
  expectedHammerUsd: 1000, bandLowUsd: 738, bandHighUsd: 1311, maxBidUsd: 900, premiumFactor: 1.22, ...o,
});
const goldin = (bid: number, close: string) => ({ auctionHouse: 'Goldin', currentBid: bid, saleDate: close.slice(0, 10), saleDateTime: close });

test('floorAtBid: no bid, or a value already above the bid → the same object back', () => {
  const a = v();
  assert.equal(floorAtBid(a, goldin(0, '2026-10-20T02:00:00Z'), NOW), a);
  assert.equal(floorAtBid(a, goldin(700, '2026-10-20T02:00:00Z'), NOW), a);
});

test('floorAtBid: expected hammer lifted to the bid (far from close); all-in = hammer × premium; band low/max bid floored; vsBid kept', () => {
  const f = floorAtBid(v(), goldin(1400, '2026-10-20T02:00:00Z'), NOW);
  assert.equal(f.expectedHammerUsd, 1400);
  assert.equal(f.bidFloor, 1400);
  assert.equal(f.compValueUsd, Math.round(1400 * lotAllInFactor({ auctionHouse: 'Goldin' }, 1400)));
  assert.equal(f.estimateUsd, f.compValueUsd);
  assert.ok(f.bandLowUsd! >= 1400 && f.low! >= Math.round(1400 * 1.22));
  assert.ok(f.bandHighUsd! >= f.expectedHammerUsd! && f.high! >= f.compValueUsd);
  assert.ok(f.maxBidUsd! >= f.bandLowUsd! && f.maxBidUsd! <= f.expectedHammerUsd!);
  assert.deepEqual(f.vsBid, { label: 'above recent comps', pct: 40 }, 'vsBid stays the comps read');
});

test('floorAtBid: inside the last 3 days the floor is bid × 1.1; the band low stays at the bid', () => {
  const f = floorAtBid(v(), goldin(1400, '2026-10-07T02:00:00Z'), NOW);
  assert.equal(f.expectedHammerUsd, Math.round(1400 * BID_FLOOR_LATE_LIFT));
  assert.equal(f.bandLowUsd, 1400);
  // a value between bid and bid×1.1 is lifted only when late
  const mid = v({ expectedHammerUsd: 1450, compValueUsd: 1769, bandLowUsd: 1200 });
  assert.equal(floorAtBid(mid, goldin(1400, '2026-10-20T02:00:00Z'), NOW).expectedHammerUsd, 1450);
  assert.equal(floorAtBid(mid, goldin(1400, '2026-10-06T02:00:00Z'), NOW).expectedHammerUsd, 1540);
});

test('floorAtBid: a value above the bid with its band low under it only has the band floored', () => {
  const f = floorAtBid(v({ bandLowUsd: 500, low: 610 }), goldin(800, '2026-10-20T02:00:00Z'), NOW);
  assert.equal(f.expectedHammerUsd, 1000);
  assert.equal(f.bidFloor, undefined);
  assert.equal(f.bandLowUsd, 800);
  assert.equal(f.low, Math.round(800 * lotAllInFactor({ auctionHouse: 'Goldin' }, 800)));
});
