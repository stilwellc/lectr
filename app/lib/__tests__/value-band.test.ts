/**
 * app/lib/value-band.ts — the client reads calibration.valueBand keyed
 * path ('e'/'n') → tier, the shape backtest.json publishes. Before this the
 * modal indexed valueBand[tier] (always undefined) and the Lab band figure
 * read valueBand.high (undefined → the figure never rendered).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibratedBand, calibratedBands, bandPathOf } from '../value-band';

// the served shape (backtest.json calibration, Oct 2026)
const cal = {
  valueBand: {
    e: { high: { lo: 0.802, hi: 1.452, mb: 0.907 }, medium: { lo: 0.752, hi: 1.629 }, low: { lo: 0.704, hi: 1.88 } },
    n: { low: { lo: 0.387, hi: 2.921 } },
  },
  valueBandByMarket: { watches: { e: { high: { lo: 0.85, hi: 1.3 } } } },
  band: { high: { lo: 0.753, hi: 1.797 }, medium: { lo: 0.64, hi: 2.109 }, low: { lo: 0.518, hi: 2.407 } },
};

test('calibratedBand reads valueBand[path][tier], not the legacy band', () => {
  assert.deepEqual(calibratedBand(cal, 'high', 'e'), cal.valueBand.e.high);
  assert.deepEqual(calibratedBand(cal, 'low', 'n'), cal.valueBand.n.low);
});

test('calibratedBand prefers the per-market cell, then walks value.ts\'s ladder', () => {
  assert.deepEqual(calibratedBand(cal, 'high', 'e', 'watches'), { lo: 0.85, hi: 1.3 });
  assert.deepEqual(calibratedBand(cal, 'medium', 'e', 'watches'), cal.valueBand.e.medium);
  // a cell valueBand does not cover → the legacy conformal band (value.ts does the same)
  assert.deepEqual(calibratedBand(cal, 'high', 'n'), cal.band.high);
  assert.equal(calibratedBand(null, 'high'), null);
});

test('calibratedBand on an older backtest.json (no valueBand) keeps the legacy band', () => {
  assert.deepEqual(calibratedBand({ band: cal.band }, 'medium'), cal.band.medium);
});

test('calibratedBands: the estimate path\'s tiers for the Lab figure', () => {
  const b = calibratedBands(cal, 'e');
  assert.ok(b?.high, 'high tier present (the figure gates on band.high)');
  assert.equal(b?.high.lo, 0.802);
  assert.deepEqual(calibratedBands({ band: cal.band }), cal.band);
});

test('bandPathOf: either estimate side → e; none → n', () => {
  assert.equal(bandPathOf({ estimateLow: 1000, estimateHigh: 2000 }), 'e');
  assert.equal(bandPathOf({ estimateLow: 1000, estimateHigh: null }), 'e');
  assert.equal(bandPathOf({ estimateLow: null, estimateHigh: null }), 'n');
});
