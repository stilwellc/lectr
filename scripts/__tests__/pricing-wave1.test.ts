/**
 * Pricing fix wave 1 (Oct 6 2026) — the publish-side contracts: the live-bid
 * floor on every served value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorAtBid, BID_FLOOR_LATE_LIFT, type ValueResult } from '../../app/lib/value';
import { lotAllInFactor } from '../../app/lib/premiums';
import { engineFlagOf, computeDeepSignal } from '../../app/lib/comps';
import type { AuctionLot } from '../../app/types';

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

test('engineFlagOf / computeDeepSignal: no engine value → no flag (never a client synthesis)', () => {
  const lot = (value: unknown, extra: Record<string, unknown> = {}) => ({ id: 'x', artist: 'andy-warhol', title: 'Marilyn', estLowUsd: 1000, estHighUsd: 2000, formKey: 'screenprint', value, ...extra }) as unknown as AuctionLot;
  assert.equal(engineFlagOf(lot(null)), null);
  assert.equal(engineFlagOf(lot(undefined)), null);
  assert.equal(computeDeepSignal(lot(null), [lot(null)]), null, 'the client no longer reads a pool for an engine-declined lot');
  const ev = { n: 6, compValueUsd: 2400, compMedianUsd: 2100, compRatio: 1.4, flagRatio: 1.35, confidence: 'high', signal: { label: 'below comparable market', strength: 'moderate', beatRatePct: 58 } };
  const f = engineFlagOf(lot(ev))!;
  assert.equal(f.label, 'Below Market');
  assert.equal(f.pct, 35, 'the printed % is the flag ratio');
  assert.equal(f.med, 2100);
  assert.equal(engineFlagOf(lot({ ...ev, signal: { ...ev.signal, label: 'at comparable market' } })), null);
  assert.equal(engineFlagOf(lot({ ...ev, compRatio: 6 })), null, 'x5 estimate-band sanity');
  assert.equal(engineFlagOf(lot({ ...ev, signal: null })), null);
  const a = engineFlagOf(lot({ ...ev, compRatio: 0.6, flagRatio: 0.62, signal: { label: 'above comparable market', strength: 'moderate', beatRatePct: 30 } }))!;
  assert.equal(a.label, 'Above Market'); assert.equal(a.pct, 38);
});
