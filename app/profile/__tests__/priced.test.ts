/**
 * ONE "PRICED" RULE (desk/priced) — both bounds = priced and summed; one
 * bound = "from $X", counted, never summed; none = nothing. USD first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricedOf, estMidOf, isPriced, fromText, pricedTotal } from '../desk/priced';

test('pricedOf: both bounds → priced at the midpoint', () => {
  const p = pricedOf({ estimateLow: 1000, estimateHigh: 3000 });
  assert.deepEqual(p, { priced: true, mid: 2000, oneSided: false, from: null, lo: 1000, hi: 3000 });
  assert.equal(estMidOf({ estimateLow: 1000, estimateHigh: 3000 }), 2000);
  assert.equal(isPriced({ estimateLow: 1000, estimateHigh: 3000 }), true);
  assert.equal(fromText({ estimateLow: 1000, estimateHigh: 3000 }), null);
});

test('pricedOf: one bound (RR "from $700") → unpriced, "from $700", never a midpoint', () => {
  const p = pricedOf({ estimateLow: 700, estimateHigh: null });
  assert.equal(p.priced, false); assert.equal(p.oneSided, true); assert.equal(p.from, 700); assert.equal(p.mid, null);
  assert.equal(estMidOf({ estimateLow: 700 }), null);
  assert.equal(fromText({ estimateLow: 700 }), 'from $700');
  // the high bound alone is a bound too
  assert.equal(fromText({ estimateHigh: 45_000 }), 'from $45K');
  assert.equal(isPriced({ estimateHigh: 45_000 }), false);
});

test('pricedOf: nothing published → nothing (a zero is not a bound)', () => {
  assert.deepEqual(pricedOf({}), { priced: false, mid: null, oneSided: false, from: null, lo: null, hi: null });
  assert.deepEqual(pricedOf({ estimateLow: 0, estimateHigh: 0 }), { priced: false, mid: null, oneSided: false, from: null, lo: null, hi: null });
  assert.equal(fromText({}), null);
});

test('pricedOf: the USD bounds win over the raw ones when the build converted a foreign estimate', () => {
  const p = pricedOf({ estLowUsd: 233, estHighUsd: 311, estimateLow: 1500, estimateHigh: 2000 });
  assert.equal(p.mid, 272); assert.equal(p.lo, 233); assert.equal(p.hi, 311);
  // one USD bound present, the other missing: the raw bound is NOT mixed in — it is one-sided
  const q = pricedOf({ estLowUsd: 233, estHighUsd: null, estimateLow: 1500, estimateHigh: 2000 });
  assert.equal(q.priced, true, 'estHighUsd null falls through to the raw high bound (the same lot, same currency as the build left it)');
});

test('pricedTotal: sums the priced midpoints only; counts one-sided rows apart', () => {
  const t = pricedTotal([
    { estimateLow: 1000, estimateHigh: 3000 },   // 2000
    { estimateLow: 700 },                         // from $700 — not summed
    { estimateLow: 10_000, estimateHigh: 20_000 }, // 15000
    {},                                           // bid-only
  ]);
  assert.deepEqual(t, { total: 17_000, priced: 2, oneSided: 1, n: 4 });
});
