/**
 * TODAY'S READS (desk/rooms/today-logic): which lots carry which read, the
 * thresholds, the velocity freshness gate, one read per lot, the cap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import type { AuctionLot } from '../../types';
import { pinClock } from '../../lib/__tests__/helpers/pin-clock';

process.env.TZ = 'America/New_York';
pinClock('2026-10-29T16:00:00-04:00');
const NOW = Date.now();

(Module as unknown as { _extensions: Record<string, (m: unknown, f: string) => void> })._extensions['.css'] = () => {};
declare const require: NodeRequire;
const T = require('../desk/rooms/today-logic') as typeof import('../desk/rooms/today-logic');

const lot = (over: Record<string, unknown>): AuctionLot =>
  ({ id: 'l', title: 'Vase', artist: 'andy-warhol', auctionHouse: 'Goldin', status: 'upcoming', saleDate: '2026-11-05', saleDateTime: '2026-11-05T23:00:00Z', currency: 'USD',
    estimateLow: null, estimateHigh: null, priceUsd: null, ...over } as unknown as AuctionLot);
const FRESH = '2026-10-29T06:00:00Z', STALE = '2026-10-27T06:00:00Z';
const reads = (upcoming: AuctionLot[], over: Partial<Parameters<typeof T.todayReadsOf>[0]> = {}) =>
  T.todayReadsOf({ upcoming, signalById: new Map(), fullLoaded: true, nowMs: NOW, lastCrawl: FRESH, ...over });

test('Most bids: the two fastest rooms by delta; the percentile is cited only from the median up', () => {
  const a = lot({ id: 'a', bidVelocity: { delta: 5, hours: 24, pctile: 80 } });
  const b = lot({ id: 'b', bidVelocity: { delta: 2, hours: 23.6, pctile: 30 } });
  const c = lot({ id: 'c', bidVelocity: { delta: 9, hours: 24, pctile: 95 } });
  const d = lot({ id: 'd', bidVelocity: { delta: 0, hours: 24, pctile: 10 } });
  const r = reads([a, b, c, d]).filter(x => x.tag === 'Most bids');
  assert.deepEqual(r.map(x => x.lot.id), ['c', 'a']);
  assert.deepEqual(r[0].fact, { kind: 'hot', delta: 9, hours: 24, pctile: 95 });
  const rb = reads([b]).filter(x => x.tag === 'Most bids')[0];
  assert.deepEqual(rb.fact, { kind: 'hot', delta: 2, hours: 24, pctile: null }, 'a below-median pace is not praised');
});

test('THE VELOCITY FRESHNESS GATE: a stale crawl prints no "+N bids in 24h"; a date-only stamp from today is fresh; a 24h-old ISO is not', () => {
  const a = lot({ id: 'a', bidVelocity: { delta: 5, hours: 24, pctile: 80 } });
  assert.equal(reads([a], { lastCrawl: STALE }).filter(x => x.tag === 'Most bids').length, 0);
  assert.equal(reads([a], { lastCrawl: null }).filter(x => x.tag === 'Most bids').length, 0);
  assert.equal(reads([a], { lastCrawl: '2026-10-29' }).filter(x => x.tag === 'Most bids').length, 1);
  assert.equal(reads([a], { lastCrawl: '2026-10-28' }).filter(x => x.tag === 'Most bids').length, 0);
  assert.equal(T.velocityFresh('2026-10-28T20:30:00Z', NOW), true);    // 23.5h ago → inside 24h, fresh
  assert.equal(T.velocityFresh('2026-10-28T19:30:00Z', NOW), false);   // 24.5h ago → stale
  // a stale crawl still lets the other reads through (they read the lot, not the diff)
  const soon = lot({ id: 's', saleDate: '2026-10-30', saleDateTime: '2026-10-30T23:00:00Z', bidVelocity: { delta: 5, hours: 24, pctile: 80 } });
  assert.deepEqual(reads([soon], { lastCrawl: STALE }).map(x => x.tag), ['Lands soon']);
});

test('Lands soon: hammers within TAG_SOON_DAYS (0–2), three at most; the bid count rides only when the estimate text did not print the bid form', () => {
  const d0 = lot({ id: 'd0', saleDate: '2026-10-29', saleDateTime: '2026-10-29T23:00:00Z', estimateLow: 1000, estimateHigh: 2000, bidCount: 4 });
  const d2 = lot({ id: 'd2', saleDate: '2026-10-31', saleDateTime: '2026-10-31T23:00:00Z', currentBid: 402, bidCount: 10 });
  const d3 = lot({ id: 'd3', saleDate: '2026-11-01', saleDateTime: '2026-11-01T23:00:00Z' });
  const d1a = lot({ id: 'd1a', saleDate: '2026-10-30', saleDateTime: '2026-10-30T23:00:00Z' });
  const d1b = lot({ id: 'd1b', saleDate: '2026-10-30', saleDateTime: '2026-10-30T23:30:00Z' });
  const r = reads([d0, d1a, d1b, d2, d3]).filter(x => x.tag === 'Lands soon');
  assert.deepEqual(r.map(x => x.lot.id), ['d0', 'd1a', 'd1b']);
  const f0 = r[0].fact as Extract<import('../desk/rooms/today-logic').ReadFact, { kind: 'soon' }>;
  assert.equal(f0.days, 0); assert.equal(f0.bids, 4); assert.match(f0.estText, /\$1K/);
  const f2 = reads([d2]).filter(x => x.tag === 'Lands soon')[0].fact as typeof f0;
  assert.equal(f2.bids, null, 'formatEstimate already printed "$402 bid · 10 bids" — never twice');
  assert.match(f2.estText, /bid/);
});

test('Direct comps: the build\'s same-card comps, two at most, only once the archive loaded; Below market: the engine\'s flag by dealScore, two at most', () => {
  const c1 = lot({ id: 'c1', cardComps: { n: 4, med: 1200 } });
  const c2 = lot({ id: 'c2', cardComps: { n: 1, med: 900 } });
  const c3 = lot({ id: 'c3', cardComps: { n: 7, med: 3000 } });
  const none = lot({ id: 'c0', cardComps: { n: 0, med: null } });
  const r = reads([c1, c2, c3, none]).filter(x => x.tag === 'Direct comps');
  assert.deepEqual(r.map(x => x.lot.id), ['c1', 'c2']);
  assert.deepEqual(r[0].fact, { kind: 'comps', n: 4, med: 1200 });
  assert.equal(reads([c1], { fullLoaded: false }).length, 0);
  const b1 = lot({ id: 'b1', estimateLow: 1000, estimateHigh: 2000 }), b2 = lot({ id: 'b2', estimateLow: 1000, estimateHigh: 2000 }), b3 = lot({ id: 'b3', currentBid: 500 });
  const sig = new Map([['b1', { label: 'Below Market', pct: 20 }], ['b2', { label: 'Below Market', pct: 60 }], ['b3', { label: 'Below Market', pct: 40 }]]);
  const under = reads([b1, b2, b3], { signalById: sig }).filter(x => x.tag === 'Below market');
  assert.equal(under.length, 2);
  assert.equal(under[0].tone, 'up');
  const fb = reads([b3], { signalById: sig }).filter(x => x.tag === 'Below market')[0].fact as Extract<import('../desk/rooms/today-logic').ReadFact, { kind: 'below' }>;
  assert.equal(fb.bid, null, 'the live-bid form already printed the bid');
});

test('Quietest: the engine\'s sleeper read — zero bids on a lot it appraised (high / medium confidence), closing inside the week; absent bidCount is absent data', () => {
  const q = lot({ id: 'q', saleDate: '2026-11-02', saleDateTime: '2026-11-02T23:00:00Z', bidCount: 0, currentBid: 100, value: { poolIds: [], n: 6, compValueUsd: 5000, compMedianUsd: 5000, low: 4000, high: 6000, compRatio: null, signal: null, estimateUsd: null, vsBid: null, exact: null, confidence: 'high' } });
  const noCount = lot({ id: 'nc', saleDate: '2026-11-02', saleDateTime: '2026-11-02T23:00:00Z', value: { poolIds: [], n: 6, compValueUsd: 5000, low: 4000, high: 6000, compRatio: null, signal: null, estimateUsd: null, vsBid: null, exact: null, confidence: 'high' } });
  const far = lot({ id: 'far', saleDate: '2026-11-20', saleDateTime: '2026-11-20T23:00:00Z', bidCount: 0, value: { poolIds: [], n: 6, compValueUsd: 5000, low: 4000, high: 6000, compRatio: null, signal: null, estimateUsd: null, vsBid: null, exact: null, confidence: 'high' } });
  const r = reads([q, noCount, far]).filter(x => x.tag === 'Quietest');
  assert.deepEqual(r.map(x => x.lot.id), ['q']);
  assert.deepEqual(r[0].fact, { kind: 'quiet', days: 4, entry: 100, cvu: 5000, atEstimate: false });
});

test('one read per lot in evidence order (hot > quiet > soon > comps > below), READS_MAX in all', () => {
  const both = lot({ id: 'both', saleDate: '2026-10-30', saleDateTime: '2026-10-30T23:00:00Z', bidVelocity: { delta: 3, hours: 24, pctile: 60 }, cardComps: { n: 2, med: 500 } });
  const sig = new Map([['both', { label: 'Below Market', pct: 50 }]]);
  const r = reads([both], { signalById: sig });
  assert.deepEqual(r.map(x => x.tag), ['Most bids']);
  const many = Array.from({ length: 12 }, (_, k) => lot({ id: `m${k}`, saleDate: '2026-10-30', saleDateTime: '2026-10-30T23:00:00Z', cardComps: { n: 2, med: 500 } }));
  const sigAll = new Map(many.map(l => [l.id, { label: 'Below Market', pct: 30 }]));
  const all = reads(many, { signalById: sigAll });
  assert.ok(all.length <= T.READS_MAX);
  assert.equal(all.filter(x => x.tag === 'Lands soon').length, T.SOON_N);
  assert.equal(all.filter(x => x.tag === 'Direct comps').length, T.COMPS_N);
  assert.equal(all.filter(x => x.tag === 'Below market').length, T.BELOW_N);
  assert.equal(new Set(all.map(x => x.lot.id)).size, all.length);
  assert.equal(T.hammersIn(0), 'today'); assert.equal(T.hammersIn(1), 'tomorrow'); assert.equal(T.hammersIn(4), 'in 4 days');
});
