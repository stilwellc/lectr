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
import { gradeDesk, monthKeys, dayOf, biasText, settledOf, estMidFor, estSideWord, EDGE_MIN_N, EDGE_HIT_PCT } from '../edge';

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
  assert.deepEqual(r.excluded, { noCall: 1, legacy: 1, noEstimate: 1, afterHammer: 0 });
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
    // the call is made the morning of the hammer (a save dated after the result is not a call — pass 12)
    m[c.id] = meta({ signalPct: c.call, savedAt: `${c.date}T10:00:00.000Z` });
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
  // (pass 12) signed calls exist only since Aug 27 2026 — the fixtures hammer after it
  const r = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01' },  // hit
    { id: 'b', call: 10, price: 11000, date: '2026-09-05' },  // hit
    { id: 'c', call: 10, price: 20000, date: '2026-09-10' },  // miss
    { id: 'd', call: 10, price: 11000, date: '2026-09-15' },  // hit
    { id: 'e', call: 10, price: 11000, date: '2026-09-20' },  // hit
    { id: 'f', call: 10, price: 11000, date: '2026-10-01' },  // hit
  ]);
  assert.deepEqual(r.streak, { current: 3, best: 3, provisional: 0 });
  const broken = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01' },
    { id: 'b', call: 10, price: 20000, date: '2026-09-08' },
  ]);
  assert.deepEqual(broken.streak, { current: 0, best: 1, provisional: 0 });
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
  // (pass 12) signed calls exist only since Aug 27 2026: the months before are
  // gaps by construction; October holds one call (n-gated: a gap, not a zero)
  const r = desk([
    { id: 'a', call: 10, price: 11000, date: '2026-09-01' },
    { id: 'b', call: 10, price: 12100, date: '2026-09-12' },
    { id: 'c', call: 10, price: 9900, date: '2026-09-20' },
    { id: 'd', call: 10, price: 11000, date: '2026-10-04' },
  ]);
  const by = Object.fromEntries(r.months.map(m => [m.key, m]));
  assert.equal(by['2026-09'].n, 3);
  assert.equal(Math.round(by['2026-09'].medianMiss!), 0);
  assert.equal(by['2026-10'].n, 1);
  assert.equal(by['2026-10'].medianMiss, null);       // a gap, not a zero
  for (const k of ['2026-05', '2026-06', '2026-07', '2026-08']) assert.equal(by[k].n, 0);
  assert.equal(r.n, 4);
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

/* ── pass 12 (Oct 29 2026): the figures a collector trusts, on fixtures ── */

test('the all-markets median miss on an EVEN count is the mean of the two middle misses', () => {
  // calls at +0% (called = mid): misses are realized ÷ mid − 1 → +10, +30, −10, +50 → sorted −10, 10, 30, 50 → 20
  const sold = [1100, 1300, 900, 1500].map((p, k) => lot({ id: `e${k}`, priceUsd: p, estimateLow: 800, estimateHigh: 1200, saleDate: `2026-09-1${k}` }));
  const r = gradeDesk({ now: NOW, saved: sold, metaFor: metas(Object.fromEntries(sold.map(l => [l.id, meta({ signalPct: 0.0001 })]))), ledger: noLedger });
  assert.equal(r.n, 4);
  assert.equal(Math.round(r.all.medianMiss! * 1000) / 1000, 20);
});

test('a call on a ONE-SIDED estimate is graded against the published bound and says so (estSide low / high); the market row counts them', () => {
  const low = lot({ id: 'low', auctionHouse: 'RR Auction', estimateLow: 2000, estimateHigh: null, priceUsd: 2400 });
  const high = lot({ id: 'high', estimateLow: null, estimateHigh: 5000, priceUsd: 4000 });
  const both = lot({ id: 'both', priceUsd: 10000 });
  const r = gradeDesk({ now: NOW, saved: [low, high, both], metaFor: metas({ low: meta({ signalPct: 20 }), high: meta({ signalPct: 20 }), both: meta({ signalPct: 20 }) }), ledger: noLedger });
  const by = Object.fromEntries(r.graded.map(c => [c.id, c]));
  assert.equal(by.low.estSide, 'low'); assert.equal(by.low.estMid, 2000);
  assert.equal(by.high.estSide, 'high'); assert.equal(by.high.estMid, 5000);
  assert.equal(by.both.estSide, 'mid'); assert.equal(by.both.estMid, 10000);
  assert.equal(r.all.oneSided, 2);
  assert.equal(estSideWord('low'), 'est. low'); assert.equal(estSideWord('mid'), 'est.'); assert.equal(estSideWord('saved'), 'est. at save');
  // the row that lost its estimate grades on the save-time midpoint and says that too
  const lost = lot({ id: 'lost', estimateLow: null, estimateHigh: null, priceUsd: 9000 });
  const r2 = gradeDesk({ now: NOW, saved: [lost], metaFor: metas({ lost: meta({ signalPct: 10, estMid: 8000 }) }), ledger: noLedger });
  assert.equal(r2.graded[0].estSide, 'saved');
});

test('a dismissed result ("none of these were me") and an owned one (you won it) are still graded — the hammer is the hammer', () => {
  const a = lot({ id: 'a' }), b = lot({ id: 'b' });
  const r = gradeDesk({ now: NOW, saved: [a, b], metaFor: metas({ a: meta({ signalPct: 10, dismissed: true }), b: meta({ signalPct: 10, owned: true }) }), ledger: noLedger });
  assert.equal(r.n, 2);
});

test('a save made AFTER the hammer is not a call: excluded (afterHammer), its max not graded, the Record still judges the lot', () => {
  const l = lot({ id: 'late', saleDate: '2026-09-20' });
  const r = gradeDesk({ now: NOW, saved: [l], metaFor: metas({ late: meta({ savedAt: '2026-09-21T10:00:00.000Z', signalPct: 15, maxUsd: 11000 }) }), ledger: noLedger });
  assert.equal(r.n, 0);
  assert.equal(r.excluded.afterHammer, 1);
  assert.equal(r.mine.n, 0);
  assert.equal(r.settled, 1);
  assert.equal(r.record.n, 1);
  // saved ON the sale day (before the evening hammer) still counts
  const r2 = gradeDesk({ now: NOW, saved: [l], metaFor: metas({ late: meta({ savedAt: '2026-09-20T10:00:00.000Z', signalPct: 15 }) }), ledger: noLedger });
  assert.equal(r2.n, 1);
});

test('currency: a EUR lot grades in USD on both sides — the realized priceUsd against the USD estimate alias (never the native bounds)', () => {
  const eur = lot({ id: 'eur', currency: 'EUR', fxRate: 1.08, estLowNative: 8000, estHighNative: 12000, estLowUsd: 8640, estHighUsd: 12960, estimateLow: 8640, estimateHigh: 12960, realizedNative: 12000, priceUsd: 12960 });
  const r = gradeDesk({ now: NOW, saved: [eur], metaFor: metas({ eur: meta({ signalPct: 20 }) }), ledger: noLedger });
  const c = r.graded[0];
  assert.equal(c.estMid, 10800);
  assert.equal(c.price, 12960);
  assert.equal(Math.round(c.called), 12960);
  assert.equal(Math.round(c.missPct), 0);
});

test('the streak says how many of its hits rest on a PROVISIONAL ledger result', () => {
  const a = lot({ id: 'a', saleDate: '2026-09-01' });
  const b = lot({ id: 'b', status: 'upcoming', priceUsd: null, saleDate: '2026-09-02' });
  const c = lot({ id: 'c', status: 'upcoming', priceUsd: null, saleDate: '2026-09-03' });
  const ledger = new Map<string, LedgerEntry>([['b', [10000, '2026-09-02', 1]], ['c', [10000, '2026-09-03', 1]]]);
  const r = gradeDesk({ now: NOW, saved: [a, b, c], metaFor: metas({ a: meta({ signalPct: 0.0001 }), b: meta({ signalPct: 0.0001 }), c: meta({ signalPct: 0.0001 }) }), ledger });
  assert.deepEqual(r.streak, { current: 3, best: 3, provisional: 2 });
  assert.equal(r.provisional, 2);
});
