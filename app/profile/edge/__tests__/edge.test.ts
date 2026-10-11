/**
 * YOUR EDGE — the grading on fixtures. The clock is pinned (dated fixtures).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinClock } from '../../../lib/__tests__/helpers/pin-clock';
pinClock('2026-10-11T12:00:00-04:00');

import type { AuctionLot } from '../../../types';
import type { SavedMeta } from '../../../lib/account';
import type { LedgerEntry } from '../../../hooks/useRayData';
import { marketOf } from '../../../constants';
import { gradeDesk, monthKeys, dayOf, biasText, settledOf, estMidFor, EDGE_MIN_N, EDGE_HIT_PCT } from '../edge';

const NOW = Date.now();

function lot(p: Partial<AuctionLot> & { id: string }): AuctionLot {
  return {
    artist: 'andy-warhol', title: 'Flowers', auctionHouse: 'Bonhams', saleDate: '2026-09-20',
    status: 'sold', priceUsd: 12000, estimateLow: 8000, estimateHigh: 12000, currency: 'USD',
    category: 'print', imageUrl: null, url: 'https://x', ...p,
  } as unknown as AuctionLot;
}
function meta(p: Partial<SavedMeta> = {}): SavedMeta {
  return { savedAt: '2026-09-01T00:00:00.000Z', estMid: null, signalPct: null, bidCount: null, ...p };
}
const metas = (m: Record<string, SavedMeta>) => (id: string) => m[id] ?? null;
const noLedger = new Map<string, LedgerEntry>();

test('a call is graded on one yardstick: called = mid × (1 + call), miss = realized ÷ called − 1', () => {
  // mid 10,000; saved below market +20% → called 12,000; hammer 12,600 → +5%, a hit, right side
  const r = gradeDesk({
    now: NOW, ledger: noLedger,
    saved: [lot({ id: 'a', estimateLow: 8000, estimateHigh: 12000, priceUsd: 12600 })],
    metaFor: metas({ a: meta({ signalPct: 20 }) }),
  });
  assert.equal(r.n, 1);
  const c = r.graded[0];
  assert.equal(c.dir, 'below');
  assert.equal(c.callPct, 20);
  assert.equal(c.estMid, 10000);
  assert.equal(c.called, 12000);
  assert.equal(Math.round(c.missPct), 5);
  assert.equal(c.hit, true);
  assert.equal(c.side, true);
  assert.equal(c.provisional, false);
  assert.equal(c.market, marketOf('andy-warhol'));
});

test('an above-market call is negative; a hammer far under it is a miss on the right side', () => {
  // mid 10,000; saved above market (−10%) → called 9,000; hammer 7,000 → −22%, not a hit; side right (under the estimate)
  const r = gradeDesk({
    now: NOW, ledger: noLedger,
    saved: [lot({ id: 'b', priceUsd: 7000 })],
    metaFor: metas({ b: meta({ signalPct: -10 }) }),
  });
  const c = r.graded[0];
  assert.equal(c.dir, 'above');
  assert.equal(c.callPct, -10);
  assert.equal(c.called, 9000);
  assert.equal(Math.round(c.missPct), -22);
  assert.equal(c.hit, false);
  assert.equal(c.side, true);
});

test('the signed-signal law: a legacy save, a save without a signal and a lot without an estimate are never graded', () => {
  const r = gradeDesk({
    now: NOW, ledger: noLedger,
    saved: [
      lot({ id: 'legacy' }),
      lot({ id: 'nocall' }),
      lot({ id: 'noest', estimateLow: null, estimateHigh: null }),
    ],
    metaFor: metas({
      legacy: meta({ savedAt: '2026-08-01T00:00:00.000Z', signalPct: 15 }),
      nocall: meta(),
      noest: meta({ signalPct: 15 }),   // no estMid recorded either
    }),
  });
  assert.equal(r.n, 0);
  assert.equal(r.settled, 3);
  assert.deepEqual(r.excluded, { noCall: 1, legacy: 1, noEstimate: 1 });
  // the Record's own judgment still counts the two with an estimate
  assert.equal(r.record.n, 2);
});

test('an unresolved save grades from the sold ledger (aliases walked) and a provisional result is flagged', () => {
  const ledger = new Map<string, LedgerEntry>([['c~', [11000, '2026-09-15', 1]]]);
  const r = gradeDesk({
    now: NOW, ledger,
    saved: [lot({ id: 'c', status: 'upcoming', priceUsd: null, saleDate: '2026-09-15' })],
    metaFor: metas({ c: meta({ signalPct: 10 }) }),
  });
  assert.equal(r.n, 1);
  assert.equal(r.graded[0].price, 11000);
  assert.equal(r.graded[0].date, '2026-09-15');
  assert.equal(r.graded[0].provisional, true);
  assert.equal(r.provisional, 1);
});

test('the save-time estimate midpoint grades a lot whose row lost its estimate', () => {
  const l = lot({ id: 'd', estimateLow: null, estimateHigh: null, priceUsd: 5500 });
  assert.equal(estMidFor(l, meta({ estMid: 5000 })), 5000);
  const r = gradeDesk({ now: NOW, ledger: noLedger, saved: [l], metaFor: metas({ d: meta({ estMid: 5000, signalPct: 10 }) }) });
  assert.equal(r.graded[0].called, 5500);
  assert.equal(Math.round(r.graded[0].missPct), 0);
  // the Record's number reads the lot's own estimate only (as /profile does)
  assert.equal(r.record.n, 0);
});

test('a result dated after the desk clock is not settled yet', () => {
  const r = gradeDesk({ now: NOW, ledger: noLedger, saved: [lot({ id: 'e', saleDate: '2026-10-20' })], metaFor: metas({ e: meta({ signalPct: 10 }) }) });
  assert.equal(r.settled, 0);
  assert.equal(r.n, 0);
  assert.equal(settledOf(lot({ id: 'z', status: 'upcoming', priceUsd: null }), noLedger), null);
});

function desk(calls: { id: string; call: number; price: number; date: string; artist?: string; signal?: AuctionLot['signal'] }[]) {
  const m: Record<string, SavedMeta> = {};
  const saved = calls.map(c => {
    m[c.id] = meta({ signalPct: c.call });
    return lot({ id: c.id, priceUsd: c.price, saleDate: c.date, artist: c.artist ?? 'andy-warhol', estimateLow: 10000, estimateHigh: 10000, ...(c.signal !== undefined ? { signal: c.signal } : {}) });
  });
  return gradeDesk({ now: NOW, ledger: noLedger, saved, metaFor: metas(m) });
}

test('medians, hit rate and bias print only at EDGE_MIN_N; under it the row says so', () => {
  const two = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01' },
    { id: 'b', call: 10, price: 11000, date: '2026-09-02' },
  ]);
  assert.equal(two.n, 2);
  assert.equal(two.all.medianMiss, null);
  assert.equal(two.all.bias, null);
  assert.equal(two.all.hits, 2);
  assert.equal(biasText(two.all), null);

  const three = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01' },   // 0%
    { id: 'b', call: 10, price: 12100, date: '2026-09-02' },   // +10%
    { id: 'c', call: 10, price: 14300, date: '2026-09-03' },   // +30% miss
  ]);
  assert.equal(three.n, EDGE_MIN_N);
  assert.equal(Math.round(three.all.medianMiss!), 10);
  assert.equal(three.all.bias, 'above');
  assert.equal(biasText(three.all), 'hammers ran 10% above your calls');
  assert.equal(three.all.hits, 2);
  assert.equal(three.all.hitRate, 2 / 3);
});

test('streaks count hits in a row in hammer order; current is the trailing run', () => {
  const r = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-04-01' },  // hit
    { id: 'b', call: 10, price: 11000, date: '2026-05-01' },  // hit
    { id: 'c', call: 10, price: 20000, date: '2026-06-01' },  // miss
    { id: 'd', call: 10, price: 11000, date: '2026-07-01' },  // hit
    { id: 'e', call: 10, price: 11000, date: '2026-08-01' },  // hit
    { id: 'f', call: 10, price: 11000, date: '2026-09-01' },  // hit
  ]);
  assert.deepEqual(r.streak, { current: 3, best: 3 });
  const broken = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-08-01' },
    { id: 'b', call: 10, price: 20000, date: '2026-09-01' },
  ]);
  assert.deepEqual(broken.streak, { current: 0, best: 1 });
});

test('best and worst are the smallest and largest |miss|; a lone call has no worst', () => {
  const r = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01' },   // 0%
    { id: 'b', call: 10, price: 9900, date: '2026-09-02' },    // −10%
    { id: 'c', call: 10, price: 16500, date: '2026-09-03' },   // +50%
  ]);
  assert.equal(r.best!.id, 'a');
  assert.equal(r.worst!.id, 'c');
  const one = desk([{ id: 'a', call: 10, price: 11000, date: '2026-09-01' }]);
  assert.equal(one.best!.id, 'a');
  assert.equal(one.worst, null);
});

test('the monthly series is the last six calendar months of the desk clock, gaps as gaps, medians n-gated', () => {
  assert.deepEqual(monthKeys(NOW).map(m => m.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(monthKeys(NOW)[5].label, 'Oct');
  assert.equal(dayOf(NOW), '2026-10-11');
  const r = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01' },
    { id: 'b', call: 10, price: 12100, date: '2026-09-12' },
    { id: 'c', call: 10, price: 9900, date: '2026-09-20' },
    { id: 'd', call: 10, price: 11000, date: '2026-07-04' },
    { id: 'e', call: 10, price: 11000, date: '2025-12-04' },   // outside the window
  ]);
  const by = Object.fromEntries(r.months.map(m => [m.key, m]));
  assert.equal(by['2026-09'].n, 3);
  assert.equal(Math.round(by['2026-09'].medianMiss!), 0);
  assert.equal(by['2026-07'].n, 1);
  assert.equal(by['2026-07'].medianMiss, null);       // a gap, not a zero
  assert.equal(by['2026-08'].n, 0);
  assert.equal(by['2026-10'].n, 0);
  assert.equal(r.n, 5);                                // the window gates the chart, not the record
});

test('calls group by market, most calls first, with an all-markets row', () => {
  const r = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01', artist: 'rolex' },
    { id: 'b', call: 10, price: 11000, date: '2026-09-02', artist: 'rolex' },
    { id: 'c', call: 10, price: 11000, date: '2026-09-03', artist: 'andy-warhol' },
  ]);
  assert.equal(r.markets.length, 2);
  assert.equal(r.markets[0].market, marketOf('rolex'));
  assert.equal(r.markets[0].n, 2);
  assert.equal(r.markets.reduce((s, m) => s + m.n, 0), r.all.n);
  assert.equal(r.all.label, 'All markets');
});

test('engine agreement reads the engine’s current call on the lot against the saved side', () => {
  const r = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01', signal: { label: 'Below Market', pct: 12 } },
    { id: 'b', call: 10, price: 11000, date: '2026-09-02', signal: { label: 'Above Market', pct: 9 } },
    { id: 'c', call: 10, price: 11000, date: '2026-09-03', signal: null },
  ]);
  assert.equal(r.graded.find(c => c.id === 'a')!.agree, true);
  assert.equal(r.graded.find(c => c.id === 'b')!.agree, false);
  assert.equal(r.graded.find(c => c.id === 'c')!.agree, null);
  assert.deepEqual(r.agreement, { agree: 1, n: 2 });
});

test('a hit is within ±EDGE_HIT_PCT of the called price, inclusive', () => {
  const r = desk([
    { id: 'in', call: 0.0001, price: 12000, date: '2026-09-01' },
  ]);
  // signalPct 0 is "no call" (account.signalCallOf) — this near-zero call grades
  assert.equal(r.n, 1);
  assert.equal(Math.round(r.graded[0].missPct), EDGE_HIT_PCT);
  assert.equal(r.graded[0].hit, true);
});
