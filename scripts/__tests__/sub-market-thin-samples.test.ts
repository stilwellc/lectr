/**
 * Sub-market page math n-gates: a 'typical price' needs MIN_TYPICAL_SALES
 * trailing-year sales (computeStats medians whatever the year held — or
 * carries the previous run's median forward when it held none).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubMarkets } from '../sub-markets';
import { ARTISTS } from '../../app/constants';

const slug = ARTISTS.find(a => a.market === 'art')!.slug;
const row = (sold12m: number | undefined) => {
  const out = buildSubMarkets([], { [slug]: { sold12m, medianPriceLast12Months: 83200, avgPriceLast12Months: 90000 } }, {});
  return Object.values(out).flat().find(r => r.slug === slug)!;
};

test('typical price is withheld under 10 trailing-year sales', () => {
  assert.equal(row(5).typicalUsd, null);
  assert.equal(row(0).typicalUsd, null);
  assert.equal(row(undefined).typicalUsd, null);
});

test('typical price publishes at 10+ sales', () => {
  assert.equal(row(10).typicalUsd, 83200);
});
