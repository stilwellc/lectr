/**
 * scripts/backtest-core.ts — the published record's AGGREGATION (the numbers
 * /value, /about and the receipts print from backtest.json): which rows land
 * in which cell, never how a row is scored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordByMarketOf, isAboveObs, type CalObs } from '../backtest-core';

const row = (o: Partial<CalObs>): CalObs => ({ m: 'art', cr: 1, beat: false, r: 1, conf: 'low', ageY: 1, et: 'b', pf: 0, fl: false, ...o });

test('isAboveObs: the stamped call wins; legacy rows recover it from the flag ratio', () => {
  assert.equal(isAboveObs(row({ ab: true, cr: 1.1 })), true);
  assert.equal(isAboveObs(row({ ab: false, cr: 0.5 })), false);
  assert.equal(isAboveObs(row({ cr: 0.7 })), true, 'cr <= 0.75 with no fr');
  assert.equal(isAboveObs(row({ cr: 0.7, fr: 0.9 })), false, 'fr (house-normalized) is the flag ratio when present');
  assert.equal(isAboveObs(row({ cr: 0.5, fl: true })), false, 'a below call is never above');
});

test('recordByMarketOf: range-estimate lots only; above calls never counted as unflagged; single-figure separate', () => {
  const rows: CalObs[] = [];
  for (let i = 0; i < 60; i++) rows.push(row({ fl: true, pf: 0.5 }));            // flagged, range
  for (let i = 0; i < 60; i++) rows.push(row({ pf: 0.1, cr: 1 }));               // at market
  for (let i = 0; i < 60; i++) rows.push(row({ pf: -0.2, cr: 0.6 }));            // above market
  for (let i = 0; i < 70; i++) rows.push(row({ fl: true, pf: 2, et: 'p' }));     // single-figure flagged
  const r = recordByMarketOf(rows).art;
  assert.deepEqual(r.flagged, { n: 60, medPct: 50 }, 'single-figure rows stay out of the headline-population cell');
  assert.deepEqual(r.unflagged, { n: 60, medPct: 10 }, 'above-market rows are not unflagged');
  assert.deepEqual(r.above, { n: 60, medPct: -20 });
  assert.deepEqual(r.singleFigure.flagged, { n: 70, medPct: 200 });
  assert.equal(r.singleFigure.unflagged.n, 0);
});

test('recordByMarketOf: a cell under 50 rows publishes no median', () => {
  const r = recordByMarketOf([row({ fl: true, pf: 1 })]).art;
  assert.deepEqual(r.flagged, { n: 1, medPct: null });
});
