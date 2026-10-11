/**
 * THE BUDGET DESK's logic (app/profile/budget/budget.ts) on dated fixtures:
 * the clock is pinned to Oct 9 2026 4 PM ET (the desk's screenshot clock).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuctionLot } from '../../../types';
import type { Follow } from '../../../lib/follows';
import type { Market } from '../../../constants';
import { pinClock } from '../../../lib/__tests__/helpers/pin-clock';
import { lotMaxBid } from '../../../lib/verdict';
import { lotAllInFactor } from '../../../lib/premiums';
import {
  bidPlan, planRowOf, dropOrder, budgetBuys, readerMarkets, followMarket, marketOfLot, winTotals, basisMix,
  nightLabel, isoDayOf, allInText, BASIS_TAG,
} from '../budget';

const NOW_ISO = '2026-10-09T16:00:00-04:00';
pinClock(NOW_ISO);
const NOW = Date.parse(NOW_ISO);

type Partial = Record<string, unknown>;
function mk(id: string, o: Partial): AuctionLot {
  return {
    id, artist: 'andy-warhol', title: 'Untitled', year: null, medium: null, dimensions: null, category: 'print',
    imageUrl: null, auctionHouse: "Christie's", saleName: 'Sale', saleDate: '2026-10-14', lotNumber: 1,
    estimateLow: null, estimateHigh: null, currency: 'USD', hammerPrice: null, premiumPrice: null, priceUsd: null,
    status: 'upcoming', signal: null, ...o,
  } as unknown as AuctionLot;
}
const value = (o: Partial) => ({ poolIds: [], n: 5, compValueUsd: 40000, low: 30000, high: 50000, compRatio: 1.1, signal: null, estimateUsd: 39000, vsBid: null, exact: null, confidence: 'medium', ...o });

// A: Phillips, estimate 26–52K, a CERTIFIED engine max bid (value.low at medium confidence)
const A = mk('phillips-A', { auctionHouse: 'Phillips', title: 'Marilyn (F. & S. II.31)', estLowUsd: 26000, estHighUsd: 52000, estimateLow: 26000, estimateHigh: 52000,
  saleDate: '2026-10-14', saleDateTime: '2026-10-14T14:00:00-04:00', value: value({ maxBidUsd: 36924, low: 39562, compValueUsd: 50000 }) });
// B: Christie's, estimate 10–15K, no engine value → estimate midpoint
const B = mk('christies-B', { title: 'Flowers', estLowUsd: 10000, estHighUsd: 15000, estimateLow: 10000, estimateHigh: 15000, saleDate: '2026-10-14', saleDateTime: '2026-10-14T18:00:00-04:00' });
// C: Wright, estimate 3–5K, Below Market 56% at LOW confidence → no max bid (floor rule), est mid, an edge
const C = mk('wright-C~', { auctionHouse: 'Wright', artist: 'george-nakashima', title: 'Conoid bench', estLowUsd: 3000, estHighUsd: 5000, estimateLow: 3000, estimateHigh: 5000,
  saleDate: '2026-10-13', signal: { label: 'Below Market', pct: 56, confidence: 'medium' }, value: value({ confidence: 'low', low: 3223, maxBidUsd: 3415, compValueUsd: 7000, signal: { label: 'Below Market', strength: 'strong', beatRatePct: 60 } }) });
// D: RR, one published side (low only), a live bid → est anchor on the one side
const D = mk('rrauction-D', { auctionHouse: 'RR Auction', artist: 'historical', title: 'Signed photograph', estLowUsd: 2000, estimateLow: 2000, saleDate: '2026-10-14', currentBid: 1391, bidCount: 15 });
// E: nothing prices it
const E = mk('bonhams-E', { auctionHouse: 'Bonhams', title: 'Study', saleDate: '2026-10-20' });
// F: sold — off the block
const F = mk('christies-F', { status: 'sold', saleDate: '2026-10-01', priceUsd: 5000, estLowUsd: 4000, estHighUsd: 6000 });
// G: Oct 20, estimate 10–15K, medium value with a max bid
const G = mk('christies-G', { title: 'Mao', estLowUsd: 10000, estHighUsd: 15000, estimateLow: 10000, estimateHigh: 15000, saleDate: '2026-10-20', value: value({ maxBidUsd: 11007, low: 11205, compValueUsd: 14000 }) });

const SAVED = [A, B, C, D, E, F, G];

test('isoDayOf / nightLabel read the desk clock: tonight, tomorrow, then the weekday', () => {
  assert.equal(isoDayOf(NOW), '2026-10-09');
  assert.equal(nightLabel('2026-10-09', NOW), 'Tonight');
  assert.equal(nightLabel('2026-10-10', NOW), 'Tomorrow');
  assert.equal(nightLabel('2026-10-14', NOW), 'Wed Oct 14');
});

test('planRowOf: the engine max bid leads, its all-in is verdict.lotMaxBid’s own', () => {
  const r = planRowOf(A, NOW)!;
  assert.equal(r.basis, 'max');
  assert.equal(r.hammer, 36924);
  const mb = lotMaxBid(A)!;
  assert.equal(r.allIn, mb.allIn);
  assert.equal(r.allIn, Math.round(36924 * lotAllInFactor(A, 36924)));
  assert.equal(r.premiumPct, 27); // Phillips under $1M
  assert.equal(r.day, '2026-10-14');
  assert.equal(r.oneSided, false);
});

test('planRowOf: no engine max bid → the estimate midpoint, labelled; a low-confidence value never yields one', () => {
  const b = planRowOf(B, NOW)!;
  assert.equal(b.basis, 'est');
  assert.equal(b.hammer, 12500);
  assert.equal(b.allIn, Math.round(12500 * lotAllInFactor(B, 12500)));
  const c = planRowOf(C, NOW)!;
  assert.equal(c.basis, 'est', 'value.low at low confidence is not a certified floor (lanes.valueFloor)');
  assert.equal(c.hammer, 4000);
  assert.equal(c.belowPct, 56);
  assert.ok(c.edge > 0, 'a Below Market flag is edge');
  assert.equal(BASIS_TAG[c.basis], 'Est mid');
});

test('planRowOf: a one-sided estimate says so; nothing prices → null', () => {
  const d = planRowOf(D, NOW)!;
  assert.equal(d.basis, 'est');
  assert.equal(d.hammer, 2000);
  assert.equal(d.oneSided, true);
  assert.equal(planRowOf(E, NOW), null);
});

test('bidPlan: live lots only, grouped by close night in order; sums per night and overall', () => {
  const p = bidPlan(SAVED, NOW, null);
  assert.deepEqual(p.nights.map(n => n.day), ['2026-10-13', '2026-10-14', '2026-10-20']);
  assert.deepEqual(p.unpriced.map(l => l.id), ['bonhams-E']);
  assert.ok(!p.rows.some(r => r.lot.id === 'christies-F'), 'a sold save is off the block');
  const oct14 = p.nights[1];
  assert.deepEqual(oct14.rows.map(r => r.lot.id), ['phillips-A', 'christies-B', 'rrauction-D'].sort((x, y) => {
    // timed closes first (A 2pm, B 6pm), the date-only RR last
    const o: Record<string, number> = { 'phillips-A': 0, 'christies-B': 1, 'rrauction-D': 2 };
    return o[x] - o[y];
  }));
  assert.equal(oct14.total, 36924 + 12500 + 2000);
  assert.equal(oct14.totalAllIn, oct14.rows.reduce((s, r) => s + r.allIn, 0));
  assert.equal(oct14.nMax, 1);
  assert.equal(oct14.nOther, 2);
  assert.equal(p.total, 36924 + 12500 + 2000 + 4000 + 11007);
  assert.equal(p.ceiling, null);
  assert.equal(p.overNights, 0, 'no ceiling → nothing is over');
  assert.equal(basisMix(p.rows), '2 at max bid · 3 at estimate midpoint');
});

test('bidPlan: a ceiling flags the over nights and suggests drops — lowest edge first, engine-priced last, biggest first', () => {
  const p = bidPlan(SAVED, NOW, { minUsd: 1000, maxUsd: 25000 });
  assert.equal(p.ceiling, 25000);
  const oct14 = p.nights.find(n => n.day === '2026-10-14')!;
  assert.equal(oct14.over, 36924 + 12500 + 2000 - 25000);
  // B (est, no edge, $12.5K) and D (est, no edge, $2K) go before A (max bid):
  // B first (biggest), still over → D, still over → A
  assert.deepEqual(oct14.drops.map(r => r.lot.id), ['christies-B', 'rrauction-D', 'phillips-A']);
  assert.equal(oct14.afterDrops, 0);
  const oct13 = p.nights.find(n => n.day === '2026-10-13')!;
  assert.equal(oct13.over, null);
  assert.equal(p.overNights, 1);
  // a ceiling that one drop clears
  const p2 = bidPlan(SAVED, NOW, { minUsd: null, maxUsd: 50000 });
  const n2 = p2.nights.find(n => n.day === '2026-10-14')!;
  assert.equal(n2.over, 1424);
  assert.deepEqual(n2.drops.map(r => r.lot.id), ['christies-B']);
  assert.equal(n2.afterDrops, 36924 + 2000);
});

test('dropOrder: Above Market before unflagged before flagged; within a tie the unpriced-by-engine rows, biggest first', () => {
  const rows = [planRowOf(A, NOW)!, planRowOf(B, NOW)!, planRowOf(C, NOW)!, planRowOf(D, NOW)!];
  const above = { ...planRowOf(B, NOW)!, edge: -0.25, lot: mk('x-above', {}) };
  assert.deepEqual(dropOrder([...rows, above]).map(r => r.lot.id), ['x-above', 'christies-B', 'rrauction-D', 'phillips-A', 'wright-C~']);
});

test('winTotals: hammer and premiums kept apart; the all-in sum is the rows’ own', () => {
  const p = bidPlan(SAVED, NOW, null);
  const w = winTotals(p);
  assert.equal(w.hammer, p.total);
  assert.equal(w.allIn, p.rows.reduce((s, r) => s + r.allIn, 0));
  assert.equal(w.premiums, w.allIn - w.hammer);
  assert.equal(w.premiumPct, Math.round((w.premiums / w.hammer) * 100));
  assert.deepEqual(w.rows.map(r => r.allIn), [...w.rows.map(r => r.allIn)].sort((a, b) => b - a), 'largest all-in first');
  assert.equal(allInText({ hammer: 1200, allIn: 1500 }), '$1.2K → $1.5K all-in');
  assert.equal(allInText({ hammer: 12500, allIn: 15750 }), '$13K → $16K all-in', 'fmtFace rounds to whole K from $10K');
});

/* ── the reader's markets and what the budget buys ── */

const follows: Follow[] = [
  { kind: 'maker', key: 'andy-warhol', label: 'Andy Warhol' },
  { kind: 'entity', key: 'sj:tcg|k:charizard', label: 'Charizard' },
  { kind: 'cat', key: 'watches', label: 'Watches' },
  { kind: 'house', key: 'Phillips', label: 'Phillips' },
];

test('marketOfLot / followMarket: a lot’s taxonomy category → its market; follows by kind', () => {
  assert.equal(marketOfLot(A), 'art');
  assert.equal(marketOfLot(C), 'design');
  assert.equal(followMarket(follows[0], [A]), 'art');
  assert.equal(followMarket(follows[1], []), 'tcg');
  assert.equal(followMarket(follows[2], []), 'watches');
  assert.equal(followMarket(follows[3], []), null, 'a house is not a market');
  assert.equal(followMarket({ kind: 'cat', key: 'fine-art:prints', label: 'Prints' }, []), 'art');
});

test('readerMarkets: seeds and follows union; nothing stated → empty (every market)', () => {
  const taste = { seeds: [{ kind: 'saved', w: 1, label: 'x', f: { cat: 'design' } }, { kind: 'follow', w: 1, label: 'TCG', market: 'TCG' }] } as unknown as Parameters<typeof readerMarkets>[0];
  assert.deepEqual(Array.from(readerMarkets(taste, follows, [A])).sort(), ['art', 'design', 'tcg', 'watches']);
  assert.equal(readerMarkets(null, [], []).size, 0);
});

const flag = (pct: number, br = 60) => ({ signal: { label: 'Below Market', pct, confidence: 'high' }, value: value({ compValueUsd: 9000, low: 5000, confidence: 'high', signal: { label: 'Below Market', strength: 'strong', beatRatePct: br }, compMedianUsd: 7000, flagRatio: 1 + pct / 100 }) });
const BOOK: AuctionLot[] = [
  // in band, art, closes in 3 days, flagged 40% at beat-rate 60
  mk('christies-b1', { title: 'Cow', estLowUsd: 2000, estHighUsd: 3000, estimateLow: 2000, estimateHigh: 3000, saleDate: '2026-10-12', saleDateTime: '2026-10-12T14:00:00-04:00', ...flag(40) }),
  // in band, art, closes in 5 days, flagged 90% at beat-rate 70 — ranks first (dealScore)
  mk('christies-b2', { title: 'Soup can', estLowUsd: 4000, estHighUsd: 6000, estimateLow: 4000, estimateHigh: 6000, saleDate: '2026-10-14', saleDateTime: '2026-10-14T14:00:00-04:00', ...flag(90, 70) }),
  // closes in 10 days — outside the week
  mk('christies-b3', { title: 'Late', estLowUsd: 2000, estHighUsd: 3000, estimateLow: 2000, estimateHigh: 3000, saleDate: '2026-10-19', ...flag(50) }),
  // $100K+ — outside the band
  mk('christies-b4', { title: 'Big', estLowUsd: 100000, estHighUsd: 150000, estimateLow: 100000, estimateHigh: 150000, saleDate: '2026-10-12', ...flag(50) }),
  // design market — outside the reader's markets
  mk('wright-b5~', { auctionHouse: 'Wright', artist: 'george-nakashima', title: 'Table', estLowUsd: 2000, estHighUsd: 3000, estimateLow: 2000, estimateHigh: 3000, saleDate: '2026-10-12', ...flag(50) }),
  // not flagged
  mk('christies-b6', { title: 'Plain', estLowUsd: 2000, estHighUsd: 3000, estimateLow: 2000, estimateHigh: 3000, saleDate: '2026-10-12' }),
  // flagged but already on the desk
  mk('christies-b7', { title: 'Watched', estLowUsd: 2000, estHighUsd: 3000, estimateLow: 2000, estimateHigh: 3000, saleDate: '2026-10-12', ...flag(50) }),
  // a bid already past the estimate — no edge left
  mk('christies-b8', { title: 'Run away', estLowUsd: 2000, estHighUsd: 3000, estimateLow: 2000, estimateHigh: 3000, saleDate: '2026-10-12', currentBid: 9000, bidCount: 4, ...flag(50) }),
];

test('budgetBuys: Below Market, in the markets, inside the band, closing within 7 days — dealScore order', () => {
  const r = budgetBuys(BOOK, NOW, { minUsd: 1000, maxUsd: 50000 }, new Set<Market>(['art']), new Set(['christies-b7']));
  assert.deepEqual(r.rows.map(x => x.lot.id), ['christies-b2', 'christies-b1']);
  assert.equal(r.candidates, 2);
  assert.equal(r.banded, true);
  assert.deepEqual(r.markets, ['art']);
  assert.equal(r.rows[0].call.label, 'Below Market');
  assert.equal(r.rows[0].call.pct, 90);
  assert.ok(r.rows[0].score > r.rows[1].score);
});

test('budgetBuys: no band → every price; no markets → every market; the cut keeps the count', () => {
  const r = budgetBuys(BOOK, NOW, null, new Set(), new Set(), 2);
  assert.equal(r.banded, false);
  // b1, b2, b4 (now inside), b5 (design now in), b7 (nothing excluded) — b3 late, b6 unflagged, b8 run away
  assert.equal(r.candidates, 5);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.markets, []);
});
